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

**Rare genes** (starter set; full table in M7): fire-pine (survives fire), nitrogen-fixer
(needs less fertility, builds soil 3× faster), mangrove (lives in shallow water and
ignores shore wind). Each costs growth. They appear and are lost by chance when a plant
establishes.

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
- **Daylight** scales growth (constant until the presence model of M8).

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

## Fire

Lightning ignites vegetation in the warm season. A burning cell burns for 8 hours and
can ignite its four neighbours, depending on their fuel, their form's flammability
(grass and conifers burn well, broadleaf forest poorly) and the dryness. Fire needs
fuel, so it stops at water and bare ground. Low plants resprout from their roots, trees
mostly die, fire-pines survive. Burnt ground loses some fertility and cannot burn again
for 60 days. The world emits `FireStarted` and `FireEnded` (with the size).

## Hooks

- `Flora.graze(ys, xs, demand)` for fauna (M4): defended plants refuse part of a bite;
  grazers on one cell share what is there. What is eaten is also worth less to the grazer
  (`[fauna] defence_toxicity`, M5), and grazers see plant form, not defence:
  `Flora.forms()` (cached until the genome changes) and `Flora.defence_at`.
- `Flora.set_daylight(level)` for presence (M8).
- `Wildfire.ignite(y, x, t)` for god powers (M8).

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
