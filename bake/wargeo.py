"""Hull geometry of the three Sengoku warship types, in ship coordinates (plain numpy, no Blender).
Ship coordinates: f = forward (m, + toward the bow), x = lateral (+ = port), z = up (0 = design waterline).

Every hull is the same Japanese build as shiomachi's bezaisen: a flat bottom (kawara) and three strakes a side
(nedana, nakadana, uwadana), no keel. The four edge curves (bottom edge, then the top edge of each strake) are
taken from the bezaisen drawing, normalised, and rescaled to each type's length, beam, depth and draught.
  atake  : Ise-bune type with a box bow (todate-zukuri): the stern's flat raked transom is repeated at the bow
  seki   : a single stem (ippon-mioshi), long and narrow
  kobaya : a small open boat with a stem
Sizes are in ref/REF.md with their sources.
"""
import math

import numpy as np

# bezaisen edge curves (shiomachi/bake/shipgeo.py), port side, (f, x, z)
_BEZ = [
    [(-8.8, 0.40, -1.15), (-6.0, 0.58, -1.36), (-2.0, 0.64, -1.44), (2.0, 0.64, -1.44), (5.5, 0.52, -1.32), (8.6, 0.16, -0.90)],
    [(-9.3, 1.50, -0.20), (-6.0, 2.05, -0.56), (-2.0, 2.30, -0.64), (2.0, 2.30, -0.63), (5.5, 1.92, -0.42), (8.6, 1.00, 0.18), (10.5, 0.20, 1.10)],
    [(-9.9, 2.35, 1.05), (-6.0, 3.10, 0.64), (-2.0, 3.35, 0.54), (2.0, 3.32, 0.57), (5.5, 2.88, 0.78), (9.0, 1.72, 1.48), (11.8, 0.22, 2.40)],
    [(-10.8, 2.72, 3.45), (-7.0, 3.55, 2.02), (-2.0, 3.72, 1.58), (2.0, 3.69, 1.60), (6.0, 3.22, 1.94), (9.5, 2.02, 2.68), (13.0, 0.24, 3.60)],
]
_BEZ_STEM = ((8.2, -1.25), (14.4, 4.85))
_BEZ_BOT, _BEZ_MIDX = -1.44, 3.72          # bottom height and half-breadth at the sheer, midships
_BEZ_D = 1.58 - _BEZ_BOT                    # depth to the sheer, midships


# ---- the three types --------------------------------------------------------------------------------------
# L: length along the sheer (stern end to bow end, without the stem head), B: beam at the sheer, D: depth
# (bottom to sheer, midships), T: draught. sweep: how much of the bezaisen's sheer rise at the ends is kept
# (Sengoku warships sit flatter). Oars per side, oar length and spacing come from the references.
KINDS = {
    'atake': dict(L=28.0, B=9.4, D=3.0, T=1.35, bow='todate', sweep=0.65, oars=38, oar_len=7.6, beam_step=1.6),
    'seki': dict(L=20.5, B=5.0, D=1.8, T=0.8, bow='mioshi', sweep=0.95, oars=22, oar_len=6.4, beam_step=1.25),
    'kobaya': dict(L=11.0, B=2.5, D=1.05, T=0.42, bow='mioshi', sweep=1.0, oars=8, oar_len=5.2, beam_step=1.0),
}


def catmull(ctrl, n):
    """Centripetal Catmull-Rom through the control points, n samples uniform in chord length"""
    P = np.asarray(ctrl, float)
    P = np.vstack([2 * P[0] - P[1], P, 2 * P[-1] - P[-2]])
    d = np.linalg.norm(np.diff(P, axis=0), axis=1) ** 0.5
    t = np.concatenate([[0], np.cumsum(d)])
    dense = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1:i + 3]
        t0, t1, t2, t3 = t[i - 1:i + 3]
        for u in np.linspace(t1, t2, 40, endpoint=False):
            a1 = (t1 - u) / (t1 - t0) * p0 + (u - t0) / (t1 - t0) * p1
            a2 = (t2 - u) / (t2 - t1) * p1 + (u - t1) / (t2 - t1) * p2
            a3 = (t3 - u) / (t3 - t2) * p2 + (u - t2) / (t3 - t2) * p3
            b1 = (t2 - u) / (t2 - t0) * a1 + (u - t0) / (t2 - t0) * a2
            b2 = (t3 - u) / (t3 - t1) * a2 + (u - t1) / (t3 - t1) * a3
            dense.append((t2 - u) / (t2 - t1) * b1 + (u - t1) / (t2 - t1) * b2)
    dense.append(P[-2])
    D = np.array(dense)
    s = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(D, axis=0), axis=1))])
    su = np.linspace(0, s[-1], n)
    return np.stack([np.interp(su, s, D[:, k]) for k in range(3)], -1)


