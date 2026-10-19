# 0015 — Rare genes: tables, effects beside the phenotype, darkness before M8

- **Status**: accepted
- **Date**: 2026-10-18

## Context

M7 asks for full rare-gene tables for creatures and plants, their appearance and loss
rates, effects and costs, and visual-signature flags for the renderer. Its bands: every
rare gene appears in `[≥ 30 %]` of 3-year seeds; none reaches fixation (> 90 % of the
population) for more than `[3 sim-months]` in `[≥ 90 %]` of seeds.

What existed: creatures carried sixteen-bit slots (`Fauna.slots`, eight used), inherited
bit by bit with gains and losses, read by nothing; plants had three rare genes (fire-pine,
nitrogen-fixer, mangrove) in a one-byte mask per cell. The docs named venom, glow,
hibernation and photosynthesis as examples; ADR 0009 and ADR 0011 slotted poisonous
plants here, to make diet learning matter.

Three questions were settled with the owner at the start (all as proposed):

1. **The tables**: eight creature genes (one per slot) and three more plant genes.
2. **Darkness before M8**: glow, photosynthesis and hibernation depend on the dark, which
   only M8 brings. They are built against a daylight input (`Fauna.set_daylight`, like
   `Flora.set_daylight`), tested with injected darkness, and the M7 runs are in constant
   daylight. Hibernation also keys on winter, which exists now.
3. **Effects beside the phenotype**: `phenotype()` stays a function of the genes only,
   because the renderer ports it (R2) and checks the port against a fixture.

## Decision

**Creature genes** (bits of `Fauna.slots`, `rare.CreatureRare`): venom (attack × 3),
toxic (hunters' kill chance × 0.2), giant (mass × 2 with all mass scaling, later
maturity), longevity (lifespan × 2, broods halved, twice the wait between broods), amphibious (land and swim speed of
both kinds, no struggle in water), hibernation (torpid in winter or darkness while fed:
burn × 0.2, ageing × 0.25; cannot eat, breed or flee), photosynthesis (energy from
sunlight on land, less under a canopy; slower on land), glow (sees and is seen at full
range in the dark). Every gene also costs resting burn. Tables with costs:
`docs/design/creatures.md`.

**Plant genes** (`flora.Rare`): fire-pine, nitrogen-fixer, mangrove as before, plus
poisonous (grazers refuse half a bite and lose energy on what they eat), fruiting (far
seeds as if light, richer for grazers) and emergent (height × 1.5 for light; needs richer
soil, catches more wind). Each costs growth. Tables: `docs/design/plants.md`.

**Effects** sit in `rare.py`: `rare.adjust` changes the carriers' body values after
`phenotype()` (`rare.body_of`); the fauna tick reads torpor, sunlight, sight in the dark,
toxic kill odds and waterproofing through it. **Darkness** dims every creature's sight to
`night_sight` (0.3) of its range at full dark; smell is unaffected.

**Signatures**: a stable key per gene (`rare.CREATURE_SIGNATURES`, `PLANT_SIGNATURES`,
`rare.signature_table()` for the protocol). `Fauna.torpid` tells the renderer who lies
curled up. Two tables, because an `IntFlag` equals its integer: a single dict keyed by
creature and plant bits collides.

**Rates**: kept as they were (creatures gain 0.0005 and lose 0.02 per gene per birth;
plants 0.0002 and 0.01 per establishment). A preview (4 seeds × 2 years) with the
creature loss rate at 0.005 gave the same peaks: genes are lost mostly because their few
carriers die, not by mutation, so the loss rate is not what keeps them rare.

**No schema bump**: no saved field changes. The slots of old saves now have effects;
creatures that gained bits before M7 become carriers.

**Emergent crown in proportion to height**: first a flat +0.5 on height; a gain in a
hand-built meadow made an emergent grass outgrow shrubs and stall succession
(`test_taller_plants_take_over_from_grass`). The crown now multiplies the height gene, and
the gene costs growth like the others.

