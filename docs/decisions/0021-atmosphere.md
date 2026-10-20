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

## Round 2: the owner's comments on the first report (2026-10-20)

The owner looked at the first report and asked for more. The answers to the questions it
raised were:

- **Fire up close** with real flame sprites and more detail, and **burnt trees left
  behind**.
- **Fire kills creatures** that stay in it. This is a sim change, built here (the owner's
  choice): `[fauna] fire_damage_per_hour = 1.0` of an animal's capacity per hour in a
  burning land cell, so an hour in a fire kills it. The death cause is `BURNT`
  (`Tally.burnt`), the burnt leave no carrion, and swimmers are safe.
- **Thunder.** The strike that starts a fire is the uncommon event, and it can happen
  only while it rains. Rain may also bring thunder that is seen and starts nothing. The
  thunderstorm must look bigger than ordinary thunder. The sim had no rain of its own,
  so it now has weather (`weather.py`, a subsystem ticked hourly before the fire):
  - rain spells begin at 5, 3, 6 and 5 a month in spring, summer, autumn and winter, and
    last 2 to 30 hours;
  - 30 % of spells bring thunder and 12 % are thunderstorms, lasting 1 to 6 hours;
  - lightning strikes only in a thunderstorm, at `[flora] fire_strikes_per_storm_hour`
    = 1.6 at full dryness. This replaces `fire_ignitions_per_year` and is calibrated to
    the same expected strikes a year (about 10.7 on the default calendar);
  - any rain slows a fire as wet land does;
  - the rain god power stays a soaking rain that puts fires out and never strikes.
- **Rain meets the water** up close.
- **A volcano to be seen**, not only its effect.
- **What the giving powers do.**
- **Every effect in all three views** in the report. The apocalypse is the exception,
  since it holds the map.