class Hull:
    def __init__(self, kind):
        self.kind = kind
        k = KINDS[kind]
        self.__dict__.update(k)
        if k['bow'] == 'todate':
            # repeat the stern (first three control points) mirrored at the bow: a symmetric box-ended hull
            src = []
            for E in _BEZ:
                aft = [p for p in E if p[0] < -1.0]
                src.append(aft + [(-f, x, z) for f, x, z in reversed(aft)])
            f0, f1 = -10.8, 10.8
        else:
            src = [list(E) for E in _BEZ]
            f0, f1 = -10.8, 13.0
        sf = self.L / (f1 - f0)
        fc = (f0 + f1) / 2
        sx = (self.B / 2) / _BEZ_MIDX
        sz = self.D / _BEZ_D
        z_mid = 1.58

        def tr(p):
            f, x, z = p
            zz = z
            if z > z_mid:        # soften the sheer rise at the ends
                zz = z_mid + (z - z_mid) * self.sweep
            return ((f - fc) * sf, x * sx, (zz - _BEZ_BOT) * sz - self.T)
        self.EDGES = [[tr(p) for p in E] for E in src]
        self.EDGE_PTS = [catmull(e, 120) for e in self.EDGES]
        if k['bow'] == 'mioshi':
            (a, b), (c, d) = _BEZ_STEM
            (_, _, za), (_, _, zb) = tr((a, 0, b)), tr((c, 0, d))
            self.STEM = (((a - fc) * sf, za), ((c - fc) * sf, zb))
        else:
            self.STEM = None
        self.thick = float(np.clip(0.11 * math.sqrt(self.B / 7.44), 0.045, 0.12))     # plank thickness
        self.deck_drop = 0.5 * sz
        self.stern_rake = self._rake(0)
        self.bow_rake = self._rake(-1) if self.STEM is None else None

    def _rake(self, i):
        (fa, _, za), (fb, _, zb) = self.EDGES[0][i], self.EDGES[3][i]
        return math.atan2(abs(fb - fa), zb - za)

    # ---- queries (same meaning as shiomachi's shipgeo) ----
    def edge_at(self, k, f):
        E = self.EDGE_PTS[k]
        return float(np.interp(f, E[:, 0], E[:, 1])), float(np.interp(f, E[:, 0], E[:, 2]))

    def sheer(self, f):
        return self.edge_at(3, f)

    def hull_x(self, f, z):
        pts = [self.edge_at(k, f) for k in range(4)]
        for (x0, z0), (x1, z1) in zip(pts, pts[1:]):
            if z <= z1:
                t = np.clip((z - z0) / max(z1 - z0, 1e-6), 0, 1)
                return x0 + (x1 - x0) * t
        return pts[-1][0]

    def deck_z(self, f):
        return self.sheer(f)[1] - self.deck_drop

    def f_range(self, k=3):
        E = self.EDGE_PTS[k]
        return float(E[0, 0]), float(E[-1, 0])

    def stem_point(self, z):
        (f0, z0), (f1, z1) = self.STEM
        return f0 + (f1 - f0) * (z - z0) / (z1 - z0)

    def end_at(self, z, bow=False):
        """(f, x) of a transom's side edge at height z (the stern, or the box bow)"""
        i = -1 if bow else 0
        ends = [self.EDGE_PTS[k][i] for k in range(4)]
        zs = [e[2] for e in ends]
        return float(np.interp(z, zs, [e[0] for e in ends])), float(np.interp(z, zs, [e[1] for e in ends]))

    def stations(self, n=40):
        """Sections for buoyancy: (f, [(x, z) edge points from the bottom up])"""
        a, b = self.EDGE_PTS[0][0, 0], self.EDGE_PTS[0][-1, 0]
        fs = np.linspace(a + 0.1, b - 0.1, n)
        return [(float(f), [self.edge_at(k, f) for k in range(4)]) for f in fs]

    def waterplane(self):
        """Half-breadth at the waterline along the length, for the wake footprint"""
        a, b = self.f_range(0)
        fs = np.linspace(a, b, 32)
        return [(float(f), float(self.hull_x(f, 0.0))) for f in fs]


if __name__ == '__main__':
    for kd in KINDS:
        H = Hull(kd)
        st = H.stations(48)
        ds = st[1][0] - st[0][0]
        vol = 0.0
        for f, pts in st:
            # area of the section below the waterline (trapezoids between the edges, both sides)
            prev = None
            area = 0.0
            for x, z in pts:
                if prev is not None:
                    (x0, z0), (x1, z1) = prev, (x, z)
                    za, zb = min(z0, 0), min(z1, 0)
                    if zb > za:
                        area += (x0 + x1) * (zb - za)
                prev = (x, z)
            area += 2 * pts[0][0] * 0.0
            vol += area * ds
        a, b = H.f_range()
        print(kd, 'sheer f %.1f..%.1f' % (a, b), 'mid half-breadth %.2f' % H.sheer(0)[0], 'sheer z %.2f' % H.sheer(0)[1],
              'end z %.2f / %.2f' % (H.sheer(a + 0.01)[1], H.sheer(b - 0.01)[1]), 'displacement ~%.0f t' % (vol * 1.025))
