// The men you can see: fighters on the fighting deck (musketeers kneeling at the parapet, spearmen, a few mounted-class
// warriors in lacquered armour) and, on a kobaya, the rowers standing at their oars. Each carries a small back flag
// (sashimono) in his side's colours. Rowers of the atake and seki work under the shield walls and are not seen.
// Figures are the shiomachi crew figure with Sengoku kit: a flat conical war hat (jingasa) or a helmet, a dark
// lacquered cuirass over the coat, a musket or a long spear. All instanced; only ships near the camera get men,
// and there are as many as the ship still has.
// Banners: tall nobori at the stern (Noshima: red and white bands; the attackers: black with a white disc),
// streaming with the wind in a vertex shader.
import * as THREE from 'three';
import { figure } from './people.js';

const LACQ = [0.03, 0.025, 0.022], LACQ_R = [0.16, 0.03, 0.02], IRON = [0.05, 0.05, 0.05], WOOD = [0.16, 0.1, 0.05];

function merge(geos) {
  let n = 0; for (const g of geos) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), col = new Float32Array(n * 3); const idx = [];
  let o = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, o * 3); nrm.set(g.attributes.normal.array, o * 3); col.set(g.attributes.color.array, o * 3);
    for (const i of g.index.array) idx.push(i + o);
    o += g.attributes.position.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}
// small props as coloured boxes and cylinders (same vertex format as the figures)
function prop(kind, c) {
  let g;
  if (kind === 'box') g = new THREE.BoxGeometry(...c.size);
  else g = new THREE.CylinderGeometry(c.r1, c.r0, c.len, 6);
  g = g.toNonIndexed(); g.setIndex([...Array(g.attributes.position.count).keys()]);
  if (c.rot) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...c.rot)));
  g.translate(...c.at);
  const n = g.attributes.position.count;
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).map((_, i) => c.col[i % 3]), 3));
  return g;
}
function kit(pose, extra) {
  const f = figure(pose);
  const parts = [f];
  // cuirass (do) over the coat, and the hat or helmet
  const y0 = pose.sit ? 0.55 : 0.95;
  parts.push(prop('cyl', { r0: 0.21, r1: 0.23, len: 0.42, at: [0, y0 + 0.25, 0.02], rot: [pose.lean ?? 0.05, 0, 0], col: pose.red ? LACQ_R : LACQ }));
  if (pose.kabuto) parts.push(prop('cyl', { r0: 0.2, r1: 0.12, len: 0.14, at: [0, y0 + 0.72, 0.04], col: IRON }), prop('box', { size: [0.5, 0.02, 0.3], at: [0, y0 + 0.66, -0.03], col: IRON }));
  else parts.push(prop('cyl', { r0: 0.36, r1: 0.04, len: 0.13, at: [0, y0 + 0.75, 0.04], col: LACQ }));
  for (const e of extra) parts.push(prop(e.kind, e));
  return merge(parts);
}

export function crewGeometries() {
  return {
    // musketeer kneeling at the parapet, the gun laid on the rail pointing outboard (+z in the figure's frame)
    gunner: kit({ sit: true, arms: 'forward', lean: 0.25 }, [{ kind: 'cyl', r0: 0.022, r1: 0.018, len: 1.3, at: [0.05, 0.95, 0.55], rot: [Math.PI / 2 - 0.05, 0, 0], col: WOOD }]),
    // spearman standing, spear upright
    spear: kit({ arms: 'down', lean: 0.04 }, [{ kind: 'cyl', r0: 0.02, r1: 0.016, len: 4.2, at: [0.28, 1.9, 0.08], col: WOOD }, { kind: 'cyl', r0: 0.028, r1: 0.001, len: 0.3, at: [0.28, 4.15, 0.08], col: IRON }]),
    // warrior in red-laced armour with a helmet, directing
    samurai: kit({ arms: 'up', lean: 0.02, kabuto: true, red: true }, []),
    // kobaya rower standing at his oar, pushing the loom (sculling)
    rower: merge([figure({ arms: 'forward', lean: 0.35, coat: [0.06, 0.07, 0.1] })]),
    // back flag (sashimono): pole and a small upright flag, coloured per instance
    flag: merge([prop('cyl', { r0: 0.012, r1: 0.012, len: 1.1, at: [0, 1.7, -0.2], col: WOOD }), prop('box', { size: [0.02, 0.46, 0.28], at: [0, 2.0, -0.34], col: [1, 1, 1] })]),
  };
}

