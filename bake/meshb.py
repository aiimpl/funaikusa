"""A small mesh accumulator: collect boxes, boards, tubes and lathes in ship coordinates (f, x, z),
then turn them into one Blender object with material slots. Ship coordinates map to Blender as (x, -f, z)
(forward is -Y, which the glTF exporter turns into +Z in three.js)."""
import math

import numpy as np

BOX_FACES = ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7))


def nrm(v):
    v = np.asarray(v, float)
    return v / max(np.linalg.norm(v), 1e-9)


def planar_uv(pts, k=1.0):
    P = np.asarray(pts, float)
    e = P[1] - P[0]
    n = np.cross(P[1] - P[0], P[-1] - P[0])
    if np.linalg.norm(n) < 1e-12 or np.linalg.norm(e) < 1e-12:
        return tuple((0.0, 0.0) for _ in pts)
    u = nrm(e); w = nrm(np.cross(nrm(n), u))
    return tuple((float(np.dot(p - P[0], u)) * k, float(np.dot(p - P[0], w)) * k) for p in P)


class MB:
    def __init__(self):
        self.v, self.f, self.m, self.uv, self.tone = [], [], [], [], []
        self.gid = 0
        self.rng = np.random.default_rng(len(self.v) + 1234)          # island counter: every island gets its own far-away UV offset so none can touch another

    def add(self, verts, faces, mat, uvs=None, uvk=1.0, groups=None):
        """uvs: per face, a tuple of (u, v) in metres for each corner. Missing ones get a planar projection of that face
        (its own island). uvk scales the auto projection (small for faces that are never seen)"""
        b = len(self.v)
        verts = [tuple(map(float, p)) for p in verts]
        self.v.extend(verts)
        # every piece of timber gets its own tone (r: brightness, g: grey/brown, b: stain), constant over the piece
        t = tuple(self.rng.random(3))
        self.tone.extend([t] * len(verts))
        base = self.gid
        self.gid += ((max(groups) + 1) if groups else 1) if uvs is not None else 0
        for n, fc in enumerate(faces):
            self.f.append(tuple(i + b for i in fc))
            self.m.append(mat)
            uv = uvs[n] if uvs is not None and n < len(uvs) and uvs[n] is not None else None
            if uv is None:
                uv = planar_uv([verts[i] for i in fc], uvk)
                g = self.gid; self.gid += 1
            else:
                g = base + (groups[n] if groups is not None else 0)
            ox = (g % 1000) * 64.0; oy = (g // 1000) * 64.0
            self.uv.append(tuple((u + ox, v + oy) for u, v in uv))

    def hexa(self, pts, mat):
        """8 corners: bottom 4 then top 4 (same order)"""
        self.add(pts, BOX_FACES, mat)

    def obox(self, c, u, v, su, sv, sw, mat):
        """Box centred at c with edge axes u, v (w = u x v) and sizes su, sv, sw"""
        c, u = np.asarray(c, float), nrm(u)
        v = nrm(np.asarray(v, float) - np.dot(v, u) * u)
        w = np.cross(u, v)
        pts = []
        for sz in (-1, 1):
            for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                pts.append(c + u * sx * su / 2 + v * sy * sv / 2 + w * sz * sw / 2)
        self.hexa(pts, mat)

    def beam(self, p0, p1, up, wd, ht, mat, ext=0.0):
        """Rectangular timber from p0 to p1; ht is measured along 'up', wd across"""
        p0, p1 = np.asarray(p0, float), np.asarray(p1, float)
        u = nrm(p1 - p0)
        L = np.linalg.norm(p1 - p0) + 2 * ext
        up = nrm(np.asarray(up, float) - np.dot(up, u) * u)
        side = np.cross(u, up)
        self.obox((p0 + p1) / 2, u, side, L, wd, ht, mat)

    def cyl(self, p0, p1, r0, r1, mat, seg=12, cap=True, ref=None):
        p0, p1 = np.asarray(p0, float), np.asarray(p1, float)
        a = nrm(p1 - p0)
        ref = np.asarray(ref if ref is not None else ((0, 0, 1) if abs(a[2]) < 0.9 else (1, 0, 0)), float)
        e1 = nrm(np.cross(a, ref)); e2 = np.cross(a, e1)
        V, F = [], []
        for p, r in ((p0, r0), (p1, r1)):
            for i in range(seg):
                t = 2 * math.pi * i / seg
                V.append(p + r * (math.cos(t) * e1 + math.sin(t) * e2))
        L = float(np.linalg.norm(p1 - p0))
        rm = max(r0, r1)
        UV = []
        for i in range(seg):
            j = (i + 1) % seg
            F.append((i, j, seg + j, seg + i))
            u0, u1 = 2 * math.pi * rm * i / seg, 2 * math.pi * rm * (i + 1) / seg
            UV.append(((u0, 0), (u1, 0), (u1, L), (u0, L)))
        if cap:
            F.append(tuple(range(seg))[::-1]); F.append(tuple(range(seg, 2 * seg)))
        self.add(V, F, mat, UV)

    def tube(self, pts, r, mat, seg=8, cap=True, radii=None):
        """Tube along a polyline with parallel-transported rings"""
        P = np.asarray(pts, float)
        n = len(P)
        T = [nrm(P[min(i + 1, n - 1)] - P[max(i - 1, 0)]) for i in range(n)]
        ref = np.array((0, 0, 1.0)) if abs(T[0][2]) < 0.9 else np.array((1.0, 0, 0))
        e1 = nrm(np.cross(T[0], ref))
        V, F = [], []
        for i in range(n):
            if i:
                e1 = nrm(e1 - np.dot(e1, T[i]) * T[i])
            e2 = np.cross(T[i], e1)
            rr = radii[i] if radii is not None else r
            for k in range(seg):
                t = 2 * math.pi * k / seg
                V.append(P[i] + rr * (math.cos(t) * e1 + math.sin(t) * e2))
        Ls = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(P, axis=0), axis=1))])
        rm = max(radii) if radii is not None else r
        UV = []
        for i in range(n - 1):
            for k in range(seg):
                a, b = i * seg + k, i * seg + (k + 1) % seg
                F.append((a, b, b + seg, a + seg))
                u0, u1 = 2 * math.pi * rm * k / seg, 2 * math.pi * rm * (k + 1) / seg
                UV.append(((u0, Ls[i]), (u1, Ls[i]), (u1, Ls[i + 1]), (u0, Ls[i + 1])))
        if cap:
            F.append(tuple(range(seg))[::-1]); F.append(tuple(range((n - 1) * seg, n * seg)))
        self.add(V, F, mat, UV)

    def lathe(self, prof, c, axis, mat, seg=16, ref=None):
        """Surface of revolution: prof is [(radius, distance along axis)], closed at radius-0 ends"""
        c, a = np.asarray(c, float), nrm(axis)
        ref = np.asarray(ref if ref is not None else ((0, 0, 1) if abs(a[2]) < 0.9 else (1, 0, 0)), float)
        e1 = nrm(np.cross(a, ref)); e2 = np.cross(a, e1)
        V, F = [], []
        for r, t in prof:
            for k in range(seg):
                q = 2 * math.pi * k / seg
                V.append(c + a * t + r * (math.cos(q) * e1 + math.sin(q) * e2))
        rm = max(r for r, _ in prof)
        pl = np.concatenate([[0], np.cumsum([math.hypot(prof[i + 1][0] - prof[i][0], prof[i + 1][1] - prof[i][1]) for i in range(len(prof) - 1)])])
        UV = []
        for i in range(len(prof) - 1):
            for k in range(seg):
                p, q = i * seg + k, i * seg + (k + 1) % seg
                F.append((p, q, q + seg, p + seg))
                u0, u1 = 2 * math.pi * rm * k / seg, 2 * math.pi * rm * (k + 1) / seg
                UV.append(((u0, pl[i]), (u1, pl[i]), (u1, pl[i + 1]), (u0, pl[i + 1])))
        F.append(tuple(range(seg))[::-1]); F.append(tuple(range((len(prof) - 1) * seg, len(prof) * seg)))
        self.add(V, F, mat, UV)

    def board(self, A, B, thick, mat, rows=2, out=None, inner_k=0.5, outer_k=1.0):
        """Plank between two polylines A (one long edge) and B (the other), thickness pushed away from 'out'
        (a function p -> outward unit vector) or, if None, along -normal of the A->B surface."""
        A, B = np.asarray(A, float), np.asarray(B, float)
        n = len(A)
        S = np.stack([A + (B - A) * (j / rows) for j in range(rows + 1)], 1)     # n x rows+1 x 3
        V = []
        for i in range(n):
            ta = S[min(i + 1, n - 1), 0] - S[max(i - 1, 0), 0]
            for j in range(rows + 1):
                nn = nrm(np.cross(ta, B[i] - A[i]))
                if out is not None and np.dot(nn, out(S[i, j])) < 0:
                    nn = -nn
                V.append(S[i, j])
                V.append(S[i, j] - nn * thick)
        idx = lambda i, j, s: (i * (rows + 1) + j) * 2 + s
        # surface coordinates: along = arc length of the mid line, across = distance from A
        M = (A + B) / 2
        al = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(M, axis=0), axis=1))])
        wd = np.linalg.norm(B - A, axis=1)
        uvo = lambda i, j: (float(al[i]) * outer_k, float(wd[i] * j / rows) * outer_k)
        uvi = lambda i, j: (float(al[i]) * inner_k, float(wd[i] * j / rows) * inner_k)
        F, UV, GR = [], [], []
        for i in range(n - 1):
            for j in range(rows):
                F.append((idx(i, j, 0), idx(i + 1, j, 0), idx(i + 1, j + 1, 0), idx(i, j + 1, 0)))
                UV.append((uvo(i, j), uvo(i + 1, j), uvo(i + 1, j + 1), uvo(i, j + 1))); GR.append(0)
                F.append((idx(i, j, 1), idx(i, j + 1, 1), idx(i + 1, j + 1, 1), idx(i + 1, j, 1)))
                UV.append((uvi(i, j), uvi(i, j + 1), uvi(i + 1, j + 1), uvi(i + 1, j))); GR.append(1)
            for j, s in ((0, 0), (rows, 1)):
                a, b = idx(i, j, 0), idx(i + 1, j, 0)
                F.append((a, idx(i, j, 1), idx(i + 1, j, 1), b))
                UV.append(((float(al[i]), 0.0), (float(al[i]), thick), (float(al[i + 1]), thick), (float(al[i + 1]), 0.0))); GR.append(2 + s)
        for i in (0, n - 1):
            for j in range(rows):
                F.append((idx(i, j, 0), idx(i, j + 1, 0), idx(i, j + 1, 1), idx(i, j, 1)))
                UV.append(None); GR.append(0)
        self.add(V, F, mat, UV, groups=GR)

    def extend(self, other):
        b = len(self.v)
        self.v.extend(other.v)
        self.f.extend([tuple(i + b for i in fc) for fc in other.f])
        self.m.extend(other.m)
        self.uv.extend(other.uv)
        self.tone.extend(other.tone)


def to_blender(v):
    f, x, z = v
    return (x, -f, z)


def build(name, mb, mats, sharp_deg=38, origin=(0, 0, 0)):
    """Make a Blender object from an accumulator. mats maps material names to bpy materials"""
    import bmesh
    import bpy
    names = sorted(set(mb.m))
    me = bpy.data.meshes.new(name)
    o = np.asarray(origin, float)
    me.from_pydata([to_blender(np.asarray(p) - o) for p in mb.v], [], mb.f)
    for nme in names:
        me.materials.append(mats[nme])
    for p, mn in zip(me.polygons, mb.m):
        p.material_index = names.index(mn)
    uvl = me.uv_layers.new(name='uv')
    flat = [c for uv in mb.uv for c in uv]
    uvl.data.foreach_set('uv', np.asarray(flat, np.float32).ravel())
    ca = me.color_attributes.new(name='tone', type='FLOAT_COLOR', domain='POINT')
    ca.data.foreach_set('color', np.concatenate([np.asarray(mb.tone, np.float32), np.ones((len(mb.tone), 1), np.float32)], 1).ravel())
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    me.validate()
    me.shade_smooth()
    me.set_sharp_from_angle(angle=math.radians(sharp_deg))
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob
