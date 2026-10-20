# 0021 — The atmosphere: moonlit nights, glow, the weather of events, the end of a world

- **Status**: accepted
- **Date**: 2026-10-20

## Context

R4 delivers the atmosphere (CLAUDE.md §8 R4): the day/night tint from presence, a glow
pass, seasons, the weather of events and the apocalypse sequence, plus, from the owner's
notes at the R3 demo, waves breaking on every coast in all three views, the map too.

The sim already had all of it, but none of it was on the wire. The light of the moment
is `Presence.light`: 1 by day, `night_light` (0.05) at night, a moonlight floor (0.15)
after 72 hours away. It follows the owner over a half-hour dawn and a 1.5-hour dusk, in
10-minute presence ticks (ADR 0016). Rain, fires, volcanoes, quakes, craters, god powers
and a world's end and beginning (ADR 0018) were output events. R1 already draws the
seasons in the plants and snow, R2 drew glow spots that were never lit, and R3's dip
between views is a plain overlay. Recordings were made from fixture saves with nobody at
the desk events, so their light never changed.

The brief asked the owner four things before coding. Their answers (2026-10-20):

1. **Night**: a **moonlit blue**, dark but readable (land, sea and animals still seen),
   so that glowing things stand out. Not near-black, and not the sim's value mapped
   straight onto brightness.
2. **Easing**: the tint **eases between** the sim's 10-minute steps, with no jumps.
3. **Apocalypse**: the **dramatic** one, **about three minutes**: the sky reddens,
   volcanoes and ash, quakes shake the picture, the sea swallows the land, darkness, the
   new continent rises.
4. **Weather**: **all of it**: rain for the rain power, smoke and glow over fires, ash
   and lava for volcanoes, a shake for quakes, a streak, flash and dust for meteors and
   craters, and light from the sky for the seed and ark powers.

## Decision

**On the wire** (additive; `protocol` stays 1; `schema.json`, `encode.py`):

- `sky`: `light`, `present`, `raining` and `burning` (the cells on fire, as grid
  indices). It is sent on connect and at every presence tick. `Presence.raining` is a new
  read-only property (no persisted field, no schema bump).
- `events`: `fire_started`, `fire_ended`, `volcano`, `earthquake`, `crater`, `god_power`,
  `world_ended` and `world_began`, each with where it happened and how far it reached.
  After `world_ended`, every message is of the next world.
- `chronicle` messages are now built from a step's outputs (`encode.entries_message`), so
  that a world's last lines and the next world's first both travel. A world's last lines
  come before its `world_ended`.

**Recordings** (`tools/stream.py`): `--sky-every`, `--schedule` (the fast-forward's
presence schedules: dusks, nights, the Long Night), `--press-days` (the god-power button
at noon) and `--famine-day`. A famine leaves every creature deep in debt of energy, so
the herd starves on the next tick and the sim ends the world its own way (archive, next
seed, next continent), which is then recorded on. There are two new recordings from the
v9 fixture: `office.json` (two weeks of office hours, the rain power twice; the
`?recording=office` page) and `end.json` (a day, then the end and the next world;
`?recording=end`).

**In the renderer** (`renderer/src/atmosphere/`), five layers in this order: the world
(land, plants, animals), then `ground` (in cells: the risen sea, smoke, dust), `weather`
(screen art pixels: rain, falling ash), `tint` (one sprite multiplied over all of those),
`lights` (in cells, additive, over the tint) and `flash` (the screen). The scroll and the
dip are page elements and take none of it.

- **The light** (`light.ts`). Night is `[0.30, 0.38, 0.66]`. Twilight is rose
  `[0.96, 0.62, 0.56]` while the owner is away (dusk) and lilac `[0.86, 0.68, 0.82]` while
  they are present (dawn), most coloured 35 % of the way from night to day. Day is
  graded by the season (warm summer, cool winter), turning to the next season's grade
  over each season's second half. Rain greys it. `LightEase` reaches each of the sim's
  steps over the wall time since the step before it (between 0.25 s and 10 minutes), so
  the scene runs one step behind the sim, smoothly, whatever the playback speed.
- **Glow** (additive halos in five steps of a 48-texel disc, never wider than three times
  that, so the steps stay a few art pixels wide). Animals with the glow gene get a halo
  at every other joint of the back, as strong as it is dark (`Herd.glowing`; none on the
  map). Each burning cell gets a small flickering glow off its middle and flames licking
  up, and the whole fire gets a wide glow, brighter at night. Lava, sparks, the seed's
  gold and the ark's beam are halos too.
