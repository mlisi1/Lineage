# R5 — Final rendering pass

The scene as R5 leaves it against the scene when R5 began, filmed from the real
renderer at 1024×600: stills at the same places (drag to compare) and films following
an animal. `report.html` is one self-contained file but for its films, in `films/`
(VP9, a few MB, committed with it).

- Branch `r5-final` at `376814b`; before: `80e4a4c`
- Rounds 1–4 (the owner's checklist items 1–7): grass see-through round the animal
  followed, no tuft popping over it; colours from six genes ranked among species, no
  olive; round map dots; a calmer ground; grass as small unoutlined tufts after
  references, nine sizes, random tints; snow only from the simulation; the young drawn
  small. Decisions: ADR 0022
- Tests wait until the owner calls the look final; the device benchmark comes later

Regenerate with `cd renderer && npm run final` (`R5_REPORT_BEFORE=<commit>` to compare
with another); do not edit by hand. R5 has no statistical criterion.