The algae M11 added (owner's request via M11) are drawn too.

**Schema.** M11's algae took v11 (commit 6f8bd1b), which this branch carries
(cherry-picked as df1787e). R4's change is v12: `v11_to_v12` adds the weather, dry, to
worlds with fire and `burnt = 0` to the tally, and there is a fixture `v12.lzma`. Schema
numbers are claimed on the coordination board from now on. Golden hashes change.

**On the wire.**

- `sky.raining` became `sky.rain`: none, rain, thunder, storm or soaking.
- `land` gains `scorch` (how recently each cell burnt) and `algae`.
- `events` gains `creatures_arrived`.
- The stream sends the land again right after an event that changes it: terrain events,
  god powers, a fire going out.
- `tools/stream.py --stage DAY:HOUR:WHAT[@X,Y]` stages a fire (a storm whose lightning
  strikes there), a rain kind, a volcano or a quake (with the terrain's own
  `apply_volcano` and `apply_earthquake`), or a god power by name. It exists for the
  report's streams.

**In the renderer.**

- **Lightning in three sizes** (`lightning.ts`). Thunder brings a thin bolt every 9 s
  or so and a faint flash. A thunderstorm brings forked bolts every 2.6 s or so,
  brighter flashes, a darker sky and heavier, slanting rain. The fire's strike is the
  thickest bolt, forked twice, with the brightest flash, and it falls where the fire
  begins.
- **Rain by kind**, with rings spreading where it hits the water and splashes on the
  land, in the middle and local views.
- **Fire.**
  - Flames in four frames: one to a burning cell in the middle view, three up close
    (2 or 3 times larger, whole multiples only), each on its own flicker.
  - Burnt ground (`scorch`) painted as charcoal patches with ash, fading as the scorch
    does.
  - Charred tree skeletons on burnt cells where a tree stood (`HEIGHT` ≥ 0.6) while the
    scorch is fresh.
  - A puff of ash where an animal dies in a burning cell.
- **A volcano's cone and a meteor's crater** (`marks.ts`), drawn for 30 sim-days from
  the event. The sim does change the heights, but the ground's gentle shading hardly
  shows a cone or a bowl from above.
  - The cone: basalt lit from the upper left, gullies, its shadow, a mouth of lava, and
    lava rivulets while it erupts.
  - The crater: its far side lit, a rim, ejecta.
- **Seed.** Golden motes over the bare land in sight: the sim sows bare land
  island-wide, not at a point.
- **Ark.** The beam goes where `creatures_arrived` says the newcomers landed.
- **Algae.** Olive fronds in clumps on the shallow sea, as thick as their biomass.
- **Glow on the map's dots** too.
- **The demo** (`?show=`) changes the land as the stream would: a cone, a bowl, a burnt
  wood, sprouts on bare land, and the ark's newcomers.

## Round 3: the owner's comments on the second report (2026-10-20)

- **Films at native resolution and frame rate.** The report's films are now taken at the
  desk screen's own 1024×600 and at 30 fps. The page has a film mode (`?film`): the
  ticker stops, the report steps the scene one frame at a time on its own clock (the
  recording plays on the same clock), and ffmpeg encodes the frames as VP9 WebM with
  4:4:4 colour. ffmpeg was approved by the owner as the report script's dependency. The
  films go to `reports/R4-atmosphere/films/`, which is gitignored (about 150 MB); only
  `report.html`, with a poster still for each film, is committed.
- **The volcano and the crater were too plain.** They are now drawn after how top-down
  pixel-art games draw mountains and craters (*Zelda: A Link to the Past*'s Death
  Mountain, the *Pokémon* GBA overworlds' Mt. Chimney, *Stardew Valley*'s Ginger Island
  volcano), procedurally (`marks.ts`):
  - **The cone** is stacked basalt ledges, each with a lit, grainy top and a striated
    cliff face toward the viewer. Its north edges catch the light in one pixel, its south
    edges are outlined, and boulders lie on the ledges. The mouth's back wall shows above
    a floor of crust.
  - **The lava** is its own untinted layer while the eruption lasts: a pool with ragged
    crust plates, and rivers meandering down the ledges and falling bright over the
    cliffs.
  - **The crater** is a raised rim with its face, the far wall of the bowl showing, a
    scorched, glassy-cracked floor, rays of debris and boulders. The bared ground shows
    through the bowl.
- **A ring where plants cannot grow for a while** round both, so that plants do not
  overlap them. This is in the sim (`Flora.observe`): a volcano's cone or any crater
  destroys the plants within `[flora] barren_reach` (1.4) × its radius, and nothing grows
  there for `barren_days` (120). The flora gains a `barren` grid in schema v12 (still
  unreleased, so its migration and fixture were amended rather than bumped).

## Round 4: the owner's comments on the third report (2026-10-20)

- **Night and day over about a minute.** Only the report changed: its day film is a
  sim-day in 60 s (1440 sim-seconds a wall second). On the desk the light follows the
  owner in real time.
- **Glow.** On the map, a light only just round the animal's square (8 art pixels). In
  the middle and local views, a ring of light round each glowing joint whose heart is
  clear (`sprites.ring`), so that the animal shows through it; up close it is wider. All
  of it breathes, between 45 % and full over 3.5 s.
- **Rain that is in the world.** The drops are sized to the view: a 2-pixel streak on
  the map, 3 in the middle view, 6 up close, falling 80, 120 and 170 art pixels a second.
  They fall in three layers (far, middle and near: smaller, slower and fainter to bigger,
  faster and brighter), each a slanted pixel line (`streakTexture`) leaning with the
  wind: 0.35 pixels across for each pixel down in rain, 0.45 with thunder, 0.8 in a
  thunderstorm, 0.2 in the rain power's soaking rain. In a thunderstorm gusts swing the
  wind, and every layer with it. Cloud greys the light while it rains (`RAIN_GREY`, and
  more in a storm), so that there are no sunny colours under rain.
- **Fire.** Up close, two large flames to a burning cell (11 × 17 pixels in six frames,
  drawn at two screen pixels to the art pixel), each with its own halo and embers.
  - **Plants carry the fire.** The sim's fire already spreads only through fuel (biomass
    times each form's flammability). The made-up fire of `?show=fire` and the burnt wood of
    `?show=burnt` now spread the same way (`fireReach`): from cell to neighbouring cell
    only where plants carry it, the most flammable fuel first.
  - **A heavier burn that tracks the fire.** The scorch is painted cell by cell, not
    blurred: charcoal, darker the more recent the fire, with drifts of pale ash, its edge
    wandering by half a cell so that it is not a grid.
- **The volcano.** Its lava flows: eight looped frames (four a second) of crust plates
  drifting across the pool and down the rivers, a brighter pulse riding the current, and
  the pool's heat swelling and ebbing. The cone's lowest ledge has no outline: it goes
  down into a skirt of dark ash and grey scree, 35 % of its radius, thinning into the
  ground in clumps.
- **The crater**, which looked like a perfect circular hole and drew its far wall cut off
  by a straight edge. It is redrawn from references on how simple impact craters look
  from above (below): a bowl with a raised rim, which is part thrown-out earth and part
  uplifted rock, sharp at the crest and tapering outward; a rumpled ejecta blanket that
  thins outward; rays, which an oblique impact throws downrange and not uprange; walls
  that slump. `marks.ts` builds a height field: a scalloped rim, a little long along the
  meteor's path; a bowl with a flat, rumpled floor and a slumped lobe; ejecta falling off
  as the cube of the distance, lumpy. It is lit from the upper left with the rim's
  shadow cast into the bowl. So the near wall is in shadow (cool, never black) and the
  far wall is lit. The fresh ejecta is paler than the ground, thins into clods and
  carries boulders, and its rays go downrange. The rim stands where the sim dug; the
  ejecta reach twice as far, beyond the sim's barren ring.
- **The ark.** Its light is as wide as the place the newcomers land on in every view (2×
  in the middle view, 4× up close). Each newcomer comes into being: the herd asks the
  atmosphere, for each animal new to the scene, whether the ark's light is on that place
  (within 8 cells and 12 s). If it is, a thread of light comes down onto the animal and
  flares, sparks rise, and the body fades in over 2.5 s in four steps
  (`CreatureLayer.arrive`).
- **The seed's plants growing.** The atmosphere diffs the land before the seed power
  against the land that comes with it (a stream sends it just before the event) or next.
  On each cell it sowed, sprouts break the soil with a glint of gold and grow leaf by leaf
  over 3 s, staggered by up to 2.5 s: five to a cell up close, one in the middle view, a
  green fleck on the map. They stay until the cell's plants are big enough to be drawn,
  or 20 sim-days. The demo now sows seedlings as the sim does (biomass 0.04, too small to
  draw).
- **Tides.** The painter also paints the swash, three layers of water running further up
  the beach (shallow sea over the sand, foam at its edge), one step of `surf` pixels each
  and one pixel on the map. Every surf and swash layer is cut into tiles 16 art pixels
  across, each on its own clock: a smooth noise of where it is on the island
  (`tidePhase`, turning over 14 cells), the same in every view. So waves run along a
  coast, and no two coasts break together. A wave runs up in 30 % of 5.4 s and drains in
  the rest. How far it runs is set by a tide that turns over 48 s. The cross-fade of a
  new painting still works, on a container per band, while the tiles carry the tide.
- **The ark and the seed only on land.** The seed sows only bare land cells. The ark's
  newcomers, scattered round its spot, could land in the sea; they are now set on the
  spot itself when they do (sim fix, with a test that fails without it). The owner was
  asked whether checks of this kind across the sim deserve a milestone of their own.

## Round 5: the owner's comments on the fourth report (2026-10-20)

- **Waves coordinated.** The tiles' clocks no longer come from a noise (which made the map's
  coast flicker at random): a wave front travels across the sea in one direction at
  5 cells a second, wandering a little, so neighbouring stretches of coast break a moment
  apart and far ones at their own time. One wave clock (5 s; first 8 s, which the owner
  found too slow) drives the crest coming in, the foam breaking and the swash running up
  after it. The swash rises and drains smoothly (each step fades in as the water reaches
  it), each step 1.5 times the surf's width, on a tide turning over a minute.
  The map keeps its surf without a swash; its tiles are 8 art pixels.
