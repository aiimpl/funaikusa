"""Parts of the three warship types as mesh accumulators (no Blender needed). Ship coordinates (f, x, z).

Materials:
  hull   side planking             tar    bottom and lower strakes      deck   deck boards
  post   vertical timbers          rail   rails, beams, ledges           shield shield boards (tate-ita)
  roof   board roofs               tile   roof tiles                     plaster white walls of the tower
  iron   plates, nails, bands      rope   lashings                       cloth  curtains (maku)

The superstructure follows ref/REF.md:
  atake  : an oar ledge (rodoko) on the beam heads; two tiers of shield boards around nearly the whole length
           (sou-yagura), gun ports in the bow wall, a flat fighting deck on top and a two-storey tower (rokaku)
  seki   : the oar ledge and one tier of shield boards with round gun ports, a small deckhouse aft
  kobaya : low half-bulwark boards (hangaki) only; the oars work over the gunwale
"""
import math

import numpy as np

from meshb import MB, nrm

rng = np.random.default_rng(11)


def lerp(a, b, t):
    return a + (b - a) * t


def resample(E, t0, t1, n):
    s = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(E, axis=0), axis=1))])
    s /= s[-1]
    u = np.linspace(t0, t1, n)
    return np.stack([np.interp(u, s, E[:, k]) for k in range(3)], -1)


def edge(H, k, side=1):
    E = H.EDGE_PTS[k].copy()
    E[:, 1] *= side
    return E


# ---- layout of each type (ship coordinates; heights relative to the sheer at midships) ----------------------
def layout(H):
    """Where the superstructure goes. Everything is derived from the hull so the three types stay consistent"""
    a, b = H.f_range()
    zs = H.sheer(0)[1]
    if H.kind == 'atake':
        return dict(ov=0.85, y0=a + 1.4, y1=b - 1.6, z_floor=zs + 0.08, gap=0.55, tiers=[(1.85, 'square'), (1.25, 'alt')],
                    parapet=0.55, oar_f=(a + 3.2, b - 3.4), mast_f=1.8, mast_h=19.5, yard_l=14.0, sail=(12.6, 12.0),
                    tower=[(-9.6, -1.6, 3.9, 2.5), (-7.6, -3.6, 2.6, 2.3)], guns=3)
    if H.kind == 'seki':
        return dict(ov=0.55, y0=a + 1.8, y1=b - 3.2, z_floor=zs + 0.05, gap=0.45, tiers=[(1.35, 'round')],
                    parapet=0.0, oar_f=(a + 2.8, b - 4.4), mast_f=1.6, mast_h=14.5, yard_l=9.6, sail=(8.8, 9.0),
                    house=(-8.0, -4.4, 1.55, 1.85), guns=1)
    return dict(ov=0.12, y0=a + 1.0, y1=b - 1.8, z_floor=zs, gap=0.0, tiers=[(0.72, 'none')], parapet=0.0,
                oar_f=(a + 1.8, b - 2.8), mast_f=1.0, mast_h=7.2, yard_l=4.6, sail=(4.2, 4.4), guns=0)


def floor_z(H, Y, f):
    """The superstructure floor follows the sheer, but flattened (a box sits on the hull)"""
    z0 = H.sheer(0)[1]
    return Y['z_floor'] + (H.sheer(f)[1] - z0) * 0.25


def box_x(H, Y, f):
    """Half-breadth of the superstructure: the sheer plus the ledge, never narrower than a fraction of midships"""
    return max(H.sheer(f)[0] + Y['ov'], (H.sheer(0)[0] + Y['ov']) * 0.62)


# ---- hull ---------------------------------------------------------------------------------------------------
def planking(H):
    mb = MB()
    nails = []
    t = H.thick
    for side in (1, -1):
        out = lambda p, s=side: nrm((0, s, 0.25))
        for k in range(3):
            A, B = edge(H, k, side), edge(H, k + 1, side)
            for b in range(2):
                mat = 'tar' if k == 0 or (k == 1 and b == 0) else 'hull'
                s0, s1 = b / 2 + (0.004 if b else 0), (b + 1) / 2 - (0.004 if b == 0 else 0)
                cuts = [0.0] + sorted(rng.uniform(0.18, 0.82, 2 + (k + b) % 2).tolist()) + [1.0]
                for c0, c1 in zip(cuts, cuts[1:]):
                    g0 = c0 + (0.00012 if c0 > 0 else 0)
                    g1 = c1 - (0.00012 if c1 < 1 else 0)
                    n = max(4, int((g1 - g0) * 90))
                    lo = lerp(resample(A, g0, g1, n), resample(B, g0, g1, n), s0)
                    hi = lerp(resample(A, g0, g1, n), resample(B, g0, g1, n), s1)
                    mb.board(lo, hi, t, mat, rows=2, out=out, inner_k=0.4)
                sn = s1 if b == 0 else 0.999
                a = resample(A, 0.02, 0.98, 70)
                bb = resample(B, 0.02, 0.98, 70)
                seam = lerp(a, bb, sn)
                L = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(seam, axis=0), axis=1))])
                step = 0.34 * max(0.6, math.sqrt(H.B / 7.4))
                for d in np.arange(0.2, L[-1] - 0.2, step):
                    i = np.searchsorted(L, d) - 1
                    u = (d - L[i]) / max(L[i + 1] - L[i], 1e-6)
                    p = lerp(seam[i], seam[i + 1], u)
                    tan = nrm(seam[i + 1] - seam[i])
                    acr = nrm(bb[i] - a[i])
                    nn = nrm(np.cross(tan, acr))
                    if np.dot(nn, out(p)) < 0:
                        nn = -nn
                    nails.append((p + nn * 0.004, tan, acr, 'tar' if mat == 'tar' else 'iron'))
    k = max(0.55, math.sqrt(H.B / 7.4))
    for p, tan, acr, m in nails:
        mb.obox(p, tan, acr, 0.075 * k, 0.03 * k, 0.012, m)
    return mb


