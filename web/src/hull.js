// Ship physics for every warship: one rigid body on the same sea surface that is drawn (from shiomachi's boat.js,
// generalised to the three types and made cheap enough to run dozens at once).
//
// Buoyancy: the hull is cut into columns (stations x strips across). The part of each column below the local sea
// surface pushes up with rho g V at its centre; uneven water gives roll and pitch without any scripted motion.
// The mass is the water displaced at the design waterline, so the ship floats where it was drawn. Ships far from the
// camera use fewer columns (setDetail).
// Water forces per column: drag against the water's orbital motion, split into forward (small), sideways (large: the
// flat bottom and the rudder resist leeway) and vertical (heave and roll damping).
// Oars: each side's oars push forward at their tholes; the push is limited by the rowers' power (P = F v), so a
// ship rows up to a speed where its drag eats the power. Rowing one side harder than the other turns the ship.
// Sail: one square mat sail on a mast that is lowered for battle (hoist 0 = mast down, no sail force).
// Flooding: six compartments (bow, waist, stern x port, starboard). Water runs in through shot holes below the
// waterline (Torricelli), the crew bails it out, and its weight sits low in that compartment: the ship lists
// toward the holed side and settles, and sinks once the water outweighs what the hull can still lift.
import * as THREE from 'three';
import { seaHeight, seaVelocity } from './waves.js';

const RHO = 1025, G = 9.81, RHO_AIR = 1.2;
const V3 = () => new THREE.Vector3();

// per type: rowers per oar, power per rower (W, sustained), rudder area (m2), centre of gravity above the design
// waterline (the superstructure makes the atake top-heavy), crew for bailing
export const KIND = {
  atake: { perOar: 1.4, rudder: 6.5, cgZ: 0.55, fighters: 90, sailK: 0.8 },
  seki: { perOar: 1, rudder: 2.6, cgZ: 0.22, fighters: 30, sailK: 1.0 },
  kobaya: { perOar: 1.5, rudder: 0.8, cgZ: 0.12, fighters: 10, sailK: 1.0 },
};
const P_ROWER = 190;         // W per rower in a hard pull at the oar (a trained crew, for minutes); about 110 W can be kept up for an hour
const F_ROWER = 230;         // N per rower at low speed (a heavy pull on a long sculling oar)
export const BEATS = [0, 0.5, 0.78, 1.0];   // stop, steady, hard, all-out

