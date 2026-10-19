"""Load a world save, inspect it, render stills and renderer fixtures.

Usage::

    uv run python -m tools.replay <save.lzma> [--config sim/config/default.toml]
        [--still out.png [--scale 3]] [--renderer-fixture DIR]

Prints a summary of the save. ``--still`` writes a pixel-art picture of the world with
its plants and creatures. ``--renderer-fixture`` writes the files the renderer spike
draws (R0): ``terrain.png`` (the bare ground, one pixel per cell), ``map.png`` (the same
with plants as flat colours, for wide shots) and ``world.json`` (plants cell by cell,
creatures and the palette). Besides the world's own creatures, ``world.json`` carries
casts for the look sheet: the specimen genomes of ``phenotypes.json`` and, gene by gene,
a plain animal with that one gene swept from 0 to 1. The fixture is a stand-in until the
state stream and its protocol exist (R1).
"""

from __future__ import annotations

import argparse
import base64
import json
from pathlib import Path
from typing import Any

import numpy as np
from lineage_sim.config import FaunaConfig, parse_config
from lineage_sim.fauna.genome import GENE_COUNT, Gene
from lineage_sim.fauna.phenotype import Phenotype, phenotype
from lineage_sim.flora import Cover
from lineage_sim.state import io
from lineage_sim.world import World
from PIL import Image

from tools.runs import DEFAULT_CONFIG, REPO_ROOT
from tools.viz import pixelmap

FIXTURE_FORMAT = "lineage-spike-fixture/3"
# Heights are stored as whole numbers: this many steps between 0 and 1.
HEIGHT_STEPS = 65535
MS_PER_DAY = 86_400_000
# One row per creature in ``world.json``: where it is, the body the phenotype function
# derives, then the genes that show on it.
BODY_FIELDS = ("mass", "limb_pairs", "land_speed", "swim_speed")
SHOWN_GENES = (
    Gene.DIET,
    Gene.SPEED,
    Gene.ARMOUR,
    Gene.SENSE,
    Gene.AQUATIC,
    Gene.JAW,
    Gene.HUE,
    Gene.PATTERN,
)
CREATURE_FIELDS = ("x", "y", *BODY_FIELDS, *(gene.name.lower() for gene in SHOWN_GENES))

# The specimen genomes shared with the renderer's phenotype check (R2).
SPECIMENS = REPO_ROOT / "sim" / "tests" / "fixtures" / "phenotypes.json"
# Gene sweeps start from a plain animal: mid-sized, two leg pairs, nothing that shows
# switched on, in a colour that stands out on every ground.
SWEEP_BASE = {
    Gene.SIZE: 0.5,
    Gene.DIET: 0.2,
    Gene.LIMBS: 0.5,
    Gene.SPEED: 0.5,
    Gene.ARMOUR: 0.0,
    Gene.SENSE: 0.4,
    Gene.AQUATIC: 0.0,
    Gene.JAW: 0.5,
    Gene.BROOD: 0.0,
    Gene.HUE: 0.92,
    Gene.PATTERN: 0.0,
    # The lifetime-learning genes (M5) have no look.
    Gene.LEARNING: 0.0,
    Gene.EXPLORATION: 0.0,
    Gene.SOCIAL: 0.0,
}
SWEEP_STEPS = (0.0, 0.25, 0.5, 0.75, 1.0)
# Every gene with a look, in the order the sheet shows them. BROOD and the learning
# genes have none.
SWEEP_GENES = (
    Gene.SIZE,
    Gene.LIMBS,
    Gene.SPEED,
    Gene.ARMOUR,
    Gene.SENSE,
    Gene.AQUATIC,
    Gene.JAW,
    Gene.DIET,
    Gene.HUE,
    Gene.PATTERN,
)


def load_world(save: Path, config_path: Path = DEFAULT_CONFIG) -> World:
    config = parse_config(config_path.read_text(encoding="utf-8"))
    return World.restore(config, io.loads(save.read_bytes()))


