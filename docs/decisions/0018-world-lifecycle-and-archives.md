# 0018 — World lifecycle and archives

- **Status**: accepted
- **Date**: 2026-10-20

## Context

M10 delivers the end of a world: collapse detection, an end-of-world event, a new
continent with a new seed, an archive of the old world (chronicle, bestiary, phylogeny,
final map), and world numbering. Accept: archives load and render; a new world starts
within budget.

Until M9 a world could not end. When the last creature died, `Fauna` waited for spring
or summer and landed 40 new founders once plants covered half the land. Strangers also
landed about six times a year, and the ark god power brought twelve. `concept.md` left
two questions open, and the owner settled both at the start of M10 (2026-10-20):

1. **What ends a world.** Evidence shown to the owner: across the M8 and M9 runs
   (80 runs of 3 years, all four presence schedules), after life first landed the island
   emptied in only 2 runs (11 empty weeks under the conference schedule, 5 under
   always-present), and vegetation never fell below 72 % of the land. A single surviving
   species is common only in the months after founding. Answer: **the death of the last
   creature, once life is established, ends the world**, and re-founding stops at that
   point. Strangers and the ark still help while anything is alive.
2. **How many archives the device keeps.** Answer: **all of them.**

## Decision

**An apocalypse subsystem that only watches** (`apocalypse.py`, `[apocalypse]`). It is
an observer registered just before the chronicle. A `CreaturesArrived` on an empty island
starts its clock (`life_since_ms`). From `established_days` (30) after that, a
`PopulationExtinct` means life has collapsed: it draws the next seed (below 2³¹, so
every reader keeps it exact) from the `APOCALYPSE` stream and reports `WorldCollapsed`.
A landing that dies out sooner is not yet life on the island: the clock resets and the
founders come again, as before M10. This is the only draw the apocalypse makes, so a world
that does not end is bit-identical to one without the subsystem.

**Observers see what earlier observers added.** The chronicle (after the apocalypse)
therefore sees `WorldCollapsed` in the same batch as the extinction and writes a
`world_end` entry (importance 5) after `last_creature`.

**The World starts over by itself, at once.** On `WorldCollapsed` it:
1. snapshots itself (the archive);
2. emits `WorldEnded(world, seed, cause, archive)`;
3. appends a small record to the ledger of past worlds (number, seed, began and ended
   instants, cause, species that ever lived);
4. becomes world n+1. The seed is the drawn one, the creation instant is the end instant
   (so the calendar runs on unbroken), sim time is back to 0, and every subsystem is
   fresh from a factory (the real world's by default);
5. emits `WorldBegan(world, seed, epoch_unix_ms)`.

The new world's observers see `WorldBegan`, so its chronicle opens with a `world_begin`
entry (importance 4). The new continent is bare rock, so founders land months later, as
on the first world. This keeps the sim pure (§4.1): the archive is an output, and the
server writes it. A caller holding absolute times would break when the clock resets, so
`advance_to` spends the time left over in the next world, and `advance_to_unix` lets
wall-clock callers (the server, fast-forward) ignore world changes entirely.

There is no apocalypse interval inside the sim. The renderer plays the sequence (R4)
over the hand-over: the last world's final frame is in the archive, and the new one
starts at the same instant.

**An archive is a save.** It is the final `WorldState`, written with `state.io.dumps`
and read with `io.loads`, so the same migration chain upgrades it: "migrations cover
archives" holds by construction. It carries everything an archive needs: the chronicle
and bestiary (ADR 0017), the species records (phylogeny), and terrain and plant cover
(the final map). A save is 0.25–0.7 MB, and worlds end rarely, so keeping them all costs
little. S1 decides where the files go and S5 copies them off the device. (S1, ADR 0023:
`<data>/archives/world-NNN-seed-S.lzma`, beside the saves in `<data>/saves/`.)

**Schema v10**: `WorldState` gains `world` (1 for the first continent) and `worlds` (one
record per world before this one), and the subsystem `apocalypse`. `v9_to_v10` numbers
every existing save as world 1. If creatures live there, life counts as established
since creation; an empty island waits for its founders.

**Tools**: fast-forward steps by the desk's clock and writes every ended world to
`archives/<seed>/world-<n>.lzma`; the owner's synthetic schedule follows the desk (first
world's seed and start), not the world; a `world` series and a `worlds_ended` count.
`replay` shows the world number, and `--still` draws an archive like any save.

## Results

- Forced collapse on the real world (the v9 fixture, day 527, a meteor whose blast covers
  the island): the world ends exactly once, the chronicle ends with `last_creature`
  and `world_end`, world 2 begins with a different continent and a `world_begin` entry,
  and the archive loads, holds 9 species in its bestiary and renders.
- Starting the next world (archive snapshot and new continent) takes about 0.06 s on
  the PC. Saving the archive takes 0.1 s for 428 KiB. Both are far inside the 2 s that
  §4.8 allows a daily save.
- At today's tuning a world ends rarely: 2 of 80 three-year runs emptied after first
  life. How often worlds should end is M11's call.

## Consequences

- Output events carry their own world's sim time. Consumers that index by time across
  worlds (fast-forward's per-seed tables) must use the desk's clock or the `world` series.
  Tables built at the end of a run (phylogeny, chronicle) are the last world's; earlier
  worlds are in their archives.
- Cumulative counters (fauna tallies, species ever) restart with each world.
- S1: write `WorldEnded.archive` atomically when it arrives, then save the new world; a
  power cut between the two loses nothing (the next start replays from the last save,
  deterministically reaching the same end). S3/S5: list past worlds from
  `World.past_worlds`; the archives hold their histories.
- R3/R4: `WorldEnded` and `WorldBegan` are the cue for the apocalypse sequence and the
  new continent's first wide shot; the wire schema does not carry them yet.
- M11: if worlds should end more often (the desk sees a new continent every few years),
  the levers are immigration (`immigrant_groups_per_year`), the ark, and the difficulty
  of the island, not this criterion.

## References

- Owner's answers, 2026-10-20 (this ADR's Context).
- ADR 0017 (the chronicle and bestiary that an archive carries); ADR 0016 (the ark and
  the meteor god powers).