**Longevity breeds slowly**: in the first full run (20 seeds × 3 years) longevity held
more than 90 % of a full herd (~200) for 142 days in one seed: halving broods costs
nothing to animals with one young. Carriers now also wait `longevity_cooldown_factor`
(2) times as long between broods: about as many young in a lifetime, slower generations.
It still swept one seed of the second run (171 days), within the band.

**M7.2 and photosynthesis** (owner's decision, 2026-10-18): in constant daylight
photosynthesis covers most of a resting animal's burn and sweeps some herds (in the 90th
percentile of seeds it holds ~0.9 of the population by year 2.5). Its cost is the
night, which M8 brings; weakening it now would likely make it useless once nights exist.
It is left as is, and M7.2 is also read without it; the full reading is judged again in
M8.

## Results (reports/M7-rare-genes, run m7-rare2: 20 seeds × 3 years, commit dd5716d)

| Criterion | Measured | Target | |
|---|---|---|---|
| M7.1 every gene appears in ≥ 30 % of seeds (lowest gene) | 0.95 | ≥ 0.3 | PASS |
| M7.2 seeds free of long fixation | 0.85 | ≥ 0.9 | FAIL (deferred to M8) |
| M7.2 without photosynthesis | 0.95 | ≥ 0.9 | PASS |

Long fixations: photosynthesis in seeds 11 (104 days) and 17 (155), longevity in seed 8
(171), all in full herds of about 200. M4's criteria still pass on this run (extinction
in 1.7 % of seed-years, herbivores and predators together 72 %, step 244 ms per day).

What the run shows:

- **Rare genes stay rare.** Apart from photosynthesis, every creature gene's mean share
  is about 0.1 % of the population (median of seeds); peaks reach 2–3 % in a typical
  seed and up to 20–45 % (toxic, glow, venom) in single seeds before fading. A gene
  arrives by mutation in one newborn and usually dies out with its first few carriers
  within 10–20 days (median episode).
- **Plants keep theirs longer.** A plant gene, once it appears, persists for 230–690 days
  (median episode), but stays at 0.1–1 % of vegetated cells; emergent trees and
  mangroves reach 5–25 % of cells in the top seeds.
- **Carrier lifespans** differ little from plain creatures' (median 12 days, most dying
  young); amphibians and longevity carriers live a few days longer.
- **No gene is concentrated among predators**: predators are few (cap 16), so too few
  carriers arise among them to read; venom never took hold in a predator line.

## Consequences

- The renderer (R2) draws overlays by signature key; only giant changes body size (mass
  × `giant_mass_factor`). R1 carries `slots`, `torpid`, the plant mask and the signature
  table in the protocol.
- M8 must call `Fauna.set_daylight` and `Flora.set_daylight` from the presence model. With
  nights, glow gains its benefit, photosynthesis its cost, and hibernators sleep through
  long darkness; the M8 report should look at these three.
- Golden hashes changed (one gain/loss draw per plant rare gene at establishment).

## References

- J. B. S. Haldane (1927), "A mathematical theory of natural and artificial selection,
  Part V: Selection and mutation", *Proc. Cambridge Philos. Soc.* 23, 838–844 — a new
  advantageous mutation with advantage *s* survives drift with probability about 2*s*:
  why most rare genes here die with their first carriers.
- G. D. Ruxton, T. N. Sherratt, M. P. Speed (2004), *Avoiding Attack: The Evolutionary
  Ecology of Crypsis, Warning Signals and Mimicry*, Oxford University Press — warning
  colours and toxicity (TOXIC).
- M. E. Rumpho et al. (2008), "Horizontal gene transfer of the algal nuclear gene psbO
  to the photosynthetic sea slug *Elysia chlorotica*", *PNAS* 105 (46), 17867–17871 — an
  animal that lives partly on sunlight (PHOTOSYNTHESIS).
