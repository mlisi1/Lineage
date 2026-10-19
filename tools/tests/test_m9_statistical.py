"""M9 acceptance on many seeds (nightly): the chronicle writes at a readable pace and
never spams.

M9.1 (CLAUDE.md §8): 2–15 notable entries per sim-month, median of the seeds' median
months; M9.2: no event type above 30 % of all entries, every seed's pooled. And no
duplicate spam over a long run: in every seed's whole history, the daily cap holds, no
sentence repeats within the dedup gap, and no species booms, crashes or migrates twice
within its own gap. Each seed lives three years of the office schedule, as the report's
run (reports/M9-chronicle/, ADR 0017). The seeds run once, in parallel, for both tests.
"""

import datetime as dt
from collections import Counter
from concurrent.futures import ProcessPoolExecutor

import numpy as np
import pytest
from lineage_sim.config import parse_config
from lineage_sim.events import ChronicleEntry, PresenceChanged
from lineage_sim.world import World

from tools.fastforward import DAY_MS, epoch_unix_ms, live_day
from tools.milestones.m9 import DAYS_PER_MONTH, MONTHLY_BAND, TYPE_SHARE_MAX
from tools.runs import DEFAULT_CONFIG

START = dt.date(2026, 1, 1)
SEEDS = range(20)
WORKERS = 8
DAYS = 1096  # three years
CONFIG = parse_config(DEFAULT_CONFIG.read_text(encoding="utf-8"))


def _chronicle(seed: int) -> list[ChronicleEntry]:
    """A seed's whole chronicle after three years of office hours."""
    world, _ = World.create(CONFIG, seed, epoch_unix_ms(START))
    world.apply(PresenceChanged(False))
    for _ in range(DAYS):
        live_day(world, "office")
    return world.chronicle.entries()


@pytest.fixture(scope="module")
def chronicles() -> list[list[ChronicleEntry]]:
    with ProcessPoolExecutor(max_workers=WORKERS) as pool:
        return list(pool.map(_chronicle, SEEDS))


def _median_month(entries: list[ChronicleEntry]) -> float:
    months = int(DAYS // DAYS_PER_MONTH)
    month = [int(e.t_ms / DAY_MS // DAYS_PER_MONTH) for e in entries
             if e.importance >= CONFIG.chronicle.notable_importance]  # fmt: skip
    return float(np.median(np.bincount([m for m in month if m < months], minlength=months)))


def spam(entries: list[ChronicleEntry]) -> list[str]:
    """What breaks the filters in one chronicle (empty when nothing does)."""
    cfg = CONFIG.chronicle
    found: list[str] = []
    if [e.number for e in entries] != list(range(1, len(entries) + 1)):
        found.append("entries are not numbered 1, 2, 3…")
    per_day = Counter(e.t_ms // DAY_MS for e in entries if e.importance < cfg.major_importance)
    found += [f"day {day}: {n} entries below major" for day, n in per_day.items()
              if n > cfg.daily_cap]  # fmt: skip
    gaps = {"boom": cfg.swing_days, "crash": cfg.swing_days,
            "migration": cfg.migration_gap_days}  # fmt: skip
    last_text: dict[str, int] = {}
    last_species: dict[tuple[str, int], int] = {}
    for e in entries:
        before = last_text.get(e.text)
        if before is not None and e.t_ms - before < cfg.dedup_days * DAY_MS:
            found.append(f"repeated within {cfg.dedup_days:g} days: {e.text}")
        last_text[e.text] = e.t_ms
        if e.kind in gaps and e.species:
            key = (e.kind, e.species)
            before = last_species.get(key)
            if before is not None and e.t_ms - before < gaps[e.kind] * DAY_MS:
                found.append(f"{e.kind} of species {e.species} twice within its gap")
            last_species[key] = e.t_ms
    return found


@pytest.mark.slow
def test_chronicle_pace_and_variety(chronicles: list[list[ChronicleEntry]]) -> None:
    rates = [_median_month(c) for c in chronicles]
    kinds = Counter(e.kind for c in chronicles for e in c)
    top, count = kinds.most_common(1)[0]
    share = count / sum(kinds.values())
    assert MONTHLY_BAND[0] <= np.median(rates) <= MONTHLY_BAND[1], f"per seed {rates}"
    assert share <= TYPE_SHARE_MAX, f"{top} holds {share:.1%}: {kinds.most_common()}"


@pytest.mark.slow
def test_no_duplicate_spam_over_three_years(chronicles: list[list[ChronicleEntry]]) -> None:
    problems = {seed: spam(c) for seed, c in zip(SEEDS, chronicles, strict=True)}
    assert all(not p for p in problems.values()), problems
    assert sum(len(c) for c in chronicles) > 20 * 100  # a real history was checked
