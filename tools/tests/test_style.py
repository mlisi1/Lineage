"""Shared plotting style invariants."""

import re

import pytest

from tools.viz import style

HEX = re.compile(r"^#[0-9a-f]{6}$")


def test_all_colours_are_hex() -> None:
    colours = [
        *style.CATEGORICAL,
        *style.SEQUENTIAL,
        *style.DIVERGING,
        *style.LAND_COVER.values(),
        *style.EVENT_TYPE.values(),
    ]
    assert all(HEX.match(c) for c in colours)


def test_entity_colours_are_distinct() -> None:
    assert len(set(style.CATEGORICAL)) == len(style.CATEGORICAL)
    assert len(set(style.LAND_COVER.values())) == len(style.LAND_COVER)
    assert len(set(style.EVENT_TYPE.values())) == len(style.EVENT_TYPE)


def test_categorical_folds_into_other_instead_of_cycling() -> None:
    n = len(style.CATEGORICAL)
    assert style.categorical(0) == style.CATEGORICAL[0]
    assert style.categorical(n - 1) == style.CATEGORICAL[-1]
    assert style.categorical(n) == style.OTHER
    assert style.species_colour(n + 5) == style.OTHER
    with pytest.raises(ValueError, match="non-negative"):
        style.categorical(-1)
