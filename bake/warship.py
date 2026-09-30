"""The three warship types: build in Blender, check with Cycles renders, bake, export glb + textures + meta json.
  blender -b --factory-startup -P bake/warship.py -- preview <kind> <out dir> [views]
  blender -b --factory-startup -P bake/warship.py -- bake <kind> <web/data> <build/check> [texture size]
kind: atake | seki | kobaya. Parts come from warparts.py, the hull lines from wargeo.py.
Exported objects: hull (LOD 0..2), mast, yard, rudder; empties for the gun mounts and the rig.
Two base-colour textures per type: _base (plain weathered timber, the Noshima side) and _base_k
(shield boards, posts and rails blackened with persimmon-tannin and soot, the attacking side).
"""
import json
import os
import sys

import bpy
from mathutils import Euler

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bakelib as K  # noqa: E402
import blib as B  # noqa: E402
import meshb  # noqa: E402
import wargeo  # noqa: E402
import warparts as WP  # noqa: E402


def make_materials(black=False):
    blk = (0.018, 0.015, 0.013)
    shield = K.wood('shield', blk if black else (0.2, 0.135, 0.08), (0.05, 0.045, 0.04) if black else (0.23, 0.19, 0.145),
                    grain='Z', weather=0.35, streak=0.5, algae=False, wear=0.5)
    return {
        'hull': K.wood('hull', (0.15, 0.1, 0.065), (0.2, 0.175, 0.145), grain='Y', weather=0.45, streak=0.7),
        'tar': K.wood('tar', (0.06, 0.045, 0.03), (0.07, 0.06, 0.05), rough=0.62, grain='Y', weather=0.2, streak=0.2, tar=True),
        'deck': K.wood('deck', (0.2, 0.15, 0.1), (0.26, 0.235, 0.2), grain='Y', weather=0.7, streak=0.25, algae=False, wear=0.2),
        'post': K.wood('post', blk if black else (0.15, 0.1, 0.062), (0.05, 0.045, 0.04) if black else (0.2, 0.17, 0.135), grain='Z',
                       weather=0.4, streak=0.4, algae=False, wear=0.45),
        'rail': K.wood('rail', blk if black else (0.16, 0.108, 0.068), (0.05, 0.045, 0.04) if black else (0.21, 0.18, 0.14), grain='Y',
                       weather=0.6, streak=0.35, algae=False, wear=0.5),
        'shield': shield,
        'roof': K.wood('roof', (0.12, 0.105, 0.088), (0.18, 0.17, 0.155), grain='Y', weather=0.8, streak=0.3, algae=False),
        'tile': K.plain('tile', (0.045, 0.047, 0.05), 0.55, var=0.18, scale=5.0),
        'plaster': K.plain('plaster', (0.62, 0.6, 0.55), 0.9, var=0.08, rust=(0.35, 0.33, 0.29), scale=3.0),
        'iron': K.plain('iron', (0.028, 0.024, 0.021), 0.7, rust=(0.075, 0.032, 0.014), scale=9.0),
        'rope': K.plain('rope', (0.2, 0.14, 0.075), 0.9, var=0.3, scale=30.0),
        'cloth': K.plain('cloth', (0.35, 0.03, 0.02), 0.9, var=0.2, scale=8.0),
    }


def build(kind, M):
    H = wargeo.Hull(kind)
    mb, Y = WP.hull_all(H)
    hull = meshb.build('hull', mb, M)
    mast = meshb.build('mast', WP.mast_parts(H, Y), M)
    yard = meshb.build('yard', WP.yard_parts(H, Y), M)
    rud = meshb.build('rudder', WP.rudder_parts(H, Y), M)
    oar = meshb.build('oar', WP.oar_parts(H, Y), M)
    pivot, rake = WP.rudder_pivot(H)
    rud.location = meshb.to_blender(pivot)
    rud.rotation_euler = Euler((-rake, 0, 0))
    zt = WP.floor_z(H, Y, Y['mast_f']) + Y['gap'] + sum(t for t, _ in Y['tiers']) if kind != 'kobaya' else H.deck_z(Y['mast_f'])
    mast.location = meshb.to_blender((Y['mast_f'], 0, zt + 0.95 * (H.B / 7.4 + 0.2)))
    yard.location = meshb.to_blender((Y['mast_f'] - 0.3, 0, zt + Y['mast_h'] - 1.0))
    return H, Y, dict(hull=hull, mast=mast, yard=yard, rudder=rud, oar=oar), zt


