"""Noshima castle (the sea castle of the Noshima Murakami): palisades, buildings, a watch tower and the landing.
  blender -b --factory-startup -P bake/castle.py -- preview <out dir>
  blender -b --factory-startup -P bake/castle.py -- bake <web/data> <build/check> [texture size]
What the excavations found (ref/NOSHIMA.md): the island cut into terraces, hon-maru on top with a small earth-fast
post building (probably a lookout), ni-no-maru round it with nine earth-fast post buildings, san-no-maru to the east
with the only building on stone footings (a store) and a smithy, a landing beach on the north side (the tide runs
slowest there), and hundreds of post holes cut in the rock shelves for piers and mooring posts. No stone walls:
a castle of earth and timber. The palisades, the gate and the heights of the buildings are drawn, not found.
Positions use the terrain function in islands.py, so everything stands on the ground the game draws.
MB coordinates here are (f, x, z) = (world z, world x, height) so the export lands in three.js world axes directly.
"""
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bakelib as K  # noqa: E402
import blib as B  # noqa: E402
import meshb  # noqa: E402
from islands import castle_island  # noqa: E402
from meshb import MB  # noqa: E402

rng = np.random.default_rng(3)


def H(x, z):
    return float(castle_island(np.array([[x]], float), np.array([[z]], float))[0, 0])


def P(x, z, dy=0.0):
    """MB point on the ground at world (x, z)"""
    return np.array((z, x, H(x, z) + dy))


def edge_ring(level, cx=0.0, cz=0.0, n=72, rmax=140):
    """Points on the terrace edge at a level: walk out from the centre until the ground drops below it"""
    pts = []
    for k in range(n):
        a = 2 * math.pi * k / n
        dx, dz = math.cos(a), math.sin(a)
        r = 2.0
        while r < rmax and H(cx + dx * r, cz + dz * r) >= level - 0.3:
            r += 0.5
        pts.append((cx + dx * (r - 1.2), cz + dz * (r - 1.2), a))
    return pts


def palisade(mb, ring, level, gaps=()):
    """Stakes (1.9 m, pointed) close together, two rails, braced every few metres; gaps (angle ranges) left open"""
    for i in range(len(ring)):
        x0, z0, a0 = ring[i]
        x1, z1, _ = ring[(i + 1) % len(ring)]
        if any(g0 <= a0 <= g1 for g0, g1 in gaps):
            continue
        L = math.hypot(x1 - x0, z1 - z0)
        n = max(1, int(L / 0.22))
        for k in range(n):
            t = (k + 0.5) / n
            x, z = x0 + (x1 - x0) * t, z0 + (z1 - z0) * t
            y = level
            h = 1.8 + rng.uniform(-0.12, 0.12)
            mb.cyl((z, x, y - 0.3), (z, x, y + h), 0.085, 0.07, 'post', seg=5, cap=False)
            mb.cyl((z, x, y + h), (z, x, y + h + 0.22), 0.07, 0.005, 'post', seg=5, cap=False)
        for hh in (0.55, 1.45):
            mb.beam((z0, x0, level + hh), (z1, x1, level + hh), (0, 0, 1), 0.07, 0.1, 'rail')
        if i % 4 == 0:
            ox, oz = x0 - math.cos(a0) * 1.0, z0 - math.sin(a0) * 1.0
            mb.beam((oz, ox, level - 0.1), (z0, x0, level + 1.4), (0, 0, 1), 0.1, 0.1, 'rail')


