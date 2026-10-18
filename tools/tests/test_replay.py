"""Replaying a save: summary, stills, and the fixture the renderer spike draws."""

from __future__ import annotations

import base64
import json
from pathlib import Path

import numpy as np
import pytest
from lineage_sim.fauna.genome import Gene
from lineage_sim.fauna.phenotype import phenotype_config
from lineage_sim.flora import Cover
from PIL import Image

from tools import replay
from tools.runs import REPO_ROOT
from tools.viz import pixelmap

SAVE = Path("sim/tests/fixtures/saves/v4.lzma")
SPIKE_FIXTURE = REPO_ROOT / "renderer" / "public" / "spike"


@pytest.fixture(scope="module")
def world() -> replay.World:
    return replay.load_world(REPO_ROOT / SAVE)


def test_summary_of_the_fixture_save(world: replay.World) -> None:
    facts = replay.summary(world)
    assert facts["seed"] == 42
    assert facts["grid"] == [256, 150]
    assert facts["date"] == "2027-08-03"
    assert facts["season"] == "summer"
    assert 0.0 < facts["land_fraction"] < 1.0
    assert facts["creatures"] == world.fauna.count > 0
    assert facts["herbivores"] + facts["omnivores"] + facts["predators"] == facts["creatures"]
    assert sum(facts["cover"].values()) == pytest.approx(1.0, abs=1e-3)
    json.dumps(facts)  # plain numbers and strings only


def test_still_is_a_scaled_picture(world: replay.World) -> None:
    still = replay.render_still(world, scale=2)
    assert still.shape == (300, 512, 3)
    assert still.dtype == np.uint8
    # Creatures are drawn over the map: the still differs from the map alone.
    terrain, flora = world.terrain, world.flora
    bare = pixelmap.render(terrain.height, terrain.sea_level, flora.cover(), flora.biomass, scale=2)
    assert bare.shape == still.shape
    assert not np.array_equal(still, bare)


def test_renderer_fixture_describes_the_world(world: replay.World) -> None:
    ground, vegetated, document = replay.renderer_fixture(world, "a.lzma")
    assert document["format"] == replay.FIXTURE_FORMAT
    assert document["source"]["save"] == "a.lzma"
    assert (document["width"], document["height"]) == (256, 150)
    assert ground.shape == vegetated.shape == (150, 256, 3)
    assert not np.array_equal(ground, vegetated)  # plants are only on the second

    cover = np.frombuffer(base64.b64decode(document["cover"]), dtype=np.uint8)
    biomass = np.frombuffer(base64.b64decode(document["biomass"]), dtype=np.uint8)
    assert cover.size == biomass.size == 256 * 150
    assert np.array_equal(cover.reshape(150, 256), world.flora.cover())
    assert document["cover_classes"] == [c.name for c in Cover]
    assert cover.max() < len(document["cover_classes"])
    # Where there is water there is nothing growing.
    assert not biomass[cover == Cover.WATER].any()

    assert document["creature_fields"] == list(replay.CREATURE_FIELDS)
    rows = np.array(document["creatures"])
    assert rows.shape == (world.fauna.count, len(replay.CREATURE_FIELDS))
    x, y = rows[:, 0], rows[:, 1]
    assert ((x >= 0) & (x < 256) & (y >= 0) & (y < 150)).all()

    # Every creature comes with its whole genome, to the bit: the renderer derives the
    # body from it with the same keys of the config as the sim.
    assert ("x", "y", *(gene.name.lower() for gene in Gene)) == replay.CREATURE_FIELDS
    genomes = rows[:, 2:].astype(np.float32)
    assert np.array_equal(genomes, world.fauna.genes)
    assert document["phenotype_config"] == phenotype_config(world.fauna.config)

    for name, ramp in document["palette"].items():
        assert name == "DORMANT" or name in Cover.__members__
        assert len(ramp) == 3
    relief = document["relief"]
    assert relief["sea_bands"] == [[limit, colour] for limit, colour in pixelmap.SEA_BANDS]
    assert relief["slope"] == pixelmap.RELIEF_SLOPE
    assert relief["high_rock"]["from"] < relief["snow"]["from"]
    assert relief["shore_outline"] == pixelmap.SHORE_OUTLINE

    # Heights come back as the sim has them, to a 65535th, and say what is sea.
    steps = document["height_steps"]
    height = np.frombuffer(base64.b64decode(document["heights"]), dtype="<u2").reshape(150, 256)
    assert np.allclose(height / steps, world.terrain.height, atol=1 / steps)
    assert np.array_equal(
        height / steps > document["sea_level"], world.flora.cover() != Cover.WATER
    )
    classes = document["diet_classes"]
    assert 0 < classes["herbivore_max"] < classes["predator_min"] < 1


def test_casts_show_the_range_of_bodies(world: replay.World) -> None:
    specimens, *sweeps = replay.casts()
    field = replay.CREATURE_FIELDS.index

    reference = json.loads(replay.SPECIMENS.read_text(encoding="utf-8"))["specimens"]
    assert specimens["name"] == "specimens"
    assert specimens["members"] == [specimen["name"] for specimen in reference]
    assert len(specimens["creatures"]) == 15
    # The genomes are the ones the phenotype fixture checks the renderer's port against.
    for row, specimen in zip(specimens["creatures"], reference, strict=True):
        assert len(row) == len(replay.CREATURE_FIELDS)
        assert row[field("x")] == row[field("y")] == 0.0  # the renderer places them
        assert row[2:] == pytest.approx(specimen["genome"], abs=1e-7)

    assert [sweep["name"] for sweep in sweeps] == [
        f"sweep-{gene.name.lower()}" for gene in replay.SWEEP_GENES
    ]
    assert Gene.BROOD not in replay.SWEEP_GENES  # it has no look
    assert set(replay.SWEEP_BASE) == set(Gene)
    for sweep, gene in zip(sweeps, replay.SWEEP_GENES, strict=True):
        assert sweep["members"] == ["0", "0.25", "0.5", "0.75", "1"]
        rows = np.array(sweep["creatures"])
        # Only the swept gene changes from one step to the next.
        for other in Gene:
            column = rows[:, field(other.name.lower())]
            if other is gene:
                assert column.tolist() == pytest.approx(list(replay.SWEEP_STEPS))
            else:
                assert np.ptp(column) == 0.0


def test_committed_spike_fixture_is_what_the_tool_writes(
    world: replay.World, tmp_path: Path
) -> None:
    """The renderer's fixture is generated, never edited: regenerating changes nothing."""
    replay.write_renderer_fixture(world, tmp_path, SAVE.as_posix())
    for name in ("terrain.png", "map.png"):
        with Image.open(tmp_path / name) as fresh, Image.open(SPIKE_FIXTURE / name) as committed:
            assert np.array_equal(np.asarray(fresh), np.asarray(committed)), name
    fresh_doc = json.loads((tmp_path / "world.json").read_text(encoding="utf-8"))
    committed_doc = json.loads((SPIKE_FIXTURE / "world.json").read_text(encoding="utf-8"))
    assert fresh_doc == committed_doc


def test_command_line(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    still = tmp_path / "pictures" / "still.png"
    fixture = tmp_path / "fixture"
    arguments = [str(REPO_ROOT / SAVE), "--still", str(still), "--scale", "1"]
    replay.main([*arguments, "--renderer-fixture", str(fixture)])
    printed = capsys.readouterr().out
    assert json.loads(printed[: printed.index("\nwrote")])["seed"] == 42
    with Image.open(still) as image:
        assert image.size == (256, 150)
    assert sorted(p.name for p in fixture.iterdir()) == ["map.png", "terrain.png", "world.json"]
