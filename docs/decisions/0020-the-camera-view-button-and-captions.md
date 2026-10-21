# 0020 — The camera: a view button, following, and captions on a scroll

- **Status**: accepted
- **Date**: 2026-10-20

## Context

R3 delivers the documentary camera and its captions. The spec (CLAUDE.md §8 R3) asked for
subject selection by an interest score, the three views and the moves between them, wide
shots at dawn, captions from chronicle entries and a Monday recap tour, the camera
choosing everything by itself.

At the start of R3 (2026-10-20) the owner changed this: the person at the desk chooses
the view with a **button**, separate from the god-power button. Their answers:

1. The screen rests on the **map**. A press goes to the **middle view**, which drifts at
   random over the island; another press to the **local view**, which follows an animal
   of a **random species** and after **about five minutes** another. A press in the local
   view goes back to the map, and so do **fifteen minutes** without a press.
2. Following has **physics**: the camera is not locked to the animal.
3. The next animal is **glided to if it is near and cut to if it is far**.
4. **No dawn wide shots and no Monday recap.**
5. **Captions** for the notable entries (importance ≥ 3, ADR 0017), on a
   **scroll-like** message box (read as a parchment scroll that unrolls).

R2 left creatures drawn only on the creature sheet (`CreatureLayer`, anchored life
between sim ticks); drawing them in the real scene from the stream was left to R3. The
wire did not carry the chronicle, and recordings carried creatures once a day.

## Decision

**A director, pure** (`renderer/src/director.ts`): a state machine fed the time that
passed, the world (size, land, the animals where they are drawn) and whether the view is
painted; it returns the view, the middle of the picture, how dark it is dipped and whom it
follows. Its random draws come from a seeded stream. Timings are constants at the top of
the file (renderer convention); the page may shorten the idle and follow times for tests
(`?idle=`, `?follow=`).

- **Changes of view dip to dark and back** (0.4 s down, up to 3 s in the dark until the
  view is painted, 0.6 s up). The camera never zooms between views: painted pixels
  shimmer at zooms in between (renderer.md "Open"), and a cut hides the first painting of
  the local view's pieces. A press during a dip leads on from where it is going.
- **The middle view** drifts: a target point travels at 1.2 cells a second to a place on
  land 20–70 cells away, whose view stays inside the world, lingers 8–20 s, and goes on;
  the camera follows the point on a critically damped spring, so it eases in and out.
- **The local view** follows on a spring a little under critical damping (period 3 s,
  damping 0.9), so that it eases after a turning animal and settles with hardly a swing;
  it aims 1 s ahead of the animal's walk (smoothed over 1.5 s) and lets it potter within a
  dead zone of one cell before moving. Sub-steps of 1/240 s make the motion the same at
  30 and 60 fps; a top speed and a longest frame (0.25 s) keep a hidden page from
  flinging it.
- **Who is followed**: a species drawn at random among those with an animal awake (all
  if every animal sleeps), then one of its animals, awake if it can be, and not the one
  just followed. A rare species is followed as often as a common one, which a random
  animal would not do. 4–6 minutes each; at once if the animal dies. The next is glided
  to (a slower, stronger spring) when it is within one view's width, and cut to otherwise.
  This replaces the spec's interest score.
- **The view stays inside the world**; the map shows the whole of it, still.
- **Pans glide** (amended after the owner found the first camera rough, 2026-10-20): the
  world is drawn in whole art pixels in a canvas a pixel larger all round, slid by the
  camera's fraction in whole device pixels, so a pan moves a screen pixel at a time
  instead of an art pixel (twice as often; finer would need blurring). The scroll and the
  dip are page elements over it, still. Plant corners are snapped to whole art pixels: the
  owner saw trees in the middle view snap back and forth, plants at half a pixel rounded
  one way or the other as the world moved (3 % of the picture at some offsets, none now).
  The sea's glints, placed as shares of the view, moved with it; each now keeps the place
  it had when it began to show.

