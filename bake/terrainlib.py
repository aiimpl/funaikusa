"""Noise and droplet erosion shared by the island bakers (numpy only). Taken from hai-no-michi (MIT)."""
import numpy as np
from scipy.ndimage import gaussian_filter


def hash2(ix, iy, seed):
    h = np.sin(ix * 127.1 + iy * 311.7 + seed * 74.7) * 43758.5453
    return h - np.floor(h)


def vnoise(x, y, seed=0):
    ix, iy = np.floor(x), np.floor(y)
    fx, fy = x - ix, y - iy
    ux, uy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
    a = hash2(ix, iy, seed)
    b = hash2(ix + 1, iy, seed)
    c = hash2(ix, iy + 1, seed)
    d = hash2(ix + 1, iy + 1, seed)
    return (a + (b - a) * ux) + ((c + (d - c) * ux) - (a + (b - a) * ux)) * uy


def pnoise(x, y, seed=0):
    """Gradient (Perlin) noise: shows less grid alignment than value noise. Remapped from -1..1 to 0..1"""
    ix, iy = np.floor(x), np.floor(y)
    fx, fy = x - ix, y - iy

    def grad(i, j, dx, dy):
        a = hash2(i, j, seed + 0.37) * 6.283185307
        return np.cos(a) * dx + np.sin(a) * dy
    u = fx * fx * fx * (fx * (fx * 6 - 15) + 10)
    v = fy * fy * fy * (fy * (fy * 6 - 15) + 10)
    n00 = grad(ix, iy, fx, fy); n10 = grad(ix + 1, iy, fx - 1, fy)
    n01 = grad(ix, iy + 1, fx, fy - 1); n11 = grad(ix + 1, iy + 1, fx - 1, fy - 1)
    n = (n00 * (1 - u) + n10 * u) * (1 - v) + (n01 * (1 - u) + n11 * u) * v
    return np.clip(n * 0.72 + 0.5, 0, 1)


def ridged_mf(x, y, octaves, seed, gain=1.6):
    """Ridged multifractal: rotates coordinates per octave to hide grid alignment. Sharp peaks, rounded valleys"""
    m, amp, wgt = 0.0, 1.0, 1.0
    for i in range(octaves):
        a = 0.62 * i + 0.3
        ca, sa = np.cos(a), np.sin(a)
        f = 2.07 ** i
        px, py = (x * ca - y * sa) * f + i * 13.1, (x * sa + y * ca) * f - i * 7.7
        r = 1 - np.abs(2 * pnoise(px, py, seed + i * 7) - 1)
        r = r * r * wgt
        m = m + r * amp
        wgt = np.clip(r * gain, 0, 1)
        amp *= 0.5
    return m


