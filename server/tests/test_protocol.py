"""The state stream: every message the encoder builds is what the schema says."""

from __future__ import annotations

import base64
import json
import re
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from lineage_server.protocol import SCHEMA_PATH, encode
from lineage_sim.config import parse_config
from lineage_sim.flora import Cover
from lineage_sim.state import io
from lineage_sim.world import World

REPO = Path(__file__).resolve().parents[2]
SAVE = REPO / "sim" / "tests" / "fixtures" / "saves" / "v4.lzma"
CONFIG = REPO / "sim" / "config" / "default.toml"
SCHEMA: dict[str, Any] = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))


def errors(value: Any, schema: dict[str, Any], path: str = "$") -> list[str]:
    """Where `value` breaks `schema`: the part of JSON Schema that schema.json uses."""
    if "$ref" in schema:
        name = schema["$ref"].removeprefix("#/$defs/")
        return errors(value, SCHEMA["$defs"][name], path)
    if "oneOf" in schema:
        passing = [option for option in schema["oneOf"] if not errors(value, option, path)]
        return [] if len(passing) == 1 else [f"{path}: matches {len(passing)} of oneOf"]
    found: list[str] = []
    kinds = schema.get("type")
    if kinds is not None:
        names = kinds if isinstance(kinds, list) else [kinds]
        checks = {
            "object": lambda v: isinstance(v, dict),
            "array": lambda v: isinstance(v, list),
            "string": lambda v: isinstance(v, str),
            "integer": lambda v: isinstance(v, int) and not isinstance(v, bool),
            "number": lambda v: isinstance(v, int | float) and not isinstance(v, bool),
            "boolean": lambda v: isinstance(v, bool),
            "null": lambda v: v is None,
        }
        if not any(checks[name](value) for name in names):
            return [f"{path}: not {kinds}"]
    if "const" in schema and value != schema["const"]:
        found.append(f"{path}: {value!r} is not {schema['const']!r}")
    if "enum" in schema and value not in schema["enum"]:
        found.append(f"{path}: {value!r} not in {schema['enum']}")
    if "pattern" in schema and not re.search(schema["pattern"], value):
        found.append(f"{path}: {value!r} does not match {schema['pattern']}")
    if "minimum" in schema and value < schema["minimum"]:
        found.append(f"{path}: {value} below {schema['minimum']}")
    if "maximum" in schema and value > schema["maximum"]:
        found.append(f"{path}: {value} above {schema['maximum']}")
    if "exclusiveMinimum" in schema and value <= schema["exclusiveMinimum"]:
        found.append(f"{path}: {value} not above {schema['exclusiveMinimum']}")
    if isinstance(value, dict):
        properties = schema.get("properties", {})
        found += [f"{path}: no {key}" for key in schema.get("required", []) if key not in value]
        for key, item in value.items():
            if key in properties:
                found += errors(item, properties[key], f"{path}.{key}")
            elif schema.get("additionalProperties") is False:
                found.append(f"{path}: unexpected {key}")
            elif isinstance(schema.get("additionalProperties"), dict):
                found += errors(item, schema["additionalProperties"], f"{path}.{key}")
    if isinstance(value, list):
        if "minItems" in schema and len(value) < schema["minItems"]:
            found.append(f"{path}: fewer than {schema['minItems']} items")
        if "maxItems" in schema and len(value) > schema["maxItems"]:
            found.append(f"{path}: more than {schema['maxItems']} items")
        if "items" in schema:
            for index, item in enumerate(value):
                found += errors(item, schema["items"], f"{path}[{index}]")
    return found


def decode(grid: dict[str, Any], count: int) -> np.ndarray:
    dtype = "<u2" if grid["encoding"] == "u16le" else "u1"
    numbers = np.frombuffer(base64.b64decode(grid["data"]), dtype=dtype)
    assert numbers.size == count
    return numbers.astype(np.float64) / grid["scale"]


@pytest.fixture(scope="module")
def world() -> World:
    config = parse_config(CONFIG.read_text(encoding="utf-8"))
    return World.restore(config, io.loads(SAVE.read_bytes()))


def test_the_schema_checker_catches_what_it_should() -> None:
    clock = {
        "type": "clock",
        "protocol": 1,
        "t_ms": 0,
        "date": "2026-01-01",
        "season": "winter",
        "season_progress": 0.1,
        "day_of_year": 1,
        "days_in_year": 365,
    }
    assert errors(clock, SCHEMA) == []
    assert errors({**clock, "season": "monsoon"}, SCHEMA)
    assert errors({**clock, "extra": 1}, SCHEMA)
    assert errors({key: value for key, value in clock.items() if key != "date"}, SCHEMA)


def test_every_message_on_connect_is_what_the_schema_says(world: World) -> None:
    messages = encode.connect_messages(world)
    assert [message["type"] for message in messages][:3] == ["clock", "land", "fauna"]
    assert messages[-1]["type"] == "creatures"
    for message in messages:
        assert errors(message, SCHEMA) == [], message["type"]
        # And it survives the wire.
        assert json.loads(json.dumps(message)) == message


def test_the_land_carries_the_world_cell_for_cell(world: World) -> None:
    land = encode.land_message(world)
    terrain, flora = world.terrain, world.flora
    count = terrain.height.size
    assert (land["height"], land["width"]) == terrain.height.shape
    heights = decode(land["heights"], count).reshape(terrain.height.shape)
    assert np.max(np.abs(heights - terrain.height)) <= 0.5 / encode.HEIGHT_STEPS + 1e-7
    cover = decode(land["cover"], count).reshape(terrain.height.shape)
    assert np.array_equal(cover, flora.cover())
    assert land["cover_classes"][Cover.WATER] == "WATER"
    biomass = decode(land["biomass"], count).reshape(terrain.height.shape)
    assert np.max(np.abs(biomass - flora.biomass)) <= 0.5 / 255 + 1e-7
    # Plant genes where something grows, nothing elsewhere.
    height_gene = decode(land["plant_height"], count).reshape(terrain.height.shape)
    assert np.all(height_gene[flora.biomass <= 0] == 0)
    assert np.any(height_gene[flora.biomass > 0] > 0)
    snow = decode(land["snow"], count)
    assert np.all((snow >= 0) & (snow <= 1))
    assert land["rare_genes"] == ["FIRE_PINE", "NITROGEN_FIXER", "MANGROVE"]


def test_creatures_send_their_genomes_once(world: World) -> None:
    sent: set[int] = set()
    first = encode.creatures_message(world, sent)
    assert len(first["ids"]) == world.fauna.count == len(first["positions"])
    assert {born["id"] for born in first["born"]} == set(first["ids"])
    assert all(len(born["genome"]) == world.fauna.genes.shape[1] for born in first["born"])
    again = encode.creatures_message(world, sent)
    assert again["born"] == []
    assert again["ids"] == first["ids"]


def test_messages_are_pure_functions_of_the_world(world: World) -> None:
    assert encode.connect_messages(world) == encode.connect_messages(world)


def test_rare_genes_travel_once_the_sim_has_them(monkeypatch: pytest.MonkeyPatch) -> None:
    """M7's parts (lineage_sim.rare, Fauna.slots, Fauna.torpid) are read only when present:
    a stand-in of the same shape shows what the messages carry then."""
    import sys
    import types

    rare = types.ModuleType("lineage_sim.rare")
    table = [
        {"kingdom": "creature", "bit": 1, "name": "VENOM", "signature": "fangs", "look": "x"},
        {"kingdom": "plant", "bit": 8, "name": "POISONOUS", "signature": "purple", "look": "y"},
    ]
    rare.signature_table = lambda: table  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "lineage_sim.rare", rare)
    fauna = types.SimpleNamespace(
        ids=np.array([7, 9], dtype=np.int64),
        genes=np.zeros((2, 14), dtype=np.float32),
        positions=np.array([[1.0, 2.0], [3.0, 4.0]], dtype=np.float32),
        slots=np.array([1, 0], dtype=np.uint16),
        torpid=np.array([False, True]),
    )
    world = types.SimpleNamespace(fauna=fauna, t_ms=5)
    creatures = encode.creatures_message(world)  # type: ignore[arg-type]
    assert errors(creatures, SCHEMA) == []
    assert [born["slots"] for born in creatures["born"]] == [1, 0]
    assert creatures["torpid"] == [9]
    message = encode.rare_message(world)  # type: ignore[arg-type]
    assert message is not None
    assert errors(message, SCHEMA) == []
    assert [gene["name"] for gene in message["genes"]] == ["VENOM", "POISONOUS"]


def test_no_rare_message_before_the_sim_has_rare_genes(world: World) -> None:
    import importlib

    if hasattr(importlib.import_module("lineage_sim.rare"), "signature_table"):
        pytest.skip("lineage_sim.rare has its table (M7 merged)")
    assert encode.rare_message(world) is None
    assert "torpid" not in encode.creatures_message(world)
