# 0016 — Presence, light and god powers

- **Status**: accepted; M8.1 revised in M11 (ADR 0019): selection on light traits, night or day
- **Date**: 2026-10-19

## Context

M8 makes the owner's presence the island's sun (PIR → `PresenceChanged`), with dusk, the
weekend Long Night, dark holidays and a moonlight floor, and adds god powers (meteor,
rain, seed, ark) with a cooldown. Its bands: the office schedule measurably selects for
night traits against always-present; a 3-week absence leaves life alive in `[≥ 80 %]`
of seeds. M7 built the darkness genes (glow, hibernation, photosynthesis) against a
daylight hook and deferred M7.2 here, since photosynthesis swept herds in constant
light (ADR 0015). A first presence model was parked on `m8-daylight` (ADR 0011).

`docs/design/presence.md` left two questions open. The owner settled them at the start
of M8 (2026-10-19):

1. **The switch**: the final hardware has no covered toggle switch. A push button fires
   a god power; the only switch turns the device on. Which power fires is random, not
   uniform: base weights from the config, raised by what the island needs.
2. **Holidays**: no calendar. A holiday is a long absence. The owner asked that this be
   tested with evolution runs: no total extinction during holidays.

The effects of the four powers were accepted as proposed.

## Decision

**Light.** A presence subsystem, registered first and run every 10 sim-minutes, moves
the light toward 1 while the owner is present (over 0.5 h), toward 0.05 once they leave
(over 1.5 h), and toward a moonlight floor of 0.15 after 72 h away. Weekends (about
63 h) stay dark; holidays get moonlight. Creatures get the light of the moment.

Plants get a running mean of each day's light over a week, at full growth from 0.25. A
first version gave them each day's own mean: in a preview (8 seeds, 2 years, office)
weekends cut growth to about 17 %, the island greened a founding season late and every
seed's founders arrived on day 457 instead of about 250. With the weekly mean an office
week grows plants as before (M3's calibration stands), founders arrive on days 241–260,
and a long holiday in moonlight slows plants to about 0.6. Plants respond to the light
summed over days, not to the moment (the daily light integral, Faust and Logan 2018);
the week is our choice, so that the Long Night is a rhythm and not a famine.

**God powers.** `GodPower()` is the button; `GodPower(power)` names one (tests, a later
phone app). Weight of power *p*: `god_weight_p × (1 + god_need_gain × need_p)` (base
meteor 1, rain 2, seed 2, ark 1; gain 4); needs: rain, 1 while a fire burns, else the
season's dryness; seed, the share of land without plants; ark, how far creatures are
below 40. Meteor: a crater on a random land cell, plants in the bowl destroyed,
creatures within twice its radius killed. Rain: fires out, soil + 5 % of its room, five
wet days (no lightning, slow spread, growth × 1.5). Seed: 400 random seeds on bare land,
one in ten with a plant rare gene. Ark: 12 plant eaters, as founders. Cooldown 7 days,
saved; `GodPowerRefused` while cooling, `GodPowerReady` once when it ends (the LED).

**State.** Schema v8: the presence subsystem's state (presence, light, the running mean,
cooldown, rain). The hooks it drives in the other subsystems are not saved; it pushes
them again on restore. An always-present world is bit-identical to before in every other
subsystem (checked over 520 days).

**Fast-forward** plays synthetic schedules (`--schedule`: always, office, office-august,
conference), hour by hour, and records each day's light.

**Acceptance.** M8.1 is read as a one-sided rank test across seeds (Mann and Whitney
1947), office above always, on glow and hibernation carriers per creature-day: p ≤ 0.05.
M8.2 counts a seed as surviving if creatures never all died during any 1–21 October
absence that found them alive. M8.3, the owner's request, does the same for August.
M7.2 is judged again on the office run.

## Results

`reports/M8-presence/` (runs `m8-office`, `m8-always`, `m8-office-august`,
`m8-conference`: the same 20 seeds × 3 sim-years each).

| Criterion | Measured | Band | |
|---|---|---|---|
| M8.1 night traits, office above always (rank test) | p = 0.146 | ≤ 0.05 | FAIL |
| M8.2 seeds surviving every 3-week absence | 100 % (57 absences) | ≥ 80 % | PASS |
| M8.3 seeds surviving every August holiday | 100 % (40 absences) | ≥ 80 % | PASS |
| M7.2 seeds free of long fixation, office light | 95 % | ≥ 90 % | PASS |

- **Hibernation is selected, in a third of the seeds.** Under office hours it takes off
  in 7 of 20 seeds (45–112 carriers per 1000 creature-days; always-lit never passes 11);
  in the rest it stays at mutation level. The median of glow and hibernation together is
  three times always-lit's (4.7 vs 1.6 ‰), but a rank test weighs every seed alike, and
  the tail does not move it enough (p = 0.15; hibernation alone 0.12).
- **Glow is not selected** (p = 0.86). In the dark a glower sees at full range but is
  also seen at full range; prey that glows lights the way for its hunters.
- **Photosynthesis is selected against** by the nights (p = 0.001; median 0.7 ‰ against
  10 ‰ always-lit, mean 4 ‰ against 145 ‰): its sweeps are gone and M7.2 passes.
- **Holidays are not a danger.** No absence, of 97, lost all creatures; the median
  absence ended with as many creatures as it began. The moonlight floor and torpor carry
  them; plants slowed to about 0.6 do not starve a herd in three to five weeks. The
  August holiday of the first year delays founders (654 inhabited days, median, against
  839), since plants green more slowly.
- The nightly test (`tools/tests/test_m8_statistical.py`, 20 seeds through August and
  October 2027) passes.

**Owner's decision (2026-10-19)**: M8.1 is deferred to M11, where glow's payoff and the
cost of the night genes are tuned with everything else (ADR 0011).

## Consequences

- The device's server only forwards presence; no calendar is needed for holidays.
- S2 builds a button (debounced), not a covered switch; `lineage_device` will have
  `button.py`. The LED follows `GodPowerReady` and `Presence.ready_t_ms`.
- R4 lights the scene from `Presence.light`; glow spots have a night to shine in.
- The chronicle (M9) can name long absences dark ages and report god powers.
- Every later statistical milestone should run under the office schedule, the light the
  gadget will have (ADR 0011).

## References

- Faust, J. E., and Logan, J. (2018). Daily light integral: a research review and
  high-resolution maps of the United States. *HortScience* 53(9), 1250–1257.
- Mann, H. B., and Whitney, D. R. (1947). On a test of whether one of two random
  variables is stochastically larger than the other. *Annals of Mathematical
  Statistics* 18(1), 50–60.
