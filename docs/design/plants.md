# Plants

Vegetation lives on the terrain grid. Each cell holds at most one plant population: a
biomass in `[0, 1]`, an 8-gene genome and a set of rare genes. Implemented in
`lineage_sim/flora.py` (M3); every number below is a `[flora]` key in
`sim/config/default.toml`. Flora ticks once per sim-day, fire once per sim-hour.

## Genome

Eight genes, each in `[0, 1]` (stored as a byte), each with a benefit and a cost:

| Gene | High value means | Paid with |
|---|---|---|
| `HEIGHT` | tall: shades others, wins the light | slower growth, richer soil needed, breaks in wind |
| `GROWTH` | fast growth | dies young |
| `COLD` | adapted to cold highlands | does badly in warm lowlands (and the reverse) |
| `FRUGALITY` | grows on poor soil | slower growth |
| `SHADE` | seedlings establish under a canopy | slower growth |
| `SEED` | heavy fruit: lands near, establishes better | no long-range wind dispersal |
| `EVERGREEN` | keeps its biomass through winter | slower growth |
| `DEFENCE` | refuses part of each bite and poisons the rest (M4, M5) | slower growth |

**Rare genes** (M7; bits of the per-cell mask `flora.Rare`): each appears with
probability `rare_gain_probability` (0.0002) and is lost with `rare_loss_probability`
(0.01) when a plant establishes; seeds from outside carry none.

| Gene | Bonus | Cost | Signature |
|---|---|---|---|
| `FIRE_PINE` | keeps 60 % of its biomass through a fire | growth | `bark` |
| `NITROGEN_FIXER` | needs 60 % less fertility, builds soil 3× faster | growth | `clover` |
| `MANGROVE` | lives in shallow water, ignores shore wind | growth | `stilts` |
| `POISONOUS` | grazers refuse half of each bite, and what they eat costs them energy (× 1 − 1.5) | growth | `berries` |
| `FRUITING` | animals carry its fruit far: far seeds go out as from the lightest seed | growth; grazers get 1.5× the energy from it | `fruit` |
| `EMERGENT` | a crown above the canopy: height × 1.5 for light (shade and competition) | 30 % more fertility needed, 2× wind exposure, growth | `crown` |

Poison makes the diet learning of M5 matter: a grazer's meal value from a poisonous
plant is negative, so learning from meals turns it away from that plant form. The
emergent crown scales with height, so it matters in trees and hardly in grass.

## Forms

A cell's form comes from its genome: **lichen** (very low and frugal), **grass**,
**shrub**, **broadleaf tree**, **conifer** (evergreen tree). With water, bare and burnt
ground these make the land-cover classes (`flora.Cover`) used by maps, statistics and the
renderer. A tree cell with biomass ≥ 0.55 is closed forest.

## Environment

- **Temperature** falls with altitude and follows the seasons (warmest in mid-summer of
  the configured hemisphere). Each plant has an optimum set by its `COLD` gene.
- **Fertility** comes from the terrain. A plant needs more of it the taller it is and
  less the more frugal it is: trees cannot establish on infertile soil.
- **Wind exposure** is full on the wave-swept shore and on summits, and breaks tall
  plants. It sorts the forms into belts: forest in sheltered ground, then shrub, grass,
  and lichen at the extremes.
- **Daylight** scales growth (M8): the plants follow a running mean of each day's light
  over about a week (`[presence] plant_light_days`), at full rate from
  `plant_full_light` (0.25), so an office week keeps their pace, weekends barely slow
  them and a long holiday in moonlight brings them to about 0.6 (`presence.md`).
- **Rain** (a god power) multiplies growth by 1.5 for five days.
- **Snow** lies where the temperature index is under `snow_below_temperature` (0.2),
  deepening to full cover `snow_depth_span` (0.1) below it (`flora.snow_cover`): with the
  lowland winter at 0.35, down to about 0.12 above the sea in midwinter and in summer only
  on peaks above 0.58. It is derived each moment from the season and the height, not
  stored, and nothing in the simulation reads it yet: the renderer draws it (R1, ADR 0014).

## What happens each day

1. **Flooding** — plants under the sea die; mangroves hold shallow water.
2. **Growth** — logistic, scaled by suitability (temperature fit × fertility supply) and
   the plant's trade-offs. Mortality and exposure remove biomass. In the cold, low
   non-evergreen plants die back to a root reserve and resprout in spring.
3. **Soil building** — plants raise the fertility of their cell toward a cap that grows
   with their stature (lichen ≈ 0.18, grass ≈ 0.25, shrub ≈ 0.38, tree ≈ 0.55). This is
   the chain behind succession: each stage makes the soil the next one needs.
4. **Dispersal** — plants seed into the four neighbouring cells and, for wind-borne
   seed, into a few far cells. A seed establishes if the plant could persist there
   (suitability × the biomass it would reach), if it finds light under the resident's
   canopy or tolerates shade, and if it clearly out-competes the resident
   (taller and better suited wins). Offspring mutate slightly.