def bottom(H):
    mb = MB()
    Ep, Es = edge(H, 0, 1), edge(H, 0, -1)
    nb = 3 if H.B > 4 else 2
    for j in range(nb):
        a = lerp(Es, Ep, j / nb + (0.003 if j else 0))
        b = lerp(Es, Ep, (j + 1) / nb - (0.003 if j < nb - 1 else 0))
        mb.board(a, b, H.thick * 1.8, 'tar', rows=1, out=lambda p: (0, 0, -1), inner_k=0.1, outer_k=0.3)
    return mb


def stem(H):
    """Single stem (mioshi) on the raked line, with iron straps; seki and kobaya only"""
    mb = MB()
    (f0, z0), (f1, z1) = H.STEM
    ax = nrm((f1 - f0, 0, z1 - z0))
    perp = nrm((-ax[2], 0, ax[0]))
    k = H.B / 7.4
    w_a, w_b, d = 0.56 * k + 0.08, 0.40 * k + 0.06, 0.8 * k + 0.1
    n = 6
    for i in range(n):
        t0, t1 = i / n, (i + 1) / n
        p0 = np.array((lerp(f0, f1, t0), 0, lerp(z0, z1, t0)))
        p1 = np.array((lerp(f0, f1, t1), 0, lerp(z0, z1, t1)))
        pts = []
        for p, w in ((p0, lerp(w_a, w_b, t0)), (p1, lerp(w_a, w_b, t1))):
            for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                pts.append(p + np.array((0, sx * w / 2, 0)) + perp * sy * d / 2)
        mb.hexa(pts, 'tar' if lerp(z0, z1, t1) < 0.3 * k else 'post')
    top = np.array((f1, 0, z1))
    mb.beam(top - ax * 0.05, top + ax * 0.35 * k, perp, w_b + 0.04, d * 1.1, 'post')
    for t in (0.7, 0.88):
        p = np.array((lerp(f0, f1, t), 0, lerp(z0, z1, t)))
        mb.beam(p - ax * 0.06, p + ax * 0.06, perp, lerp(w_a, w_b, t) + 0.03, d * 1.04, 'iron')
    return mb


def transom(H, bow=False):
    """Flat raked end board (todate): horizontal boards between the strake ends. The atake has one at each end"""
    mb = MB()
    i = -1 if bow else 0
    z_lo, z_hi = H.EDGES[0][i][2], H.EDGES[3][i][2]
    zs = np.linspace(z_lo, z_hi, 10)
    rake = H.bow_rake if bow else H.stern_rake
    sgn = -1 if bow else 1
    inward = np.array((sgn * math.cos(rake), 0, -math.sin(rake)))
    for za, zb in zip(zs, zs[1:]):
        zb2 = zb - 0.006
        fa, xa = H.end_at(za, bow)
        fb, xb = H.end_at(zb2, bow)
        A = np.array([(fa, -xa, za), (fa, xa, za)])
        B = np.array([(fb, -xb, zb2), (fb, xb, zb2)])
        mb.board(A, B, H.thick * 1.4, 'hull' if za > 0.3 else 'tar', rows=1, out=lambda p: -inward, inner_k=0.5)
    for x in (-1, 0, 1):
        za, zb = z_lo + 0.05, z_hi + 0.05
        f0, x0 = H.end_at(za, bow)
        f1, x1 = H.end_at(zb, bow)
        p0 = np.array((f0 - sgn * 0.05, x * (x0 - 0.1), za))
        p1 = np.array((f1 - sgn * 0.05, x * (x1 - 0.1), zb))
        mb.beam(p0, p1, (1, 0, 0), 0.24 * H.B / 7.4 + 0.06, 0.24 * H.B / 7.4 + 0.06, 'post')
    return mb


def deck(H, Y):
    """Main deck inside the hull (seen on the kobaya; under the superstructure on the others)"""
    mb = MB()
    a, b = H.f_range(2)
    fs = np.linspace(a + 0.3, b - 0.3, 80)
    nb = max(6, int(H.B / 0.45))
    for j in range(nb):
        u0 = -1 + 2 * j / nb + 0.004
        u1 = -1 + 2 * (j + 1) / nb - 0.004
        A, B = [], []
        for f in fs:
            z = H.deck_z(f)
            w = H.hull_x(f, z) - H.thick * 1.3
            for u, L in ((u0, A), (u1, B)):
                L.append((f, u * w, z + 0.02 * H.B * (1 - u * u)))
        mb.board(np.array(A), np.array(B), 0.06, 'deck', rows=1, out=lambda p: (0, 0, 1), inner_k=0.1)
    return mb