def building(mb, x, z, w, d, yaw, h=2.4, roof='board', walls='board', footing=False):
    """Earth-fast post building: posts every ~1.8 m, board walls with a door on the long side, a gabled roof of
    boards held down with poles and stones (or thatch). footing: stands on stones (the store in san-no-maru)"""
    c, s = math.cos(yaw), math.sin(yaw)
    loc = lambda u, v, y: np.array((z + u * s + v * c, x + u * c - v * s, y))    # u along the ridge, v across
    y0 = min(H(x + du, z + dv) for du in (-w / 2, w / 2) for dv in (-d / 2, d / 2)) + 0.05
    if footing:
        for u in np.linspace(-w / 2, w / 2, 5):
            for v in (-d / 2, d / 2):
                mb.obox(loc(u, v, y0 + 0.12), (s, c, 0), (c, -s, 0), 0.5, 0.5, 0.35, 'stone')
        y0 += 0.3
    # floor
    mb.obox(loc(0, 0, y0 + 0.35), (s, c, 0), (c, -s, 0), w, d, 0.1, 'deck')
    nu = max(2, int(round(w / 1.8)))
    for i in range(nu + 1):
        u = -w / 2 + w * i / nu
        for v in (-d / 2, d / 2):
            mb.beam(loc(u, v, y0 - 0.2), loc(u, v, y0 + h), (0, 0, 1), 0.16, 0.16, 'post')
    # walls between the posts (board, vertical), a door opening in the middle bay of the front
    for v in (-d / 2, d / 2):
        for i in range(nu):
            if v > 0 and i == nu // 2:
                continue
            u = -w / 2 + w * (i + 0.5) / nu
            mb.obox(loc(u, v, y0 + 0.4 + (h - 0.4) / 2), (s, c, 0), (0, 0, 1), w / nu - 0.14, h - 0.4, 0.05, 'shield' if walls == 'board' else 'plaster')
    for u in (-w / 2, w / 2):
        mb.obox(loc(u, 0, y0 + 0.4 + (h - 0.4) / 2), (c, -s, 0), (0, 0, 1), d - 0.14, h - 0.4, 0.05, 'shield' if walls == 'board' else 'plaster')
        # gable triangle
        g = [loc(u, -d / 2 - 0.1, y0 + h), loc(u, d / 2 + 0.1, y0 + h), loc(u, 0, y0 + h + d * 0.42)]
        mb.add([tuple(q) for q in g], [(0, 1, 2), (2, 1, 0)], 'shield')
    # roof: two slopes with an overhang
    over = 0.6
    for sv in (-1, 1):
        A = np.array([loc(u, sv * (d / 2 + over), y0 + h - over * 0.42) for u in np.linspace(-w / 2 - 0.4, w / 2 + 0.4, 6)])
        Bp = np.array([loc(u, 0, y0 + h + d * 0.42 + 0.08) for u in np.linspace(-w / 2 - 0.4, w / 2 + 0.4, 6)])
        mb.board(A, Bp, 0.1 if roof == 'board' else 0.35, 'roof' if roof == 'board' else 'straw', rows=2, out=lambda p: (0, 0, 1))
        if roof == 'board':
            # weighting poles along the slope, with a few stones on them
            for t in (0.3, 0.7):
                p0, p1 = loc(-w / 2 - 0.3, sv * (d / 2 + over) * (1 - t), y0 + h - over * 0.42 + (d * 0.42 + over * 0.42) * t + 0.12), loc(w / 2 + 0.3, sv * (d / 2 + over) * (1 - t), y0 + h - over * 0.42 + (d * 0.42 + over * 0.42) * t + 0.12)
                mb.cyl(p0, p1, 0.06, 0.06, 'post', seg=6)
                for k in range(3):
                    q = p0 + (p1 - p0) * rng.uniform(0.1, 0.9)
                    mb.obox(q + (0, 0, 0.1), (1, 0, 0), (0, 1, 0), 0.25, 0.22, 0.18, 'stone')
    mb.cyl(loc(-w / 2 - 0.5, 0, y0 + h + d * 0.42 + 0.14), loc(w / 2 + 0.5, 0, y0 + h + d * 0.42 + 0.14), 0.1, 0.1, 'post', seg=6)


def tower(mb, x, z, w=3.2, h=7.5):
    """Watch tower (monomi-yagura) on hon-maru: four raked posts, cross braces, a boarded platform with a low wall and a roof"""
    y0 = H(x, z)
    top = y0 + h
    for sx in (-1, 1):
        for sz in (-1, 1):
            mb.beam((z + sz * w * 0.7, x + sx * w * 0.7, y0 - 0.3), (z + sz * w / 2, x + sx * w / 2, top + 1.6), (0, 0, 1), 0.2, 0.2, 'post')
    for y in (y0 + 2.2, y0 + 4.6):
        k = 0.7 - 0.2 * (y - y0) / h
        for a, b in (((-1, -1), (1, -1)), ((1, -1), (1, 1)), ((1, 1), (-1, 1)), ((-1, 1), (-1, -1))):
            mb.beam((z + a[1] * w * k, x + a[0] * w * k, y), (z + b[1] * w * k, x + b[0] * w * k, y), (0, 0, 1), 0.12, 0.14, 'rail')
    mb.obox((z, x, top), (1, 0, 0), (0, 1, 0), w + 0.4, w + 0.4, 0.14, 'deck')
    for sv in (-1, 1):
        mb.obox((z + sv * (w / 2 + 0.15), x, top + 0.55), (0, 1, 0), (0, 0, 1), w + 0.4, 1.0, 0.06, 'shield')
        mb.obox((z, x + sv * (w / 2 + 0.15), top + 0.55), (1, 0, 0), (0, 0, 1), w + 0.4, 1.0, 0.06, 'shield')
    for sv in (-1, 1):
        A = np.array([(z + zz, x + sv * (w / 2 + 0.7), top + 1.7) for zz in np.linspace(-w / 2 - 0.7, w / 2 + 0.7, 4)])
        Bp = np.array([(z + zz, x, top + 2.6) for zz in np.linspace(-w / 2 - 0.7, w / 2 + 0.7, 4)])
        mb.board(A, Bp, 0.08, 'roof', rows=2, out=lambda p: (0, 0, 1))
    # a ladder
    mb.beam((z + w * 0.9, x - 0.3, y0), (z + w / 2, x - 0.3, top), (0, 0, 1), 0.08, 0.08, 'rail')
    mb.beam((z + w * 0.9, x + 0.3, y0), (z + w / 2, x + 0.3, top), (0, 0, 1), 0.08, 0.08, 'rail')


