# Chronicle and bestiary

## Chronicle (M9)

The island writes its own history (`sim/lineage_sim/chronicle.py`, ADR 0017). A
chronicle subsystem, registered last, turns what happens into dated entries: English
text from templates (a few variants each, picked from the chronicle's own random
stream), a kind, an importance, the species it is about and the cell where it happened.

**Importance** is an integer from 1 to 5 (chosen by the owner, 2026-10-19):

| | Name | Examples |
|---|---|---|
| 1 | background | a season begins |
| 2 | minor | a short-lived, small species dies out |
| 3 | notable | speciation, arrival, notable extinction, big fire, earthquake, a strait closes, record, boom, crash, migration, anniversary, dark age and dawn |
| 4 | major | a first (hunters, swimmers, a forest, a rare gene, a fire), volcano, meteor, the sea splits the land, a god power, a huge fire |
| 5 | historic | the first creatures land; the last creature dies |

Notable entries (≥ 3) are what M9's criterion counts; major entries (≥ 4) are pushed to
the phone (S4). Every importance and threshold is in `[chronicle]`.

**How it sees.** The World hands every batch of outputs to observers right after it is
produced, at the same sim time (`Observer.observe`): species born and extinct, fires,
volcanoes, earthquakes, craters, the land splitting and rejoining, god powers, seasons.
Once a day, after the species census, it looks at the world for what no event says:

- **Firsts**: the first hunters and swimmers (a species' mean genome), the first closed
  forest, the first carrier of each creature and plant rare gene, the first fire.
- **Records**: most creatures, most species alive, the largest species, the oldest
  species, the largest fire. Kept from the start, announced from 180 days after the
  first landing, when beaten by 10 % (a species-held record only when another species
  takes it).
- **Booms and crashes**: a species (or all creatures) doubling or halving within 30 days.
- **Migrations**: a species settles a large landmass (three or more of it there) that
  it had not settled the day before. Creatures cross one by one, so this is a group
  grown over days.
- **Anniversaries**: the world's birthday; each year a species has lived.
- **Dark ages**: the owner away for 120 h (a weekend is about 63); the dawn when they
  return.

**Filters.** An entry of the same kind about the same subject within a gap is dropped
(7 days; records 30, booms and crashes 30, migrations 60). At most 3 entries below major
per sim-day; major entries always pass.

**Storage.** The chronicle lives in the world save (schema v9), so the save is the whole
history and M10 archives a world with its state. A save from before the chronicle gets an
empty, unprimed one, which first takes stock in silence: what already happened is not
announced as news.

Measured (`reports/M9-chronicle/`, 20 seeds × 3 years, office schedule): 3.5 notable
entries per sim-month (median seed; about 2 before life, 4–5 after), 0.7 major ones, the
largest type extinction at 18.9 %. Big fires are rare in office light. ADR 0017.

## Bestiary (M9)

`Chronicle.bestiary()` gives a record per species that ever lived: the species record
(`Species.records`: dates, peak, the founding genome that is its portrait), its ancestry
(names back to its arrival) and daughters, its diet and habitat from the founding genome,
the rare genes any member ever carried, when it was most numerous, and the chronicle's
entries about it. Bestiaries are archived with their world (M10). The M9 report shows
one seed's bestiary and its founding genomes.

The chronicle is per world: its firsts, records and anniversaries count from the world's
creation, so a new world (M10) starts with a fresh chronicle and the old one goes to the
archive with its world.

## Outputs

Entries are `ChronicleEntry` output events (numbered from 1) and `Chronicle.entries()`.
Captions on the desk screen (R3), push notifications for major events (S4), the phone app
(S3) and the daily journal (S5).
