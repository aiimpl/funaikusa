// Shot in flight and what it hits. Numbers from ref/GUNS.md (the muzzle speeds of Japanese large guns are not recorded;
// ~250 m/s for a short black-powder gun is an estimate):
//   oozutsu  1-kanme ball (lead, 3.75 kg, 86 mm)          250 m/s   reload ~20 s (game time, the real one was minutes)
//   ishibiya 47 mm iron ball (0.42 kg)                     230 m/s   reload ~7 s (a spare chamber is dropped in)
//   teppo    6-monme lead ball (22 g, 16 mm)               330 m/s   ~20 s a man; a file of them keeps up a fire
//   horoku   clay fire pot (2.5 kg) swung on a rope        14 m/s
// Balls fly with gravity and quadratic air drag (sphere, Cd 0.47), so a low shot at the waterline is flat and fast
// while a long lob loses most of its speed. Each step the path segment is tested against every ship's boxes
// (the hull below the sheer, and the superstructure) in that ship's own frame, so heel and pitch count.
import * as THREE from 'three';
import { seaHeight } from './waves.js';

const RHO_AIR = 1.2, G = 9.81;
export const GUN = {
  oozutsu: { m: 3.75, d: 0.086, v0: 250, reload: 20, charge: 1.0, spread: 0.004 },
  ishibiya: { m: 0.42, d: 0.047, v0: 230, reload: 7, charge: 0.4, spread: 0.007 },
  teppo: { m: 0.022, d: 0.016, v0: 330, reload: 20, charge: 0.06, spread: 0.012 },
  horoku: { m: 2.5, d: 0.18, v0: 14, reload: 6, charge: 0, spread: 0.08, fire: true },
};

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3(), _q = new THREE.Quaternion();

// ship-local boxes (x lateral, y up, z forward): hull and superstructure, from the type's meta
export function shipBoxes(meta) {
  const L = meta.L, B = meta.B;
  const zt = meta.deck_top;
  const box = meta.box;
  const bx = B / 2 + (box?.ov ?? 0);
  const out = [{ min: new THREE.Vector3(-B / 2, -meta.T - 0.1, -L / 2), max: new THREE.Vector3(B / 2, zt - (box ? box.gap + box.tiers.reduce((a, b) => a + b, 0) : 0) + 0.2, L / 2), part: 'hull' }];
  if (meta.kind !== 'kobaya') out.push({ min: new THREE.Vector3(-bx, zt - box.gap - box.tiers.reduce((a, b) => a + b, 0), box.y0), max: new THREE.Vector3(bx, zt, box.y1), part: 'yagura' });
  else out.push({ min: new THREE.Vector3(-B / 2, zt - 0.4, -L / 2 + 1), max: new THREE.Vector3(B / 2, zt + 0.8, L / 2 - 1.5), part: 'yagura' });
  return out;
}

// segment p0 -> p1 against an axis-aligned box: entry fraction or -1
function segBox(p0, p1, bmin, bmax) {
  let t0 = 0, t1 = 1;
  for (const k of ['x', 'y', 'z']) {
    const d = p1[k] - p0[k];
    if (Math.abs(d) < 1e-9) { if (p0[k] < bmin[k] || p0[k] > bmax[k]) return -1; continue; }
    let a = (bmin[k] - p0[k]) / d, b = (bmax[k] - p0[k]) / d;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
    if (t0 > t1) return -1;
  }
  return t0;
}

