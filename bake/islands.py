"""Islands of the play area and the distant coasts, as heightfields (numpy + scipy only).
  python bake/islands.py <web/data> <build/check>
World axes are three.js: x east, z south (north is -z), y up, metres; the sea surface is y = 0.
Outputs
  near.bin / near.json   16 km square, 8 m grid: the islands you sail among (uint16, row delta, deflate)
  far.bin / far.json     96 km square, 96 m grid: the mainland ranges and outer islands that make the haze layers
  map.json               ports, the strait and island names for the game
  build/check/*.png      top views for checking

Island shape (Seto Inland Sea): old, rounded granite hills, 60-300 m, several summits per island, steep wooded
coasts with small bays and pocket beaches, rocky islets offshore. Each island is a domed blob whose outline is
warped by noise (capes and coves), with ridged noise for the secondary summits, then eroded by droplets so the
slopes carry gullies and the bays fill with a little sediment.
"""
import json
import os
import sys
import zlib

import numpy as np


sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from terrainlib import erode_multi, fbm, pnoise, ridged_mf, smooth  # noqa: E402

NEAR, NN = 16000.0, 2001          # 8 m grid
FAR, FN = 96000.0, 1001           # 96 m grid

# The play area follows the real layout round Noshima (ref/NOSHIMA.md, OpenStreetMap centres converted to metres
# from Noshima: x east, z south). Shapes are generated, so the coasts are not the real ones.
#   Noshima (~200 m, 25 m high, the castle island) and Taizaki-jima (~90 x 45 m) sit in the channel between
#   Oshima to the south-west and Ujima / Hakata-jima to the north-east; the tide runs through at up to 10 knots.
# name, centre x, z, radius (m), height (m), elongation (x, z scale), seed
ISLANDS = [
    ('大島', -2150, 3350, 3900, 380, (1.15, 1.0), 1),       # its north-east shore (Miyakubo) is ~800 m from Noshima
    ('鵜島', 950, -700, 700, 84, (0.8, 1.2), 2),
    ('伯方島', 500, -3550, 3300, 300, (1.35, 0.85), 3),      # its south shore ~900 m north of Noshima
    ('大三島', -6400, -3900, 2600, 430, (1.0, 1.2), 4),
    ('岡村島', -6200, 2200, 900, 250, (1.0, 1.0), 5),
    ('見近島', 1900, 1400, 170, 30, (1.2, 0.9), 6),
    ('津島', 4600, 1900, 700, 140, (1.2, 1.0), 8),
    ('生口島', 5200, -5600, 1900, 420, (1.1, 1.0), 9),
    ('大下島', -2000, 7400, 800, 160, (1.0, 1.1), 10),
]
ISLETS = 14
PORTS = [
    {'name': '宮窪', 'island': '大島', 'face': 2.4},           # the Oshima side harbour, facing north-east toward Noshima
]
NOSHIMA = {'x': 0.0, 'z': 0.0}
TAIZAKI = {'x': -9.0, 'z': 191.0}


def castle_island(X, Z):
    """Noshima: a round hill about 200 m across and 25 m high, cut into terraces (the three baileys stepping down,
    hon-maru on top, ni-no-maru round it, san-no-maru to the east), steep scarps between them, low rocky shelves at
    the waterline (the rock-cut post holes are there) and a sand beach on the north side (the landing).
    Taizaki-jima to the south: a smaller hill with its top levelled"""
    out = np.full_like(X, -60.0)
    for (cx, cz, rx, rz, top, levels, seed) in ((0, 0, 108, 102, 25.0, (25.0, 18.5, 11.5), 91), (-9, 191, 48, 28, 22.0, (22.0, 14.0), 92)):
        dx, dz = X - cx, Z - cz
        warp = 1 + 0.12 * (pnoise(X / 45 + seed, Z / 45, seed) - 0.5) + 0.05 * (pnoise(X / 12, Z / 12 + seed, seed + 1) - 0.5)
        r = np.hypot(dx / rx, dz / rz) * warp
        # a dome that drops fast at the shore: cliffs of 6-10 m round most of it
        h = top * np.clip(1 - r ** 1.7, -0.5, 1) + np.where(r > 0.8, -top * 0.25 * (r - 0.8) / 0.2, 0)
        h = np.where(r < 1.0, h, -8 - 25 * (r - 1))
        # terraces: flatten into levels with short steep scarps between
        q = h.copy()
        for k, L in enumerate(levels):
            nxt = levels[k + 1] if k + 1 < len(levels) else 5.0
            band = (h > nxt + 1.5) & (h <= L + 3.0)
            q = np.where(band, np.minimum(L, nxt + 1.5 + (h - nxt - 1.5) * 4.0), q)
        if cx == 0:
            # san-no-maru: the eastern side is lower and wider
            east = np.clip((dx - 25) / 50, 0, 1) * (r < 0.85)
            q = np.where(east > 0, np.minimum(q, levels[2] + (1 - east) * (q - levels[2])), q)
            # the north beach: a gentle sandy slope instead of the cliff
            beach = np.clip((-dz - 55) / 40, 0, 1) * np.clip(1 - np.abs(dx) / 70, 0, 1)
            q = q * (1 - beach) + np.clip(1.8 - (r - 0.78) * 25, -4, 3) * beach
        # rock shelves at the waterline all round (the tide-cut platform)
        shelf = (r > 0.93) & (r < 1.12)
        q = np.where(shelf, np.maximum(q, -0.6 + 0.8 * (pnoise(X / 6, Z / 6, seed + 5) - 0.5)), q)
        out = np.maximum(out, q)
    return out