def summary(world: World) -> dict[str, Any]:
    """The facts about a world one wants at a glance."""
    herbivores, omnivores, predators = world.fauna.diet_counts()
    return {
        "seed": world.seed,
        "sim_days": world.t_ms / MS_PER_DAY,
        "date": world.instant.date.isoformat(),
        "season": world.instant.season.value,
        "grid": [int(world.terrain.height.shape[1]), int(world.terrain.height.shape[0])],
        "land_fraction": round(world.terrain.land_fraction, 4),
        "sea_level": round(world.terrain.sea_level, 4),
        "landmasses": world.terrain.landmass_count,
        "cover": {
            cover.name.lower(): round(share, 4)
            for cover, share in world.flora.cover_shares().items()
        },
        "creatures": world.fauna.count,
        "herbivores": herbivores,
        "omnivores": omnivores,
        "predators": predators,
    }


def render_still(world: World, scale: int = 1) -> np.ndarray:
    """Pixel-art picture of the world: ground, plants and one pixel per creature."""
    terrain, flora, fauna = world.terrain, world.flora, world.fauna
    image = pixelmap.render(
        terrain.height, terrain.sea_level, flora.cover(), flora.biomass, scale=scale
    )
    creatures = np.column_stack(
        [fauna.positions, fauna.genes[:, Gene.DIET], fauna.genes[:, Gene.SIZE]]
    )
    cfg = fauna.config
    return pixelmap.draw_creatures(
        image, creatures, cfg.herbivore_max_diet, cfg.predator_min_diet, scale=scale
    )


def creature_rows(
    body: Phenotype, genes: np.ndarray, positions: np.ndarray | None = None
) -> list[list[float]]:
    """One row of ``CREATURE_FIELDS`` per creature; without positions they are all at 0, 0."""
    if positions is None:
        positions = np.zeros((len(genes), 2), dtype=np.float32)
    columns = [
        positions[:, 0],
        positions[:, 1],
        *(getattr(body, name) for name in BODY_FIELDS),
        *(genes[:, gene] for gene in SHOWN_GENES),
    ]
    return np.round(np.column_stack(columns).astype(np.float64), 3).tolist()


def _cast(cfg: FaunaConfig, name: str, members: list[str], genomes: np.ndarray) -> dict[str, Any]:
    genes = genomes.astype(np.float32)
    return {
        "name": name,
        "members": members,
        "creatures": creature_rows(phenotype(cfg, genes), genes),
    }


def casts(cfg: FaunaConfig) -> list[dict[str, Any]]:
    """Creatures chosen to show the range of bodies, for the renderer's look sheet.

    ``specimens`` are the genomes of ``phenotypes.json``. Each ``sweep-<gene>`` is the
    plain animal of ``SWEEP_BASE`` with that one gene at each of ``SWEEP_STEPS``.
    """
    specimens = json.loads(SPECIMENS.read_text(encoding="utf-8"))["specimens"]
    out = [
        _cast(
            cfg,
            "specimens",
            [specimen["name"] for specimen in specimens],
            np.array([specimen["genome"] for specimen in specimens]),
        )
    ]
    base = np.zeros(GENE_COUNT)
    for gene, value in SWEEP_BASE.items():
        base[gene] = value
    for gene in SWEEP_GENES:
        genomes = np.tile(base, (len(SWEEP_STEPS), 1))
        genomes[:, gene] = SWEEP_STEPS
        members = [f"{step:g}" for step in SWEEP_STEPS]
        out.append(_cast(cfg, f"sweep-{gene.name.lower()}", members, genomes))
    return out


def _b64(grid: np.ndarray) -> str:
    return base64.b64encode(np.ascontiguousarray(grid, dtype=np.uint8).tobytes()).decode("ascii")


