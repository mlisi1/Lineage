"""Pixel-art rendering of the world for reports: flat palettes, stepped shading.

Every class has a short ramp of flat colours; relief picks a step of the ramp instead of
blending, the sea is drawn in depth bands, and the shoreline gets a one-pixel outline.
Images are upscaled by whole factors with no smoothing.
"""

from __future__ import annotations

import base64
import io
from collections.abc import Sequence

import numpy as np
from lineage_sim.flora import Cover
from matplotlib.colors import to_rgb
from PIL import Image, ImageDraw, ImageFont

# Sea: (deepest depth of the band, colour), shallow to deep.
SEA_BANDS: tuple[tuple[float, str], ...] = (
    (0.02, "#8ecbe6"),
    (0.06, "#5aa7d6"),
    (0.14, "#3b7fbf"),
    (0.26, "#2c5f9e"),
    (9.99, "#1f437a"),
)
SHORE_OUTLINE = "#3d3528"

# Land: three flat tones per class — in shade, flat light, lit slope.
LAND_RAMPS: dict[Cover, tuple[str, str, str]] = {
    Cover.BARE: ("#8f7f68", "#b3a188", "#cdbd9f"),
    Cover.LICHEN: ("#8b9a7a", "#a9b792", "#c3cfa8"),
    Cover.GRASS: ("#6f9a3f", "#8fbf4f", "#aad468"),
    Cover.SHRUB: ("#4f7d3a", "#6a9a45", "#84b356"),
    Cover.BROADLEAF: ("#2f6230", "#3f7d3a", "#55964a"),
    Cover.CONIFER: ("#1f4a3a", "#2b6149", "#3a7a5a"),
    Cover.BURNT: ("#3a302b", "#4f423a", "#66564b"),
}
# Low plants that have died back to their roots (winter, or just after a fire) look dry.
DORMANT = ("#8f8448", "#b3a65c", "#cdc177")
DORMANT_BELOW = 0.3  # biomass
DORMANT_CLASSES = (Cover.LICHEN, Cover.GRASS, Cover.SHRUB)
# Bare rock above the tree line gets lighter with altitude, ending in snow.
HIGH_ROCK = ("#77716c", "#98928c", "#b5b0aa")
SNOW = ("#c9d3dc", "#e6edf2", "#ffffff")
HIGH_ROCK_FROM = 0.30  # height above the sea
SNOW_FROM = 0.46

# One flat colour per class for chart legends and stacked areas.
COVER_COLOURS: dict[Cover, str] = {
    Cover.WATER: SEA_BANDS[2][1],
    **{cover: ramp[1] for cover, ramp in LAND_RAMPS.items()},
}
COVER_LABELS: dict[Cover, str] = {
    Cover.WATER: "water",
    Cover.BARE: "bare",
    Cover.LICHEN: "lichen",
    Cover.GRASS: "grass",
    Cover.SHRUB: "shrub",
    Cover.BROADLEAF: "broadleaf forest",
    Cover.CONIFER: "conifer forest",
    Cover.BURNT: "burnt",
}


def _rgb8(colour: str) -> np.ndarray:
    return np.round(np.array(to_rgb(colour)) * 255).astype(np.uint8)


def relief_step(height: np.ndarray) -> np.ndarray:
    """0 (in shade), 1 (flat) or 2 (lit) per cell, light from the north-west."""
    h = height.astype(np.float64)
    slope = np.zeros_like(h)
    # Height gained walking one cell toward the light: positive faces the light.
    slope[1:, 1:] = h[1:, 1:] - h[:-1, :-1]
    step = np.ones(h.shape, dtype=np.intp)
    step[slope > 0.012] = 2
    step[slope < -0.012] = 0
    return step


def render(
    height: np.ndarray,
    sea_level: float,
    cover: np.ndarray | None = None,
    biomass: np.ndarray | None = None,
    *,
    scale: int = 1,
) -> np.ndarray:
    """RGB uint8 image (H·scale, W·scale, 3). Without ``cover`` all land is bare; with
    ``biomass`` (0–1) low plants that have died back are drawn dry."""
    height = height.astype(np.float64)
    land = height > sea_level
    if cover is None:
        cover = np.where(land, Cover.BARE, Cover.WATER).astype(np.uint8)
    image = np.zeros((*height.shape, 3), dtype=np.uint8)

    depth = sea_level - height
    lower = -np.inf
    for limit, colour in SEA_BANDS:
        image[~land & (depth > lower) & (depth <= limit)] = _rgb8(colour)
        lower = limit

    step = relief_step(height)
    above = height - sea_level
    for kind, ramp in LAND_RAMPS.items():
        tones = np.stack([_rgb8(c) for c in ramp])
        cells = cover == kind
        image[cells] = tones[step[cells]]
    if biomass is not None:
        tones = np.stack([_rgb8(c) for c in DORMANT])
        cells = np.isin(cover, DORMANT_CLASSES) & (biomass < DORMANT_BELOW)
        image[cells] = tones[step[cells]]
    # Unvegetated high ground: rock, then snow.
    for start, ramp in ((HIGH_ROCK_FROM, HIGH_ROCK), (SNOW_FROM, SNOW)):
        tones = np.stack([_rgb8(c) for c in ramp])
        cells = (cover == Cover.BARE) & (above >= start)
        image[cells] = tones[step[cells]]

    # One-pixel outline: land cells that touch the sea.
    sea = cover == Cover.WATER
    touches = np.zeros_like(sea)
    touches[1:, :] |= sea[:-1, :]
    touches[:-1, :] |= sea[1:, :]
    touches[:, 1:] |= sea[:, :-1]
    touches[:, :-1] |= sea[:, 1:]
    image[(cover == Cover.BARE) & touches] = _rgb8(SHORE_OUTLINE)

    if scale > 1:
        image = np.repeat(np.repeat(image, scale, axis=0), scale, axis=1)
    return image


