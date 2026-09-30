"""Guns: the bow gun (oozutsu), the breech-loading swivel gun (ishibiya / furanki) and the thrown fire pot (horoku).
  blender -b --factory-startup -P bake/guns.py -- preview <out dir> [views]
  blender -b --factory-startup -P bake/guns.py -- bake <web/data> <build/check> [texture size]
Each is built in its own frame (f along the bore, + toward the muzzle; z up) with the pivot at the origin.
Sizes (ref/GUNS.md):
  oozutsu : a 1-kanme gun of forged iron like the Shibatsuji gun but shorter for a ship: bore 86 mm, 2.35 m,
            breech about 26 cm across; layered hoops along the barrel, octagonal breech, touch-hole pan on the right,
            on a heavy wooden bed lashed to the deck with rope
  ishibiya: bronze breech-loader, bore 47 mm, 1.6 m (the Japanese one in the Musee de l'Armee), open breech slot,
            a mug-shaped chamber with a handle held by a wedge, a forked yoke on a post and a tiller
  horoku  : unglazed clay pot 18 cm across with a neck, a fuse and a rope sling
"""
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bakelib as K  # noqa: E402
import blib as B  # noqa: E402
import meshb  # noqa: E402
from meshb import MB  # noqa: E402


def lathe_f(mb, prof, mat, seg=32, c=(0, 0, 0)):
    """Surface of revolution about the f axis: prof = [(radius, f)]"""
    mb.lathe(prof, c, (1, 0, 0), mat, seg=seg, ref=(0, 0, 1))


def octagon_prism(mb, f0, f1, r0, r1, mat):
    """Barrel section with eight flats (the across-flats radius r0 at f0, r1 at f1)"""
    V, F, UV = [], [], []
    for f, r in ((f0, r0), (f1, r1)):
        R = r / math.cos(math.pi / 8)
        for k in range(8):
            a = math.pi / 8 + k * math.pi / 4
            V.append((f, R * math.cos(a), R * math.sin(a)))
    L = f1 - f0
    for k in range(8):
        j = (k + 1) % 8
        F.append((k, j, 8 + j, 8 + k))
        w = 2 * r0 * math.tan(math.pi / 8)
        UV.append(((0, 0), (w, 0), (w, L), (0, L)))
    F.append(tuple(range(8))[::-1]); UV.append(None)
    F.append(tuple(range(8, 16))); UV.append(None)
    mb.add(V, F, mat, UV)


# ---- bow gun --------------------------------------------------------------------------------------------
OZ = dict(bore=0.086, length=2.35, r_breech=0.13, r_muzzle=0.085, trunnion_f=0.0, breech_f=-0.95)


