# Milestone reports

One directory per statistical milestone, `<MID>-<slug>/`, produced by
`uv run python -m tools.report <MID> --runs runs/<id>` (see CLAUDE.md §7). Each holds a
self-contained `report.html`, `metrics.json`, the exact `config.toml`, and a short
`README.md`. Reports are regenerated, never hand-edited.

Milestones measured on the device (R0) are built the same way from the file the device
benchmark wrote (`--runs <directory holding kiosk-bench.json>`). That file is kept in the
report directory in place of `config.toml`: it is the evidence, and a PC cannot
regenerate it. To rebuild such a report, point `--runs` at the report directory itself.

`R0-look-sheet/` is not a measurement but a picture book: how the renderer spike draws
terrain, plants and creatures, written by `cd renderer && npm run look`.