def beams(H, Y):
    """Through-beams (funabari). On the warships their heads carry the oar ledge, so they stick out a long way"""
    mb = MB()
    a, b = Y['y0'], Y['y1']
    ov = Y['ov']
    k = H.B / 7.4
    for f in np.arange(a + 0.4, b - 0.2, H.beam_step):
        z = H.sheer(f)[1] - 0.18 * k - 0.05
        x = max(H.hull_x(f, z) + ov + 0.08, 0.3)
        mb.beam((f, -x, z), (f, x, z), (0, 0, 1), 0.2 * k + 0.08, 0.24 * k + 0.08, 'rail')
        for s in (-1, 1):
            mb.obox((f, s * (x + 0.003), z), (0, s, 0), (1, 0, 0), 0.012, 0.2 * k + 0.1, 0.24 * k + 0.1, 'iron')
    return mb


def wale(H):
    mb = MB()
    a, b = H.f_range()
    for side in (1, -1):
        E = resample(edge(H, 3, side), 0.0, 1.0, 90)
        if H.STEM is not None:
            E = E[E[:, 0] < b - 0.5]
        mb.tube(E + np.array((0, side * 0.03, 0.0)), 0.07 * math.sqrt(H.B / 7.4) + 0.02, 'rail', seg=6)
    return mb


# ---- boards with holes (gun and arrow ports) -------------------------------------------------------------
def hole_radius(shape, th, r):
    """Radial outline of a port around its centre, in the panel plane"""
    if shape == 'round':
        return r
    if shape == 'square':
        return r / max(abs(math.cos(th)), abs(math.sin(th)))
    if shape == 'tri':      # point up
        k = 3
        a = (th - math.pi / 2) % (2 * math.pi / k) - math.pi / k
        return r * 0.5 / math.cos(a)
    if shape == 'slot':     # wide and low (arrow slit)
        return r / max(abs(math.cos(th)) / 2.6, abs(math.sin(th)))
    raise ValueError(shape)


def panel(mb, c, u, v, w, h, t, mat, holes=()):
    """Slab of w x h x t centred at c, face normal = u x v (outward), with through-holes.
    holes: list of (du, dv, shape, r) in panel coordinates. Built as rings from each hole out to the panel edge"""
    c, u, v = np.asarray(c, float), nrm(u), nrm(v)
    n = np.cross(u, v)
    if not holes:
        mb.obox(c, u, v, w, h, t, mat)
        return
    # split the panel into vertical cells, one hole per cell
    hs = sorted(holes, key=lambda q: q[0])
    edges = [-w / 2] + [(hs[i][0] + hs[i + 1][0]) / 2 for i in range(len(hs) - 1)] + [w / 2]
    for (du, dv, shape, r), e0, e1 in zip(hs, edges, edges[1:]):
        cu = (e0 + e1) / 2
        cw = e1 - e0
        corners = [(e0, -h / 2), (e1, -h / 2), (e1, h / 2), (e0, h / 2)]
        ang_c = sorted(math.atan2(y - dv, x - du) % (2 * math.pi) for x, y in corners)
        m = 24
        angs = sorted(set([round(a, 6) for a in ang_c] + [round(2 * math.pi * i / m, 6) for i in range(m)]))
        inner, outer = [], []
        for th in angs:
            rr = hole_radius(shape, th, r)
            inner.append((du + rr * math.cos(th), dv + rr * math.sin(th)))
            # ray to the cell boundary
            ct, st = math.cos(th), math.sin(th)
            ts = []
            if abs(ct) > 1e-9:
                ts += [(e0 - du) / ct, (e1 - du) / ct]
            if abs(st) > 1e-9:
                ts += [(-h / 2 - dv) / st, (h / 2 - dv) / st]
            tt = min(x for x in ts if x > 1e-9)
            outer.append((du + tt * ct, dv + tt * st))
        N = len(angs)
        P = lambda q, s: c + u * q[0] + v * q[1] + n * s * t / 2
        V = [P(q, 1) for q in inner] + [P(q, 1) for q in outer] + [P(q, -1) for q in inner] + [P(q, -1) for q in outer]
        F, UV, GR = [], [], []
        uvf = lambda q: (q[0] + w / 2, q[1] + h / 2)
        for i in range(N):
            j = (i + 1) % N
            F.append((i, j, N + j, N + i)); UV.append((uvf(inner[i]), uvf(inner[j]), uvf(outer[j]), uvf(outer[i]))); GR.append(0)
            F.append((2 * N + i, 3 * N + i, 3 * N + j, 2 * N + j)); UV.append((uvf(inner[i]), uvf(outer[i]), uvf(outer[j]), uvf(inner[j]))); GR.append(1)
            # tunnel through the board
            L0 = sum(math.dist(inner[k], inner[(k + 1) % N]) for k in range(i))
            L1 = L0 + math.dist(inner[i], inner[j])
            F.append((i, 2 * N + i, 2 * N + j, j)); UV.append(((L0, 0), (L0, t), (L1, t), (L1, 0))); GR.append(2)
        mb.add(V, F, mat, UV, groups=GR)
        # the cell's outer edges (top, bottom, sides) as thin faces
        for (x0, y0), (x1, y1) in zip(corners, corners[1:] + corners[:1]):
            q = [P((x0, y0), 1), P((x1, y1), 1), P((x1, y1), -1), P((x0, y0), -1)]
            mb.add(q, [(0, 3, 2, 1)], mat)
        _ = cu, cw


