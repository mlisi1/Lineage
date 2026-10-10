"""Load a world save, inspect it, render stills and renderer fixtures.

Usage::

    uv run python -m tools.replay <save.lzma> [--config sim/config/default.toml]
        [--still out.png [--scale 3]] [--renderer-fixture DIR]

Prints a summary of the save. ``--still`` writes a pixel-art picture of the world with
its plants and creatures. ``--renderer-fixture`` writes the files the renderer spike
draws (R0): ``terrain.png`` (the bare ground, one pixel per cell), ``map.png`` (the same
with plants as flat colours, for wide shots) and ``world.json`` (plants cell by cell,
creatures and the palette). The fixture is a stand-in until the state stream and its
protocol exist (R1).
"""

from __future__ import annotations

import argparse
import base64
import json
from pathlib import Path
from typing import Any

import numpy as np
from lineage_sim.config import parse_config
from lineage_sim.fauna.genome import Gene
from lineage_sim.flora import Cover
from lineage_sim.state import io
from lineage_sim.world import World
from PIL import Image

from tools.runs import DEFAULT_CONFIG
from tools.viz import pixelmap

FIXTURE_FORMAT = "lineage-spike-fixture/1"
MS_PER_DAY = 86_400_000
# One row per creature in ``world.json``, in this order.
CREATURE_FIELDS = (
    "x",
    "y",
    "mass",
    "limb_pairs",
    "land_speed",
    "diet",
    "armour",
    "hue",
    "pattern",
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
    body, genes = fauna.body, fauna.genes
    creatures = np.column_stack(
        [
            fauna.positions[:, 0],
            fauna.positions[:, 1],
            body.mass,
            body.limb_pairs,
            body.land_speed,
            genes[:, Gene.DIET],
            genes[:, Gene.ARMOUR],
            genes[:, Gene.HUE],
            genes[:, Gene.PATTERN],
        ]
    )
    palette = {cover.name: list(ramp) for cover, ramp in pixelmap.LAND_RAMPS.items()}
    palette["DORMANT"] = list(pixelmap.DORMANT)
    document = {
        "format": FIXTURE_FORMAT,
        "source": {"save": source, **summary(world)},
        "width": int(columns),
        "height": int(rows),
        "cover_classes": [cover.name for cover in Cover],
        "cover": _b64(flora.cover()),
        "biomass": _b64(np.round(flora.biomass * 255.0)),
        "dormant_below_biomass": pixelmap.DORMANT_BELOW,
        "dormant_classes": [cover.name for cover in pixelmap.DORMANT_CLASSES],
        "palette": palette,
        "creature_fields": list(CREATURE_FIELDS),
        "creatures": np.round(creatures.astype(np.float64), 3).tolist(),
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
