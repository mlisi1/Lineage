"""Guard for CLAUDE.md §4.6: only `lineage_device` may import GPIO libraries."""

import ast
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
NON_DEVICE_SOURCES = ("sim/lineage_sim", "server/lineage_server", "tools")
GPIO_MODULES = frozenset(
    {"gpiod", "gpiozero", "RPi", "OPi", "wiringpi", "periphery", "smbus", "smbus2", "spidev"}
)


def _python_files() -> list[Path]:
    return sorted(p for d in NON_DEVICE_SOURCES for p in (REPO / d).rglob("*.py"))


def _gpio_imports(source: str) -> list[str]:
    found: list[str] = []
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Import):
            names = [alias.name for alias in node.names]
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            names = [node.module]
        else:
            continue
        found += [n for n in names if n.split(".")[0] in GPIO_MODULES]
    return found


def test_device_package_imports() -> None:
    import lineage_device

    assert lineage_device.__version__


@pytest.mark.parametrize("path", _python_files(), ids=lambda p: str(p.relative_to(REPO)))
def test_no_gpio_outside_device(path: Path) -> None:
    assert _gpio_imports(path.read_text(encoding="utf-8")) == []


def test_guard_catches_gpio_import() -> None:
    assert _gpio_imports("import gpiod\nfrom RPi import GPIO") == ["gpiod", "RPi"]