def views(H):
    L = H.L
    s = L / 28.0
    return {
        'side': ((0.0, 55.0 * s, 4.0 * s), (0.0, 0.0, 3.0 * s), 40),
        'bow34': ((22.0 * s, 20.0 * s, 6.0 * s), (2.0 * s, 0.0, 3.0 * s), 40),
        'stern34': ((-24.0 * s, 17.0 * s, 8.0 * s), (-2.0 * s, 0.0, 3.0 * s), 40),
        'top': ((-4.0 * s, 16.0 * s, 20.0 * s), (0.0, 0.0, 2.0 * s), 30),
        'close': ((3.0 * s, 9.0 * s, 2.4 * s), (1.0 * s, 0.0, 2.2 * s), 40),
    }


def place_oars(H, Y, oar):
    """Preview only: copies of the oar at every thole, at the catch of the stroke"""
    import math
    obs = []
    for i, (f, x, z) in enumerate(WP.oar_tholes(H, Y)):
        o = oar.copy()
        bpy.context.scene.collection.objects.link(o)
        o.location = meshb.to_blender((f, x, z))
        # oar frame: blade toward +x (outboard on the port side); starboard oars are turned half round. Dip ~24 deg
        o.rotation_euler = Euler((0, math.radians(24), 0 if x > 0 else math.pi), 'YZX')
        obs.append(o)
    oar.hide_render = True
    return obs


def make_lods(hull):
    """Coarser copies of the hull for distance (same UVs, so the same textures): about 1/5 and 1/25 of the triangles"""
    out = []
    for n, ratio in ((1, 0.2), (2, 0.04)):
        o = hull.copy()
        o.data = hull.data.copy()
        o.name = f'hull_lod{n}'
        bpy.context.scene.collection.objects.link(o)
        m = o.modifiers.new('dec', 'DECIMATE')
        m.decimate_type = 'COLLAPSE'
        m.ratio = ratio
        m.use_collapse_triangulate = True
        B.apply_mods(o)
        print('LOD', n, sum(len(p.vertices) - 2 for p in o.data.polygons), flush=True)
        out.append(o)
    return out


def main():
    argv = sys.argv[sys.argv.index('--') + 1:]
    mode, kind = argv[0], argv[1]
    B.reset()
    M = make_materials()
    H, Y, obs, zt = build(kind, M)
    tris = {k: sum(len(p.vertices) - 2 for p in o.data.polygons) for k, o in obs.items()}
    print('WARSHIP', kind, 'tris', tris, flush=True)
    if mode == 'preview':
        out = argv[2]
        os.makedirs(out, exist_ok=True)
        place_oars(H, Y, obs['oar'])
        V = views(H)
        only = argv[3].split(',') if len(argv) > 3 else list(V)
        K.preview_scene(out, kind, {k: V[k] for k in only})
        return
    data, chk = argv[2], argv[3]
    size = int(argv[4]) if len(argv) > 4 else 4096
    os.makedirs(data, exist_ok=True); os.makedirs(chk, exist_ok=True)
    parts = [obs['hull'], obs['mast'], obs['yard'], obs['rudder'], obs['oar']]
    K.bake_textures(parts, data, kind, size)
    # the blackened variant: swap the materials' colours and bake base colour again
    K.SOCK.clear()
    black = make_materials(black=True)
    for o in parts:
        for i, m in enumerate(o.data.materials):
            nm = m.name.split('.')[0]
            o.data.materials[i] = black[nm]
    base_k = K.bake_pass(parts, 'base', size)
    K.save_png(os.path.join(data, f'{kind}_base_k.png'), base_k[..., :3], True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(chk, f'{kind}.blend'))
    pts = {f'gun_{i}': p for i, p in enumerate(WP.gun_mounts(H, Y))}
    emp = K.add_empties(pts)
    lods = make_lods(obs['hull'])
    K.export_glb(os.path.join(data, f'{kind}.glb'), parts + lods, emp)
    pivot, rake = WP.rudder_pivot(H)
    meta = {
        'kind': kind, 'L': H.L, 'B': H.B, 'D': H.D, 'T': H.T,
        'stations': H.stations(40), 'waterplane': H.waterplane(),
        'deck_top': zt, 'mast_f': Y['mast_f'], 'mast_h': Y['mast_h'], 'yard_l': Y['yard_l'], 'sail': list(Y['sail']),
        'rudder_pivot': list(pivot), 'rudder_rake': rake,
        'oar_len': H.oar_len, 'tholes': WP.oar_tholes(H, Y), 'guns': WP.gun_mounts(H, Y),
        'box': {'y0': Y['y0'], 'y1': Y['y1'], 'ov': Y['ov'], 'gap': Y['gap'], 'tiers': [t for t, _ in Y['tiers']]},
    }
    json.dump(meta, open(os.path.join(data, f'{kind}.json'), 'w'))
    print('WARSHIP done', kind, flush=True)


if __name__ == '__main__':
    main()