# ---- superstructure -------------------------------------------------------------------------------------
def plan_line(H, Y, side, n=None):
    """Points along the outer face of the superstructure (the ledge edge), from y0 to y1"""
    fs = np.linspace(Y['y0'], Y['y1'], n or max(8, int((Y['y1'] - Y['y0']) / 0.5)))
    return [(f, side * box_x(H, Y, f), floor_z(H, Y, f)) for f in fs]


def ledge(H, Y):
    """Oar ledge (rodoko): planks from the sheer out to the outer rail, on the beam heads; the outer rail holds the tholes"""
    mb = MB()
    if Y['ov'] < 0.3:
        return mb
    fs = np.linspace(Y['y0'], Y['y1'], 60)
    for side in (1, -1):
        A = np.array([(f, side * (H.sheer(f)[0] - 0.05), floor_z(H, Y, f) - 0.04) for f in fs])
        B = np.array([(f, side * box_x(H, Y, f), floor_z(H, Y, f) - 0.04) for f in fs])
        mb.board(A, B, 0.08, 'deck', rows=1, out=lambda p: (0, 0, 1), inner_k=0.2)
        rail = np.array([(f, side * (box_x(H, Y, f) + 0.02), floor_z(H, Y, f) + 0.02) for f in fs])
        mb.tube(rail, 0.09 * math.sqrt(H.B / 7.4) + 0.03, 'rail', seg=6)
    return mb


def shield_wall(H, Y):
    """Tiers of shield boards around the superstructure: posts every bay, boards between them, a port in each
    board, a rail on top of each tier. The oar gap below the first tier is left open (the oars come out there)"""
    mb = MB()
    bay = 1.25 if H.kind == 'atake' else (1.05 if H.kind == 'seki' else 0.95)
    z0 = Y['gap']
    t = 0.08 if H.kind != 'kobaya' else 0.05
    port = {'atake': 0.11, 'seki': 0.075, 'kobaya': 0.0}[H.kind]
    tiers = Y['tiers']
    fs = np.arange(Y['y0'], Y['y1'] + 1e-6, bay)
    fs = np.append(fs[:-1], Y['y1']) if Y['y1'] - fs[-1] > bay * 0.4 else np.append(fs[:-1], Y['y1'])
    for side in (1, -1):
        P = lambda f, dz: np.array((f, side * box_x(H, Y, f), floor_z(H, Y, f) + dz))
        zc = z0
        for ti, (th, kind) in enumerate(tiers):
            for i in range(len(fs) - 1):
                fa, fb = fs[i], fs[i + 1]
                pa, pb = P(fa, zc), P(fb, zc)
                u = nrm(pb - pa)
                if side < 0:
                    u = -u
                v = np.array((0, 0, 1.0))
                w = np.linalg.norm(pb - pa) - 0.12
                c = (pa + pb) / 2 + np.array((0, 0, th / 2)) - np.array((0, side * t / 2, 0))
                holes = []
                if kind == 'square':
                    holes = [(0.0, 0.05, 'square', port)]
                elif kind == 'round':
                    holes = [(-w / 4, 0.1, 'round', port), (w / 4, 0.1, 'round', port)]
                elif kind == 'alt':
                    holes = [(-w / 4, 0.0, 'square', port * 0.8), (w / 4, -0.02, 'tri', port * 1.5)]
                panel(mb, c, u, v, w, th - 0.1, t, 'shield', holes)
                # horizontal batten at mid-height on the inside keeps the boards together
                mb.beam(c - u * w / 2 + np.array((0, -side * t, -th * 0.2)), c + u * w / 2 + np.array((0, -side * t, -th * 0.2)), (0, side, 0), 0.05, 0.1, 'rail')
            # posts
            for f in fs:
                p = P(f, zc)
                mb.beam(p + np.array((0, -side * 0.06, -0.02 if ti == 0 else 0)), p + np.array((0, -side * 0.06, th)), (0, side, 0), 0.13, 0.13, 'post')
            # rail on top of the tier
            top = np.array([P(f, zc + th) + np.array((0, -side * 0.04, 0.04)) for f in np.linspace(Y['y0'], Y['y1'], 40)])
            mb.tube(top, 0.07, 'rail', seg=6)
            zc += th
        # posts in the oar gap (short, between the ledge and the first tier)
        if z0 > 0.1:
            for f in fs:
                p = P(f, 0)
                mb.beam(p + np.array((0, -side * 0.06, 0)), p + np.array((0, -side * 0.06, z0)), (0, side, 0), 0.12, 0.12, 'post')
            sill = np.array([P(f, z0) + np.array((0, -side * 0.04, 0)) for f in np.linspace(Y['y0'], Y['y1'], 40)])
            mb.tube(sill, 0.07, 'rail', seg=6)
    # end walls across the bow and stern of the box (the bow wall carries the gun ports)
    for end, fe in (('stern', Y['y0']), ('bow', Y['y1'])):
        xe = box_x(H, Y, fe)
        zc = z0
        sgn = 1 if end == 'bow' else -1
        for ti, (th, kind) in enumerate(tiers):
            w = 2 * xe - 0.12
            c = np.array((fe - sgn * t / 2, 0, floor_z(H, Y, fe) + zc + th / 2))
            holes = []
            if end == 'bow' and ti == 0 and Y['guns']:
                ng = Y['guns']
                for g in range(ng):
                    du = (g - (ng - 1) / 2) * min(1.6, w / (ng + 0.5))
                    holes.append((du, -0.05, 'square', 0.26))
            elif kind in ('square', 'round', 'alt'):
                nb = max(2, int(w / 1.3))
                for g in range(nb):
                    du = (g - (nb - 1) / 2) * w / nb
                    holes.append((du, 0.05, 'round' if kind == 'round' else 'square', port))
            u = np.array((0, -sgn, 0.0))
            panel(mb, c, u, (0, 0, 1), w, th - 0.1, t, 'shield', holes)
            top = np.array([(fe, x, floor_z(H, Y, fe) + zc + th + 0.04) for x in np.linspace(-xe, xe, 12)])
            mb.tube(top, 0.07, 'rail', seg=6)
            zc += th
        if z0 > 0.1:
            # the gap below is boarded at the ends (no oars there)
            c = np.array((fe - sgn * t / 2, 0, floor_z(H, Y, fe) + z0 / 2))
            mb.obox(c, (0, 1, 0), (0, 0, 1), 2 * xe - 0.12, z0, t, 'shield')
    return mb