def gate(mb, x, z, a, level):
    """A plain gate in the palisade: two posts, a cross beam, a small board roof"""
    t = np.array((math.cos(a + math.pi / 2), math.sin(a + math.pi / 2)))
    for s in (-1, 1):
        px, pz = x + t[0] * s * 1.3, z + t[1] * s * 1.3
        mb.beam((pz, px, level - 0.3), (pz, px, level + 3.0), (0, 0, 1), 0.24, 0.24, 'post')
    p0 = (z - t[1] * 1.8, x - t[0] * 1.8, level + 2.8)
    p1 = (z + t[1] * 1.8, x + t[0] * 1.8, level + 2.8)
    mb.beam(p0, p1, (0, 0, 1), 0.22, 0.26, 'rail')
    for sv in (-1, 1):
        d = np.array((math.sin(a), math.cos(a))) * sv
        A = np.array([(z + t[1] * u + d[1] * 0.8, x + t[0] * u + d[0] * 0.8, level + 3.0) for u in np.linspace(-2.2, 2.2, 4)])
        Bp = np.array([(z + t[1] * u, x + t[0] * u, level + 3.6) for u in np.linspace(-2.2, 2.2, 4)])
        mb.board(A, Bp, 0.06, 'roof', rows=1, out=lambda p: (0, 0, 1))


def landing(mb):
    """The north beach: a pier on posts out over the rock shelf, and rows of mooring posts in the rock (the post holes)"""
    # pier from the beach north-ward
    x0, z0 = -5.0, -86.0
    for i in range(14):
        z = z0 - i * 1.6
        for sx in (-1.4, 1.4):
            mb.cyl((z, x0 + sx, -3.0), (z, x0 + sx, 1.3), 0.13, 0.12, 'post', seg=6)
        mb.beam((z, x0 - 1.6, 1.25), (z, x0 + 1.6, 1.25), (0, 0, 1), 0.14, 0.16, 'rail')
    for sx in (-1.2, -0.4, 0.4, 1.2):
        mb.beam((z0 + 0.5, x0 + sx, 1.4), (z0 - 13 * 1.6 - 0.5, x0 + sx, 1.4), (0, 0, 1), 0.36, 0.07, 'deck')
    # mooring posts in lines along the east and north shelves
    for (a0, a1, n) in ((-2.2, -0.9, 38), (-0.6, 0.7, 30)):
        for k in range(n):
            a = a0 + (a1 - a0) * k / (n - 1)
            dx, dz = math.cos(a), math.sin(a)
            r = 60.0
            while r < 140 and H(dx * r, dz * r) > -0.4:
                r += 0.5
            x, z = dx * (r - 1.5), dz * (r - 1.5)
            mb.cyl((z, x, -1.5), (z, x, 1.0 + rng.uniform(-0.3, 0.4)), 0.12, 0.1, 'post', seg=6)


