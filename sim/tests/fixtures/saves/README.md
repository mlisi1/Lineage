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

When bumping the schema to vN+1, add `vN+1.lzma` saved by the new code, alongside the
`vN_to_vN+1.py` migration and its test.
