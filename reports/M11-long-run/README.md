# M11 — Long-run tuning and stability

Run `m11-report-main`: 20 seeds × 3 sim-years, commit `92a082a235be`, config `96684c6842a6094b`, wall time 1265.34 s.
Baseline `m11-tuned-heldout`: config `96684c6842a6094b` (start 2026-01-01; 14 job(s); schedule office).
Baseline `m11-report-always`: config `96684c6842a6094b` (start 2026-01-01; 12 job(s)).
Baseline `m11-report-conference`: config `96684c6842a6094b` (start 2026-01-01; 12 job(s); schedule conference).
Baseline `m11-report-five-year`: config `96684c6842a6094b` (start 2026-01-01; 12 job(s); schedule office).
Baseline `m11-report-fork`: config `96684c6842a6094b` (start 2026-01-01; 12 job(s); forks every 60 days for 28; schedule office).
Baseline `m11-report-learning-off`: config `e6caa502a8da141c` (start 2026-01-01; 12 job(s); fauna.learning=false; schedule office).
Baseline `m11-report-off-algae`: config `a167daa0a0490812` (start 2026-01-01; 12 job(s); flora.algae_capacity=0.0; schedule office).
Baseline `m11-report-off-cover`: config `77e7991ffe85378b` (start 2026-01-01; 12 job(s); fauna.cover_protection=0.0; schedule office).
Baseline `m11-report-off-gut-seeds`: config `a94464a48925b62c` (start 2026-01-01; 12 job(s); fauna.gut_seeds_per_hour=0.0; flora.fruit_by_wind=true; schedule office).
Baseline `m11-report-office-august`: config `96684c6842a6094b` (start 2026-01-01; 12 job(s); schedule office-august).
Baseline `m11-report-off-kin`: config `0944e1dec1c6c377` (start 2026-01-01; 12 job(s); fauna.prey_diet_gap=1.0; schedule office).
Baseline `m11-report-off-nutrients`: config `d04fab89c487dc5a` (start 2026-01-01; 12 job(s); fauna.dung_fertility=0.0; fauna.carrion_fertility=0.0; schedule office).
Baseline `m11-report-off-reach`: config `ff2165d867d63db6` (start 2026-01-01; 12 job(s); fauna.browse_floor=1.0; schedule office).
Baseline `m11-report-off-resting`: config `ac29b62e9b162e79` (start 2026-01-01; 12 job(s); fauna.hunter_rest_share=1.0; schedule office).
Baseline `m11-report-off-soft-caps`: config `1293676c569fe501` (start 2026-01-01; 12 job(s); fauna.crowding_wait_days=0.0; schedule office).
Baseline `m11-report-off-wading`: config `0f5af511e8ba7087` (start 2026-01-01; 12 job(s); fauna.wading_depth=0.0; schedule office).
Baseline `m11-report-presses`: config `96684c6842a6094b` (start 2026-01-01; 12 job(s); schedule office; presses every 7 days).