def locate_ports(H, c):
    """Walk out from the island centre in the harbour direction until the ground drops below the sea; the harbour
    basin is centred 70 m beyond that point"""
    cell = c[1] - c[0]
    for p in PORTS:
        name, cx, cz = next((n, x, z) for n, x, z, *_ in ISLANDS if n == p['island'])
        dx, dz = np.sin(p['face']), np.cos(p['face'])
        for s in np.arange(0, 9000, 4.0):
            x, z = cx + dx * s, cz + dz * s
            i, j = int(round((x - c[0]) / cell)), int(round((z - c[0]) / cell))
            if H[j, i] < 0:
                p['x'], p['z'] = float(x + dx * 70), float(z + dz * 70)
                break
# Miyakubo-seto: the channel between Oshima and Noshima / Ujima, running west-north-west to east-south-east
STRAIT = {'name': '宮窪瀬戸', 'x': -120.0, 'z': 380.0, 'dir': 0.32, 'width': 760.0}


def locate_strait():
    pass


def island(X, Z, cx, cz, R, Hm, el, seed):
    """Several overlapping lobes (each a future cape or hill) under a domain warp, so the outline gets capes, coves and
    necks rather than a round blob; a dome profile with ridged secondary summits on top"""
    rng = np.random.default_rng(seed)
    ang = rng.uniform(0, np.pi)
    ca, sa = np.cos(ang), np.sin(ang)
    dx0, dz0 = X - cx, Z - cz
    qx = (dx0 * ca - dz0 * sa) / el[0]
    qz = (dx0 * sa + dz0 * ca) / el[1]
    # domain warp in metres: shifts the outline by up to ~0.35 R, with a finer warp for small coves
    qx = qx + 0.34 * R * fbm(qx / (R * 0.9) + seed * 1.3, qz / (R * 0.9), 4, seed) + 0.1 * R * (pnoise(qx / 140 + seed, qz / 140, seed + 3) - 0.5)
    qz = qz + 0.34 * R * fbm(qx / (R * 0.9), qz / (R * 0.9) - seed * 1.7, 4, seed + 1) + 0.1 * R * (pnoise(qx / 140, qz / 140 - seed, seed + 4) - 0.5)
    r = np.full_like(X, 9.0)
    for k in range(4):
        ox, oz = rng.uniform(-0.5, 0.5, 2) * R * (0 if k == 0 else 1)
        rk = R * (0.75 if k == 0 else rng.uniform(0.35, 0.6))
        r = np.minimum(r, np.hypot(qx - ox, qz - oz) / rk)
    t = np.clip(1 - r, -0.6, 1)
    dome = np.where(t > 0, np.power(np.maximum(t, 0), 0.8), 0) * Hm
    rid = ridged_mf(qx / (R * 0.8) + seed * 1.7, qz / (R * 0.8) - seed, 5, 100 + seed) / 1.7
    h = dome * (0.5 + 0.65 * rid) + np.where(t > 0, 0, t * max(70.0, 0.12 * R))       # the sea floor drops ~12 % off the shore
    h += np.maximum(t, 0) * 25 * (pnoise(X / 240 + seed, Z / 240, seed + 9) - 0.45)
    return h


def islet(X, Z, cx, cz, R, Hm, seed):
    r = np.hypot(X - cx, Z - cz) / R
    r = r * (1 + 0.35 * (pnoise(X / 60 + seed, Z / 60, seed) - 0.5))
    t = np.clip(1 - r, -0.5, 1)
    return np.where(t > 0, np.power(np.maximum(t, 0), 0.6) * Hm, t * 30)