def top_deck(H, Y):
    """Flat fighting deck on top of the shield walls (sou-yagura roof), with a low parapet on the atake"""
    mb = MB()
    if H.kind == 'kobaya':
        return mb
    zt = Y['gap'] + sum(th for th, _ in Y['tiers'])
    fs = np.linspace(Y['y0'], Y['y1'], 50)
    nb = max(8, int(2 * box_x(H, Y, 0) / 0.5))
    for j in range(nb):
        u0 = -1 + 2 * j / nb + 0.003
        u1 = -1 + 2 * (j + 1) / nb - 0.003
        A = np.array([(f, u0 * (box_x(H, Y, f) - 0.02), floor_z(H, Y, f) + zt) for f in fs])
        B = np.array([(f, u1 * (box_x(H, Y, f) - 0.02), floor_z(H, Y, f) + zt) for f in fs])
        mb.board(A, B, 0.07, 'deck', rows=1, out=lambda p: (0, 0, 1), inner_k=0.1)
    if Y['parapet'] > 0:
        ph = Y['parapet']
        for side in (1, -1):
            for f0, f1 in zip(fs[:-1:3], fs[3::3]):
                p0 = np.array((f0, side * (box_x(H, Y, f0) - 0.05), floor_z(H, Y, f0) + zt + ph / 2 + 0.04))
                p1 = np.array((f1, side * (box_x(H, Y, f1) - 0.05), floor_z(H, Y, f1) + zt + ph / 2 + 0.04))
                u = nrm(p1 - p0) * (1 if side > 0 else -1)
                panel(mb, (p0 + p1) / 2, u, (0, 0, 1), np.linalg.norm(p1 - p0) - 0.04, ph, 0.06, 'shield',
                      [(0.0, 0.02, 'slot', 0.05)])
    return mb


def hip_roof(mb, f0, f1, x, z, rise, over, mat, tile=False, gable=0.45):
    """Irimoya-style roof over a rectangle f0..f1 x -x..x at eave height z: a hipped lower part and a small gable
    on top. Tiled roofs get rows of round tiles as half-round ridges"""
    L = f1 - f0
    fc = (f0 + f1) / 2
    ex = x + over
    ef0, ef1 = f0 - over, f1 + over
    zr = z + rise
    ridge_half = L / 2 * gable + over * 0.5
    # four slopes: two long trapezoids (sides) and two triangles/trapezoids at the ends (hips)
    ra, rb = np.array((fc - ridge_half, 0, zr)), np.array((fc + ridge_half, 0, zr))
    th = 0.12
    for s in (1, -1):
        e0, e1 = np.array((ef0, s * ex, z)), np.array((ef1, s * ex, z))
        # slope board: from the eave line up to the ridge line, both as polylines
        A = np.array([lerp(e0, e1, t) for t in np.linspace(0, 1, 12)])
        B = np.array([lerp(ra, rb, t) for t in np.linspace(0, 1, 12)])
        # hips: the ends of the side slope lean inward to the ridge ends
        mb.board(A, B, th, mat, rows=4, out=lambda p: (0, 0, 1))
    for e in (-1, 1):
        cf = ef1 if e > 0 else ef0
        rp = rb if e > 0 else ra
        A = np.array([(cf, y, z) for y in np.linspace(-ex, ex, 8)])
        B = np.array([rp + (0, y * 0.02, 0) for y in np.linspace(-1, 1, 8)])
        mb.board(A, B, th, mat, rows=3, out=lambda p: (0, 0, 1))
        # small gable triangle standing on the ridge end (irimoya)
        g = np.array([rp + (0, -0.9 * rise, -rise * 0.45), rp + (0, 0.9 * rise, -rise * 0.45), rp + (0, 0, 0.05)])
        mb.add([tuple(q) for q in g], [(0, 1, 2), (2, 1, 0)], 'post')
    # ridge
    mb.beam(ra - (0.2, 0, -0.08), rb + (0.2, 0, 0.08), (0, 0, 1), 0.3, 0.28, 'tile' if tile else 'roof')
    if tile:
        # rows of round tiles running down the side slopes
        for s in (1, -1):
            n = int((ef1 - ef0) / 0.3)
            for i in range(n + 1):
                t = i / n
                e = np.array((lerp(ef0, ef1, t), s * ex, z + th * 0.6))
                r = np.array((lerp(ra[0], rb[0], t), 0, zr + th * 0.6))
                mb.cyl(e, lerp(e, r, 0.94), 0.055, 0.055, 'tile', seg=5, cap=False)
            # eave tiles (a thicker edge)
            mb.cyl((ef0, s * ex, z + 0.02), (ef1, s * ex, z + 0.02), 0.09, 0.09, 'tile', seg=6)