- **Glow** fainter closer in: its pulse runs from 12 % to 30 % in the middle view and 6 %
  to 16 % up close (30 % to 70 % on the map), so that the animal shows through it.
- **Rain.** The drops are pale blue (three tones, far to near) and drawn over the tint,
  faded with the light, so that they show on any ground; under the tint they had vanished
  on the light map. They are longer and fall about twice as fast (3, 5 and 6 pixels; 170,
  210 and 230 pixels a second). Each spell draws its own strength (45 % to 135 %) when it
  begins and swells within it over 18 s. A thunderstorm falls half as heavy again, faster,
  and leans and gusts harder.
- **Thunder at random times.** Bolts fall by chance in windows a quarter of their mean
  spacing, at a rate that turns over 25 s (lulls and bursts, a bolt sometimes right after
  another).
- **The sun blocked.** A multiply tint can only darken, and a first grey veil did not read
  in the films (the owner). Under cloud the world is now colour-graded: a colour-matrix
  filter on the world's container takes each colour toward its grey and cools it a little
  (`GREY_OUT` 72 % at full overcast), as overcast as the weather: cloud 50 %, the rain
  power 75 %, rain 80 %, thunder 90 %, storm 100 %. A faint haze of cloud-grey (14 %) lies
  over it. The filter is on only while the sky is overcast, so a clear day costs no pass
  (R5 measures it on the board). Lights, lightning and rain are outside the world and keep
  their colour.
