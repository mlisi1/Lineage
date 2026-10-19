# Presence and god powers

Built in M8 (`sim/lineage_sim/presence.py`, ADR 0016). Tunables: `[presence]` in
`sim/config/default.toml`.

## The owner is the sun

A PIR sensor reports presence; hold logic lives upstream (device/server), and the sim
receives `PresenceChanged` events. The presence subsystem runs every 10 sim-minutes,
registered first, so the others always see the current light.

- **Present → day.** The light rises to 1 over `dawn_hours` (0.5 h).
- **Leaving → dusk.** It falls over `dusk_hours` (1.5 h) to `night_light` (0.05): evenings
  are dusk, nights are dark.
- **Weekends are the Long Night**: about 63 hours away, all of it dark.
- **Holidays are dark ages.** No calendar: a holiday is a long absence. After
  `moonlight_after_hours` (72 h) away a moonlight floor (0.15) holds, so life is not left
  in black for weeks. The chronicle (M9) can name the era.
- **A world that never hears of its owner stays fully lit** (a new world starts present).
- Seasons follow the real calendar (UTC internally, `clock.py`).

Who reads the light:

| Reader | What it gets | Effect |
|---|---|---|
| Creatures (`Fauna.set_daylight`) | the light of the moment | sight dims to `night_sight` of the range (glow keeps full range); photosynthesis feeds on it; hibernators go torpid below `hibernation_daylight` |
| Plants (`Flora.set_daylight`) | growth factor `min(1, recent / plant_full_light)` | `recent` is a running mean of each day's mean light over `plant_light_days` (7): an office week (about 0.3, dipping to 0.24 after a weekend) grows plants as before M8; a long holiday in moonlight slows them to about 0.6 |

These hooks are not saved; the presence state is (schema v8), and the subsystem pushes
them again after a restore.

## God powers

A push button (no covered switch: the owner's decision, 2026-10-19) sends `GodPower()`.
At most one power fires per `god_cooldown_days` (7); a press during the cooldown returns
`GodPowerRefused(ready_t_ms)`, and `GodPowerReady` is emitted once when it ends: the
LED's cue. The cooldown is in the saved state.

**Which power**: the island draws it from the presence stream. Power *p* has weight
`god_weight_p × (1 + god_need_gain × need_p)`, with needs in [0, 1] (`Presence.needs`):

| Power | Base weight | Need | Effect |
|---|---|---|---|
| Meteor | 1 | none | a crater (`meteor_radius_cells` 8, depth 0.15, rim and fertility as natural craters) on a random land cell; plants in the bowl destroyed; creatures within 2 × the radius killed, leaving nothing to eat |
| Rain | 2 | 1 while a fire burns, else the season's dryness | every fire put out; soil fertility + 5 % of its room; for `rain_days` (5) no lightning, slow spread, plant growth × 1.5 |
| Seed | 2 | share of land without plants | 400 seeds of random genomes on random bare land cells, taking where they could grow; each carries a random plant rare gene with probability 0.1 |
| Ark | 1 | how far creatures are below 40 | 12 plant eaters land on a vegetated spot, as founders do |

`GodPower(power="rain")` names a power instead (tests; a phone app later). Every power
returns `GodPowerUsed(power, x, y)` and its own events (`CraterFormed`, `FireEnded`,
`CreaturesArrived`, `PopulationExtinct`).

## Schedules for fast-forward

The device gets presence from its sensor; fast-forward runs play a synthetic schedule
(`tools/schedules.py`, `--schedule`), each day's events seeded by (world seed, day):
`always`; `office` (weekdays about 9:00 to 18:00 UTC with some spread, 5 % of weekdays
away, weekends away); `office-august` (and away all August); `conference` (and away 1–21
October).

## Targets

- The office schedule measurably selects for night traits compared with always-present
  (M8.1).
- A 3-week absence leaves life alive in `[≥ 80%]` of seeds (M8.2); so does the August
  holiday (M8.3, asked by the owner).