def tower(H, Y):
    """Rokaku on the atake: storeys of white walls with dark timber framing, each with a tiled roof"""
    mb = MB()
    if 'tower' not in Y:
        return mb
    zt = Y['gap'] + sum(th for th, _ in Y['tiers']) + 0.07
    zb = floor_z(H, Y, -6) + zt
    for n, (f0, f1, hx, hh) in enumerate(Y['tower']):
        # walls: plaster panels between posts, a band of dark boards at the bottom, windows (lattice) on the upper half
        for side in (1, -1):
            for fa, fb in zip(np.linspace(f0, f1, int((f1 - f0) / 1.0) + 1)[:-1], np.linspace(f0, f1, int((f1 - f0) / 1.0) + 1)[1:]):
                c = np.array(((fa + fb) / 2, side * hx, zb + hh / 2))
                mb.obox(c + (0, -side * 0.04, -hh * 0.3), (1, 0, 0), (0, 0, 1), fb - fa, hh * 0.4, 0.1, 'shield')
                mb.obox(c + (0, -side * 0.04, hh * 0.2), (1, 0, 0), (0, 0, 1), fb - fa, hh * 0.6, 0.1, 'plaster')
                # window: dark recess with vertical bars
                for k in range(4):
                    fx = lerp(fa + 0.25, fb - 0.25, k / 3)
                    mb.beam((fx, side * (hx + 0.02), zb + hh * 0.45), (fx, side * (hx + 0.02), zb + hh * 0.75), (side, 0, 0), 0.04, 0.05, 'post')
                mb.beam((fa + 0.15, side * (hx + 0.02), zb + hh * 0.45), (fb - 0.15, side * (hx + 0.02), zb + hh * 0.45), (0, 0, 1), 0.05, 0.06, 'post')
                mb.beam((fa + 0.15, side * (hx + 0.02), zb + hh * 0.75), (fb - 0.15, side * (hx + 0.02), zb + hh * 0.75), (0, 0, 1), 0.05, 0.06, 'post')
            for f in np.linspace(f0, f1, int((f1 - f0) / 1.0) + 1):
                mb.beam((f, side * (hx + 0.03), zb), (f, side * (hx + 0.03), zb + hh), (side, 0, 0), 0.14, 0.14, 'post')
        for fe in (f0, f1):
            for y0, y1 in zip(np.linspace(-hx, hx, 5)[:-1], np.linspace(-hx, hx, 5)[1:]):
                c = np.array((fe, (y0 + y1) / 2, zb + hh / 2))
                mb.obox(c + (0, 0, -hh * 0.3), (0, 1, 0), (0, 0, 1), y1 - y0, hh * 0.4, 0.1, 'shield')
                mb.obox(c + (0, 0, hh * 0.2), (0, 1, 0), (0, 0, 1), y1 - y0, hh * 0.6, 0.1, 'plaster')
                mb.beam((fe, y0, zb), (fe, y0, zb + hh), (1, 0, 0), 0.14, 0.14, 'post')
        mb.obox(((f0 + f1) / 2, 0, zb + hh + 0.06), (1, 0, 0), (0, 1, 0), f1 - f0 + 0.3, 2 * hx + 0.3, 0.14, 'rail')
        top_store = n == len(Y['tower']) - 1
        rise = 1.5 if top_store else 0.9
        over = 0.9 if n == 0 else 0.7
        if top_store:
            hip_roof(mb, f0, f1, hx, zb + hh + 0.1, rise, over, 'tile', tile=True)
        else:
            # skirt roof (koshi-yane) around the storey; the next storey stands on it
            nxt = Y['tower'][n + 1]
            for s in (1, -1):
                A = np.array([(f, s * (hx + over), zb + hh + 0.1) for f in np.linspace(f0 - over, f1 + over, 12)])
                B = np.array([(f, s * nxt[2], zb + hh + rise) for f in np.linspace(f0 - over * 0.2, f1 + over * 0.2, 12)])
                mb.board(A, B, 0.12, 'tile', rows=3, out=lambda p: (0, 0, 1))
                n_t = int((f1 - f0 + 2 * over) / 0.3)
                for i in range(n_t + 1):
                    t = i / n_t
                    e = np.array((lerp(f0 - over, f1 + over, t), s * (hx + over), zb + hh + 0.18))
                    r = np.array((lerp(f0 - over * 0.2, f1 + over * 0.2, t), s * nxt[2], zb + hh + rise + 0.05))
                    mb.cyl(e, lerp(e, r, 0.9), 0.05, 0.05, 'tile', seg=5, cap=False)
            for e in (-1, 1):
                fe = f1 if e > 0 else f0
                A = np.array([(fe + e * over, y, zb + hh + 0.1) for y in np.linspace(-hx - over, hx + over, 8)])
                B = np.array([(fe + e * over * 0.2, y * nxt[2] / (hx + over), zb + hh + rise) for y in np.linspace(-hx - over, hx + over, 8)])
                mb.board(A, B, 0.12, 'tile', rows=3, out=lambda p: (0, 0, 1))
            zb = zb + hh + rise - 0.05
            continue
    return mb