- **Weather**. Smoke, ash, dust, flames and rain are slots that go round cycles of their
  own; where a slot is depends only on its number and the time, as the sea's glints do.
  Nothing is kept from frame to frame, the same moment looks the same on every run, and
  `?still` pictures are fixed. Short things last wall seconds so that they read at any
  speed: a quake shakes for 4 s, a meteor falls for 1.2 s then flashes and raises dust,
  a seed or ark beam lasts 8 s, and lightning makes a half-strength flash with sparks
  where a fire starts. A volcano erupts for 12 sim-hours and at least 30 wall seconds.
  Rain sets in and stops over 3 s.
- **The end of a world** (`apocalypse.ts`), 180 s on the map. The **omen** (20 s)
  reddens the sky and starts the ash. The **fire** (40 s) opens 40 lava vents on high land
  while a quake shakes the picture every 6 s. In the **flood** (60 s) a risen sea, painted
  one pixel to the cell in the depth bands and with foam at its edge, covers the land from
  the lowland up, the last peak going under. Then comes the **dark** (20 s), and the
  **rise** (40 s), where the light comes back and the sea falls away from the new
  continent. The red sky is mixed in whatever the hour (the end is lit by its fires, not
  by the owner). The camera goes to the map (`Director.toMap`) and the view button does
  nothing until the sequence is over. The dead leave the scene at its start. Everything
  the stream sends after `world_ended` waits (`Sequence`): the next world's land and
  animals until the dark, so that the old land stays until the sea has it, and its news
  until the rise. The chronicle's own lines tell the end (as they come) and the
  beginning (at the rise).
- **The map's surf**: the map is painted with the three surf bands like the closer
  views, and the sea brings them in.
- **On demand** (`demo.ts`, `?show=day|dusk|dawn|night|moon|rain|fire|volcano|quake|
  meteor|seed|ark|end`): messages as the stream would send them, made up on the land in
  sight, for the owner's look and the visual tests. The stream's own sky is then not
  taken. Nothing reaches the sim.

## Results

On the PC, renderer tests went from 255 to 281 unit tests: the light's colours,
monotonic brightening, the season's turn, the ease; the acts, the flood, the vents and
the held stream; puffs, drops and the halo's steps; the shows. Playwright went from 25 to
43 tests: 15 snapshots of lighting states and events, the office recording ending in the
dark, a glowing animal shining at night and not by day, and a real world's end from
`end.json` holding the camera on the map and ignoring the button until the next world has
risen. The scene and camera baselines were regenerated for the map's surf and the season
grade; each was within its tolerance before. Python: protocol tests for `sky` and
`events`, stream tests for the office schedule, the button and a famine's world end; the
committed R1 recording is still what the tool writes. Nothing is measured on the board:
R5 does that.

## Consequences

- **S1** sends `sky` at every presence tick and `events` and `chronicle` from each step's
  outputs, in the order `tools/stream.py` does: a world's last lines, its end, then the
  next world as on connect.
- **R5** measures the atmosphere's cost on the board: one multiplied sprite, a few
  hundred additive halos at most in a big fire (`MOST_FIRES`), 180 raindrops, and during
  an apocalypse a world-sized texture repainted ten times a second. R5 keeps
  `Director.toMap`, which the apocalypse uses; of the R3 demo's clicks it removes the
  pointer handler and `Director.nextSubject`.
- Events off the screen are not seen: the camera does not go to them (the owner's button
  steers it, ADR 0020). Only a world's end takes the camera.
- Falling snow and lightning bolts are not drawn: snow lies where the sim has it (R1),
  and lightning shows as a flash.

## References

- Stardew Valley (ConcernedApe, 2016): evenings darken the farm under a blue-violet
  overlay while lamps and windows stay lit over it. This is the model for a moonlit
  multiply tint with an additive pass above it, in the cosy look already taken for R1 and
  R2 (ADR 0013, 0014).
- PixiJS v8 documentation, `blendMode` (`multiply`, `add`), <https://pixijs.com/>:
  the tint is one sprite multiplied over the scene, and the lights are added over it, so
  there is no filter pass and no render texture.
- ADR 0016 (light and god powers), ADR 0018 (the world's end and the next), ADR 0020 (the
  camera and the dip).
