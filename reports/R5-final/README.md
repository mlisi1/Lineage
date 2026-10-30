# R5 — Final rendering pass

The scene as R5 leaves it against the scene when R5 began, filmed from the real
renderer at 1024×600: stills at the same places (drag to compare) and films following
an animal. `report.html` is one self-contained file but for its films, in `films/`
(VP9, about 60 MB, not in git: `npm run final` makes them again; the page shows each
film's poster without them).

- Branch `r5-final` at `cb7250d`; before: `80e4a4c`
- Rounds 1–4 (the owner's checklist items 1–7): grass see-through round the animal
  followed, no tuft popping over it; colours from six genes ranked among species, no
  olive; round map dots; a calmer ground; grass as small unoutlined tufts after
  references, nine sizes, random tints; snow only from the simulation; the young drawn
  small; plants off the water; land animals wade or struggle in the sea; legs step in
  turn; no body folds through itself; animals keep clear of trees and bushes.
  The name card of the animal followed; deaths by cause with bones, landings with a
  splash; the illuminated chronicle scroll lit like a lantern at night, its places
  marked and visited.
- Animations: eating, hunting, births, sleep at night, plants in the wind, fireflies,
  gulls, butterflies and dust; bushes in pieces (the default), leaning in the wind;
  drawn only, so the simulation is unchanged: autumn leaves, animals shaking off the
  rain and hunching in storms, basking, venom's strike, wakes, the young trailing their
  mothers, a pair touching heads before a birth. Decisions: ADR 0022
- The owner called the look final on 2026-10-25; its tests are in (Playwright stills
  in `renderer/tests/e2e/final.spec.ts`). The device benchmark is `reports/R5-device/`

Regenerate with `cd renderer && npm run final` (`R5_REPORT_BEFORE=<commit>` to compare
with another); do not edit by hand. R5 has no statistical criterion.