def house(H, Y):
    """Small deckhouse on the seki: board walls, a gabled board roof"""
    mb = MB()
    if 'house' not in Y:
        return mb
    f0, f1, hx, hh = Y['house']
    zt = floor_z(H, Y, (f0 + f1) / 2) + Y['gap'] + sum(th for th, _ in Y['tiers']) + 0.07
    for side in (1, -1):
        for fa, fb in zip(np.linspace(f0, f1, 4)[:-1], np.linspace(f0, f1, 4)[1:]):
            c = np.array(((fa + fb) / 2, side * hx, zt + hh / 2))
            panel(mb, c, (side, 0, 0) if False else (1, 0, 0), (0, 0, 1), fb - fa - 0.1, hh, 0.07, 'shield', [(0.0, 0.2, 'round', 0.06)])
        for f in np.linspace(f0, f1, 4):
            mb.beam((f, side * hx, zt), (f, side * hx, zt + hh), (1, 0, 0), 0.12, 0.12, 'post')
    for fe in (f0, f1):
        mb.obox((fe, 0, zt + hh / 2), (0, 1, 0), (0, 0, 1), 2 * hx, hh, 0.07, 'shield')
        g = [(fe, -hx - 0.3, zt + hh), (fe, hx + 0.3, zt + hh), (fe, 0, zt + hh + 0.9)]
        mb.add(g, [(0, 1, 2), (2, 1, 0)], 'shield')
    for s in (1, -1):
        A = np.array([(f, s * (hx + 0.45), zt + hh - 0.05) for f in np.linspace(f0 - 0.4, f1 + 0.4, 8)])
        B = np.array([(f, 0, zt + hh + 0.95) for f in np.linspace(f0 - 0.4, f1 + 0.4, 8)])
        mb.board(A, B, 0.06, 'roof', rows=2, out=lambda p: (0, 0, 1))
    mb.beam((f0 - 0.5, 0, zt + hh + 0.98), (f1 + 0.5, 0, zt + hh + 0.98), (0, 0, 1), 0.16, 0.14, 'rail')
    return mb


def half_bulwark(H, Y):
    """Kobaya: low boards (hangaki) along the gunwale with notches for the oars"""
    mb = MB()
    if H.kind != 'kobaya':
        return mb
    th = Y['tiers'][0][0]
    for side in (1, -1):
        fs = np.linspace(Y['y0'], Y['y1'], 14)
        for fa, fb in zip(fs[:-1], fs[1:]):
            pa = np.array((fa, side * (H.sheer(fa)[0] - 0.02), H.sheer(fa)[1] + 0.12))
            pb = np.array((fb, side * (H.sheer(fb)[0] - 0.02), H.sheer(fb)[1] + 0.12))
            u = nrm(pb - pa) * (1 if side > 0 else -1)
            c = (pa + pb) / 2 + np.array((0, 0, th / 2))
            panel(mb, c, u, (0, 0, 1), np.linalg.norm(pb - pa) - 0.06, th, 0.05, 'shield', [(0.0, 0.1, 'slot', 0.035)])
        for f in fs:
            p = np.array((f, side * (H.sheer(f)[0] - 0.05), H.sheer(f)[1]))
            mb.beam(p, p + (0, 0, th + 0.15), (side, 0, 0), 0.09, 0.09, 'post')
        top = np.array([(f, side * (H.sheer(f)[0] - 0.03), H.sheer(f)[1] + th + 0.14) for f in np.linspace(Y['y0'], Y['y1'], 30)])
        mb.tube(top, 0.045, 'rail', seg=6)
    return mb


def mast_step(H, Y):
    """Tabernacle at the mast foot (the mast pivots aft here to be lowered for battle)"""
    mb = MB()
    f = Y['mast_f']
    zt = floor_z(H, Y, f) + Y['gap'] + sum(th for th, _ in Y['tiers']) if H.kind != 'kobaya' else H.deck_z(f)
    k = H.B / 7.4 + 0.2
    for s in (1, -1):
        mb.obox((f, s * 0.32 * k, zt + 0.6 * k), (1, 0, 0), (0, 1, 0), 0.5 * k, 0.16 * k, 1.2 * k, 'rail')
    mb.cyl((f, -0.45 * k, zt + 0.95 * k), (f, 0.45 * k, zt + 0.95 * k), 0.06 * k, 0.06 * k, 'iron', seg=8)
    return mb


# ---- separate moving parts (their own objects, each in its own frame) ----------------------------------------
def mast_parts(H, Y):
    """Mast in its own frame: foot at the origin, up +z; pivot (for lowering) at the origin"""
    mb = MB()
    h = Y['mast_h']
    r0 = 0.012 * h + 0.06
    n = 8
    for i in range(n):
        t0, t1 = i / n, (i + 1) / n
        mb.cyl((0, 0, h * t0), (0, 0, h * t1), lerp(r0, r0 * 0.6, t0), lerp(r0, r0 * 0.6, t1), 'post', seg=12, cap=i in (0, n - 1))
    for z in np.arange(1.2, h * 0.5, 1.1):
        t = z / h
        mb.cyl((0, 0, z - 0.03), (0, 0, z + 0.03), lerp(r0, r0 * 0.6, t) + 0.012, lerp(r0, r0 * 0.6, t) + 0.012, 'rope', seg=12)
    mb.obox((-0.2, 0, h - 0.5), (1, 0, 0), (0, 1, 0), r0 * 1.6, r0 * 1.4, 0.7, 'rail')
    return mb


