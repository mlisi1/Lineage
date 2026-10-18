# 0013 — Creatures in a cosy palette, after Stardew Valley

- **Status**: accepted
- **Date**: 2026-10-18

## Context

R0 settled how creatures are drawn: seen straight from above, a body plan per kind of
animal (ADR 0007, `renderer.md`), outlined and lit (`lit`): a near-black outline the same
for every animal, the far side of every mass in a cool shade, a lit back. During R2 the
owner asked for Stardew Valley's look as the inspiration. Stardew draws its characters
and animals at a three-quarter view; taking that too would mean new body plans and new
motion (legs under the body, sprites that turn left and right) and reopening ADR 0007,
so the owner chose its *style* and kept the camera straight above.

What reads as Stardew in its animals, and can be had on our procedural bodies: colours
richer than ours; outlines that are a dark of the object's own colour rather than one
black; shading that changes hue (shade toward violet, light toward warm yellow) rather
than only lightness; large, glinting eyes; and a soft shadow on the ground under every
character.

The creature sheet (`renderer/creatures.html`, report `reports/R2-creature-sheet/`) drew
the fifteen specimens, the markings and two local-view scenes in `lit` and in a `cosy`
proposal side by side, the same animals walking the same paths. A first `cosy` was too
close to `lit` to tell apart at the local view's size and was pushed further before the
owner saw it.

## Decision

Creatures are drawn in **`cosy`** in every view (`proposal.ts`: `midBody`, `localBody`).
It is `lit`'s body plans and layering, with another palette (`PALETTES.cosy` in
`src/creatures/body.ts`):

- colours at saturation 0.82 instead of 0.5;
- the outline is the animal's hue at lightness 0.2, blended a third of the way toward
  plum: dark, but each animal's own;
- shade is mixed toward violet by half, and wider: 16 % of a mass, up to 2½ pixels;
- the lit patch goes toward the body's pale tone and then toward gold;
- eyes 1.45 times larger, with a glint from 2 pixels across;
- one see-through oval (alpha 0.38) on the ground under the middle of the body, down and
  to the right of it, away from the light. One sprite per animal, so it is evenly dark
  where overlapping ovals would not be.

The shared tones (plum, violet, gold, warm white, ground shadow) are in
`renderer/src/palette.ts`, which R1's ground and plants use as well, so the land and its
animals share one light. `lit` stays in the code as the comparison in the creature sheet.

## Consequences

- Cost: one sprite more per animal for the shadow, and two for the glints of animals whose
  eyes were too small for one: 2.5 % more sprites for the fixture's 197 animals in the
  middle view, 6 % in the local view (where few are in sight). mid-crowd held 30 fps on
  the board with about 9 ms a frame to spare (ADR 0010); the benchmark's views now draw
  `cosy`, and R2's performance check re-measures them.
- The R0 look sheet (`reports/R0-look-sheet/`) is R0's record and keeps `lit`; the next
  regeneration of it will show `cosy`.
- The ground shadow is the only see-through part of a body. If R4's night tint or glow
  pass needs shadows to change with the light, it changes this one part.
- A three-quarter view stays out of scope; asking for it later means a new ADR against
  ADR 0007.

## References

- Stardew Valley (ConcernedApe, 2016): https://www.stardewvalley.net/ — the reference
  for the palette, outlines, eyes and ground shadows; nothing is copied from its art.
- Slynyrd, "Pixelblog 1 – Color Palettes":
  https://www.slynyrd.com/blog/2018/1/10/pixelblog-1-color-palettes — hue shifting:
  shades turned toward blue and violet, highlights toward yellow.