def oozutsu():
    mb = MB()
    L, fb = OZ['length'], OZ['breech_f']
    fm = fb + L
    rb, rm = OZ['r_breech'], OZ['r_muzzle']
    r = lambda f: rb + (rm - rb) * (f - fb) / L
    # octagonal breech third, then round barrel with hoops, a swelling at the muzzle
    fo = fb + L * 0.32
    octagon_prism(mb, fb + 0.06, fo, r(fb + 0.06), r(fo), 'gun')
    prof = [(0.0, fb - 0.07), (rb * 0.55, fb - 0.07), (rb * 0.78, fb - 0.03), (rb * 0.96, fb), (rb * 1.02, fb + 0.06), (r(fo) * 0.99, fb + 0.07)]
    lathe_f(mb, prof, 'gun')
    # cascabel knob behind the breech plug
    lathe_f(mb, [(0.0, fb - 0.2), (0.03, fb - 0.2), (0.045, fb - 0.16), (0.03, fb - 0.12), (0.028, fb - 0.07)], 'gun', seg=16)
    body = [(r(fo) * 1.03, fo - 0.01), (r(fo) * 1.06, fo + 0.02), (r(fo) * 1.0, fo + 0.05)]
    f = fo + 0.05
    while f < fm - 0.28:
        body += [(r(f), f), (r(f), f + 0.14), (r(f + 0.14) * 1.035, f + 0.155), (r(f + 0.17) * 1.035, f + 0.19), (r(f + 0.2), f + 0.205)]
        f += 0.205
    body += [(r(fm - 0.28), fm - 0.28), (rm * 0.96, fm - 0.2), (rm * 1.12, fm - 0.1), (rm * 1.18, fm - 0.04), (rm * 1.14, fm), (OZ['bore'] / 2 + 0.004, fm)]
    body += [(OZ['bore'] / 2, fm - 0.01), (OZ['bore'] / 2, fm - 0.5), (0.0, fm - 0.5)]
    lathe_f(mb, body, 'gun', seg=32)
    # touch hole with a pan (hizara) and its lid on the right, at the breech
    fp = fb + 0.14
    x = -r(fp) - 0.005
    mb.obox((fp, x - 0.02, 0.03), (1, 0, 0), (0, 1, 0), 0.09, 0.05, 0.02, 'gun')
    mb.obox((fp, x - 0.03, 0.055), (1, 0, 0), (0, 1, 0), 0.1, 0.06, 0.008, 'gun')
    # sight blocks on top (front and rear)
    mb.obox((fb + 0.2, 0, r(fb + 0.2) / math.cos(math.pi / 8) * 0.97 + 0.012), (1, 0, 0), (0, 1, 0), 0.05, 0.03, 0.03, 'gun')
    mb.obox((fm - 0.12, 0, rm * 1.18 + 0.01), (1, 0, 0), (0, 1, 0), 0.03, 0.012, 0.02, 'gun')
    return mb


def oozutsu_bed():
    """Wooden bed (dai): two cheek timbers on a thick base, a transverse bolster the barrel rests in, rope lashings
    over the barrel, a wedge (quoin) under the breech for elevation. No wheels: it slides back on the deck"""
    mb = MB()
    fb = OZ['breech_f']
    base_h = 0.2
    z0 = -OZ['r_breech'] - 0.14      # top of the base below the bore line
    mb.obox((-0.25, 0, z0 - base_h / 2), (1, 0, 0), (0, 1, 0), 1.9, 0.62, base_h, 'bed')
    for s in (-1, 1):
        # cheeks: taller at the front (where the barrel is held), sloping down aft
        pts = [(-1.15, s * 0.2, z0), (0.65, s * 0.2, z0), (0.65, s * 0.2, z0 + 0.3), (-1.15, s * 0.2, z0 + 0.12)]
        V = pts + [(p[0], p[1] + s * 0.11, p[2]) for p in pts]
        mb.add(V, [(0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)], 'bed')
        # iron straps along the top of the cheeks
        mb.obox((-0.25, s * 0.255, z0 + 0.22), (1, -0, 0.1), (0, 1, 0), 1.8, 0.115, 0.012, 'iron')
    # bolster under the barrel near the front
    mb.obox((0.4, 0, z0 + 0.1), (1, 0, 0), (0, 1, 0), 0.24, 0.42, 0.2, 'bed')
    # quoin under the breech
    V = [(-0.95, -0.12, z0), (-0.55, -0.12, z0), (-0.55, -0.12, z0 + 0.03), (-0.95, -0.12, z0 + 0.12)]
    V = V + [(p[0], 0.12, p[2]) for p in V]
    mb.add(V, [(0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)], 'bed')
    # rope lashings over the barrel (three turns each) at the bolster and at the breech
    for fl in (0.4, fb + 0.45):
        rr = OZ['r_breech'] + (OZ['r_muzzle'] - OZ['r_breech']) * (fl - fb) / OZ['length']
        for k in range(3):
            d = (k - 1) * 0.035
            pts = []
            for a in np.linspace(0, math.pi, 13):
                pts.append((fl + d, (rr + 0.016) * math.cos(a) * 1.02, (rr + 0.016) * math.sin(a)))
            pts = [(fl + d, 0.3, z0 + 0.05)] + [(fl + d, 0.26, 0.0)] + pts + [(fl + d, -0.26, 0.0), (fl + d, -0.3, z0 + 0.05)]
            mb.tube(pts, 0.009, 'rope', seg=6, cap=False)
    # ring bolts for the breeching ropes at the back corners
    for s in (-1, 1):
        mb.cyl((-1.12, s * 0.3, z0 - 0.02), (-1.12, s * 0.3, z0 + 0.08), 0.035, 0.035, 'iron', seg=10)
    return mb