def renderer_fixture(world: World, source: str) -> tuple[np.ndarray, np.ndarray, dict[str, Any]]:
    """The spike fixture: (ground image, vegetation map, contents of ``world.json``).

    The ground image has no plants; they come cell by cell (cover class and biomass) so
    the renderer can draw them as sprites. The vegetation map shows them as flat colours,
    one pixel per cell, for shots too wide for sprites.
    """
    terrain, flora, fauna = world.terrain, world.flora, world.fauna
    rows, columns = terrain.height.shape
    ground = pixelmap.render(terrain.height, terrain.sea_level)
    vegetated = pixelmap.render(terrain.height, terrain.sea_level, flora.cover(), flora.biomass)
    # Bodies from the genes alone; rare genes (M7) are overlays the renderer adds itself.
    creatures = creature_rows(phenotype(fauna.config, fauna.genes), fauna.genes, fauna.positions)
    palette = {cover.name: list(ramp) for cover, ramp in pixelmap.LAND_RAMPS.items()}
    palette["DORMANT"] = list(pixelmap.DORMANT)
    document = {
        "format": FIXTURE_FORMAT,
        "source": {"save": source, **summary(world)},
        "width": int(columns),
        "height": int(rows),
        # Heights of the cells, row by row, as little-endian 16-bit numbers: with the sea
        # level, what the close-up's ground is interpolated from.
        "heights": base64.b64encode(
            np.round(terrain.height.astype(np.float64) * HEIGHT_STEPS).astype("<u2").tobytes()
        ).decode("ascii"),
        "height_steps": HEIGHT_STEPS,
        "sea_level": round(float(terrain.sea_level), 6),
        "cover_classes": [cover.name for cover in Cover],
        "cover": _b64(flora.cover()),
        "biomass": _b64(np.round(flora.biomass * 255.0)),
        "dormant_below_biomass": pixelmap.DORMANT_BELOW,
        "dormant_classes": [cover.name for cover in pixelmap.DORMANT_CLASSES],
        "palette": palette,
        # How the maps turn height into colour, for the renderer to do the same between
        # cells: sea bands by depth (shallowest first), relief by slope toward the light,
        # rock and snow on bare high ground, and the outline of the shore.
        "relief": {
            "sea_bands": [[limit, colour] for limit, colour in pixelmap.SEA_BANDS],
            "slope": pixelmap.RELIEF_SLOPE,
            "high_rock": {"from": pixelmap.HIGH_ROCK_FROM, "ramp": list(pixelmap.HIGH_ROCK)},
            "snow": {"from": pixelmap.SNOW_FROM, "ramp": list(pixelmap.SNOW)},
            "shore_outline": pixelmap.SHORE_OUTLINE,
        },
        "diet_classes": {
            "herbivore_max": fauna.config.herbivore_max_diet,
            "predator_min": fauna.config.predator_min_diet,
        },
        "creature_fields": list(CREATURE_FIELDS),
        "creatures": creatures,
        "casts": casts(fauna.config),
    }
    return ground, vegetated, document


def write_renderer_fixture(world: World, out_dir: Path, source: str) -> None:
    ground, vegetated, document = renderer_fixture(world, source)
    out_dir.mkdir(parents=True, exist_ok=True)
    for name, image in (("terrain.png", ground), ("map.png", vegetated)):
        Image.fromarray(image, mode="RGB").save(out_dir / name, format="PNG", optimize=True)
    (out_dir / "world.json").write_text(
        json.dumps(document, separators=(",", ":")) + "\n", encoding="utf-8"
    )


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Inspect a world save and render it.")
    parser.add_argument("save", type=Path, help="a save file written by the sim (.lzma)")
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--still", type=Path, help="write a pixel-art PNG of the world here")
    parser.add_argument("--scale", type=int, default=3, help="pixels per cell in the still")
    parser.add_argument(
        "--renderer-fixture", type=Path, help="write terrain.png and world.json for the spike"
    )
    args = parser.parse_args(argv)
    world = load_world(args.save, args.config)
    print(json.dumps(summary(world), indent=2))
    if args.still is not None:
        args.still.parent.mkdir(parents=True, exist_ok=True)
        Image.fromarray(render_still(world, args.scale), mode="RGB").save(args.still)
        print(f"wrote {args.still}")
    if args.renderer_fixture is not None:
        write_renderer_fixture(world, args.renderer_fixture, args.save.as_posix())
        print(f"wrote terrain.png, map.png and world.json in {args.renderer_fixture}")


if __name__ == "__main__":
    main()
