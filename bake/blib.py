"""Helpers for building parts in Blender: bevelled boxes, tubes, lathes and helices, joined into one object at the end.
The material-node helpers work on both Blender 4.x and 5.x.
"""
import math

import bmesh
import bpy
from mathutils import Matrix, Vector


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def gpu_cycles(samples=64):
    scn = bpy.context.scene
    scn.render.engine = 'CYCLES'
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL'
    prefs.get_devices()
    for d in prefs.devices:
        d.use = True
    scn.cycles.device = 'GPU'
    scn.cycles.samples = samples
    return scn


# ---- Material nodes ---------------------------------------------------------------
def mat_new(name):
    m = bpy.data.materials.new(name)
    if m.node_tree is None:
        m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        if n.type != 'OUTPUT_MATERIAL':
            nt.nodes.remove(n)
    return m, nt


def out_node(nt):
    return [n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'][0]


def N(nt, t, **kw):
    n = nt.nodes.new(t)
    for k, v in kw.items():
        if k == 'inputs':
            for kk, vv in v.items():
                n.inputs[kk].default_value = vv
        else:
            setattr(n, k, v)
    return n


def L(nt, a, b):
    nt.links.new(a, b)


# ---- Shapes ---------------------------------------------------------------------
def _obj(name, bm, mat):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    if mat is not None:
        me.materials.append(mat)
    return ob


def apply_mods(ob):
    """Apply modifiers (replace the mesh with its evaluated version)"""
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    old = ob.data
    ob.modifiers.clear()
    ob.data = me
    bpy.data.meshes.remove(old)
    return ob


def bevel(ob, width, seg=2, angle=40, harden=True, clamp=True):
    m = ob.modifiers.new('bevel', 'BEVEL')
    m.width = width
    m.segments = seg
    m.limit_method = 'ANGLE'
    m.angle_limit = math.radians(angle)
    m.harden_normals = harden
    m.use_clamp_overlap = clamp
    m.miter_outer = 'MITER_ARC'
    apply_mods(ob)
    ob.data.shade_smooth()
    return ob


def hull(name, pts, mat, bev=0.0, seg=2):
    """Hexahedron from 8 points (4 bottom, 4 top, each counter-clockwise). For tapered or skewed boxes"""
    bm = bmesh.new()
    v = [bm.verts.new(p) for p in pts]
    for f in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
        bm.faces.new([v[i] for i in f])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = _obj(name, bm, mat)
    return bevel(ob, bev, seg) if bev > 0 else ob


def box(name, c, s, mat, bev=0.0, seg=2, rot=None):
    """Box with center c and size s. rot is a sequence of (axis, angle)"""
    hx, hy, hz = s[0] / 2, s[1] / 2, s[2] / 2
    pts = [(-hx, -hy, -hz), (hx, -hy, -hz), (hx, hy, -hz), (-hx, hy, -hz),
           (-hx, -hy, hz), (hx, -hy, hz), (hx, hy, hz), (-hx, hy, hz)]
    M = Matrix.Identity(3)
    for ax, a in (rot or []):
        M = Matrix.Rotation(a, 3, ax) @ M
    pts = [tuple(M @ Vector(p) + Vector(c)) for p in pts]
    return hull(name, pts, mat, bev, seg)


def tube(name, pts, r, mat, seg=12, cap=True):
    """Tube along a polyline (corners are not rounded; use denser points for bends)"""
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = r
    cu.bevel_resolution = max(1, seg // 4 - 1)
    cu.use_fill_caps = cap
    sp = cu.splines.new('POLY')
    sp.points.add(len(pts) - 1)
    for p, q in zip(sp.points, pts):
        p.co = (q[0], q[1], q[2], 1)
    ob = bpy.data.objects.new(name, cu)
    bpy.context.scene.collection.objects.link(ob)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg), depsgraph=dg)
    bpy.data.objects.remove(ob)
    bpy.data.curves.remove(cu)
    o2 = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o2)
    me.materials.clear()
    me.materials.append(mat)
    me.shade_smooth()
    return o2