# ---- swivel breech-loader -----------------------------------------------------------------------------------
FR = dict(bore=0.047, length=1.6, r=0.07)


def ishibiya():
    mb = MB()
    L, rr = FR['length'], FR['r']
    fm = 0.95
    fb = fm - L
    # barrel: bronze, round with mouldings; the rear third is an open trough (the chamber slot)
    slot0, slot1 = fb + 0.12, fb + 0.55
    barrel = [(rr * 1.18, slot1), (rr * 1.22, slot1 + 0.03), (rr * 1.05, slot1 + 0.06)]
    f = slot1 + 0.06
    while f < fm - 0.15:
        rf = rr * (1.0 - 0.18 * (f - slot1) / (fm - slot1))
        barrel += [(rf, f), (rf, f + 0.18), (rf * 1.07, f + 0.195), (rf * 1.07, f + 0.22), (rf, f + 0.235)]
        f += 0.235
    barrel += [(rr * 0.82, fm - 0.12), (rr * 0.98, fm - 0.06), (rr * 1.0, fm), (FR['bore'] / 2 + 0.004, fm),
               (FR['bore'] / 2, fm - 0.01), (FR['bore'] / 2, slot1 + 0.02), (rr * 1.18, slot1)]
    lathe_f(mb, barrel, 'bronze', seg=28)
    # the trough: two side rails and a bottom joining the barrel to the breech block
    for s in (-1, 1):
        mb.obox(((slot0 + slot1) / 2, s * rr * 1.05, 0.0), (1, 0, 0), (0, 1, 0), slot1 - slot0 + 0.04, 0.03, rr * 1.4, 'bronze')
    mb.obox(((slot0 + slot1) / 2, 0, -rr * 0.9), (1, 0, 0), (0, 1, 0), slot1 - slot0 + 0.04, rr * 2.1, 0.035, 'bronze')
    # breech block and the wedge slot behind the chamber
    lathe_f(mb, [(0.0, fb - 0.02), (rr * 1.05, fb - 0.02), (rr * 1.15, fb + 0.04), (rr * 1.12, slot0), (0.0, slot0)], 'bronze', seg=24)
    mb.obox((slot0 + 0.03, 0, rr * 0.2), (1, 0, 0), (0, 1, 0), 0.04, rr * 0.5, rr * 2.6, 'iron')
    # tiller (the long tail used to aim) and trunnions on the yoke pin
    mb.cyl((fb - 0.02, 0, 0), (fb - 0.75, 0, -0.06), 0.022, 0.018, 'iron', seg=10)
    lathe_f(mb, [(0.0, fb - 0.8), (0.03, fb - 0.8), (0.035, fb - 0.74), (0.0, fb - 0.74)], 'iron', seg=10)
    for s in (-1, 1):
        mb.cyl((0.0, s * rr * 1.1, 0), (0.0, s * (rr * 1.1 + 0.06), 0), 0.03, 0.03, 'bronze', seg=12)
    return mb


