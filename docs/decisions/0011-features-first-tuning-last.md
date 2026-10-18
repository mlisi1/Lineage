# 0011 — Features first, tuning last; day and night stay in M8

- **Status**: accepted
- **Date**: 2026-10-18

## Context

During M5, every new mechanism moved the balance of the island: meal learning cut
predation, plant toxicity starved hunters, scavenging changed the step cost (ADR 0009).
Each time, predators, plants and learning had to be retuned. Five milestones of features
remain before M11 (species, rare genes, presence, chronicle, worlds), and each will move
the balance again.

The owner's presence is the island's sun (M8). It will change the island more than any
other feature: on an office schedule it is lit for about a quarter of the week, with a
Long Night of about 63 hours every weekend. Pulling it forward, so that everything after
is tuned under the real light, was evaluated (and started, on branch `m8-daylight`).

## Decision

**Build the remaining features in milestone order and tune once, at the end, in M11.**

- Order: M6 → M7 → M8 → M9 → M10 → M11, as CLAUDE.md §8 suggests.
- Between milestones the island must stay **viable, not tuned**: no collapse, herbivores
  and predators both present. Each milestone's report still checks its criteria; the
  bands are initial ones (CLAUDE.md §8), and M11 judges every M2–M10 criterion together.
- **Day and night stay in M8**, in order. M11 then tunes everything once, darkness
  included. M8 itself must check for *structural* problems darkness may expose, the main
  one being extinctions over the weekend's Long Night (the owner's requirement: none). If
  creatures starve through it, the fix is a mechanism (rest, a lower burn at night), not
  just new numbers.
- The day/night work already started stays parked on `m8-daylight` (a presence subsystem
  with dawn, dusk and a moonlight floor; seeded office, August and conference schedules
  for fast-forward) for M8 to pick up.

## Consequences

- Faster progress on features. Fine balance is deliberately left for M11, so milestone
  reports in between may show criteria near their bands.
- M11 carries more weight: it must tune plants, animals and learning together, under the
  office schedule, with the full feature set.
- Candidate features from ADR 0009 are slotted where they belong: poisonous plants and
  diet traditions that matter with M7 (rare plant genes); rest and learning the owner's
  rhythm with M8; making learning visible with M9 (chronicle) and R3 (captions).
