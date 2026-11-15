#!/usr/bin/env python3
"""Build the fixed seal artwork: vermilion bird-worm inscription inside a
hand-rubbed, weathered square border.  Output is RGBA (transparent paper) so the
stamp sits directly on the wallpaper instead of reading as a pasted card.

Design notes, learned by comparing against the reference the user supplied:
  * The frame is a SOLID block of saturated cinnabar.  Weathering lives at the
    contours and in the pigment grain — never as holes punched through the
    block, which reads as a watercolour wash instead of a stamp.
  * The inscription nearly touches the frame.  A wide white gutter around it
    makes the stamp look like a framed picture rather than a seal.
  * The outer contour bleeds: a thin, low-alpha ring just outside the crisp edge,
    the way paste squeezes out under a real stone. It must not reach inwards, or
    the paper inside the opening turns pink.
  * A stamp is never axis-aligned: a hair of rotation and a slight keystone keep
    it from reading as a vector rectangle.

Usage: python3 src/make_seal.py [square|round]   (writes fonts/seal*.webp)
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

N = 1024                      # working resolution
OUT = 512                     # final texture size
INK = np.array([200, 38, 26], np.float32)     # saturated cinnabar
PAPER = np.array([250, 246, 239], np.float32)

SHAPE = (sys.argv[1] if len(sys.argv) > 1 else 'square').lower()
assert SHAPE in ('square', 'round'), SHAPE
HERE = Path(__file__).resolve().parent
OUT_DIR = HERE.parent / 'fonts'
RNG = np.random.default_rng(20240515)


def value_noise(n, cells, seed):
    """Smooth value noise in [0,1] on an n*n grid from a cells*cells lattice."""
    r = np.random.default_rng(seed)
    g = r.random((cells + 1, cells + 1)).astype(np.float32)
    img = Image.fromarray((g * 255).astype(np.uint8))
    img = img.resize((n, n), Image.BICUBIC)
    return np.asarray(img, np.float32) / 255.0


def fbm(n, base_cells, octaves, seed, gain=0.5):
    total = np.zeros((n, n), np.float32)
    amp, cells, norm = 1.0, base_cells, 0.0
    for i in range(octaves):
        total += amp * value_noise(n, max(2, int(cells)), seed + i * 977)
        norm += amp
        amp *= gain
        cells *= 2
    return total / norm


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


# ---------------------------------------------------------------- coordinates
yy, xx = np.mgrid[0:N, 0:N].astype(np.float32)
c = (N - 1) / 2.0
u0 = (xx - c) / (N / 2.0)      # -1 .. 1
v0 = (yy - c) / (N / 2.0)

# A hand-pressed seal is never axis-aligned and never perfectly square.  A hair of
# rotation plus a slight keystone is what makes it read as a real stamp instead of
# a vector rectangle; the chips and the dry-brush are generated in these warped
# coordinates, so the wear follows the block.
ROT = np.deg2rad(-0.9 if SHAPE == 'square' else 0.0)
u = u0 * np.cos(ROT) + v0 * np.sin(ROT)
v = -u0 * np.sin(ROT) + v0 * np.cos(ROT)
if SHAPE == 'square':
    # keystone: the bottom edge is a touch wider than the top, as when a block is
    # rocked slightly during the press
    v = v * (1.0 - 0.022 * v) * (1.0 + 0.018 * u * 0.0)
    u = u * (1.0 + 0.020 * v)
theta = np.arctan2(v, u)

# A 方印 is a square (Chebyshev radius); a 圆印 is a disc (Euclidean).  Corners of
# the square are rounded only by the chips below, never by the geometry.
rad = (np.maximum(np.abs(u), np.abs(v)) if SHAPE == 'square'
       else np.sqrt(u * u + v * v))

# --------------------------------------------------------------- border shape
# Each contour wobbles on its own, so the frame is never parallel-sided.  The
# amplitude is small: this is a worn stone edge, not a wavy brush line.
wob_out = (0.0105 * np.sin(3 * theta + 0.7) + 0.0062 * np.sin(7 * theta + 2.1)
           + 0.0036 * np.sin(13 * theta + 4.4) + 0.0020 * np.sin(23 * theta + 1.9))
wob_in = (0.0125 * np.sin(4 * theta + 2.9) + 0.0078 * np.sin(9 * theta + 1.3)
          + 0.0046 * np.sin(15 * theta + 5.2) + 0.0026 * np.sin(27 * theta + 3.3))

# Thickness: a hand-rubbed frame pools ink at the corners and thins mid-side.
corner_pool = np.clip(np.abs(np.cos(2 * theta)) ** 0.6, 0, 1)
thick = (0.124 + 0.020 * corner_pool if SHAPE == 'square' else 0.108)
thick = thick + 0.008 * np.sin(5 * theta + 0.4)

r_out = 0.944 + wob_out
r_in = r_out - thick + wob_in

# micro-edge: paper tooth nibbles both contours
r_out_edge = r_out + 0.0085 * (fbm(N, 44, 5, 11) - 0.5)
r_in_edge = r_in - 0.0190 * (fbm(N, 52, 5, 29) - 0.5)

core = smoothstep(0.0, 1.0, (r_out_edge - rad) * 300.0) * \
       smoothstep(0.0, 1.0, (rad - r_in_edge) * 300.0)

span = np.maximum(r_out - r_in, 1e-4)
pos = np.clip((rad - r_in) / span, 0.0, 1.0)

# The frame is opaque nearly everywhere; only the outer 12% and inner 8% of the
# band thin out, which is where a rubbing loses ink first.
edge_fade = (0.55 + 0.45 * smoothstep(0.0, 0.12, pos)
             * smoothstep(1.0, 0.88, pos))
band = core * edge_fade

# ------------------------------------------------------------------- chipping
# 崩裂 — many small bites along the contours, none in the middle of the block.
chip_med = fbm(N, 60, 4, 41)
chip_fine = fbm(N, 150, 3, 73)
bite = (smoothstep(0.68, 0.88, chip_med) * 0.30 +
        smoothstep(0.72, 0.92, chip_fine) * 0.22)
bite *= smoothstep(0.42, 1.0, pos) ** 0.7
band *= 1.0 - np.clip(bite, 0, 1) * 0.85

# decisive flakes bitten out of the contours
flakes = np.zeros((N, N), np.float32)
for _ in range(64):
    edge_in = RNG.random() < 0.42           # some bite the inner contour
    ang = RNG.uniform(0, 2 * np.pi)
    # Sample the contour radius at this angle so the bite is centred ON the edge.
    th = ang
    r_o = 0.978 + (0.0105 * np.sin(3 * th + 0.7) + 0.0062 * np.sin(7 * th + 2.1)
                   + 0.0036 * np.sin(13 * th + 4.4) + 0.0020 * np.sin(23 * th + 1.9))
    r_i = r_o - (0.124 + 0.020 * np.clip(abs(np.cos(2 * th)) ** 0.6, 0, 1)
                 + 0.008 * np.sin(5 * th + 0.4))
    rr = r_i + RNG.uniform(-0.006, 0.006) if edge_in else r_o + RNG.uniform(-0.006, 0.006)
    fx, fy = c + rr * N / 2 * np.cos(ang), c + rr * N / 2 * np.sin(ang)
    size = RNG.uniform(0.003, 0.010)
    rx, ry = size * N * RNG.uniform(0.7, 1.5), size * N * RNG.uniform(0.7, 1.5)
    rot = RNG.uniform(0, np.pi)
    dx, dy = xx - fx, yy - fy
    a = dx * np.cos(rot) + dy * np.sin(rot)
    b = -dx * np.sin(rot) + dy * np.cos(rot)
    d = (a / rx) ** 2 + (b / ry) ** 2
    flakes = np.maximum(flakes, smoothstep(1.25, 0.25, d) * RNG.uniform(0.5, 1.0))
band *= 1.0 - flakes * 0.85

# -------------------------------------------------------------- 飞白 / dryness
# Dry-brush skips thin the ink, and only near the contours.
streak_broad = fbm(N, 11, 3, 101)
streak_fine = fbm(N, 110, 3, 131)
dry = smoothstep(0.66, 0.90, streak_fine) * (0.30 + 0.70 * streak_broad)
dry *= 0.35 + 0.65 * (1.0 - smoothstep(0.10, 0.55, pos) * smoothstep(0.90, 0.55, pos))
band *= 1.0 - dry * 0.32

# ----------------------------------------------------- cinnabar 拓印 texture
# Fine pigment grain — this is what makes the block read as ink on stone — plus
# tiny paper specks where the stone surface did not take the paste.
grain = fbm(N, 380, 2, 151)
band *= 0.90 + 0.10 * grain

speck = smoothstep(0.88, 0.97, fbm(N, 900, 1, 173))
band *= 1.0 - speck * 0.38

# Soft bleed outside the crisp contour: paste squeezing out under the stone.
# It is a thin ring OUTSIDE the frame only — letting it reach the interior would
# wash the paper pink.
outer_ring = smoothstep(0.0, 1.0, (rad - r_out_edge) * 300.0) * \
             smoothstep(0.0, 1.0, (r_out_edge + 0.011 - rad) * 300.0)
band = np.maximum(band, outer_ring * 0.16 * (0.30 + 0.70 * fbm(N, 120, 3, 181)))

# --------------------------------------------------------------- inscription
field = Image.open(Path(__file__).with_name('seal-field.png')).convert('L')
fa = np.asarray(field, np.float32) / 255.0
glyph = np.clip((0.72 - fa) / 0.42, 0.0, 1.0)          # 0 paper .. 1 ink
glyph = np.asarray(Image.fromarray((glyph * 255).astype(np.uint8))
                   .filter(ImageFilter.GaussianBlur(0.7)), np.float32) / 255.0
glyph = smoothstep(0.10, 0.60, glyph)

# The inscription nearly fills the opening: only a hair of paper between the
# outer columns and the frame, as on the reference.
#
# `field_final.png` is NOT centred — its ink sits with a 48 px margin on the left
# and 6 px on the other three sides.  Scaling the raw square would leave a wide
# white gutter down the left edge, so crop to the ink first.
ink = glyph > 0.35
ys_i, xs_i = np.where(ink)
y0i, y1i = ys_i.min(), ys_i.max() + 1
x0i, x1i = xs_i.min(), xs_i.max() + 1
cropped = glyph[y0i:y1i, x0i:x1i]
ch, cw = cropped.shape
# square it off by padding, never by stretching, so the script is not distorted
side_src = max(ch, cw)
sq = np.zeros((side_src, side_src), np.float32)
oy, ox = (side_src - ch) // 2, (side_src - cw) // 2
sq[oy:oy + ch, ox:ox + cw] = cropped

# Place the inscription inside the OPENING the frame actually left, rather than at
# a fixed inset: the two contours wobble independently, so a formula-based inset
# ends up with a wide white gutter on one side and a collision on the other.
# The opening is the largest transparent region around the centre.
opening = (band < 0.45)
# limit to the middle so the transparent margin outside the frame is ignored
inner_mask = np.zeros_like(opening)
lim = int(N * 0.10)
inner_mask[lim:N - lim, lim:N - lim] = True
opening &= inner_mask
if not opening.any():
    raise SystemExit('no opening found inside the frame')

# the opening's extent along each axis, measured at the centre band so a chip in
# one corner cannot drag the box outwards
row_ok = opening[N // 2 - N // 12:N // 2 + N // 12].all(axis=0)
col_ok = opening[:, N // 2 - N // 12:N // 2 + N // 12].all(axis=1)
xs_o = np.where(row_ok)[0]
ys_o = np.where(col_ok)[0]
if len(xs_o) == 0 or len(ys_o) == 0:
    xs_o = np.where(opening.any(axis=0))[0]
    ys_o = np.where(opening.any(axis=1))[0]
cx_o = (xs_o.min() + xs_o.max() + 1) / 2.0
cy_o = (ys_o.min() + ys_o.max() + 1) / 2.0
half_w = min(cx_o - xs_o.min(), xs_o.max() + 1 - cx_o)
half_h = min(cy_o - ys_o.min(), ys_o.max() + 1 - cy_o)

inner_side = int(2 * min(half_w, half_h) - N * 0.008)
if SHAPE == 'round':
    # A real round seal fills its disc: the characters crowd right up to the ring,
    # and the corner ones simply run into it. Sizing to the strictly inscribed
    # square (0.707) leaves a wide empty moat that no seal cutter would leave.
    inner_side = int(inner_side * 0.860)

fi = Image.fromarray((sq * 255).astype(np.uint8)).resize(
    (inner_side, inner_side), Image.LANCZOS)
glyph_full = np.zeros((N, N), np.float32)
x0 = int(round(cx_o - inner_side / 2.0))
y0 = int(round(cy_o - inner_side / 2.0))
x0 = max(0, min(N - inner_side, x0))
y0 = max(0, min(N - inner_side, y0))
glyph_full[y0:y0 + inner_side, x0:x0 + inner_side] = \
    np.asarray(fi, np.float32)[:inner_side, :inner_side] / 255.0

# the inscription takes ink a touch less evenly than the frame, with its own
# fine dry-brush skips
glyph_full *= 0.93 + 0.07 * fbm(N, 220, 2, 211)
glyph_full *= 1.0 - smoothstep(0.84, 0.96, fbm(N, 420, 1, 233)) * 0.28

alpha = np.clip(np.maximum(band, glyph_full), 0.0, 1.0)

# ------------------------------------------------------------ tone + composite
# Cinnabar is never flat, but the variation has to be fine-grained: broad tonal
# drift is what made an earlier pass look like a watercolour wash.
tone = fbm(N, 150, 3, 307)
value = 0.94 + 0.11 * tone
col = INK[None, None, :] * value[..., None]
# unfilled stone pits show a little paper through the ink
pits = smoothstep(0.93, 0.99, fbm(N, 420, 2, 401)) * 0.28
col = col * (1 - pits[..., None]) + PAPER * pits[..., None]

# Resize in PREMULTIPLIED alpha.  Straight-alpha Lanczos rings negative around
# hard edges and leaves colour fringes on near-transparent pixels (which showed
# up as red speckles on the paper).
col32 = np.clip(col, 0, 255).astype(np.float32)
pre = np.dstack([col32 * alpha[..., None], alpha * 255.0])
pre_img = Image.fromarray(np.clip(pre, 0, 255).astype(np.uint8))
pre_small = np.asarray(pre_img.resize((OUT, OUT), Image.LANCZOS), np.float32)
a_small = pre_small[..., 3:4] / 255.0
with np.errstate(invalid='ignore', divide='ignore'):
    rgb_small = np.where(a_small > 1e-4, pre_small[..., :3] / np.maximum(a_small, 1e-4), 0.0)
rgba = np.dstack([np.clip(rgb_small, 0, 255), pre_small[..., 3]]).astype(np.uint8)
out = Image.fromarray(rgba)

# Downsampling averages the fine grain away, so re-apply it at the output size.
a_out = np.asarray(out, np.float32)
g_out = fbm(OUT, 200, 2, 601)
a_out[..., 3] *= 0.86 + 0.14 * g_out
c_out = a_out[..., :3] * (0.93 + 0.14 * fbm(OUT, 160, 2, 617))[..., None]
a_out[..., :3] = np.clip(c_out, 0, 255)
out = Image.fromarray(np.clip(a_out, 0, 255).astype(np.uint8))
NAME = 'seal.webp' if SHAPE == 'square' else 'seal-round.webp'
# The stamp is displayed at most around 200 px, so 448 px of artwork is already
# two device pixels per CSS pixel; anything larger is bytes nobody sees.
tex = out.resize((448, 448), Image.LANCZOS)
tex.save(OUT_DIR / NAME, quality=88, method=6)
print('saved', out.size, 'coverage', float((alpha > 0.5).mean()))
