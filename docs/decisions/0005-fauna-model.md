# 0005 — Fauna model

- **Status**: accepted
- **Date**: 2026-10-10

## Context

M4 asks for creatures with a genome, a procedural body, a brain, energy, eating plants
and meat, sexual reproduction with an asexual fallback, and a population cap; and sets
targets: extinction in under 20 % of seed-years, measurable drift from the ancestors,
herbivores and predators both present at year 3 in at least 60 % of seeds.

## Decision

- **Struct of arrays, vectorised.** One row per creature; Python loops only over the
  handful of attacks and broods of a tick. A tick costs ~1 ms at 200 creatures.
- **Ten-minute tick.** Three sim-years are 158 000 ticks per seed; a finer tick would
  make statistical runs impractical and the device does not need it (the renderer
  interpolates).
- **The brain only steers.** Eating, attacking and breeding follow from where a creature
  is and its state. This keeps the net tiny (186 weights) and leaves a clean place for
  M5's learning.
- **Founders arrive with instincts.** Random brains cannot forage; evolution from them
  would take far longer than the targets allow.
- **Founders and strangers come from outside**, like the plants' seed rain. Founders are
  herbivores; half of the stranger groups are hunter species built for hunting.
- **Separate predator cap (16).** With one cap, a herd at the cap left no room for a
  predator to be born. Sixteen is what a herd of 200 can feed.
- **Schema v4**; as before the migration only bumps the version.

## What tuning found (each was a failure before it was a rule)

- **Roots are out of reach.** Grazing a cell to zero killed the plants; forty founders
  stripped their landing site in three days and starved.
- **Mates are only sought when ready, prey only when hungry.** Long-sighted species were
  dying because the mate signal, always on, pulled them into a huddle; fed predators
  killed 63 animals in a day.
- **Personal space.** Without a pull away from their own kind, groups never spread over
  their food.
- **Roaming with a persistent heading.** White-noise wander nets a few cells a day;
  predators with no prey in view never found any.
- **Founders land in spring or summer.** Landing in autumn, as the grass died back,
  killed most first colonies.
- **A hunter must not count itself as prey.** A bug: the nearest creature in reach that
  a hunter could kill was itself. Every capable predator died within hours; the 22
  "kills" of an early trial were suicides. Found with a hand-built predator scenario,
  now a test.

## Consequences

- Herbivores thin the vegetation: at year 3, closed forest covers about 5 % of the land
  instead of 10 %, and trees of any density 42 % instead of 47 % (medians of 20 seeds).
  The M3 report describes the world without animals and is not regenerated.
- M3's nightly test builds a world without fauna, as M2's builds one without flora.
- Predator presence depends on arrivals. If later milestones want self-sustaining
  predator lineages, newborn hunters need a better start (parental care, or carcasses to
  scavenge).
- A full save is ~590 KiB and ~100 ms on a PC: close to the device's 2 s budget once
  scaled; S1 should measure it early. (S1, ADR 0023: a full world of about 200 animals,
  0.68 MB, saved through the server's store in 197 ms on the PC, nearly all of it xz;
  the board's number comes from its session.)
