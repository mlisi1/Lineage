# 0017 — Chronicle and bestiary

- **Status**: accepted
- **Date**: 2026-10-19

## Context

M9 makes the island write its own history: event detectors (speciation, extinction,
firsts, records, booms and crashes, migrations, splits and rejoins, fires, volcanoes,
god powers, anniversaries), templated text, importance scores, deduplication and rate
limiting, and a bestiary record per species with its portrait's genome. Bands:
`[2–15]` notable entries per sim-month (median); no event type above 30 % of all entries.

`docs/design/chronicle.md` left open the importance scale and the threshold for "major"
(push notifications, S4). The owner settled three questions at the start of M9
(2026-10-19):

1. **Importance** is an integer 1–5: 1 background, 2 minor, 3 notable, 4 major,
   5 historic. Notable (≥ 3) is what the M9 criterion counts; major (≥ 4) is pushed.
2. **Language**: English, templates in one place so another language can follow.
3. **Where the history lives**: in the world save. The save is the whole history,
   survives power cuts, and M10 archives a world by archiving its state.

## Decision

**A chronicle subsystem, registered last.** Most news is already an output of another
subsystem, so the World gained an observer hook (`subsystem.Observer`): after each tick,
midnight, input event or initialisation, the batch of outputs goes to every observer at
the same sim time, and what they return is appended (not shown to observers again). The
chronicle reads the other subsystems but never writes to them and draws only from its own
stream (`chronicle`); a test checks that a world with it evolves bit-identically to one
without. Its daily tick (after the species census at midnight) finds what no event says:
firsts, records, booms and crashes, migrations, anniversaries, dark ages.

**Detectors** (thresholds in `[chronicle]`):

- Species: arrivals (the very first is "first life", importance 5), splits, extinctions
  (notable if the species lived 60 days or peaked at 20, else minor), the last creature.
- Firsts, once per world: hunters and swimmers (a living species' mean genome), a closed
  forest, a fire, each creature and plant rare gene.
- Records: most creatures, most species alive, the largest species, the oldest species,
  the largest fire (≥ 300 cells). Kept from the start, announced from 180 days after the
  first landing (the fire record: after the world's first 180 days), when the last
  announced value is beaten by 10 %, at most once per record per 30 days; a record held
  by a species is told only when another species takes it.
- Booms and crashes: a species, or all creatures, doubling or halving within 30 days,
  with at least 20 at the larger end.
- Migrations: a species *settles* a large landmass, 3 or more of it there, where it had
  not settled the day before. Creatures cross straits one by one; the first rule ("3
  arrive where none stood yesterday") found no migration in 60 seed-years. Yesterday's
  settled groups are followed by their cells, so a landmass that splits or merges is no
  news.
- The land and the god: splits (major), rejoins, volcanoes, earthquakes, meteors that no
  god power sent; god powers (the meteor's crater is not told twice); fires of 300 cells
  (1500: major).
- Time: the world's birthday; each year a species has lived; seasons (background).
- Dark ages: the owner away 120 h (a weekend is about 63 h), and the dawn on return.

**Filters.** An entry of the same kind about the same subject within a gap is dropped
(7 days; records and swings 30, migrations 60). At most 3 entries below major per UTC
sim-day; major entries always pass.

**Text.** Each kind has one to three templates; the chronicle's stream picks one. Entries
carry no date (the reader adds it), the species they are about and the cell where they
happened (mean position of a species' members), for R3's camera.

**State and the bestiary.** Schema v9 (`v8_to_v9`) adds the chronicle: entries column by
column, dedup memory, records, firsts, per-species peaks, rare genes seen and anniversary
counts, a 30-day ring of member counts, yesterday's settled groups. An upgraded world's
chronicle starts *unprimed* and first takes stock in silence, so what happened before
the upgrade is not announced as news. The bestiary is a view: `Species.records()` (the
founding genome is the portrait) joined with what the chronicle keeps (ancestry,
daughters, diet and habitat from the founding genome, rare genes ever carried, when it
peaked, its entries).

## Results

`reports/M9-chronicle/`: 20 seeds × 3 sim-years, office schedule (ADR 0016), run
`m9-office`, wall time 18 min at 10 jobs.

| Criterion | Measured | Band | |
|---|---|---|---|
| M9.1 notable entries per sim-month, median of seeds' median months | 3.5 | [2, 15] | PASS |
| M9.2 largest event type share (extinction) | 18.9 % | ≤ 30 % | PASS |

- 19 of 20 seeds within the band (p10 2, p90 4; mean months 4.0). The low seed is the one
  whose founders landed latest (day 443): the year before life holds about 2 notable
  entries a month (land, plants, fires), inhabited years 4–5.
- Types: extinction 18.9 %, speciation 17.9 %, crash 11.7 %, boom 11.6 %, firsts 10.6 %,
  season 7.2 %, arrival 6.2 %, record 1.9 %, migration 1.3 %; worst seed's largest type
  22.1 %. About 169 entries per seed in 3 years; importance 3 dominates (122 per seed),
  major 23.5, historic 1.
- Major entries, what S4 would push: 0.68 per sim-month (median seed).
- **Fires are nearly silent**: in office light only 5 of 150 fires reached 300 cells (M3's
  calibration was always-lit); the first big fires became records. Left for M11.
- Dark ages and god powers do not appear in the run: the office schedule has no long
  absence and fast-forward presses no button. Both are covered by scenario tests and the
  v9 fixture (a week away, then the ark).
- In a 1.3-year preview the one-off firsts held 34 % of entries; over 3 years they fall
  to 10.6 %, as the history fills. A world younger than about a year will show mostly
  firsts.

## Consequences

- R3 gets captions from `ChronicleEntry` (kind, importance, text, species, cell); S4
  pushes importance ≥ `major_importance`; S5 and S3 read `Chronicle.entries()` and
  `bestiary()`. The wire schema is untouched: carrying entries to the renderer is R3's.
- The save grows with the history (about 170 entries per 3 years, text included).
- Golden hashes changed: the schema version and the chronicle's state are hashed.
- M11: fire thresholds against office light; whether booms and crashes (23 % together)
  should need larger swings; the low-seed year before life.

## References

None outside the project: the importance scale, the language and where the history lives
are the owner's choices (above); thresholds come from M2, M3 and M6 reports
(`reports/M3-flora` fire sizes, `reports/M6-species` lifespans and rates).