def ishibiya_chamber():
    """One chamber (kohou): a short thick mug with a handle; it drops into the trough, the wedge holds it"""
    mb = MB()
    r = FR['r'] * 0.92
    lathe_f(mb, [(0.0, -0.2), (r * 0.9, -0.2), (r, -0.17), (r, 0.12), (r * 0.72, 0.16), (r * 0.62, 0.2),
                 (FR['bore'] / 2 + 0.006, 0.2), (FR['bore'] / 2, 0.19), (FR['bore'] / 2, 0.0), (0.0, 0.0)], 'iron', seg=24)
    pts = [(-0.12, 0, r), (-0.1, 0, r + 0.08), (0.06, 0, r + 0.08), (0.08, 0, r)]
    mb.tube(pts, 0.012, 'iron', seg=8)
    return mb


def ishibiya_yoke():
    """Forked yoke on a post (the pin goes into a socket on the rail)"""
    mb = MB()
    rr = FR['r']
    for s in (-1, 1):
        pts = [(0.0, s * 0.02, -0.12), (0.0, s * (rr * 1.25), -0.08), (0.0, s * (rr * 1.2 + 0.03), 0.0), (0.0, s * (rr * 1.2 + 0.03), 0.03)]
        mb.tube(pts, 0.022, 'iron', seg=10)
    mb.cyl((0, 0, -0.12), (0, 0, -0.55), 0.028, 0.024, 'iron', seg=10)
    return mb


# ---- fire pot ---------------------------------------------------------------------------------------------
def horoku():
    mb = MB()
    R = 0.09
    prof = [(0.0, -R)]
    for a in np.linspace(-math.pi / 2, math.pi / 2 * 0.72, 18)[1:]:
        prof.append((R * math.cos(a), R * math.sin(a)))
    prof += [(0.028, R * 0.98), (0.03, R * 1.1), (0.024, R * 1.13), (0.0, R * 1.13)]
    mb.lathe([(r, z) for r, z in prof], (0, 0, 0), (0, 0, 1), 'clay', seg=20)
    # fuse
    mb.tube([(0, 0, R * 1.12), (0.01, 0.0, R * 1.3), (0.03, 0.01, R * 1.42), (0.05, 0.02, R * 1.46)], 0.005, 'rope', seg=5)
    # rope sling: a net of four cords under the pot, gathered at the top into a carrying loop
    for k in range(4):
        a = k * math.pi / 2 + math.pi / 4
        pts = []
        for t in np.linspace(-math.pi / 2, math.pi / 2 * 0.7, 10):
            pts.append((math.cos(a) * (R + 0.006) * math.cos(t), math.sin(a) * (R + 0.006) * math.cos(t), (R + 0.006) * math.sin(t)))
        pts.append((math.cos(a) * 0.035, math.sin(a) * 0.035, R * 1.05))
        mb.tube(pts, 0.004, 'rope', seg=4, cap=False)
    mb.tube([(0.03, 0, R * 1.02), (0.05, 0, R * 1.5), (0.0, 0, R * 1.75), (-0.05, 0, R * 1.5), (-0.03, 0, R * 1.02)], 0.005, 'rope', seg=5, cap=False)
    for z in (R * 0.1, -R * 0.45):
        c = R * math.cos(math.asin(z / R)) + 0.006
        pts = [(c * math.cos(a), c * math.sin(a), z) for a in np.linspace(0, 2 * math.pi, 25)]
        mb.tube(pts, 0.004, 'rope', seg=4, cap=False)
    return mb


