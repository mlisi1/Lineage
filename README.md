# Lineage

An idle desk gadget: a small procedurally generated island where creatures and plants
evolve over years of real time. See [CLAUDE.md](CLAUDE.md) for the architecture and
milestones, and [docs/design/](docs/design/) for the spec.

## Quick start

Requires [uv](https://docs.astral.sh/uv/) and Node 22.

```sh
uv sync                                   # Python 3.11 workspace: sim, server, device, tools
uv run pytest -m "not slow"               # fast suite
uv run ruff check . && uv run pyright     # lint and types

uv run python -m tools.fastforward --years 3 --seeds 20 --out runs/demo
uv run python -m tools.report M0 --runs runs/demo

cd renderer && npm ci && npm test && npx playwright test
npm run dev                               # then / (the scene: V or a click steps the views) or /land.html
```

Run the island in real time (S1), as the device does, with the desk's page:

```sh
cd renderer && npm run build:kiosk && cd ..
uv run python -m lineage_server.main --data runs/island --dist renderer/dist-kiosk --fake-device
# then http://localhost:8080/ ; keys typed in the terminal play the device:
# p presence, g god power, v view, l/r power lost/restored; Ctrl+C saves and stops
```

If your shell exports `PYTHONPATH` (for example a sourced ROS environment), prefix the
Python commands with `env -u PYTHONPATH`.
