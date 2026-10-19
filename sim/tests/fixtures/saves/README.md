# Frozen save fixtures

One save per released schema version (`vN.lzma`). **Never edit or delete these**
(CLAUDE.md §4.4): migration tests load them to prove old saves still upgrade.

| File | Schema | Contents |
|---|---|---|
| `v0.lzma` | 0 | Toy pre-release layout: seed 42, epoch 2026-03-01 00:00 UTC, `sim_time_s` 90061.5 |
| `v1.lzma` | 1 | Default M1 world (no subsystems): seed 42, epoch 2026-03-01 00:00 UTC, stepped 10 days + 1234.567 s |
| `v2.lzma` | 2 | Default M2 world (terrain, 256×150): seed 42, epoch 2026-03-01 00:00 UTC, stepped 30 days |
| `v3.lzma` | 3 | Default M3 world (terrain, flora, fire): seed 42, epoch 2026-03-01 00:00 UTC, stepped 200 days |
| `v4.lzma` | 4 | Default M4 world (terrain, flora, fire, fauna): seed 42, epoch 2026-03-01 00:00 UTC, stepped 520 days |
| `v5.lzma` | 5 | Default M5 world (creatures learn during life): seed 42, epoch 2026-03-01 00:00 UTC, stepped 520 days |
| `v6.lzma` | 6 | Default M5 world, revised (plant-form and carrion senses, meal value, `SOCIAL` gene, 246 weights, carrion and scent): seed 42, epoch 2026-03-01 00:00 UTC, stepped 520 days. Amended while v6 was unreleased (branch `m5-lifetime-learning`); frozen from its merge |
| `v7.lzma` | 7 | Default M6 world (species: labels, phylogeny, names): seed 42, epoch 2026-03-01 00:00 UTC, stepped 520 days |
| `v8.lzma` | 8 | Default M8 world (presence and god powers): seed 42, epoch 2026-03-01 00:00 UTC, stepped 513 days present, then 7 days of office hours (absent from day 513, 9:00–18:00 on weekdays), the rain god power used at 12:00 on day 519; saved at day 520, the owner away |

When bumping the schema to vN+1, add `vN+1.lzma` saved by the new code, alongside the
`vN_to_vN+1.py` migration and its test.