def near_map():
    c = np.linspace(-NEAR / 2, NEAR / 2, NN)
    X, Z = np.meshgrid(c, c)            # H[j, i] at x = c[i], z = c[j]
    H = np.full_like(X, -38.0) + 10 * (pnoise(X / 3000, Z / 3000, 71) - 0.5)
    for name, cx, cz, R, Hm, el, seed in ISLANDS:
        H = np.maximum(H, island(X, Z, cx, cz, R, Hm, el, seed))
    locate_ports(H, c)
    locate_strait()
    rng = np.random.default_rng(5)
    placed = 0
    while placed < ISLETS:
        cx, cz = rng.uniform(-6500, 6500, 2)
        if np.hypot(cx - STRAIT['x'], cz - STRAIT['z']) < 1500:
            continue
        if any(np.hypot(cx - p['x'], cz - p['z']) < 600 for p in PORTS):
            continue
        R = rng.uniform(40, 160); Hm = R * rng.uniform(0.15, 0.4)
        H = np.maximum(H, islet(X, Z, cx, cz, R, Hm, placed + 30))
        placed += 1
    # the strait: keep a navigable channel (at least -8 m) through the middle
    s = STRAIT
    d, a = np.array([np.cos(s['dir']), np.sin(s['dir'])]), np.array([-np.sin(s['dir']), np.cos(s['dir'])])
    along = (X - s['x']) * d[0] + (Z - s['z']) * d[1]
    across = (X - s['x']) * a[0] + (Z - s['z']) * a[1]
    ch = (1 - smooth(s['width'] * 0.3, s['width'] * 0.75, np.abs(across))) * (1 - smooth(700, 1000, np.abs(along)))
    H = np.minimum(H, H * (1 - ch) + (-14.0) * ch)       # keep the channel deep (the islands are placed clear of it)
    # harbours: a sheltered basin, a flat town terrace behind it
    for p in PORTS:
        fx, fz = np.sin(p['face']), np.cos(p['face'])
        u = (X - p['x']) * fx + (Z - p['z']) * fz           # + toward the open sea
        v = -(X - p['x']) * fz + (Z - p['z']) * fx
        basin = (1 - smooth(110, 200, np.hypot(u * 0.9, v)))
        H = H * (1 - basin) + np.minimum(H, -5.5) * basin
        terrace = (1 - smooth(90, 200, np.hypot((u + 190) * 1.2, v * 0.75))) * (H > 1.0)
        H = H * (1 - terrace) + np.minimum(H, 3.0 + 0.012 * np.maximum(-u - 150, 0) ** 1.2) * terrace
    base = H.copy()
    print('eroding near', flush=True)
    castle = castle_island(X, Z)
    H = H + erode_multi(H, NEAR, seed=21, levels=((8, 18, (40, 12)), (4, 16, (22, 8)), (2, 12, (10, 4))))
    # keep the channel and harbours as they were cut (sediment would fill them)
    keep = np.maximum(ch, 0)
    for p in PORTS:
        keep = np.maximum(keep, 1 - smooth(150, 260, np.hypot(X - p['x'], Z - p['z'])))
    H = H * (1 - keep) + base * keep
    # the sea floor keeps its depth: the rain's sediment may build a few metres of shelf off the beaches, never flats
    sea = base < 0
    H = np.where(sea, np.minimum(H, np.minimum(base + 4.0, -0.8)), H)
    # the castle islands go in after the erosion (their terraces are made by hand, not by rain). The game draws them from
    # their own 1 m mesh (castle.py), so this coarse grid is kept 3 m under that surface where it is above water
    H = np.maximum(H, np.where(castle > -1.0, castle - 3.0, castle))
    return X, Z, H