def castle_all():
    mb = MB()
    # hon-maru (top, 25 m): watch tower and a small hut
    tower(mb, -4.0, 3.0)
    building(mb, 7.0, -6.0, 4.5, 3.2, 0.3, h=2.2)
    ring0 = edge_ring(25.0)
    palisade(mb, ring0, 25.0, gaps=((1.2, 1.35),))
    # ni-no-maru (18.5 m): nine earth-fast post buildings round the top
    ring1 = edge_ring(18.5)
    palisade(mb, ring1, 18.5, gaps=((-1.75, -1.55), (1.3, 1.45)))
    k = 0
    for a in np.linspace(-2.9, 2.6, 11):
        if -1.8 < a < -1.45:
            continue
        # halfway between the hon-maru edge and the ni-no-maru edge
        r0 = next(math.hypot(x, z) for x, z, aa in ring0 if abs(((aa - a + math.pi) % (2 * math.pi)) - math.pi) < 0.06)
        r1 = next(math.hypot(x, z) for x, z, aa in ring1 if abs(((aa - a + math.pi) % (2 * math.pi)) - math.pi) < 0.06)
        r = (r0 + r1) / 2
        if r1 - r0 < 6:
            continue
        building(mb, math.cos(a) * r, math.sin(a) * r, rng.uniform(5.5, 8.5), min(4.0, (r1 - r0) - 1.5), a + math.pi / 2, h=rng.uniform(2.2, 2.7),
                 roof='thatch' if k % 3 == 1 else 'board')
        k += 1
        if k >= 9:
            break
    # san-no-maru (east, 11.5 m): the store on stone footings and the smithy
    building(mb, 66.0, 6.0, 10.0, 5.5, 1.5, h=3.2, footing=True, walls='plaster')
    building(mb, 60.0, -22.0, 5.0, 4.0, 1.2, h=2.3, roof='thatch')
    ring2 = edge_ring(11.5)
    palisade(mb, [p for p in ring2 if -1.2 < p[2] < 1.2], 11.5)
    gx, gz, ga = min(ring1, key=lambda p: abs(((p[2] + 1.65 + math.pi) % (2 * math.pi)) - math.pi))
    gate(mb, gx, gz, ga, 18.5)
    landing(mb)
    return mb


def ground_mesh(mb):
    """The castle islands' own ground at 1 m (the game's terrain grid is 8 m, too coarse for the terraces and scarps).
    It covers the islands down to below the waterline; the game lowers its coarse terrain under it"""
    for (cx, cz, rx, rz) in ((0.0, 0.0, 150.0, 145.0), (-9.0, 191.0, 105.0, 85.0)):
        xs = np.arange(cx - rx, cx + rx + 0.1, 1.0)
        zs = np.arange(cz - rz, cz + rz + 0.1, 1.0)
        X, Z = np.meshgrid(xs, zs)
        Hh = castle_island(X, Z)
        nx = len(xs)
        V = [(float(Z[j, i]), float(X[j, i]), float(max(Hh[j, i], -9.0))) for j in range(len(zs)) for i in range(nx)]
        F, UV = [], []
        for j in range(len(zs) - 1):
            for i in range(nx - 1):
                q = (j * nx + i, j * nx + i + 1, (j + 1) * nx + i + 1, (j + 1) * nx + i)
                if max(Hh[j, i], Hh[j, i + 1], Hh[j + 1, i], Hh[j + 1, i + 1]) < -8.0:
                    continue
                F.append((q[0], q[3], q[2], q[1]))
                UV.append(tuple((float(X[jj, ii]), float(Z[jj, ii])) for ii, jj in ((i, j), (i, j + 1), (i + 1, j + 1), (i + 1, j))))
        # one UV island per island, in metres (packed later)
        mb.add(V, F, 'ground', UV, groups=[0] * len(F))