# ---- materials / assembly ------------------------------------------------------------------------------
def make_materials():
    return {
        # forged iron: dark, a little oily; red-brown rust in patches, pitted
        'gun': K.metal('gun', (0.03, 0.028, 0.026), 0.5, patina=(0.075, 0.036, 0.018), metallic=0.8, pit=0.6, scale=7.0, cover=(0.56, 0.7), pscale=3.0),
        'iron': K.metal('iron', (0.035, 0.032, 0.03), 0.6, patina=(0.075, 0.035, 0.018), metallic=0.75, pit=0.4, scale=10.0, cover=(0.55, 0.7), pscale=2.5),
        # bronze: brown with green-grey verdigris in the hollows
        'bronze': K.metal('bronze', (0.13, 0.075, 0.035), 0.5, patina=(0.055, 0.08, 0.06), metallic=0.9, pit=0.3, scale=6.0, cover=(0.5, 0.66), pscale=2.5),
        'bed': K.wood('bed', (0.12, 0.075, 0.042), (0.15, 0.12, 0.09), grain='Y', weather=0.2, streak=0.4, algae=False, wear=0.4),
        'rope': K.plain('rope', (0.12, 0.085, 0.045), 0.9, var=0.3, scale=60.0),
        'clay': K.plain('clay', (0.3, 0.13, 0.06), 0.85, var=0.2, rust=(0.06, 0.04, 0.03), scale=9.0),
    }


def build(M):
    obs = {}
    obs['oozutsu'] = meshb.build('oozutsu', oozutsu(), M, sharp_deg=30)
    obs['oozutsu_bed'] = meshb.build('oozutsu_bed', oozutsu_bed(), M)
    obs['ishibiya'] = meshb.build('ishibiya', ishibiya(), M, sharp_deg=30)
    obs['ishibiya_chamber'] = meshb.build('ishibiya_chamber', ishibiya_chamber(), M, sharp_deg=30)
    obs['ishibiya_yoke'] = meshb.build('ishibiya_yoke', ishibiya_yoke(), M)
    obs['horoku'] = meshb.build('horoku', horoku(), M)
    return obs


# preview layout: guns side by side on a floor (ship coordinates: f along the gun, x across)
LAYOUT = {'oozutsu': (0, 0, 0.62), 'oozutsu_bed': (0, 0, 0.62), 'ishibiya': (0, 1.4, 1.0), 'ishibiya_chamber': (-0.5, 1.4, 1.0),
          'ishibiya_yoke': (0, 1.4, 1.0), 'horoku': (0.2, -0.9, 0.1)}

VIEWS = {
    'side': ((0.0, -4.2, 1.1), (0.0, 0.4, 0.7), 42),
    'q34': ((2.6, -2.6, 1.8), (0.0, 0.3, 0.7), 40),
    'breech': ((-2.4, -1.2, 1.4), (-0.6, 0.4, 0.8), 45),
    'muzzle': ((2.3, 0.2, 0.9), (1.2, 0.0, 0.62), 40),
    'close': ((-1.2, -0.9, 1.1), (-0.8, 0.0, 0.62), 50),
}


def main():
    argv = sys.argv[sys.argv.index('--') + 1:]
    mode = argv[0]
    B.reset()
    M = make_materials()
    obs = build(M)
    tris = {k: sum(len(p.vertices) - 2 for p in o.data.polygons) for k, o in obs.items()}
    print('GUNS tris', tris, flush=True)
    if mode == 'preview':
        out = argv[1]
        os.makedirs(out, exist_ok=True)
        for k, o in obs.items():
            o.location = meshb.to_blender(LAYOUT[k])
        obs['ishibiya_chamber'].location = meshb.to_blender((-0.5, 1.4, 1.0 + 0.0))
        only = argv[2].split(',') if len(argv) > 2 else list(VIEWS)
        K.preview_scene(out, 'guns', {k: VIEWS[k] for k in only}, sea=False, sun_el=35, sun_az=200)
        return
    data, chk = argv[1], argv[2]
    size = int(argv[3]) if len(argv) > 3 else 2048
    os.makedirs(data, exist_ok=True); os.makedirs(chk, exist_ok=True)
    parts = list(obs.values())
    K.bake_textures(parts, data, 'guns', size, normal=True)
    import bpy
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(chk, 'guns.blend'))
    K.export_glb(os.path.join(data, 'guns.glb'), parts)
    print('GUNS done', flush=True)


if __name__ == '__main__':
    main()
