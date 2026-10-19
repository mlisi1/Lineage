"""Build the state stream's messages from a world (``schema.json`` defines them).

Pure functions of the world: no I/O, no clock. The server sends them over the WebSocket
(S1); ``tools/stream.py`` writes them to files for the renderer to draw without a server.
"""

from __future__ import annotations

import base64
import importlib
from collections.abc import Iterable
from typing import Any

import numpy as np
from lineage_sim.fauna import phenotype
from lineage_sim.fauna.genome import Gene as CreatureGene
from lineage_sim.flora import RARE_GENES, Cover
from lineage_sim.flora import Gene as PlantGene
from lineage_sim.world import World

PROTOCOL = 1
Message = dict[str, Any]

# Whole numbers per unit of a grid's values.
HEIGHT_STEPS = 65535
SHARE_STEPS = 255


def grid(values: np.ndarray, encoding: str = "u8", scale: float = 1) -> dict[str, Any]:
    """A grid of the world's cells, row by row, as the schema's ``Grid``."""
    dtype = "<u2" if encoding == "u16le" else "u1"
    top = 65535 if encoding == "u16le" else 255
    numbers = np.clip(np.rint(np.asarray(values, dtype=np.float64) * scale), 0, top)
    data = np.ascontiguousarray(numbers.astype(dtype)).tobytes()
    return {"encoding": encoding, "scale": scale, "data": base64.b64encode(data).decode("ascii")}


def clock_message(world: World) -> Message:
    instant = world.instant
    return {
        "type": "clock",
        "protocol": PROTOCOL,
        "t_ms": world.t_ms,
        "date": instant.date.isoformat(),
        "season": instant.season.value,
        "season_progress": round(float(instant.season_progress), 6),
        "day_of_year": instant.day_of_year,
        "days_in_year": instant.days_in_year,
    }


def land_message(world: World) -> Message:
    terrain, flora = world.terrain, world.flora
    rows, columns = terrain.height.shape
    growing = flora.biomass > 0
    genome = flora.genome.astype(np.float64) / 255.0

    def gene(which: PlantGene) -> dict[str, Any]:
        return grid(np.where(growing, genome[which], 0.0), scale=SHARE_STEPS)

    return {
        "type": "land",
        "protocol": PROTOCOL,
        "t_ms": world.t_ms,
        "world": {"seed": world.seed},
        "width": int(columns),
        "height": int(rows),
        "sea_level": round(float(terrain.sea_level), 6),
        "cover_classes": [cover.name for cover in Cover],
        "heights": grid(terrain.height, "u16le", HEIGHT_STEPS),
        "cover": grid(flora.cover()),
        "biomass": grid(flora.biomass, scale=SHARE_STEPS),
        "snow": grid(flora.snow(world.instant), scale=SHARE_STEPS),
        "plant_height": gene(PlantGene.HEIGHT),
        "plant_evergreen": gene(PlantGene.EVERGREEN),
        "plant_rare": grid(np.where(growing, flora.rare, 0)),
        "rare_genes": [rare.name for rare in RARE_GENES if rare.name is not None],
    }


def fauna_message(world: World) -> Message:
    """What bodies are derived from. ``phenotype_config`` holds the keys R2's port reads,
    once the sim names them (``phenotype.CONFIG_KEYS``); ``rare_config`` those for drawing
    rare genes (``rare.render_config``)."""
    config = world.fauna.config
    keys: Iterable[str] = getattr(phenotype, "CONFIG_KEYS", ())
    rare = importlib.import_module("lineage_sim.rare")
    render_config = getattr(rare, "render_config", None)
    return {
        "type": "fauna",
        "protocol": PROTOCOL,
        "genes": [gene.name for gene in CreatureGene],
        "phenotype_config": {key: getattr(config, key) for key in keys},
        # What drawing rare genes needs (M7, R2), once the sim names it.
        "rare_config": {} if render_config is None else dict(render_config(config)),
    }


def creatures_message(world: World, sent: set[int] | None = None) -> Message:
    """Where every creature is; genomes of those not in ``sent``, which is then updated."""
    fauna = world.fauna
    ids = [int(value) for value in fauna.ids]
    known = sent if sent is not None else set()
    genes = fauna.genes
    # Rare genes (M7): the slots of each creature, and who is torpid, once the sim has them.
    slots = getattr(fauna, "slots", None)
    torpid = getattr(fauna, "torpid", None)
    born: list[dict[str, Any]] = []
    for row, ident in enumerate(ids):
        if ident in known:
            continue
        entry: dict[str, Any] = {
            "id": ident,
            "genome": [round(float(value), 6) for value in genes[row]],
        }
        if slots is not None:
            entry["slots"] = int(slots[row])
        born.append(entry)
    known.update(ids)
    message: Message = {
        "type": "creatures",
        "protocol": PROTOCOL,
        "t_ms": world.t_ms,
        "ids": ids,
        "positions": np.round(fauna.positions.astype(np.float64), 3).tolist(),
        "born": born,
    }
    species = getattr(world, "species", None)
    if species is not None:
        message["species"] = [int(label) for label in species.labels_now()]
    if torpid is not None:
        message["torpid"] = [ident for row, ident in enumerate(ids) if bool(torpid[row])]
    return message


def rare_message(world: World) -> Message | None:
    """The rare genes of both kingdoms and their looks (M7), or None before they exist."""
    try:
        rare = importlib.import_module("lineage_sim.rare")
    except ModuleNotFoundError:
        return None
    table = getattr(rare, "signature_table", None)
    if table is None:
        return None
    return {
        "type": "rare",
        "protocol": PROTOCOL,
        "genes": [
            {
                "kingdom": str(row["kingdom"]),
                "bit": int(row["bit"]),
                "name": str(row["name"]),
                "signature": str(row["signature"]),
                "look": str(row["look"]),
            }
            for row in table()
        ],
    }


def species_message(world: World) -> Message | None:
    """Every species that has lived (M6), or None in a world without species."""
    species = getattr(world, "species", None)
    if species is None:
        return None
    return {
        "type": "species",
        "protocol": PROTOCOL,
        "species": [
            {
                "id": int(record.id),
                "name": str(record.name),
                "parent": int(record.parent) if record.parent > 0 else None,
                "extinct": record.extinct_t_ms >= 0,
            }
            for record in species.records()
        ],
    }


def connect_messages(world: World, sent: set[int] | None = None) -> list[Message]:
    """Everything a renderer needs when it connects, in the order to send it."""
    messages = [clock_message(world), land_message(world), fauna_message(world)]
    for extra in (species_message(world), rare_message(world)):
        if extra is not None:
            messages.append(extra)
    messages.append(creatures_message(world, sent))
    return messages