def ground_material():
    """Beaten earth and short grass on the flats, bare granite and weathered sand (masa) on the scarps, wet dark rock
    at the waterline, a pale sand beach"""
    m, nt = B.mat_new('ground')
    N, L = (lambda t, **k: B.N(nt, t, **k)), (lambda a, b: B.L(nt, a, b))
    tc = N('ShaderNodeTexCoord'); geo = N('ShaderNodeNewGeometry')
    sep = N('ShaderNodeSeparateXYZ'); L(tc.outputs['Object'], sep.inputs[0])
    nz = N('ShaderNodeSeparateXYZ'); L(geo.outputs['Normal'], nz.inputs[0])
    n1 = N('ShaderNodeTexNoise', inputs={'Scale': 0.35, 'Detail': 8.0, 'Roughness': 0.6}); L(tc.outputs['Object'], n1.inputs['Vector'])
    n2 = N('ShaderNodeTexNoise', inputs={'Scale': 2.5, 'Detail': 6.0}); L(tc.outputs['Object'], n2.inputs['Vector'])
    grassK = N('ShaderNodeMapRange', inputs={1: 0.4, 2: 0.62}); L(n1.outputs['Fac'], grassK.inputs[0])
    earth = N('ShaderNodeMix', data_type='RGBA'); L(grassK.outputs[0], earth.inputs['Factor'])
    earth.inputs[6].default_value = (0.2, 0.15, 0.09, 1); earth.inputs[7].default_value = (0.1, 0.12, 0.05, 1)
    steep = N('ShaderNodeMapRange', inputs={1: 0.85, 2: 0.6}); L(nz.outputs['Z'], steep.inputs[0])
    rock = N('ShaderNodeMix', data_type='RGBA'); L(n2.outputs['Fac'], rock.inputs['Factor'])
    rock.inputs[6].default_value = (0.2, 0.185, 0.16, 1); rock.inputs[7].default_value = (0.13, 0.12, 0.1, 1)
    c1 = N('ShaderNodeMix', data_type='RGBA'); L(steep.outputs[0], c1.inputs['Factor']); L(earth.outputs[2], c1.inputs[6]); L(rock.outputs[2], c1.inputs[7])
    # waterline: dark wet rock up to ~0.8 m, sand on the low flat north beach
    wet = N('ShaderNodeMapRange', inputs={1: 1.2, 2: 0.2}); L(sep.outputs['Z'], wet.inputs[0])
    c2 = N('ShaderNodeMix', data_type='RGBA'); L(wet.outputs[0], c2.inputs['Factor']); L(c1.outputs[2], c2.inputs[6]); c2.inputs[7].default_value = (0.05, 0.05, 0.04, 1)
    bs = N('ShaderNodeBsdfPrincipled', inputs={'Roughness': 0.92})
    L(c2.outputs[2], bs.inputs['Base Color'])
    L(bs.outputs[0], B.out_node(nt).inputs['Surface'])
    K.SOCK['ground'] = dict(nt=nt, bsdf=bs, base=c2.outputs[2], rough=None)
    rv = N('ShaderNodeValue'); rv.outputs[0].default_value = 0.92
    K.SOCK['ground']['rough'] = rv.outputs[0]
    return m


def make_materials():
    return {
        'post': K.wood('post', (0.14, 0.1, 0.065), (0.2, 0.175, 0.145), grain='Z', weather=0.5, streak=0.4, algae=False, wear=0.4),
        'rail': K.wood('rail', (0.15, 0.1, 0.065), (0.21, 0.18, 0.14), grain='Y', weather=0.6, streak=0.35, algae=False, wear=0.5),
        'deck': K.wood('deck', (0.19, 0.14, 0.095), (0.25, 0.22, 0.19), grain='Y', weather=0.7, streak=0.25, algae=False, wear=0.2),
        'shield': K.wood('shield', (0.18, 0.125, 0.075), (0.22, 0.185, 0.14), grain='Z', weather=0.4, streak=0.5, algae=False, wear=0.4),
        'roof': K.wood('roof', (0.11, 0.095, 0.08), (0.17, 0.16, 0.145), grain='Y', weather=0.8, streak=0.3, algae=False),
        'straw': K.plain('straw', (0.24, 0.19, 0.1), 0.95, var=0.35, rust=(0.1, 0.085, 0.05), scale=14.0),
        'plaster': K.plain('plaster', (0.55, 0.53, 0.48), 0.9, var=0.08, rust=(0.3, 0.28, 0.24), scale=3.0),
        'stone': K.plain('stone', (0.3, 0.29, 0.27), 0.85, var=0.3, rust=(0.15, 0.15, 0.13), scale=5.0),
        'ground': ground_material(),
    }


def main():
    argv = sys.argv[sys.argv.index('--') + 1:]
    mode = argv[0]
    B.reset()
    M = make_materials()
    ob = meshb.build('castle', castle_all(), M)
    gmb = MB(); ground_mesh(gmb)
    gob = meshb.build('castle_ground', gmb, M, sharp_deg=80)
    print('CASTLE tris', sum(len(p.vertices) - 2 for p in ob.data.polygons), 'ground', len(gob.data.polygons), flush=True)
    if mode == 'preview':
        out = argv[1]
        os.makedirs(out, exist_ok=True)
        views = {'ne': ((-160.0, 170.0, 70.0), (0.0, 10.0, 15.0), 35), 'n': ((-190.0, -20.0, 40.0), (-20.0, 0.0, 12.0), 35),
                 'close': ((-40.0, 40.0, 30.0), (0.0, 0.0, 20.0), 30)}
        K.preview_scene(out, 'castle', views, sea=True, sun_el=35, sun_az=160)
        return
    data, chk = argv[1], argv[2]
    size = int(argv[3]) if len(argv) > 3 else 4096
    os.makedirs(data, exist_ok=True); os.makedirs(chk, exist_ok=True)
    K.bake_textures([ob, gob], data, 'castle', size)
    K.export_glb(os.path.join(data, 'castle.glb'), [ob, gob])
    print('CASTLE done', flush=True)


if __name__ == '__main__':
    main()
