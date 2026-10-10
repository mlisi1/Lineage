"""Replaying a save: summary, stills, and the fixture the renderer spike draws."""

from __future__ import annotations

import base64
import json
from pathlib import Path

import numpy as np
import pytest
from lineage_sim.fauna.genome import Gene
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
    assert (rows[:, replay.CREATURE_FIELDS.index("mass")] > 0).all()

    # The genes that show come with every creature, each in [0, 1].
    assert replay.CREATURE_FIELDS[:6] == (
        "x",
        "y",
        "mass",
        "limb_pairs",
        "land_speed",
        "swim_speed",
    )
    shown = rows[:, len(("x", "y", *replay.BODY_FIELDS)) :]
    assert shown.shape[1] == len(replay.SHOWN_GENES)
    assert ((shown >= 0) & (shown <= 1)).all()
    hue = rows[:, replay.CREATURE_FIELDS.index("hue")]
    assert np.allclose(hue, world.fauna.genes[:, Gene.HUE], atol=1e-3)

    for name, ramp in document["palette"].items():
        assert name == "DORMANT" or name in Cover.__members__
        assert len(ramp) == 3
    assert document["sea"] == [colour for _, colour in pixelmap.SEA_BANDS]
    classes = document["diet_classes"]
    assert 0 < classes["herbivore_max"] < classes["predator_min"] < 1


def test_casts_show_the_range_of_bodies(world: replay.World) -> None:
    cfg = world.fauna.config
    specimens, *sweeps = replay.casts(cfg)
    field = replay.CREATURE_FIELDS.index

    reference = json.loads(replay.SPECIMENS.read_text(encoding="utf-8"))["specimens"]
    assert specimens["name"] == "specimens"
    assert specimens["members"] == [specimen["name"] for specimen in reference]
    assert len(specimens["creatures"]) == 15
    # The bodies are the ones the phenotype fixture promises the renderer.
    for row, specimen in zip(specimens["creatures"], reference, strict=True):
        assert len(row) == len(replay.CREATURE_FIELDS)
        assert row[field("x")] == row[field("y")] == 0.0  # the renderer places them
        for name in replay.BODY_FIELDS:
            assert row[field(name)] == pytest.approx(specimen["phenotype"][name], abs=1e-3)
        assert row[field("hue")] == pytest.approx(specimen["genome"][Gene.HUE], abs=1e-3)

    assert [sweep["name"] for sweep in sweeps] == [
        f"sweep-{gene.name.lower()}" for gene in replay.SWEEP_GENES
    ]
    assert Gene.BROOD not in replay.SWEEP_GENES  # it has no look
    assert set(replay.SWEEP_BASE) == set(Gene)
    for sweep, gene in zip(sweeps, replay.SWEEP_GENES, strict=True):
        assert sweep["members"] == ["0", "0.25", "0.5", "0.75", "1"]
        rows = np.array(sweep["creatures"])
        # Only what the swept gene drives changes from one step to the next.
        for other in replay.SHOWN_GENES:
            column = rows[:, field(other.name.lower())]
            if other is gene:
                assert column.tolist() == list(replay.SWEEP_STEPS)
            else:
                assert np.ptp(column) == 0.0
    by_name = {sweep["name"]: np.array(sweep["creatures"]) for sweep in sweeps}
    assert by_name["sweep-size"][:, field("mass")].tolist() == pytest.approx(
        [cfg.mass_min * (cfg.mass_max / cfg.mass_min) ** step for step in replay.SWEEP_STEPS],
        abs=1e-3,
    )
    assert by_name["sweep-limbs"][:, field("limb_pairs")].tolist() == [0, 1, 2, 3, 4]
    assert np.ptp(by_name["sweep-hue"][:, field("mass")]) == 0.0


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