// banner material: a nobori (tall flag laced to a pole with a top cross-bar), ripples downwind; the design is drawn
// from uv per side (instance attribute aSide)
function bannerMaterial(patch, U, wind) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = U.uTime; sh.uniforms.uWind = wind.uniforms.uWind;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aSide; uniform float uTime; uniform vec2 uWind; varying vec2 vB; varying float vSide;')
      .replace('#include <begin_vertex>', `vec3 transformed = position;
        vB = uv; vSide = aSide;
        // the free edge flaps: a travelling wave, growing away from the pole
        float fr = uv.x;
        float w = length(uWind) + 0.5;
        transformed.z += fr * sin(uv.x * 6.0 - uTime * (3.0 + w * 0.8) + uv.y * 2.0) * 0.12 * min(w / 4.0, 1.5);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vB; varying float vSide;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 c;
          if (vSide < 0.5) {
            // Noshima: red and white bands (after the Noshima family record), the top band white with a red mark
            float b = floor(vB.y * 7.0);
            c = mod(b, 2.0) < 0.5 ? vec3(0.62, 0.6, 0.55) : vec3(0.32, 0.025, 0.02);
            vec2 q = vec2(vB.x - 0.5, (vB.y - 0.93) * 3.0);
            if (vB.y > 0.86) { c = vec3(0.62, 0.6, 0.55); if (length(q) < 0.22 && length(q) > 0.13) c = vec3(0.32, 0.025, 0.02); }
          } else {
            // the attackers: black, a white disc high up
            c = vec3(0.018, 0.016, 0.015);
            vec2 q = vec2(vB.x - 0.5, (vB.y - 0.8) * 3.6);
            if (length(q) < 0.3) c = vec3(0.6, 0.58, 0.54);
          }
          diffuseColor.rgb = c;
        }`);
  };
  m.customProgramCacheKey = () => 'nobori';
  patch?.(m);
  return m;
}