def far_map():
    c = np.linspace(-FAR / 2, FAR / 2, FN)
    X, Z = np.meshgrid(c, c)
    H = np.full_like(X, -40.0)
    # mainland to the north (Honshu, 10-40 km) and south (Shikoku, 14-45 km): long ranges rising inland
    wn = X / 9000 + 0.5 * fbm(X / 20000, Z / 20000, 3, 201)
    for side, z0, hmax, seed in ((-1, -16000, 480, 211), (1, 19000, 700, 221)):
        coast = z0 + side * 0 + 2500 * fbm(X / 9000, 7.3 * side, 4, seed) + 1200 * (pnoise(X / 2600, seed, seed) - 0.5)
        inland = (Z - coast) * side                      # + inland
        rise = smooth(-300, 9000, inland)
        rid = ridged_mf(X / 7000 + seed, Z / 7000 + wn * 0.3, 6, seed) / 1.7
        H = np.maximum(H, np.where(inland > -600, (inland + 600) / 600 * 20 - 20, -40) + rise * hmax * (0.35 + 0.75 * rid))
    # outer islands in a ring 9-30 km out, larger and higher with distance (they make the middle layers)
    rng = np.random.default_rng(17)
    for k in range(38):
        ang = rng.uniform(0, 2 * np.pi); dist = rng.uniform(10000, 34000)
        cx, cz = np.cos(ang) * dist, np.sin(ang) * dist * 0.45
        R = rng.uniform(500, 1700) * (0.7 + dist / 34000); Hm = rng.uniform(80, 280) * (0.7 + dist / 45000)
        H = np.maximum(H, island(X, Z, cx, cz, R, Hm, (rng.uniform(0.7, 1.5), 1.0), 300 + k))
    print('eroding far', flush=True)
    H = H + erode_multi(H, FAR, seed=41, levels=((4, 14, (120, 30)), (2, 12, (60, 16)), (1, 10, (25, 8))))
    # inside the near square, sink below it (the near map draws there)
    cheb = np.maximum(np.abs(X), np.abs(Z))
    H = H - (1 - smooth(NEAR / 2 - 700, NEAR / 2 - 100, cheb)) * 400
    return X, Z, H


def write(path, meta_path, H, size, n):
    hmin, hmax = float(H.min()) - 1, float(H.max()) + 1
    q = np.round((H - hmin) / (hmax - hmin) * 65535).astype(np.int32)
    dq = np.diff(q, axis=1, prepend=0).astype(np.int16).astype('<i2')
    open(path, 'wb').write(zlib.compress(dq.tobytes(), 9))
    json.dump(dict(size=size, n=n, hmin=hmin, hmax=hmax), open(meta_path, 'w'))


def top_png(path, H, size):
    from PIL import Image
    gz, gx = np.gradient(H, size / (H.shape[0] - 1))
    nn = np.stack([-gx, np.ones_like(H), -gz], -1); nn /= np.linalg.norm(nn, axis=-1, keepdims=True)
    L = np.array([-0.5, 0.7, -0.5]); L /= np.linalg.norm(L)
    s = np.clip(nn @ L, 0, 1)
    land = H > 0
    rgb = np.where(land[..., None], np.stack([0.3 + 0.5 * s, 0.4 + 0.5 * s, 0.25 + 0.4 * s], -1),
                   np.stack([0.1 + 0 * s, 0.25 + 0.2 * np.clip(H / -40 + 1, 0, 1), 0.4 + 0.2 * np.clip(H / -40 + 1, 0, 1)], -1))
    Image.fromarray((np.clip(rgb, 0, 1) * 255).astype(np.uint8)).save(path)


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else 'web/data'
    chk = sys.argv[2] if len(sys.argv) > 2 else 'build/check'
    os.makedirs(out, exist_ok=True); os.makedirs(chk, exist_ok=True)
    X, Z, H = near_map()
    write(os.path.join(out, 'near.bin'), os.path.join(out, 'near.json'), H, NEAR, NN)
    top_png(os.path.join(chk, 'near_top.png'), H[::2, ::2], NEAR)
    np.save(os.path.join(chk, 'near.npy'), H.astype(np.float32))
    Xf, Zf, Hf = far_map()
    write(os.path.join(out, 'far.bin'), os.path.join(out, 'far.json'), Hf, FAR, FN)
    top_png(os.path.join(chk, 'far_top.png'), Hf, FAR)
    isl = [{'name': n, 'x': x, 'z': z, 'r': r} for n, x, z, r, *_ in ISLANDS] + [{'name': '能島', 'x': 0, 'z': 0, 'r': 105}, {'name': '鯛崎島', 'x': -9, 'z': 191, 'r': 40}]
    json.dump({'ports': PORTS, 'strait': {k: v for k, v in STRAIT.items() if k != 'between'}, 'islands': isl, 'noshima': NOSHIMA},
              open(os.path.join(out, 'map.json'), 'w'), ensure_ascii=False)
    print('ISLANDS near', round(float(H.min())), round(float(H.max())), 'far', round(float(Hf.min())), round(float(Hf.max())),
          {f: os.path.getsize(os.path.join(out, f)) for f in ('near.bin', 'far.bin')})


if __name__ == '__main__':
    main()