- **A cloudy weather** in the sim (`Rain.CLOUD`, `[weather] cloud_spells_per_month`,
  `cloud_hours_min`, `cloud_hours_max`): between rains the sky clouds over, 8 times a
  month for 3 to 36 hours, and rain can come out of it. The owner left its effect on
  evolution to us: it has none. It is only seen, so plants and animals live under the
  same light, fire is not slowed, and M11's tuning is not disturbed. Its state is the
  weather's own (`rain`, `until_ms`), so no schema change. On the wire it is
  `sky.rain = "cloud"`.
- **Fire.** Up close the flame is redrawn after pixel-art fire references (below): 15 × 24
  texels in six frames, with a steady base on its fuel, a body that narrows and sways more
  the higher it is, tongues licking up in turn, and on each loop a lick pinching off and
  rising. The colours run from a deep red rim (never brown, which reads as smoke) through
  orange and yellow to a white-gold heart. Each burning cell has a bed of glowing embers
  on the ground, so the flames rise out of it. A burning tree or bush burns in its crown
  too. After the owner saw it: the big flames flicker slowly (about 4 frames a second)
  and are 72 % opaque so what stands behind them shows; three small flames lick round
  them in every burning cell; at night an added copy of each flame keeps it lit, since
  among the plants it is under the tint.
- **Depth sorting.** What lies on the ground (a crater, a cone's scree, a fire's embers) is
  drawn on a floor under the plants (`Landscape.floor`). What stands (flames, a cone and
  its lava, the seed's sprouts) goes into the plants' rows by its foot (`RowPool`, the
  rows the creatures already use), so what stands in front covers it. These were drawn
  over every plant before. On the map there are no rows: they go over the ground.
- **The volcano's lava** wells up in the middle of the pool and drifts outward to its rim,
  where before it slid sideways.
- **A crater only after its meteor.** The stream now sends the land an event changed just
  after the event's news (`tools/stream.py`; a server does the same). The scene holds a
  crater's land until its meteor strikes (1.2 s).
- **The seed's growth.** The scene finds the sown cells as those bare before whose
  biomass grew. A land that changed for another reason is passed over (a fire's, coming
  with the power), and the next one is waited for. The recorded seed took on few cells,
  so the report also shows it made up on burnt ground (`?show=burnt,seed`).
- **The ark's foot.** The beam fades in steps toward its foot into a flattened pool of
  light on the ground; each newcomer's thread of light likewise.

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
- Simple impact craters, for the crater of round 4: NASA, *Impact craters* (lunar
  feature guide; rays as bright streaks, signs of youth),
  <https://www.nasa.gov/sites/default/files/atoms/files/impact-craters.pdf>; Arizona
  State University, Mars Education, *Simple craters* (bowl-shaped, low raised rims, a
  rumpled ejecta blanket), <https://marsed.mars.asu.edu/mep/craters/simple-craters>;
  NASA JPL, *How to make a crater* (an oblique impact throws no rays uprange),
  <https://www.jpl.nasa.gov/videos/how-to-make-a-crater>; World Machine, *Craters*
  tutorial (the rim sharp at its edge, tapering into the land),
  <https://www.world-machine.com/tutorials/craters/craters.html>; the Cratermaker
  documentation, *Create a shaded topographic representation of a crater* (a crater
  drawn as a shaded height field),
  <https://cratermaker.readthedocs.io/en/latest/auto_examples/04-topography/4.1-plot_shaded_crater.html>;
  EGU 2014 abstracts on simple crater rims (the rim's height is ejecta and structural
  uplift in about equal parts), <https://meetingorganizer.copernicus.org/EGU2014/EGU2014-2240.pdf>.
- Pixel-art fire, for the flames of round 5: Sprite AI, *Fire pixel art* (a near-white
  core, yellow, orange, deep red at the edge; no brown, which reads as smoke or dirt;
  four to six looping frames; a base kept nearly still so the fire stays on its fuel;
  tongues that appear at the top and pinch off), <https://www.sprite-ai.art/gallery/fire>;
  Wacom community, *Easy and quick flame animation tutorial* (filling a flame shape from a
  dark red rim inward to brighter colours, eight to ten colours),
  <https://community.wacom.com/en-de/easy-and-quick-flame-animation-tutorial>;
  OpenGameArt, *Camp fire animation for RPGs*, <https://lpc.opengameart.org/node/14162>.
- ADR 0016 (light and god powers), ADR 0018 (the world's end and the next), ADR 0020 (the
  camera and the dip).