def yard_parts(H, Y):
    mb = MB()
    L = Y['yard_l'] / 2
    r = 0.01 * Y['yard_l'] + 0.05
    pts = [(0, x, 0.02 * (x / L) ** 2 * 6) for x in np.linspace(-L, L, 14)]
    radii = [lerp(r, r * 0.55, abs(x) / L) for x in np.linspace(-L, L, 14)]
    mb.tube(pts, r, 'post', seg=10, radii=radii)
    for x in np.arange(-0.8, 0.85, 0.2):
        mb.cyl((0, x - 0.04, 0), (0, x + 0.04, 0), r * 1.35, r * 1.35, 'rope', seg=10)
    return mb


def rudder_parts(H, Y):
    """Rudder in its own frame: stock along +z through the origin, blade aft (-f), tiller forward"""
    mb = MB()
    k = H.D / 3.0
    z_lo, z_hi = -H.T - 0.5 * k, H.sheer(H.f_range()[0] + 0.5)[1] + 0.6 * k
    mb.cyl((0, 0, z_lo), (0, 0, z_hi), 0.16 * k + 0.04, 0.13 * k + 0.03, 'post', seg=12)
    blade_top = 0.3 * k + 0.4
    nb = 6
    chord = 2.6 * k + 0.4
    for j in range(nb):
        f0 = -0.12 - j * chord / nb
        f1 = f0 - chord / nb + 0.004
        lo = [(f0, -0.08, z_lo), (f1, -0.08, z_lo), (f1, 0.08, z_lo), (f0, 0.08, z_lo)]
        hi = [(f0, -0.08, blade_top), (f1, -0.08, blade_top), (f1, 0.08, blade_top), (f0, 0.08, blade_top)]
        mb.hexa(lo + hi, 'tar' if j else 'post')
    for z in np.linspace(z_lo + 0.3, blade_top - 0.2, 3):
        for s in (-1, 1):
            mb.obox((-chord / 2 - 0.1, s * 0.1, z), (1, 0, 0), (0, 0, 1), chord, 0.12, 0.05, 'rail')
    mb.beam((0, 0, z_hi - 0.2), (2.2 * k + 0.6, 0, z_hi - 0.2), (0, 0, 1), 0.12, 0.14, 'rail')
    return mb


def rudder_pivot(H):
    f_w, _ = H.end_at(0.0)
    return np.array((f_w - 0.3 * H.D / 3 - 0.2, 0.0, 0.0)), H.stern_rake


def oar_parts(H, Y):
    """One oar (ro) in its own frame: the thole at the origin, loom inboard (-x), blade outboard (+x) and a little down.
    Japanese ro are two pieces: a long straight loom and a broad blade scarfed on at an angle"""
    mb = MB()
    L = H.oar_len
    inb = L * 0.3
    r = 0.028 + 0.004 * L
    mb.cyl((0, -inb, 0), (0, L * 0.45, 0), r, r * 0.9, 'post', seg=8)
    a = np.array((0, L * 0.42, 0))
    b = np.array((0, L * 0.7, -L * 0.035))
    w = 0.1 + 0.018 * L
    A = np.array([lerp(a, b, t) + (w / 2 * min(1, t * 3), 0, 0) for t in np.linspace(0, 1, 6)])
    Bv = np.array([lerp(a, b, t) - (w / 2 * min(1, t * 3), 0, 0) for t in np.linspace(0, 1, 6)])
    mb.board(A, Bv, 0.03, 'post', rows=1, out=lambda p: (0, 0, 1))
    mb.cyl((0, -inb + 0.02, 0), (0, -inb + 0.02, 0.28), 0.025, 0.025, 'post', seg=6)
    return mb


# ---- guns (placeholders until bake/guns.py makes the real ones) ------------------------------------------------
def gun_mounts(H, Y):
    """Points behind the bow gun ports: (f, x, z) of the muzzle's rest position"""
    if not Y['guns']:
        return []
    fe = Y['y1']
    xe = box_x(H, Y, fe)
    w = 2 * xe - 0.12
    ng = Y['guns']
    z = floor_z(H, Y, fe) + Y['gap'] + Y['tiers'][0][0] / 2 - 0.05
    return [(fe - 0.1, (g - (ng - 1) / 2) * min(1.6, w / (ng + 0.5)), z) for g in range(ng)]


def oar_tholes(H, Y):
    """Thole points along each side (f, x, z), port side first"""
    f0, f1 = Y['oar_f']
    n = H.oars
    out = []
    for side in (1, -1):
        for f in np.linspace(f0, f1, n):
            if H.kind == 'kobaya':
                out.append((float(f), float(side * (H.sheer(f)[0] + 0.02)), float(H.sheer(f)[1] + 0.2)))
            else:
                out.append((float(f), float(side * (box_x(H, Y, f) + 0.02)), float(floor_z(H, Y, f) + 0.12)))
    return out


def hull_all(H):
    Y = layout(H)
    mb = MB()
    parts = [planking(H), bottom(H), deck(H, Y), beams(H, Y), wale(H), ledge(H, Y), shield_wall(H, Y) if H.kind != 'kobaya' else MB(),
             top_deck(H, Y), tower(H, Y), house(H, Y), half_bulwark(H, Y), mast_step(H, Y), transom(H)]
    if H.STEM is not None:
        parts.append(stem(H))
    else:
        parts.append(transom(H, bow=True))
    for p in parts:
        mb.extend(p)
    return mb, Y