# --- Composition ------------------------------------------------------------------------

_FRAME = _rgb8("#14213d")
_INK = (230, 237, 242)
_LABEL_SCALE = 2  # the bitmap font is drawn small and doubled, pixel for pixel


def _label(text: str) -> np.ndarray:
    """``text`` in a chunky bitmap font, as an RGB image on the frame colour."""
    font = ImageFont.load_default()
    left, _top, right, bottom = (int(v) for v in font.getbbox(text))
    image = Image.new("RGB", (right - left + 2, bottom + 2), tuple(int(c) for c in _FRAME))
    ImageDraw.Draw(image).text((1 - left, 1), text, fill=_INK, font=font)
    pixels = np.asarray(image)
    return np.repeat(np.repeat(pixels, _LABEL_SCALE, axis=0), _LABEL_SCALE, axis=1)


def tile_grid(
    tiles: Sequence[Sequence[np.ndarray]],
    row_labels: Sequence[str],
    column_labels: Sequence[str],
    *,
    gap: int = 6,
) -> np.ndarray:
    """Lay equally sized RGB tiles out in a labelled grid, pixel for pixel."""
    tile_h, tile_w = tiles[0][0].shape[:2]
    heads = [_label(text) for text in column_labels]
    sides = [_label(text) for text in row_labels]
    head_h = max(h.shape[0] for h in heads) + gap
    canvas = np.empty(
        (
            head_h + len(tiles) * (tile_h + sides[0].shape[0] + 2 * gap),
            gap + len(tiles[0]) * (tile_w + gap),
            3,
        ),
        dtype=np.uint8,
    )
    canvas[:] = _FRAME
    for c, head in enumerate(heads):
        x = gap + c * (tile_w + gap)
        canvas[gap // 2 : gap // 2 + head.shape[0], x : x + head.shape[1]] = head
    y = head_h
    for r, row in enumerate(tiles):
        side = sides[r]
        canvas[y : y + side.shape[0], gap : gap + side.shape[1]] = side
        y += side.shape[0] + gap
        for c, tile in enumerate(row):
            x = gap + c * (tile_w + gap)
            canvas[y : y + tile_h, x : x + tile_w] = tile
        y += tile_h + gap
    return canvas


def png_data_uri(image: np.ndarray) -> str:
    buffer = io.BytesIO()
    Image.fromarray(image, mode="RGB").save(buffer, format="PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")


def animation_data_uri(frames: Sequence[np.ndarray], frame_ms: int) -> str:
    """Looping, lossless animated WebP: hard pixel edges survive."""
    images = [Image.fromarray(frame, mode="RGB") for frame in frames]
    buffer = io.BytesIO()
    images[0].save(
        buffer,
        format="WEBP",
        save_all=True,
        append_images=images[1:],
        duration=frame_ms,
        loop=0,
        lossless=True,
        method=4,
    )
    return "data:image/webp;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")


# --- Creatures --------------------------------------------------------------------------

# One flat colour per diet class, bright against every land cover.
DIET_COLOURS: dict[str, str] = {
    "herbivore": "#ffffff",
    "omnivore": "#ffd23f",
    "predator": "#e23b3b",
}
_CREATURE_OUTLINE = "#1b1b1b"


def draw_creatures(
    image: np.ndarray,
    creatures: np.ndarray,
    herbivore_max_diet: float,
    predator_min_diet: float,
    *,
    scale: int = 1,
) -> np.ndarray:
    """Draw creatures on a rendered map (in place) and return it.

    ``creatures`` has rows of (x, y, diet gene, size gene); NaN rows are ignored. Each is
    one cell in its diet colour; at ``scale`` ≥ 3 it gets a dark one-pixel outline so it
    reads on any ground.
    """
    rows = creatures[np.isfinite(creatures[:, 0])]
    height, width = image.shape[0] // scale, image.shape[1] // scale
    xs = np.clip(np.rint(rows[:, 0]), 0, width - 1).astype(np.intp)
    ys = np.clip(np.rint(rows[:, 1]), 0, height - 1).astype(np.intp)
    diet = rows[:, 2]
    kinds = np.where(diet >= predator_min_diet, 2, np.where(diet <= herbivore_max_diet, 0, 1))
    colours = np.stack([_rgb8(c) for c in DIET_COLOURS.values()])
    outline = _rgb8(_CREATURE_OUTLINE)
    # Predators last, so they stay visible in a crowd.
    for index in np.argsort(kinds, kind="stable"):
        y0, x0 = int(ys[index]) * scale, int(xs[index]) * scale
        if scale >= 3:
            image[y0 : y0 + scale, x0 : x0 + scale] = outline
            image[y0 + 1 : y0 + scale - 1, x0 + 1 : x0 + scale - 1] = colours[kinds[index]]
        else:
            image[y0 : y0 + scale, x0 : x0 + scale] = colours[kinds[index]]
    return image