def bend(pts, radius=0.08, n=4):
    """Round polyline corners with arcs (for bending tubes)"""
    P = [Vector(p) for p in pts]
    out = [P[0]]
    for i in range(1, len(P) - 1):
        a, b, c = P[i - 1], P[i], P[i + 1]
        d0, d1 = (b - a).normalized(), (c - b).normalized()
        r = min(radius, (b - a).length * 0.45, (c - b).length * 0.45)
        p0, p1 = b - d0 * r, b + d1 * r
        for k in range(n + 1):
            t = k / n
            out.append((p0 * (1 - t) + b * t) * (1 - t) + (b * (1 - t) + p1 * t) * t)
    out.append(P[-1])
    return [tuple(p) for p in out]


def lathe(name, prof, mat, seg=48, axis='X', center=(0, 0, 0), mats=None, smooth=True):
    """Surface of revolution. prof is a sequence of (radius, axial position), revolved around axis"""
    bm = bmesh.new()
    rings = []
    for i in range(seg):
        a = 2 * math.pi * i / seg
        ring = []
        for r, t in prof:
            if axis == 'X':
                p = (center[0] + t, center[1] + r * math.cos(a), center[2] + r * math.sin(a))
            else:
                p = (center[0] + r * math.cos(a), center[1] + r * math.sin(a), center[2] + t)
            ring.append(bm.verts.new(p))
        rings.append(ring)
    for i in range(seg):
        A, B = rings[i], rings[(i + 1) % seg]
        for j in range(len(prof) - 1):
            f = bm.faces.new((A[j], A[j + 1], B[j + 1], B[j]))
            if mats:
                f.material_index = mats[j]
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = _obj(name, bm, mat)
    if smooth:
        ob.data.shade_smooth()
        ob.data.set_sharp_from_angle(angle=math.radians(35))
    return ob


def helix(name, c, r, wire, h, turns, mat, axis=(0, 0, 1)):
    n = int(turns * 24)
    pts = []
    for i in range(n + 1):
        a = 2 * math.pi * turns * i / n
        pts.append((r * math.cos(a), r * math.sin(a), h * i / n - h / 2))
    ob = tube(name, pts, wire, mat, seg=8)
    z = Vector((0, 0, 1))
    q = z.rotation_difference(Vector(axis))
    ob.matrix_world = Matrix.Translation(c) @ q.to_matrix().to_4x4()
    return ob


def arch(name, c, r0, r1, x0, x1, a0, a1, mat, seg=28, bev=0.012):
    """Wheel arch flare (an arc-shaped band with thickness along x). c is (y, z); angles are in the y-z plane"""
    bm = bmesh.new()
    loops = []
    for i in range(seg + 1):
        a = a0 + (a1 - a0) * i / seg
        cy, sz = math.cos(a), math.sin(a)
        loop = [bm.verts.new((x, c[0] + r * cy, c[1] + r * sz)) for x, r in ((x0, r0), (x0, r1), (x1, r1), (x1, r0))]
        loops.append(loop)
    for i in range(seg):
        A, B = loops[i], loops[i + 1]
        for j in range(4):
            bm.faces.new((A[j], A[(j + 1) % 4], B[(j + 1) % 4], B[j]))
    bm.faces.new(loops[0][::-1])
    bm.faces.new(loops[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = _obj(name, bm, mat)
    return bevel(ob, bev, 2, angle=30) if bev else ob


def join(name, obs):
    obs = [o for o in obs if o is not None]
    bpy.ops.object.select_all(action='DESELECT')
    for o in obs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = obs[0]
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    ob.data.name = name
    return ob


def mirror_x(ob):
    """Copy mirrored in x (for symmetric parts)"""
    o2 = ob.copy()
    o2.data = ob.data.copy()
    bpy.context.scene.collection.objects.link(o2)
    me = o2.data
    for v in me.vertices:
        v.co.x = -v.co.x
    me.flip_normals()
    return o2