5. **Seed rain** — a thin rain of seeds with random genomes from outside the map. It
   colonises bare rock, new land and burnt ground, and brings back lost forms.
6. **Feedback** — vegetation cover goes to the terrain, where it slows erosion and
   leaching.

## Algae (M11)

Food at sea, so that swimming can be a way of life (ADR 0019). Algae have no genome:
one biomass per cell, on sea cells no deeper than `algae_max_depth` (0.03 height units,
about 5 % of the map) where no plant stands (a mangrove shades them out). Spores are
everywhere, so a habitable cell never holds less than `algae_seed`; from there they grow
logistically towards `algae_capacity` (0.4) at `algae_growth_per_year` (60) × daylight
× rain × a season factor that falls to `algae_winter_share` (0.3) in midwinter. Daylight
is the plants' light (a week's running mean of presence), so office weekends barely
slow them. A cell that falls dry loses them; new shallows gain them. `algae_capacity` 0
turns them off.

Grazers eat them like plants (`Flora.graze` eats algae where no plant stands, down to
`grazing_reserve_biomass`), for `algae_meal_share` (0.8) of a plant's energy. Only
creatures at ease in water smell them (`creatures.md`). Saved state since schema v11.

## Fire

Lightning ignites vegetation, and lightning comes only with a thunderstorm (R4, the
island's own weather, `weather.py`): fires start only while it rains, mostly in the warm
season, when the land is dry (`fire_strikes_per_storm_hour` × dryness; calibrated to the
same expected strikes a year as before R4). While any rain falls a fire spreads as on
wet land. A fire burns animals that stay in it (`creatures.md`). A volcano's cone and a
crater (natural or the meteor's) bare the land round them: plants within `barren_reach`
(1.4) × the event's radius are destroyed and nothing grows there for `barren_days` (120;
`Flora.observe`, `Flora.barren`, R4). A burning cell burns for 8 hours and
can ignite its four neighbours, depending on their fuel, their form's flammability
(grass and conifers burn well, broadleaf forest poorly) and the dryness. Fire needs
fuel, so it stops at water and bare ground. Low plants resprout from their roots, trees
mostly die, fire-pines survive. Burnt ground loses some fertility and cannot burn again
for 60 days. The world emits `FireStarted` and `FireEnded` (with the size).

## Hooks

- `Flora.graze(ys, xs, demand)` for fauna (M4): defended plants refuse part of a bite;
  grazers on one cell share what is there; where no plant stands they eat algae (M11:
  `Flora.algae`, `grazeable_algae`, `on_algae`). What is eaten is also worth less to the grazer
  (`[fauna] defence_toxicity`, M5), and grazers see plant form, not defence:
  `Flora.forms()` (cached until the genome changes) and `Flora.defence_at`.
- `Flora.set_daylight(level)` and `Flora.set_rain(factor)` for presence (M8).
- God powers (M8): `Flora.clear(ys, xs)` (a meteor's bowl), `Flora.sow(rng, count,
  rare_chance, instant)` (seed), `Wildfire.extinguish(t)` and `Wildfire.set_wet(wet)`
  (rain: no lightning, slow spread); `Wildfire.set_weather(raining, storm)` for the
  weather (R4).

## How it is drawn

The renderer shows a cell's plant by its form, its biomass and the season: four stages
of growth by biomass (a sprout under 0.17, young to 0.5, grown to 0.85, old above) and
the four seasons, with low growth dried in winter, which is how winter dieback looks.
The state stream (R1) carries two genes of each cell's plant and its rare genes:

- `HEIGHT` picks a tree's or bush's build: broad and low, as the scale has it, or
  slender and tall.
- `EVERGREEN` sets how late it turns in autumn and goes bare, and what it does in winter:
  a broadleaf from 77/255 (below the conifers' 128) keeps its leaves, in a colder green;
  a bush still standing in winter (one not died back) keeps its leaves unless it has
  under 100/255, when it is bare twigs.
- The rare genes show as accents (M7's signatures: red bark, clover at the foot, stilt
  roots in shallow water, violet berries, fruit, a taller crown).
- The other six genes do not show.

See `renderer.md`, "The land from the state stream".

## Measured behaviour (M3 report, 20 seeds × 5 sim-years from bare rock)

See `reports/M3-flora/`. Targets from CLAUDE.md §8, and how they are read:

- Grass covers ≥ 50% of land within `[3–9 sim-months]` (median seed).
- First closed forest within `[12–24 sim-months]`: closed canopy on ≥ 2% of the land
  (median seed).
- ≥ 4 distinct plant forms coexist at year 3 in ≥ 80% of seeds: a form counts when it
  holds ≥ 1% of the land.
- No seed ends at 100% one class.

## Open

- "Plant species" is a coarse genome cluster for now; real clustering comes in M6.
- Height evolves quickly on fertile ground (a shrub lineage becomes trees within months);
  revisit `mutation_sigma` if lineages should be more stable.
- Moisture is not modelled; altitude, fertility and exposure carry the niches.