def fbm(x, y, octaves=5, seed=0):
    v, amp, f = 0.0, 0.5, 1.0
    for i in range(octaves):
        v = v + amp * (vnoise(x * f, y * f, seed + i * 13) - 0.5)
        f *= 2.03
        amp *= 0.5
    return v


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def erode(H, cell, drops=1_200_000, batch=6_000, steps=48, seed=7, lim=(45, 15)):
    """Droplet erosion: drop many droplets on the slopes at once; they erode and carry sediment as they flow and deposit it as they slow.
    Gullies branch downhill, ridges sharpen, and sediment collects in valley floors. Returns the height change (m)"""
    n = H.shape[0]
    h = H.astype(np.float64).copy().ravel()
    rng = np.random.default_rng(seed)
    inertia, cap_k, min_cap, k_er, k_dep, evap, grav = 0.08, 5.0, 0.01, 0.35, 0.3, 0.025, 9.8

    def sample(px, py):
        ix = np.clip(px.astype(np.int64), 0, n - 2); iy = np.clip(py.astype(np.int64), 0, n - 2)
        u = px - ix; v = py - iy
        i00 = iy * n + ix
        a, b, c, d = h[i00], h[i00 + 1], h[i00 + n], h[i00 + n + 1]
        hh = a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v
        gx = (b - a) * (1 - v) + (d - c) * v
        gy = (c - a) * (1 - u) + (d - b) * u
        return hh, gx, gy, i00, u, v

    def splat(i00, u, v, amt):
        np.add.at(h, i00, amt * (1 - u) * (1 - v)); np.add.at(h, i00 + 1, amt * u * (1 - v))
        np.add.at(h, i00 + n, amt * (1 - u) * v); np.add.at(h, i00 + n + 1, amt * u * v)

    for bi in range(drops // batch):
        px = rng.uniform(1, n - 2, batch); py = rng.uniform(1, n - 2, batch)
        dx = np.zeros(batch); dy = np.zeros(batch)
        vel = np.ones(batch); water = np.ones(batch); sed = np.zeros(batch)
        alive = np.ones(batch, bool)
        for _ in range(steps):
            h0, gx, gy, i00, u, v = sample(px, py)
            dx = dx * inertia - gx * (1 - inertia); dy = dy * inertia - gy * (1 - inertia)
            ln = np.hypot(dx, dy)
            alive &= ln > 1e-9
            ln = np.where(ln > 1e-9, ln, 1)
            dx /= ln; dy /= ln
            nx, ny = px + dx, py + dy
            alive &= (nx > 1) & (nx < n - 2) & (ny > 1) & (ny < n - 2)
            h1 = sample(np.clip(nx, 1, n - 2), np.clip(ny, 1, n - 2))[0]
            dh = h1 - h0
            cap = np.maximum(-dh * vel * water * cap_k, min_cap)
            dep = (sed > cap) | (dh > 0)
            amt_dep = np.where(dh > 0, np.minimum(dh, sed), (sed - cap) * k_dep)
            amt_er = np.minimum(np.minimum((cap - sed) * k_er, np.maximum(-dh, 0)), 0.004 * cell)   # a droplet erodes at most 0.4% of the cell size per step
            amt = np.where(dep, amt_dep, -amt_er) * alive
            splat(i00, u, v, amt)
            sed = sed - amt
            vel = np.minimum(np.sqrt(np.maximum(vel * vel - dh * grav / cell * 0.5, 0)), 6.0)
            water *= 1 - evap
            px, py = np.where(alive, nx, px), np.where(alive, ny, py)
            if not alive.any():
                break
        if bi % 20 == 0:
            np.clip(h, H.ravel() - lim[0], H.ravel() + lim[1], out=h)
    out = np.clip(h.reshape(n, n), H - lim[0], H + lim[1])
    # slumping: relax slopes steeper than the angle of repose (40 deg); edges do not wrap
    tn = np.tan(np.radians(40))
    for _ in range(6):
        for a_, b_ in ((0, 1), (1, 0), (1, 1), (1, -1)):
            d = cell * np.hypot(a_, b_)
            P = out[0:n - a_, max(0, -b_):n - max(0, b_)]            # (i, j)
            Q = out[a_:n, max(0, b_):n + min(0, b_)]                 # (i + a, j + b)
            diff = P - Q
            ex = np.clip(np.abs(diff) - tn * d, 0, None) * np.sign(diff) * 0.25
            P -= ex
            Q += ex
    return out - H


def erode_multi(H, size, seed=7, levels=((4, 24, (60, 20)), (2, 20, (30, 10)), (1, 14, (12, 5)))):
    """Layer erosion from coarse to fine grids: 16 m cuts main valleys, 8 m side valleys, 4 m gullies. H is on the 1 m grid"""
    from scipy.ndimage import zoom
    n = H.shape[0]
    cur = H.copy()
    for step, per, lim in levels:
        c = cur[::step, ::step]
        d = erode(c, size / (c.shape[0] - 1), drops=int(c.size * per), seed=seed + step, lim=lim)
        d = zoom(d, (n - 1) / (c.shape[0] - 1), order=1)[:n, :n]
        d = gaussian_filter(d, step * 0.55)                 # hide the coarse grid corners
        cur = cur + d
    return cur - H