- **PASS** M2.1 (tuning seeds): Land fraction never below the band (minimum over all seeds and samples) (measured 0.3199, target ≥ 0.25)
- **PASS** M2.2 (tuning seeds): Land fraction never above the band (maximum over all seeds and samples) (measured 0.5203, target ≤ 0.6)
- **PASS** M2.3 (tuning seeds): Share of seeds with ≥ 1 landmass split or rejoin per 3 years (measured 0.95, target ≥ 0.5)
- **PASS** M2.4 (tuning seeds): Seeds that lost all their land at any time (measured 0, target ≤ 0)
- **PASS** M4.1 (tuning seeds): Share of seed-years in which the population died out (measured 0, target ≤ 0.2)
- **PASS** M4.2 (tuning seeds): Share of seeds whose genetic distance from the ancestors is still rising (end of run vs two thirds of it) (measured 1, target ≥ 0.8)
- **PASS** M4.3 (tuning seeds): Share of seeds with ≥ 3 herbivores and ≥ 3 predators, mean over the final year (measured 0.9085, target ≥ 0.6)
- **PASS** M4.4 (tuning seeds): Step of the whole world, median ms per sim-day (measured 400.6, target ≤ 600)
- **PASS** M5.1 (tuning seeds): Learning tracks the local environment: share of seeds whose final-year diet fit (learned plant preference against the local plant defence) is positive (measured 0.95, target ≥ 0.8)
- **PASS** M6.1 (tuning seeds): Median seed's share of inhabited sim-time after the founding with 3–16 species alive (measured 0.9955, target ≥ 0.9)
- **PASS** M6.2 (tuning seeds): Speciations (splits on the island) per inhabited sim-month, median of seeds (measured 1.714, target ≥ 1)
- **PASS** M7.1 (tuning seeds): Share of seeds in which the rarest-appearing rare gene appears (lowest over all creature and plant genes) (measured 0.8, target ≥ 0.3)
- **PASS** M7.2 (tuning seeds): Share of seeds where no rare gene stays above 90% of its population for more than 91 days (measured 1, target ≥ 0.9)
- **PASS** M9.1 (tuning seeds): Notable entries (importance ≥ 3) per sim-month: median of the seeds' median months (measured 5, target [2, 15])
- **PASS** M9.2 (tuning seeds): Share of all entries (every seed) held by the most frequent event type (measured 0.2383, target ≤ 0.3)
- **PASS** M11.1 (tuning seeds): Mean genetic distance from the ancestors still rising at year 3: mean over seeds at the end minus at two thirds of the run (measured 0.02962, target ≥ 0)
- **PASS** D1 (tuning seeds): Genes with a niche (looks aside) in ≥ 25% of seeds: both ends of the range each held ≥ 10% of creatures at some time (measured 10, target ≥ 9)
- **PASS** D2 (tuning seeds): Rare genes (creature and plant) that thrive in ≥ 10% of seeds: ≥ 5% of its population for ≥ 30 days (measured 5, target ≥ 5)
- **PASS** D3a (tuning seeds): Predators' share of creatures after year 1: median of seeds' median inhabited day (measured 0.1372, target [0.03, 0.2])
- **PASS** D3b (tuning seeds): Share of inhabited days after year 1 with ≥ 3 predators (all seeds) (measured 0.916, target ≥ 0.8)
- **PASS** M2.1 (held-out seeds): Land fraction never below the band (minimum over all seeds and samples) (measured 0.3242, target ≥ 0.25)
- **PASS** M2.2 (held-out seeds): Land fraction never above the band (maximum over all seeds and samples) (measured 0.5349, target ≤ 0.6)
- **PASS** M2.3 (held-out seeds): Share of seeds with ≥ 1 landmass split or rejoin per 3 years (measured 0.95, target ≥ 0.5)
- **PASS** M2.4 (held-out seeds): Seeds that lost all their land at any time (measured 0, target ≤ 0)
- **PASS** M4.1 (held-out seeds): Share of seed-years in which the population died out (measured 0, target ≤ 0.2)
- **PASS** M4.2 (held-out seeds): Share of seeds whose genetic distance from the ancestors is still rising (end of run vs two thirds of it) (measured 1, target ≥ 0.8)
- **PASS** M4.3 (held-out seeds): Share of seeds with ≥ 3 herbivores and ≥ 3 predators, mean over the final year (measured 1, target ≥ 0.6)
- **PASS** M4.4 (held-out seeds): Step of the whole world, median ms per sim-day (measured 442.2, target ≤ 600)
- **PASS** M5.1 (held-out seeds): Learning tracks the local environment: share of seeds whose final-year diet fit (learned plant preference against the local plant defence) is positive (measured 1, target ≥ 0.8)
- **PASS** M6.1 (held-out seeds): Median seed's share of inhabited sim-time after the founding with 3–16 species alive (measured 0.9797, target ≥ 0.9)
- **PASS** M6.2 (held-out seeds): Speciations (splits on the island) per inhabited sim-month, median of seeds (measured 1.654, target ≥ 1)
- **PASS** M7.1 (held-out seeds): Share of seeds in which the rarest-appearing rare gene appears (lowest over all creature and plant genes) (measured 0.95, target ≥ 0.3)
- **PASS** M7.2 (held-out seeds): Share of seeds where no rare gene stays above 90% of its population for more than 91 days (measured 1, target ≥ 0.9)
- **PASS** M9.1 (held-out seeds): Notable entries (importance ≥ 3) per sim-month: median of the seeds' median months (measured 4, target [2, 15])
- **PASS** M9.2 (held-out seeds): Share of all entries (every seed) held by the most frequent event type (measured 0.2451, target ≤ 0.3)
- **PASS** M11.1 (held-out seeds): Mean genetic distance from the ancestors still rising at year 3: mean over seeds at the end minus at two thirds of the run (measured 0.02685, target ≥ 0)
- **PASS** D1 (held-out seeds): Genes with a niche (looks aside) in ≥ 25% of seeds: both ends of the range each held ≥ 10% of creatures at some time (measured 10, target ≥ 9)
- **PASS** D2 (held-out seeds): Rare genes (creature and plant) that thrive in ≥ 10% of seeds: ≥ 5% of its population for ≥ 30 days (measured 8, target ≥ 5)
- **PASS** D3a (held-out seeds): Predators' share of creatures after year 1: median of seeds' median inhabited day (measured 0.14, target [0.03, 0.2])
- **PASS** D3b (held-out seeds): Share of inhabited days after year 1 with ≥ 3 predators (all seeds) (measured 0.939, target ≥ 0.8)
- **PASS** M3.1 (5 years): Months until grass covers ≥ 50% of the land (median seed) (measured 7.014, target [3, 9])
- **PASS** M3.2 (5 years): Months until closed forest on ≥ 2% of the land (median seed) (measured 20.93, target [12, 24])
- **PASS** M3.3 (5 years): Share of seeds with ≥ 4 plant forms (each ≥ 1% of land) at year 3 (measured 1, target ≥ 0.8)
- **PASS** M3.4 (5 years): Seeds that end as a single land-cover class (measured 0, target ≤ 0)
- **PASS** M3.5 (5 years): Share of seeds where grass never reached half the land or no forest closed (measured 0, target ≤ 0.1)
- **PASS** M5.3: Step of the whole world with learning on, median ms per sim-day (measured 382.8, target ≤ 600)
- **FAIL** M8.1: Night traits (glow, hibernation) are more frequent under the office schedule than always-present: one-sided rank test across seeds, p-value (measured 0.5927, target ≤ 0.05)
- **PASS** M8.2: Share of seeds whose creatures survive every 3-week absence (1–21 October) (measured 1, target ≥ 0.8)
- **PASS** M8.3: Share of seeds whose creatures survive every August holiday (asked by the owner) (measured 1, target ≥ 0.8)
- **PASS** M7.2: Re-judged in the office's light: share of seeds where no rare gene stays above 90% of its population for more than 91 days (measured 1, target ≥ 0.9)

See `report.html` for figures and `metrics.json` for every number.
