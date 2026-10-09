# 0001 — M0 toolchain choices

- **Status**: accepted
- **Date**: 2026-10-09

## Context

M0 sets up the repository. CLAUDE.md §5 fixes most tools (uv, ruff, pyright, pytest,
hypothesis, pytest-benchmark, NumPy, Vite, PixiJS, vitest, Playwright, eslint, prettier)
but leaves a few details open.

## Decision

- **uv workspace** with members `sim`, `server`, `device` (packages) and `tools`
  (virtual: `tools/` is imported from the repo root as `python -m tools.<name>`, its
  `pyproject.toml` only declares dependencies). The root is a virtual project that
  depends on all members so `uv sync` installs everything.
- **Python pinned to 3.11** (`.python-version`, `requires-python = ">=3.11,<3.12"`) to
  match the device OS.
- **pytest `--import-mode=importlib`** so each package can have test files with the same
  name; `pythonpath = ["."]` makes `tools` importable.
- **matplotlib** (tools only, never deployed) for report figures. It is the de facto
  standard, covers time series, histograms/violins, maps and animated GIFs (via Pillow,
  which it already depends on) and renders deterministic SVG so regenerated reports diff
  cleanly. Figures are inlined as base64 SVG to keep `report.html` self-contained.
- **pyright from PyPI** (it fetches its own Node runtime) so Python checks need no
  separate Node setup; strict mode applies to `sim/`, basic mode elsewhere.
- **Static guards as tests**: `sim/tests/test_purity.py` rejects wall-clock, filesystem,
  network, environment and global-random access in `lineage_sim`;
  `device/tests/test_isolation.py` rejects GPIO imports outside `lineage_device`.
- **Renderer**: Node 22 LTS, `@types/node` for the config files only.

## Consequences

- Reports need no browser or network to view.
- The purity guard is conservative: a legitimate need for e.g. `hash()` in the sim must
  change the guard explicitly, which forces a review.
- Shells that export `PYTHONPATH` (e.g. a sourced ROS environment) leak foreign
  packages and pytest plugins into the 3.11 venv; run with `env -u PYTHONPATH`.