export class Gunnery {
  constructor(fx, sea) {
    this.fx = fx; this.sea = sea;
    this.balls = [];
    this.events = [];
    // visible balls: small dark spheres (the big ones can be followed by eye)
    this.mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshBasicMaterial({ color: 0x0a0907 }), 256);
    this.mesh.count = 0; this.mesh.frustumCulled = false;
  }
  // from: the firing ship (its velocity is added), at: muzzle (world), dir: unit bore direction
  fire(type, from, at, dir, t) {
    const g = GUN[type];
    const sp = g.spread;
    const d = dir.clone().add(new THREE.Vector3((Math.random() - 0.5) * sp * 2, (Math.random() - 0.5) * sp * 2, (Math.random() - 0.5) * sp * 2)).normalize();
    const v = d.multiplyScalar(g.v0 * (0.97 + Math.random() * 0.06));
    if (from) v.add(from.body.vel);
    this.balls.push({ type, g, p: at.clone(), v, from, t0: t, k: 0.5 * RHO_AIR * 0.47 * Math.PI * (g.d / 2) ** 2 / g.m });
    if (g.charge > 0) {
      this.fx.muzzle(at, dir, g.charge, from?.body.vel);
      // recoil on the ship: the ball's momentum (and the powder gases, about half as much again)
      if (from) from.body.impulse(dir.clone().multiplyScalar(-g.m * g.v0 * 1.5), at);
      this.events.push({ kind: 'fire', type, at: at.clone(), from });
    }
  }
  update(dt, t, ships) {
    const n = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / n;
    const keep = [];
    for (const b of this.balls) {
      let alive = true;
      for (let s = 0; s < n && alive; s++) {
        const p0 = _a.copy(b.p);
        const sp = b.v.length();
        b.v.addScaledVector(b.v, -b.k * sp * h);
        b.v.y -= G * h;
        b.p.addScaledVector(b.v, h);
        // ships
        for (const sh of ships) {
          if (sh === b.from && t - b.t0 < 0.3) continue;
          if (sh.gone) continue;
          const bd = sh.body;
          if (bd.pos.distanceToSquared(b.p) > (sh.meta.L * 0.7 + 10) ** 2) continue;
          _q.copy(bd.quat).invert();
          const l0 = _b.copy(p0).sub(bd.pos).applyQuaternion(_q);
          const l1 = _d.copy(b.p).sub(bd.pos).applyQuaternion(_q);
          let best = 2, part = null;
          for (const bx of sh.boxes) {
            const f = segBox(l0, l1, bx.min, bx.max);
            if (f >= 0 && f < best) { best = f; part = bx.part; }
          }
          if (part) {
            const local = l0.clone().lerp(l1, best);
            const world = p0.clone().lerp(b.p, best);
            this.events.push({ kind: 'hit', type: b.type, ship: sh, part, local, world, vel: b.v.clone(), energy: 0.5 * b.g.m * b.v.lengthSq(), from: b.from });
            if (b.g.charge > 0.2) this.fx.splinters(world, b.v.clone().normalize(), Math.min(b.g.m, 2));
            if (b.g.m > 0.3) bd.impulse(b.v.clone().multiplyScalar(b.g.m), world);
            alive = false; break;
          }
        }
        if (!alive) break;
        // the sea
        const hs = seaHeight(this.sea, b.p.x, b.p.z, t, 1);
        if (b.p.y < hs) {
          this.events.push({ kind: 'splash', type: b.type, world: b.p.clone(), energy: 0.5 * b.g.m * b.v.lengthSq(), from: b.from });
          const e = Math.min(0.5 * b.g.m * b.v.lengthSq() / 60000, 2.2);
          if (b.type === 'teppo') { if (Math.random() < 0.5) this.fx.spawn(1, b.p.x, hs + 0.05, b.p.z, 0, 3 + Math.random() * 2, 0, 0.1, 0.8, { drag: 0.1 }); }
          else this.fx.splash(new THREE.Vector3(b.p.x, hs, b.p.z), Math.max(e, 0.25));
          alive = false;
        }
        if (t - b.t0 > 12) alive = false;
      }
      if (alive) keep.push(b);
    }
    this.balls = keep;
    // draw the heavy balls
    let i = 0;
    const m4 = new THREE.Matrix4();
    for (const b of this.balls) {
      if (b.type === 'teppo') continue;
      const r = b.type === 'horoku' ? 0.09 : b.g.d / 2 * 1.4;
      m4.makeScale(r, r, r).setPosition(b.p);
      this.mesh.setMatrixAt(i++, m4);
      if (i >= 256) break;
      if (b.g.fire) this.fx.burn(b.p, 0.25, dt);
    }
    this.mesh.count = i;
    this.mesh.instanceMatrix.needsUpdate = true;
    const ev = this.events; this.events = [];
    return ev;
  }
  // where a shot fired now would first come down to the sea (for the aiming line): a list of points
  predict(type, at, dir, vship, t, maxT = 8) {
    const g = GUN[type];
    const p = at.clone(), v = dir.clone().multiplyScalar(g.v0).add(vship ?? new THREE.Vector3());
    const k = 0.5 * RHO_AIR * 0.47 * Math.PI * (g.d / 2) ** 2 / g.m;
    const pts = [p.clone()];
    const h = 1 / 60;
    for (let s = 0; s < maxT / h; s++) {
      const sp = v.length();
      v.addScaledVector(v, -k * sp * h); v.y -= G * h;
      p.addScaledVector(v, h);
      if (s % 3 === 0) pts.push(p.clone());
      if (p.y < 0) { pts.push(p.clone().setY(0)); break; }
    }
    return pts;
  }
}