**The stream's animals in the scene** (`renderer/src/herd.ts`): a roster gives each id a
slot of R2's `CreatureLayer` and frees the slots of the dead; two layers, the middle view's
body plans (also the map's dots) and the local view's, anchored to the sim's positions on
each `creatures` message. Only the layer of the view shown moves. In the local view animals are drawn 1.2 times R2's
size (the owner, 2026-10-20: at R2's size markings and eyes were lost). Animals stand among the
plants of the view's opaque plant layer (the old one while the next day fades in), and a
plant layer now lets its guests go before it is destroyed. `CreatureLayer` gained a cast
that changes (`place`, `remove`, `setTorpid`, `replan`) and the atlas a creature-only form.

**The chronicle on the wire**: a `chronicle` message (additive; `protocol` stays 1) with
the entries written since the last one and the notable and major thresholds; not sent on
connect (history is the API's, S3). `tools/stream.py` records it, sends the species again
when the census changes, and can record creatures more often than daily
(`--creatures-every`). A third recording, `renderer/public/stream/life.json` (28 days
from the v9 fixture, creatures every two sim-hours, 2.8 MB), is the page's default, played
by sim time at 1 800 sim-seconds a wall second (`Recording` with a speed).

**Captions on a scroll** (`renderer/src/captions.ts`): one scroll at a time at the foot of
the screen, over the dip, so it stays readable through a cut. It unrolls from its middle
(0.8 s, easing out), stays open 4 s plus 0.07 s a character, rolls up (0.6 s) and waits
1.5 s before the next; at most four wait, the least important dropped first. The date of
the entry is written above it in words. The text is in a pixel font drawn for it
(`renderer/src/pixelfont.ts`, capitals 7 art pixels tall, descenders 2), because a
system font shrunk to art pixels smears and differs between browsers; the paper and the
wooden rolls are in the cosy palette, lit from the upper left, with a see-through shadow.

**The button on the page**: V, space or Enter on a keyboard, a tap on a phone, and
`window.__press()`, which S2's hardware button reaches. For the demo (the owner,
2026-10-20) a click or tap in the local view goes on to another animal instead, and a
double click back to the map (`Director.nextSubject`, `toMap`); the button keeps the
cycle. This is for the demo only: the final build does not have it (R5 removed it on
2026-10-21: a click or tap is the button in every view; `toMap` stays for R4's apocalypse).

## Results

On the PC: 255 renderer unit tests (spring, framing, the director's rules on synthetic
worlds, the queue and the scroll's painting, the font, the roster), 25 Playwright tests
(the button cycles the views in the page and the local view follows an animal; a snapshot
of the scroll; R1's seven snapshots unchanged). Nothing is measured on the board: R5
does that (the local view now carries every animal's motion, about 200 in the v9 world).

## Consequences

- **S2** builds a second button (`view`), debounced like the god-power one; the device
  layer hands presses to the page (`__press`, or a message on a reverse channel when S1
  has one).
- **S3**: the phone's renderer has its own camera; a tap is its button.
- **R4** draws the light; the dip's dark is a plain plum overlay until then. The
  apocalypse sequence (`WorldEnded`) is still to be put on the wire.
- Each worktree's Playwright tests take `PLAYWRIGHT_PORT`, as before.
- CLAUDE.md §8 R3 is amended to what was built; the spec's dawn shots and recap tour are
  dropped by the owner.

## References

- Itay Keren, "Scroll Back: The Theory and Practice of Cameras in Side-Scrollers",
  GDC 2015: camera windows (the dead zone), lead in the direction of motion, and smoothing
  toward a target rather than locking to it.
- Thomas Lowe, "Critically Damped Ease-In/Ease-Out Smoothing", *Game Programming Gems 4*
  (2004): a spring at critical damping as the smooth, overshoot-free follow.
- ConcernedApe, *Stardew Valley* (2016): the cosy look (ADR 0013, 0014) the scroll's paper
  and wood are drawn after.