export class CrewView {
  constructor(art, patch, U, wind, max = 900) {
    this.art = art; this.wind = wind;
    const G = crewGeometries();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
    patch?.(mat);
    this.group = new THREE.Group();
    this.meshes = {};
    for (const [k, g] of Object.entries(G)) {
      const im = new THREE.InstancedMesh(g, mat, max);
      im.count = 0; im.frustumCulled = false;
      if (k === 'flag') im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
      this.meshes[k] = im; this.group.add(im);
    }
    // banners
    const bg = new THREE.PlaneGeometry(0.9, 5.2, 8, 12).translate(0.45, 0, 0).rotateY(Math.PI / 2);
    const bs = new THREE.InstancedBufferAttribute(new Float32Array(200), 1);
    bg.setAttribute('aSide', bs);
    this.banner = new THREE.InstancedMesh(bg, bannerMaterial(patch, U, wind), 200);
    this.banner.count = 0; this.banner.frustumCulled = false; this.banner.userData.side = bs;
    this.pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.05, 0.07, 1, 6), new THREE.MeshStandardMaterial({ color: new THREE.Color(0.12, 0.08, 0.05), roughness: 0.8 }), 400);
    this.pole.count = 0; this.pole.frustumCulled = false;
    patch?.(this.pole.material);
    this.group.add(this.banner, this.pole);
    this.slots = {};
    for (const k of Object.keys(art.kinds)) this.slots[k] = this.makeSlots(art.kinds[k].meta);
  }
  casters() { return [...Object.values(this.meshes), this.banner, this.pole]; }
  // fixed places on each type: [x, y, z, yaw, role]
  makeSlots(m) {
    const out = [];
    const box = m.box, zt = m.deck_top;
    if (m.kind !== 'kobaya') {
      const bx = m.B / 2 + box.ov - 0.7;
      for (let f = box.y0 + 1.2; f < box.y1 - 0.8; f += 1.25) for (const s of [1, -1]) out.push([s * bx, zt, f, s > 0 ? Math.PI / 2 : -Math.PI / 2, 'gunner']);
      // across the bow wall
      for (let x = -bx + 0.6; x < bx - 0.5; x += 1.3) out.push([x, zt, box.y1 - 0.7, 0, 'gunner']);
      // spearmen and a warrior in the middle
      for (let f = box.y0 + 2; f < box.y1 - 5; f += 2.4) for (const x of [-1.2, 1.2]) out.push([x + (Math.random() - 0.5) * 0.6, zt, f, Math.random() * 6.28, 'spear']);
      out.push([1.6, zt, box.y1 - 5.5, 0, 'samurai'], [0.8, zt, (box.y0 + box.y1) / 2, 0.5, 'samurai']);
    } else {
      for (const th of m.tholes) out.push([th[1] - Math.sign(th[1]) * 1.1, th[2] - 0.35, th[0], Math.sign(th[1]) > 0 ? -Math.PI / 2 : Math.PI / 2, 'rower']);
      for (let f = -2.5; f < 3; f += 1.1) out.push([(Math.random() - 0.5) * 0.4, m.deck_top, f, Math.random() * 6.28, f > 1 ? 'gunner' : 'spear']);
      out.push([0, m.deck_top, 3.4, 0, 'samurai']);
    }
    // shuffle the order in which men are lost (losses come off the list's end)
    for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
    out.sort((a, b) => (a[4] === 'rower') - (b[4] === 'rower'));
    return out;
  }
  update(ships, camPos, t) {
    for (const im of Object.values(this.meshes)) im.count = 0;
    this.banner.count = 0; this.pole.count = 0;
    const M = new THREE.Matrix4(), L = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), Y = new THREE.Vector3(0, 1, 0);
    const red = new THREE.Color(0.35, 0.03, 0.02), white = new THREE.Color(0.62, 0.6, 0.55), black = new THREE.Color(0.02, 0.018, 0.016);
    for (const sh of ships) {
      if (sh.gone) continue;
      const b = sh.body;
      M.compose(b.pos, b.quat, one);
      const d = camPos.distanceTo(b.pos);
      // banners at the stern (two on an atake), always drawn
      const m = sh.meta;
      const nb = sh.kind === 'atake' ? 2 : 1;
      for (let k = 0; k < nb; k++) {
        const bz = (m.box ? m.box.y0 : -m.L / 2 + 1.5) + 0.6 + k * 1.4, bx = nb > 1 ? (k ? -1 : 1) * 1.6 : 1.0;
        const by = m.deck_top + 0.2;
        const hgt = sh.kind === 'kobaya' ? 4.2 : 7.0;
        L.compose(p.set(bx, by + hgt / 2, bz), q.identity(), new THREE.Vector3(1, hgt, 1)).premultiply(M);
        this.pole.setMatrixAt(this.pole.count++, L);
        // the banner hangs from the top of its pole, turned to stream downwind
        const s = sh.kind === 'kobaya' ? 0.6 : 1;
        // stream downwind: the wind (relative to the moving ship) in ship-local axes
        const wv = this.wind.uniforms.uWind.value;
        const lw = new THREE.Vector3(wv.x - b.vel.x, 0, wv.y - b.vel.z).applyQuaternion(b.quat.clone().invert());
        L.compose(p.set(bx, by + hgt - 2.7 * s, bz), q.setFromAxisAngle(Y, Math.atan2(-lw.x, -lw.z)), new THREE.Vector3(1, s, s)).premultiply(M);
        const i = this.banner.count++;
        this.banner.setMatrixAt(i, L);
        this.banner.userData.side.setX(i, sh.side === 'A' ? 0 : 1);
      }
      if (d > 320) continue;
      const slots = this.slots[sh.kind];
      const nf = Math.round(Math.min(sh.fighters, sh.kind === 'atake' ? 60 : 40));
      const nr = sh.kind === 'kobaya' ? Math.round(Math.min(b.rowersAlive, m.tholes.length)) : 0;
      let fi = 0, ri = 0;
      for (const sl of slots) {
        const role = sl[4];
        if (role === 'rower') { if (ri++ >= nr) continue; } else if (fi++ >= nf) continue;
        const im = this.meshes[role];
        let yaw = sl[3], bob = 0, lean = 0;
        if (role === 'rower') { lean = 0.15 * Math.sin(b.stroke + sl[2] * 0.3) * (b.rowPow > 0.01 ? 1 : 0.2); }
        else bob = 0.02 * Math.sin(t * 1.3 + sl[2]);
        q.setFromAxisAngle(Y, yaw);
        if (lean) q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), lean));
        L.compose(p.set(sl[0], sl[1] + bob, sl[2]), q, one).premultiply(M);
        im.setMatrixAt(im.count++, L);
        if (role !== 'rower') {
          const fl = this.meshes.flag;
          fl.setMatrixAt(fl.count, L);
          fl.setColorAt(fl.count, sh.side === 'A' ? ((fi & 1) ? red : white) : black);
          fl.count++;
        }
      }
    }
    for (const im of [...Object.values(this.meshes), this.banner, this.pole]) im.instanceMatrix.needsUpdate = true;
    if (this.meshes.flag.instanceColor) this.meshes.flag.instanceColor.needsUpdate = true;
    this.banner.userData.side.needsUpdate = true;
  }
}
