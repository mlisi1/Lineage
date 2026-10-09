"""Static guard for CLAUDE.md §4.1–4.2: `lineage_sim` is pure and deterministic.

Scans every module's AST for imports and calls that would read the wall clock, the
filesystem, the network, the environment, or global random state.
"""

import ast
from pathlib import Path

import pytest

PACKAGE_DIR = Path(__file__).resolve().parents[1] / "lineage_sim"

FORBIDDEN_MODULES = frozenset(
    {
        "asyncio",
        "glob",
        "http",
        "os",
        "pathlib",
        "random",
        "requests",
        "secrets",
        "shutil",
        "socket",
        "subprocess",
        "sys",
        "tempfile",
        "threading",
        "time",
        "urllib",
        "uuid",
    }
)
FORBIDDEN_CALLS = frozenset({"open", "input", "print", "breakpoint", "hash", "id"})
# Wall-clock readers on datetime/date objects.
FORBIDDEN_ATTRIBUTES = frozenset({"now", "today", "utcnow", "fromtimestamp", "utcfromtimestamp"})
# Only explicitly seeded generator construction is allowed under numpy.random.
ALLOWED_NUMPY_RANDOM = frozenset(
    {"Generator", "SeedSequence", "BitGenerator", "PCG64", "PCG64DXSM", "Philox", "SFC64"}
)


def _modules() -> list[Path]:
    return sorted(PACKAGE_DIR.rglob("*.py"))


def _violations(source: str) -> list[str]:
    found: list[str] = []
    for node in ast.walk(ast.parse(source)):
        names: list[str] = []
        if isinstance(node, ast.Import):
            names = [alias.name for alias in node.names]
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            names = [node.module]
            if node.module == "numpy.random":
                names += [
                    f"numpy.random.{a.name}"
                    for a in node.names
                    if a.name not in ALLOWED_NUMPY_RANDOM
                ]
        for name in names:
            root = name.split(".")[0]
            if root in FORBIDDEN_MODULES or name.startswith("numpy.random."):
                found.append(f"line {getattr(node, 'lineno', '?')}: import {name}")

        if isinstance(node, ast.Call):
            func = node.func
            if isinstance(func, ast.Name) and func.id in FORBIDDEN_CALLS:
                found.append(f"line {node.lineno}: call {func.id}()")
            if isinstance(func, ast.Attribute) and func.attr in FORBIDDEN_ATTRIBUTES:
                found.append(f"line {node.lineno}: call .{func.attr}()")

        if (
            isinstance(node, ast.Attribute)
            and isinstance(node.value, ast.Attribute)
            and node.value.attr == "random"
            and isinstance(node.value.value, ast.Name)
            and node.value.value.id in {"np", "numpy"}
            and node.attr not in ALLOWED_NUMPY_RANDOM
        ):
            found.append(f"line {node.lineno}: np.random.{node.attr}")
    return found


@pytest.mark.parametrize("path", _modules(), ids=lambda p: str(p.relative_to(PACKAGE_DIR)))
def test_module_is_pure(path: Path) -> None:
    assert _violations(path.read_text(encoding="utf-8")) == []


@pytest.mark.parametrize(
    "snippet",
    [
        "import time",
        "import os.path",
        "from random import random",
        "from pathlib import Path",
        "import numpy as np\nnp.random.seed(1)",
        "import numpy as np\nx = np.random.rand(3)",
        "from numpy.random import default_rng",
        "import datetime\ndatetime.datetime.now()",
        "from datetime import date\ndate.today()",
        "open('save.lzma')",
        "hash('seed')",
    ],
)
def test_guard_catches(snippet: str) -> None:
    assert _violations(snippet), snippet


@pytest.mark.parametrize(
    "snippet",
    [
        "import numpy as np\nrng = np.random.Generator(np.random.PCG64(1))",
        "from numpy.random import Generator, SeedSequence",
        "import datetime\nd = datetime.datetime(2026, 1, 1, tzinfo=datetime.UTC)",
        "import lzma\nimport tomllib",
    ],
)
def test_guard_allows(snippet: str) -> None:
    assert _violations(snippet) == []