export class Hull {
  constructor(meta, sea, wind, ground = null, tide = null) {
    this.meta = meta; this.sea = sea; this.wind = wind; this.ground = ground; this.tide = tide;
    this.kind = meta.kind;
    this.K = KIND[meta.kind];
    this.allCols = this.makeCols(meta.stations, 4);
    this.farCols = this.makeCols(meta.stations.filter((_, i) => i % 4 === 1), 2);
    this.cols = this.allCols;
    // mass from the displacement at the design waterline, inertia from the column masses plus the superstructure
    let V = 0; const cb = V3();
    for (const c of this.allCols) { const d = Math.min(Math.max(-c.p.y, 0), c.top); c.v0 = d * c.area; V += c.v0; cb.addScaledVector(V3().copy(c.p).setY(c.p.y + d / 2), c.v0); }
    this.V0 = V;
    this.mass0 = RHO * V;
    cb.divideScalar(V);
    for (const cs of [this.farCols]) {       // scale the coarse columns so they lift the same total
      let v = 0; for (const c of cs) { c.v0 = Math.min(Math.max(-c.p.y, 0), c.top) * c.area; v += c.v0; }
      const k = V / Math.max(v, 1e-6); for (const c of cs) c.area *= k;
    }
    this.cg = new THREE.Vector3(0, this.K.cgZ * meta.D, cb.z);
    const L = meta.L, B = meta.B, H = meta.D + 3;
    const m = this.mass0;
    // box-like radii of gyration (roll ~0.4 B, pitch/yaw ~0.26 L) with added water mass
    this.I = new THREE.Vector3(m * (0.4 * B) ** 2 * 1.3 + m * 0.1 * H * H, m * (0.27 * L) ** 2 * 1.2, m * (0.26 * L) ** 2 * 1.25);
    this.pos = V3(); this.quat = new THREE.Quaternion(); this.vel = V3(); this.angV = V3();
    // controls: rudder (-0.6..0.6), beat 0..3 per side (fractional allowed), hoist (0 = mast down), brace (yard angle)
    this.ctl = { rudder: 0, beatL: 0, beatR: 0, hoist: 0, brace: 0, anchor: null };
    this.rudder = 0; this.hoist = 0; this.brace = 0; this.powL = 0; this.powR = 0;
    this.fatigue = 0;                              // 0 fresh .. 1 spent
    this.rowers = meta.tholes.length * this.K.perOar;
    this.rowersAlive = this.rowers;
    this.stroke = 0;                               // oar phase (radians), advanced by the beat
    // flooding compartments: [bow, waist, stern] x [port, starboard]
    const f0 = meta.stations[0][0], f1 = meta.stations[meta.stations.length - 1][0];
    this.comp = [];
    for (let i = 0; i < 3; i++) for (const s of [1, -1]) {
      const fa = f0 + (f1 - f0) * i / 3, fb = f0 + (f1 - f0) * (i + 1) / 3;
      this.comp.push({ f: (fa + fb) / 2, fa, fb, x: s * B * 0.22, water: 0, cap: 0, holes: [] });
    }
    for (const c of this.allCols) { const k = this.compAt(c.p.z, c.p.x); this.comp[k].cap += (c.top * c.area) * 0.9; }
    this.water = 0;
    this.sail = { depth: 0.5, side: 1, flog: 0, force: 0, aoa: 0 };
    this.appWind = new THREE.Vector2(); this.trueWind = new THREE.Vector2();
    this.current = { x: 0, z: 0 };
    this.t = 0; this.heave = 0; this.seaK = 1; this.grounded = 0; this.subV = 0;
    this.sunk = false;
    this._imp = [];
    this.tmp = { F: V3(), T: V3(), cgw: V3(), f: V3(), r: V3(), pw: V3(), pv: V3(), rel: V3(), at: V3(), fwd: V3(), up: V3(), side: V3(),
      v: V3(), w: V3(), q: new THREE.Quaternion(), qi: new THREE.Quaternion(), wv: { x: 0, y: 0, z: 0 }, a2: new THREE.Vector2(), b2: new THREE.Vector2() };
  }
  makeCols(st, NS) {
    const cols = [];
    const ds = (st[st.length - 1][0] - st[0][0]) / Math.max(st.length - 1, 1);
    for (const [f, pts] of st) {
      const xs = pts[pts.length - 1][0], zs = pts[pts.length - 1][1];
      for (let i = 0; i < NS; i++) {
        const x = -xs + (i + 0.5) * (2 * xs / NS);
        const ax = Math.abs(x);
        let zb = pts[0][1];
        if (ax > pts[0][0]) {
          for (let k = 0; k + 1 < pts.length; k++) {
            const [x0, z0] = pts[k], [x1, z1] = pts[k + 1];
            if (ax >= x0 && ax <= x1) { zb = z0 + (z1 - z0) * (ax - x0) / Math.max(x1 - x0, 1e-6); break; }
            if (k + 2 === pts.length) zb = z1;
          }
        }
        if (zs - zb < 0.05) continue;
        cols.push({ p: new THREE.Vector3(x, zb, f), top: zs - zb, area: (2 * xs / NS) * ds, ds, w: 2 * xs / NS, sub: 0 });
      }
    }
    return cols;
  }
  compAt(f, x) {
    const c0 = this.comp[0];
    const L = this.comp[4].fb - c0.fa;
    const i = THREE.MathUtils.clamp(Math.floor((f - c0.fa) / L * 3), 0, 2);
    return i * 2 + (x >= 0 ? 0 : 1);
  }
  setDetail(near) { this.cols = near ? this.allCols : this.farCols; this.near = near; }
  get mass() { return this.mass0 + this.water * RHO; }
  place(x, z, heading) {
    this.pos.set(x, 0, z);
    this.quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading);
    this.vel.set(0, 0, 0); this.angV.set(0, 0, 0);
  }
  get heading() { const f = this.tmp.v.set(0, 0, 1).applyQuaternion(this.quat); return Math.atan2(f.x, f.z); }
  forward(out = V3()) { return out.set(0, 0, 1).applyQuaternion(this.quat); }
  cgWorld(out = V3()) { return out.copy(this.cg).applyQuaternion(this.quat).add(this.pos); }
  toWorld(p, out = V3()) { return out.copy(p).applyQuaternion(this.quat).add(this.pos); }
  toLocal(pw, out = V3()) { return out.copy(pw).sub(this.pos).applyQuaternion(this.tmp.qi.copy(this.quat).invert()); }
  pointVel(pw, out = V3()) {
    const cgw = this.cgWorld(this.tmp.r);
    return out.copy(this.angV).cross(this.tmp.w.subVectors(pw, cgw)).add(this.vel);
  }
  // an impulse (N s) at a world point: shot striking, the gun's recoil, a collision
  impulse(J, at) { this._imp.push([J.clone(), at.clone()]); }
  // a hole (m2) at a ship-local point; below the waterline it lets water in
  hole(local, area) {
    const c = this.comp[this.compAt(local.z, local.x)];
    c.holes.push({ p: local.clone(), a: area });
  }

  step(dt, t) {
    this.t = t;
    const tm = this.tmp;
    const F = tm.F.set(0, 0, 0), T = tm.T.set(0, 0, 0);
    const cgw = this.cgWorld(tm.cgw);
    const add = (f, at) => { F.add(f); T.add(tm.r.subVectors(at, cgw).cross(f)); };
    const c = this.ctl;
    this.rudder += THREE.MathUtils.clamp(c.rudder - this.rudder, -dt * 0.8, dt * 0.8);
    this.hoist += THREE.MathUtils.clamp(c.hoist - this.hoist, -dt * 0.08, dt * 0.05);    // raising the mast takes a crew ~20 s
    this.brace += THREE.MathUtils.clamp(c.brace - this.brace, -dt * 0.25, dt * 0.25);
    const fwd = this.forward(tm.fwd);
    const up = tm.up.set(0, 1, 0).applyQuaternion(this.quat);
    const side = tm.side.set(1, 0, 0).applyQuaternion(this.quat);
    const cur = this.tide ? this.tide.at(this.pos.x, this.pos.z) : { x: 0, z: 0 };
    this.current = cur;
    // ---- buoyancy and water drag per column
    let subV = 0, touch = 0;
    const pw = tm.pw, pv = tm.pv, rel = tm.rel, at = tm.at, wv = tm.wv;
    const sinkK = this.sunk ? 0.0 : 1;
    for (const col of this.cols) {
      this.toWorld(col.p, pw);
      if (this.ground) {
        const gh = this.ground(pw.x, pw.z);
        const pen = gh - pw.y;
        if (pen > 0) {
          this.pointVel(pw, pv);
          const fn = Math.min(pen, 0.4) * 6.0e5 * col.area - pv.y * 2.5e4 * col.area;
          if (fn > 0) {
            const hv = Math.hypot(pv.x, pv.z) + 1e-3;
            add(tm.f.set(-pv.x / hv * fn * 0.6, fn, -pv.z / hv * fn * 0.6), pw);
            touch += 1;
          }
        }
      }
      const h = seaHeight(this.sea, pw.x, pw.z, t, this.seaK);
      const depth = Math.min(Math.max(h - pw.y, 0), col.top * Math.max(up.y, 0.2));
      col.sub = depth;
      if (depth <= 0) continue;
      const vol = depth * col.area;
      subV += vol;
      at.copy(pw).addScaledVector(up, depth * 0.5);
      add(tm.f.set(0, RHO * G * vol * sinkK, 0), at);
      seaVelocity(this.sea, pw.x, pw.z, t, Math.exp(-depth * 0.2) * this.seaK, wv);
      this.pointVel(at, pv);
      rel.set(pv.x - wv.x - cur.x, pv.y - wv.y, pv.z - wv.z - cur.z);
      const u = rel.dot(fwd), s = rel.dot(side), w = rel.dot(up);
      const latA = depth * col.ds, botA = col.w * col.ds * Math.min(depth / 0.3, 1);
      const fu = -(0.5 * RHO * 0.004 * col.area * 3.2 * u * Math.abs(u) + 8 * col.area * u);
      const fs = -(0.5 * RHO * 1.1 * latA * s * Math.abs(s) + 420 * latA * s);
      const fw = -(0.5 * RHO * 1.2 * botA * w * Math.abs(w) + 2600 * botA * w);
      add(tm.f.copy(fwd).multiplyScalar(fu).addScaledVector(side, fs).addScaledVector(up, fw), at);
    }
    this.subV = subV; this.grounded = touch;
    // wave-making resistance grows steeply past the hull speed
    const U = this.vel.dot(fwd);
    const Fr = Math.abs(U) / Math.sqrt(G * this.meta.L);
    add(tm.f.copy(fwd).multiplyScalar(-Math.sign(U) * this.mass * 0.06 * Math.pow(Fr, 4) * 40), cgw);
    // ---- oars
    this.rowStep(dt, U, add, fwd);
    // ---- sail (mast up only)
    if (this.hoist > 0.02) this.sailStep(dt, t, add, fwd, up, side);
    else { this.sail.force = 0; this.sail.flog = 0; }
    // ---- rudder
    const rp = this.meta.rudder_pivot;
    const rc = this.toWorld(tm.v.set(0, -this.meta.T * 0.6, rp[0] - 0.8), V3());
    const rv = this.pointVel(rc, V3()).sub(tm.v.set(cur.x, 0, cur.z));
    const ru = rv.dot(fwd), rs = rv.dot(side);
    const flowAng = Math.atan2(rs, Math.max(Math.abs(ru), 0.2));
    const alpha = this.rudder + flowAng;
    const sp2 = ru * ru + rs * rs;
    const CLr = 2.2 * Math.sin(2 * THREE.MathUtils.clamp(alpha, -0.55, 0.55)) * (Math.abs(alpha) > 0.55 ? 0.6 : 1);
    const Ar = this.K.rudder;
    add(V3().copy(side).multiplyScalar(-0.5 * RHO * Ar * sp2 * CLr).addScaledVector(fwd, -0.5 * RHO * Ar * sp2 * 0.1 * Math.abs(Math.sin(alpha))), rc);
    // ---- anchor
    if (c.anchor) {
      const bow = this.toWorld(tm.v.set(0, 1.0, this.meta.L * 0.45), V3());
      const d = V3().set(c.anchor.x - bow.x, 0, c.anchor.z - bow.z);
      const L = d.length();
      if (L > c.anchor.len) add(d.normalize().multiplyScalar((L - c.anchor.len) * 2000 * this.meta.L), bow);
    }
    // ---- flooding: water in through holes below the surface, bailed out by the crew; its weight sits low
    this.floodStep(dt, t, add);
    // gravity (the hull's own weight at the centre of gravity)
    add(tm.f.set(0, -this.mass0 * G, 0), cgw);
    // ---- integrate (impulses first)
    const M = this.mass;
    for (const [J, p] of this._imp) { this.vel.addScaledVector(J, 1 / M); const tq = V3().subVectors(p, cgw).cross(J); this._angImp(tq); }
    this._imp.length = 0;
    this.vel.addScaledVector(F, dt / M);
    const inv = tm.qi.copy(this.quat).invert();
    const Tl = V3().copy(T).applyQuaternion(inv);
    const wl = V3().copy(this.angV).applyQuaternion(inv);
    const I = this.I;
    const Iw = V3().set(I.x * wl.x, I.y * wl.y, I.z * wl.z);
    Tl.sub(V3().copy(wl).cross(Iw));
    wl.x += Tl.x / I.x * dt; wl.y += Tl.y / I.y * dt; wl.z += Tl.z / I.z * dt;
    this.angV.copy(wl.applyQuaternion(this.quat));
    const cg0 = this.cgWorld(V3()).addScaledVector(this.vel, dt);
    const wlen = this.angV.length();
    if (wlen > 1e-9) { tm.q.setFromAxisAngle(tm.v.copy(this.angV).divideScalar(wlen), wlen * dt); this.quat.premultiply(tm.q).normalize(); }
    this.pos.copy(cg0).sub(tm.v.copy(this.cg).applyQuaternion(this.quat));
    this.heave = this.vel.y;
  }
  _angImp(tq) {
    const inv = this.tmp.qi.copy(this.quat).invert();
    const tl = V3().copy(tq).applyQuaternion(inv);
    const wl = V3().copy(this.angV).applyQuaternion(inv);
    wl.x += tl.x / this.I.x; wl.y += tl.y / this.I.y; wl.z += tl.z / this.I.z;
    this.angV.copy(wl.applyQuaternion(this.quat));
  }
  rowStep(dt, U, add, fwd) {
    const c = this.ctl;
    // the rowers follow the beat drum; all-out wears them down, a steady beat lets them recover slowly
    const tgtL = BEATS[Math.round(THREE.MathUtils.clamp(c.beatL, 0, 3))] ?? 0;
    const tgtR = BEATS[Math.round(THREE.MathUtils.clamp(c.beatR, 0, 3))] ?? 0;
    this.powL += THREE.MathUtils.clamp(tgtL - this.powL, -dt * 0.6, dt * 0.35);
    this.powR += THREE.MathUtils.clamp(tgtR - this.powR, -dt * 0.6, dt * 0.35);
    const pw = (this.powL + this.powR) / 2;
    this.fatigue = THREE.MathUtils.clamp(this.fatigue + dt * (pw > 0.8 ? 0.004 * (pw - 0.8) / 0.2 : -0.0015 * (1 - pw)), 0, 1);
    const tired = 1 - 0.55 * this.fatigue;
    const perSide = this.rowersAlive / 2;
    // stroke rate ~ 20..40 per minute with the beat
    this.stroke += dt * (2 * Math.PI) * (0.3 + 0.4 * pw) * (pw > 0.01 ? 1 : 0);
    this.rowPow = pw;
    const th = this.meta.tholes;
    const n = th.length / 2;
    const v = Math.max(Math.abs(U), 0.5);
    for (const [side, pow] of [[1, this.powL], [-1, this.powR]]) {
      if (pow < 0.01) continue;
      const Fs = Math.min(F_ROWER, P_ROWER / v) * perSide * pow * tired * (U < -0.2 ? 0.6 : 1);
      // applied at the middle thole of that side
      const mid = th[side > 0 ? Math.floor(n / 2) : n + Math.floor(n / 2)];
      const at = this.toWorld(this.tmp.v.set(mid[1], mid[2], mid[0]), V3());
      add(V3().copy(fwd).multiplyScalar(Fs), at);
    }
  }
  sailStep(dt, t, add, fwd, up, side) {
    const m = this.meta;
    const sailH = m.sail[1] * this.hoist;
    const ceH = m.deck_top + 1.5 + sailH * 0.55;
    const ce = this.toWorld(V3().set(0, ceH, m.mast_f - 0.5), V3());
    const tw = this.wind.at(ce.x, ce.z, t, new THREE.Vector2()).multiplyScalar(Math.pow(Math.max(ce.y, 2) / 10, 0.12));
    this.trueWind.copy(tw);
    const vce = this.pointVel(ce, V3());
    const aw = this.tmp.a2.set(tw.x - vce.x, tw.y - vce.z);
    this.appWind.copy(aw);
    const yd = V3().copy(side).applyAxisAngle(up, this.brace);
    const yd2 = new THREE.Vector2(yd.x, yd.z).normalize();
    const n2 = new THREE.Vector2(-yd2.y, yd2.x);
    const awS = aw.length();
    const sArea = m.sail[0] * sailH * 0.92 * this.K.sailK;
    if (awS < 0.05) return;
    const awN = aw.clone().divideScalar(awS);
    const cn = awN.dot(n2);
    const aoa = Math.asin(THREE.MathUtils.clamp(Math.abs(cn), 0, 1));
    // a flat mat sail: less lift than a cotton one, stalls sooner
    const CL = 1.05 * Math.sin(2 * Math.min(aoa, Math.PI / 4) * 1.6) * (aoa < 0.45 ? 1 : Math.max(0.3, 1 - (aoa - 0.45) * 0.9));
    const CD = 0.1 + 1.2 * Math.pow(Math.sin(aoa), 2);
    const q = 0.5 * RHO_AIR * awS * awS * sArea;
    const liftDir = new THREE.Vector2(-awN.y, awN.x);
    const side2 = Math.sign(cn) || 1;
    if (liftDir.dot(n2) * side2 < 0) liftDir.negate();
    const f2 = awN.clone().multiplyScalar(q * CD).addScaledVector(liftDir, q * CL * (aoa > 0.06 ? 1 : aoa / 0.06));
    add(V3().set(f2.x, 0, f2.y), ce);
    this.sail.side = -side2 * Math.sign(n2.dot(new THREE.Vector2(fwd.x, fwd.z)) || 1);
    this.sail.aoa = aoa;
    this.sail.force = Math.hypot(f2.x, f2.y);
    const press = THREE.MathUtils.clamp(q / sArea / 30, 0, 1);
    const target = aoa < 0.12 ? 0.1 : 0.3 + 1.1 * Math.sqrt(press) * Math.min(aoa / 0.5, 1);
    this.sail.depth += (target - this.sail.depth) * Math.min(dt * 2.5, 1);
    this.sail.flog += ((aoa < 0.14 ? 1 - aoa / 0.14 : 0) * Math.min(awS / 4, 1) - this.sail.flog) * Math.min(dt * 3, 1);
  }
  floodStep(dt, t, add) {
    let total = 0;
    const bail = (this.bailers ?? 0) * 0.004;       // m3/s per bailer (a bucket every few seconds)
    const nb = this.comp.filter((c) => c.water > 0.01).length || 1;
    for (const c of this.comp) {
      let q = 0;
      for (const h of c.holes) {
        const pw = this.toWorld(this.tmp.v.set(h.p.x, h.p.y, h.p.z), V3());
        const head = seaHeight(this.sea, pw.x, pw.z, t, this.seaK) - pw.y;
        if (head > 0) q += 0.62 * h.a * Math.sqrt(2 * G * head);
      }
      c.water = THREE.MathUtils.clamp(c.water + (q - bail / nb) * dt, 0, c.cap);
      total += c.water;
      if (c.water > 0.01) {
        // the water lies low in the compartment; it runs to the lower side as the ship heels
        const at = this.toWorld(this.tmp.v.set(c.x, -this.meta.T * 0.6, c.f), V3());
        add(V3().set(0, -c.water * RHO * G, 0), at);
      }
    }
    this.water = total;
    // over the sheer: once the deck edge is under, the sea pours in and she goes
    if (total > this.V0 * 0.9) this.sunk = true;
  }
  // the master sets the yard so the sail meets the apparent wind at a good angle (shiomachi's autoTrim)
  autoBrace() {
    const aw = this.appWind;
    if (aw.lengthSq() < 0.01) return this.ctl.brace;
    const from = Math.atan2(-aw.x, -aw.y);
    const rel = THREE.MathUtils.euclideanModulo(from - this.heading + Math.PI, Math.PI * 2) - Math.PI;
    return -Math.sign(rel) * THREE.MathUtils.clamp(Math.PI / 2 - Math.abs(rel) + 0.49, 0, 1.2);
  }
  get speed() { return this.vel.dot(this.forward(this.tmp.v)); }
  get heel() { const s = this.tmp.v.set(1, 0, 0).applyQuaternion(this.quat); return Math.asin(THREE.MathUtils.clamp(s.y, -1, 1)); }
  get pitch() { const f = this.tmp.v.set(0, 0, 1).applyQuaternion(this.quat); return Math.asin(THREE.MathUtils.clamp(f.y, -1, 1)); }
}
