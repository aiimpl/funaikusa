// Ship physics: one rigid body on the same sea surface that is drawn.
//
// Buoyancy: the hull is cut into columns (48 stations x 6 strips across). Each column reaches from the hull
// bottom at that point up to the sheer; the part below the local sea surface pushes up with rho g V at its centre.
// Uneven water across the beam and along the length gives roll and pitch without any scripted motion.
// The mass is the water displaced at the design waterline (z = 0), so the ship floats where it was drawn.
//
// Water forces per column: drag against the water's own orbital motion, split into forward (small, the hull is
// fair), sideways (large, the flat bottom and the rudder resist leeway) and vertical (heave/roll damping).
// Sail: a square sail. Apparent wind = true wind (with gusts, stronger aloft) minus the ship's own motion.
// Lift and drag of a cambered square sail from the angle of attack, applied at the centre of effort, so the ship heels
// and weather helm appears. Rudder: lift from its angle to the local flow, stalls past ~30 deg.
// Sculling oar (ro): a small forward push at the stern for harbours and calms.
import * as THREE from 'three';
import { seaHeight, seaVelocity } from './waves.js';

const RHO = 1025, G = 9.81, RHO_AIR = 1.2;
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _f = new THREE.Vector3(), _r = new THREE.Vector3(), _q = new THREE.Quaternion();

export class Boat {
  constructor(meta, sea, wind, ground = null, tide = null) {
    this.sea = sea; this.wind = wind; this.ground = ground; this.tide = tide;
    this.grounded = 0;
    this.cols = [];
    const st = meta.stations;
    const ds = (st[st.length - 1][0] - st[0][0]) / (st.length - 1);
    const NS = 6;
    for (const [f, pts] of st) {
      // pts: edge points (x, z) from the bottom edge up to the sheer (port side)
      const xs = pts[pts.length - 1][0];
      const zs = pts[pts.length - 1][1];
      for (let i = 0; i < NS; i++) {
        const x = -xs + (i + 0.5) * (2 * xs / NS);
        const ax = Math.abs(x);
        // hull bottom height at this half-breadth: the flat bottom inside the first edge, else along the edges
        let zb = pts[0][1];
        if (ax > pts[0][0]) {
          for (let k = 0; k + 1 < pts.length; k++) {
            const [x0, z0] = pts[k], [x1, z1] = pts[k + 1];
            if (ax >= x0 && ax <= x1) { zb = z0 + (z1 - z0) * (ax - x0) / Math.max(x1 - x0, 1e-6); break; }
            if (k + 2 === pts.length) zb = z1;
          }
        }
        if (zs - zb < 0.05) continue;
        this.cols.push({ p: new THREE.Vector3(x, zb, f), top: zs - zb, area: (2 * xs / NS) * ds, ds, w: 2 * xs / NS, sub: 0 });
      }
    }
    // mass from the displacement at the design waterline, inertia from the column masses plus the rig
    let V = 0; const cg = new THREE.Vector3();
    for (const c of this.cols) { const d = Math.min(Math.max(0 - c.p.y, 0), c.top); c.v0 = d * c.area; V += c.v0; cg.addScaledVector(c.p.clone().setY(c.p.y + d / 2), c.v0); }
    this.mass = RHO * V;
    this.cob0 = cg.divideScalar(V);
    // centre of gravity: over the centre of buoyancy; cargo sits low in the hold, but the deck load, the mast, yard and sail
    // (about 5 t, centred ~14 m up) lift it to just above the waterline
    this.cg = new THREE.Vector3(0, 0.25, this.cob0.z);
    let Ixx = 0, Iyy = 0, Izz = 0;
    for (const c of this.cols) {
      const m = this.mass * c.v0 / V, r = c.p.clone().sub(this.cg);
      Ixx += m * (r.y * r.y + r.z * r.z) + m * 1.0; Iyy += m * (r.x * r.x + r.z * r.z); Izz += m * (r.x * r.x + r.y * r.y) + m * 1.5;
    }
    // added mass of the water moving with the hull, plus the rig high above (5 t at ~14 m: ~1e6 kg m2 in roll and pitch)
    this.I = new THREE.Vector3(Ixx * 1.25 + 1.0e6, Iyy * 1.1, Izz * 1.3 + 1.0e6);
    this.pos = new THREE.Vector3(0, 0, 0);          // position of the ship origin (midships, design waterline)
    this.quat = new THREE.Quaternion();
    this.vel = new THREE.Vector3();                 // velocity of the centre of gravity
    this.angV = new THREE.Vector3();                // angular velocity, world frame
    // controls
    this.ctl = { rudder: 0, hoist: 1, brace: 0, ro: 0, anchor: null };
    this.rudder = 0; this.hoist = 1; this.brace = 0;
    // outputs for visuals / HUD
    this.sail = { depth: 1.2, side: 1, flog: 0, draft: 0, aoa: 0, force: 0 };
    this.appWind = new THREE.Vector2(); this.trueWind = new THREE.Vector2();
    this.meta = meta;
    this.t = 0;
    this.heave = 0;
    this.seaK = 1;
  }
  place(x, z, heading) {
    this.pos.set(x, 0, z);
    this.quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading);
    this.vel.set(Math.sin(heading), 0, Math.cos(heading)).multiplyScalar(0);
    this.angV.set(0, 0, 0);
  }
  get heading() { const f = _v.set(0, 0, 1).applyQuaternion(this.quat); return Math.atan2(f.x, f.z); }
  forward(out = new THREE.Vector3()) { return out.set(0, 0, 1).applyQuaternion(this.quat); }
  cgWorld(out = new THREE.Vector3()) { return out.copy(this.cg).applyQuaternion(this.quat).add(this.pos); }
  // world point of a ship-local point
  toWorld(p, out = new THREE.Vector3()) { return out.copy(p).applyQuaternion(this.quat).add(this.pos); }
  pointVel(pw, out = new THREE.Vector3()) {
    const cgw = this.cgWorld(_r);
    return out.copy(this.angV).cross(_w.subVectors(pw, cgw)).add(this.vel);
  }

  step(dt, t) {
    this.t = t;
    const F = new THREE.Vector3(), T = new THREE.Vector3();
    const cgw = this.cgWorld(new THREE.Vector3());
    const add = (f, at) => { F.add(f); T.add(_r.subVectors(at, cgw).cross(f)); };
    // controls move at the speed of the crew
    const c = this.ctl;
    this.rudder += THREE.MathUtils.clamp(c.rudder - this.rudder, -dt * 0.7, dt * 0.7);
    this.hoist += THREE.MathUtils.clamp(c.hoist - this.hoist, -dt * 0.16, dt * 0.1);     // lowering is faster than hoisting
    this.brace += THREE.MathUtils.clamp(c.brace - this.brace, -dt * 0.25, dt * 0.25);
    const fwd = this.forward(new THREE.Vector3());
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.quat);
    const side = new THREE.Vector3(1, 0, 0).applyQuaternion(this.quat);   // to port
    // ---- buoyancy and water drag per column
    const wv = { x: 0, y: 0, z: 0 };
    // the tidal stream under the ship (the hull is dragged along with the moving water)
    const cur = this.tide ? this.tide.at(this.pos.x, this.pos.z) : { x: 0, z: 0 };
    this.current = cur;
    let subV = 0, subArea = 0;
    const pw = new THREE.Vector3(), rel = new THREE.Vector3(), pv = new THREE.Vector3();
    let touch = 0;
    for (const col of this.cols) {
      this.toWorld(col.p, pw);
      // the sea bed: a stiff, heavily damped contact with sliding friction (running aground)
      if (this.ground) {
        const gh = this.ground(pw.x, pw.z);
        const pen = gh - pw.y;
        if (pen > 0) {
          this.pointVel(pw, pv);
          const fn = Math.min(pen, 0.4) * 6.0e5 * col.area - pv.y * 2.5e4 * col.area;
          if (fn > 0) {
            const hv = Math.hypot(pv.x, pv.z) + 1e-3;
            add(_f.set(-pv.x / hv * fn * 0.6, fn, -pv.z / hv * fn * 0.6), pw);
            touch += 1;
          }
        }
      }
      const h = seaHeight(this.sea, pw.x, pw.z, t, this.seaK);
      const depth = Math.min(Math.max(h - pw.y, 0), col.top * Math.max(up.y, 0.2));
      col.sub = depth;
      if (depth <= 0) continue;
      const vol = depth * col.area;
      subV += vol; subArea += col.area;
      // centre of the submerged part of the column, along the ship's up
      const at = pw.clone().addScaledVector(up, depth * 0.5);
      add(_f.set(0, RHO * G * vol, 0), at);
      // drag against the water's orbital motion (decays with depth)
      seaVelocity(this.sea, pw.x, pw.z, t, Math.exp(-depth * 0.2) * this.seaK, wv);
      this.pointVel(at, pv);
      rel.set(pv.x - wv.x - cur.x, pv.y - wv.y, pv.z - wv.z - cur.z);
      const u = rel.dot(fwd), s = rel.dot(side), w = rel.dot(up);
      const latA = depth * col.ds, botA = col.w * col.ds * Math.min(depth / 0.3, 1);
      const fu = -(0.5 * RHO * 0.004 * col.area * 3.2 * u * Math.abs(u) + 8 * col.area * u);
      const fs = -(0.5 * RHO * 1.1 * latA * s * Math.abs(s) + 420 * latA * s);
      const fw = -(0.5 * RHO * 1.2 * botA * w * Math.abs(w) + 2600 * botA * w);
      add(_f.copy(fwd).multiplyScalar(fu).addScaledVector(side, fs).addScaledVector(up, fw), at);
    }
    this.subV = subV;
    this.grounded = touch;
    // wave-making resistance grows steeply past the hull speed (~ 1.34 sqrt(L ft) knots; L ~ 21 m -> ~6.6 m/s)
    const U = this.vel.dot(fwd);
    const Fr = Math.abs(U) / Math.sqrt(G * 21);
    add(fwd.clone().multiplyScalar(-Math.sign(U) * this.mass * 0.06 * Math.pow(Fr, 4) * 40), cgw);
    // ---- sail
    const rig = this.meta.rig;
    const deckY = rig.mast_foot[2];
    const sailH = this.meta.sail[1] * Math.max(this.hoist, 0.05);
    const ceH = deckY + 2.2 + sailH * 0.55;                      // centre of effort above the design waterline
    const ce = this.toWorld(new THREE.Vector3(0, ceH, rig.mast_top[0] - 0.8), new THREE.Vector3());
    const tw = this.wind.at(ce.x, ce.z, t, new THREE.Vector2()).multiplyScalar(Math.pow(Math.max(ce.y, 2) / 10, 0.12));
    this.trueWind.copy(tw);
    const vce = this.pointVel(ce, new THREE.Vector3());
    const aw = new THREE.Vector2(tw.x - vce.x, tw.y - vce.z);
    this.appWind.copy(aw);
    // sail plane: along the yard; the yard is braced by angle 'brace' about the mast from athwartships
    const yd = side.clone().applyAxisAngle(up, this.brace);
    const yd2 = new THREE.Vector2(yd.x, yd.z).normalize();
    const n2 = new THREE.Vector2(-yd2.y, yd2.x);                 // sail normal (horizontal)
    const awS = aw.length();
    const sArea = this.meta.sail[0] * sailH * 0.92;
    if (awS > 0.05) {
      const awN = aw.clone().divideScalar(awS);
      const cn = awN.dot(n2);                                     // wind across the sail
      const ca = awN.dot(yd2);
      const aoa = Math.asin(THREE.MathUtils.clamp(Math.abs(cn), 0, 1));  // 0 = edge-on, 90 deg = square to the wind
      // cambered square sail: lift peaks near 25-30 deg, then it stalls into pure drag
      const CL = 1.35 * Math.sin(2 * Math.min(aoa, Math.PI / 4) * 1.6) * (aoa < 0.49 ? 1 : Math.max(0.35, 1 - (aoa - 0.49) * 0.9));
      const CD = 0.08 + 1.25 * Math.pow(Math.sin(aoa), 2);
      const q = 0.5 * RHO_AIR * awS * awS * sArea;
      // lift is perpendicular to the apparent wind, toward the side the sail bellies to (downwind side of the sail)
      const liftDir = new THREE.Vector2(-awN.y, awN.x);
      const side2 = Math.sign(cn) || 1;
      if (liftDir.dot(n2) * side2 < 0) liftDir.negate();
      const f2 = awN.clone().multiplyScalar(q * CD).addScaledVector(liftDir, q * CL * (aoa > 0.06 ? 1 : aoa / 0.06));
      add(new THREE.Vector3(f2.x, 0, f2.y), ce);
      this.sail.side = -side2 * Math.sign(n2.dot(new THREE.Vector2(fwd.x, fwd.z)) || 1);
      this.sail.aoa = aoa;
      this.sail.force = Math.hypot(f2.x, f2.y);
      // the cloth: depth grows with pressure, flogging when nearly edge-on; the draft moves toward the windward edge
      const press = THREE.MathUtils.clamp(q / sArea / 30, 0, 1);   // 1 at ~7 m/s apparent wind
      // a loose-footed square sail bags deeply: up to ~3.5 m in a good breeze with the wind well aft
      const target = aoa < 0.12 ? 0.2 : 0.9 + 2.8 * Math.sqrt(press) * Math.min(aoa / 0.5, 1);
      this.sail.depth += (target - this.sail.depth) * Math.min(dt * 2.5, 1);
      this.sail.flog += ((aoa < 0.14 ? 1 - aoa / 0.14 : 0) * Math.min(awS / 4, 1) - this.sail.flog) * Math.min(dt * 3, 1);
      this.sail.draft = ca * 0.8;
    }
    // ---- rudder: area ~ 7 m2 below the water, lift against the local flow
    const rp = rig.rudder_pivot;
    const rc = this.toWorld(new THREE.Vector3(0, -1.0, rp[0] - 1.5), new THREE.Vector3());
    const rv = this.pointVel(rc, new THREE.Vector3()).sub(new THREE.Vector3(cur.x, 0, cur.z));
    const ru = rv.dot(fwd), rs = rv.dot(side);
    const flowAng = Math.atan2(rs, Math.max(Math.abs(ru), 0.2));
    const alpha = this.rudder + flowAng;
    const sp2 = ru * ru + rs * rs;
    const CLr = 2.2 * Math.sin(2 * THREE.MathUtils.clamp(alpha, -0.55, 0.55)) * (Math.abs(alpha) > 0.55 ? 0.6 : 1);
    const Fr_ = 0.5 * RHO * 7.0 * sp2 * CLr;
    add(side.clone().multiplyScalar(-Fr_).addScaledVector(fwd, -0.5 * RHO * 7 * sp2 * 0.1 * Math.abs(Math.sin(alpha))), rc);
    // ---- sculling oar at the stern (about 2 kN, and a little sideways when steering)
    if (c.ro) add(fwd.clone().multiplyScalar(2200 * c.ro), this.toWorld(new THREE.Vector3(0, 0, rp[0] + 0.5), new THREE.Vector3()));
    // ---- anchor: an elastic rode to the anchor on the bottom
    if (c.anchor) {
      const bow = this.toWorld(new THREE.Vector3(0, 1.5, 9.5), new THREE.Vector3());
      const d = new THREE.Vector3(c.anchor.x - bow.x, 0, c.anchor.z - bow.z);
      const L = d.length();
      if (L > c.anchor.len) add(d.normalize().multiplyScalar((L - c.anchor.len) * 9000), bow);
    }
    // gravity
    add(_f.set(0, -this.mass * G, 0), cgw);
    // ---- integrate
    this.vel.addScaledVector(F, dt / this.mass);
    // torque in ship frame -> angular acceleration with the diagonal inertia
    const inv = this.quat.clone().invert();
    const Tl = T.clone().applyQuaternion(inv);
    const wl = this.angV.clone().applyQuaternion(inv);
    const I = this.I;
    // Euler's equations (with the gyroscopic term)
    const Iw = new THREE.Vector3(I.x * wl.x, I.y * wl.y, I.z * wl.z);
    Tl.sub(wl.clone().cross(Iw));
    wl.x += Tl.x / I.x * dt; wl.y += Tl.y / I.y * dt; wl.z += Tl.z / I.z * dt;
    this.angV.copy(wl.applyQuaternion(this.quat));
    const cg0 = this.cgWorld(new THREE.Vector3()).addScaledVector(this.vel, dt);
    const wlen = this.angV.length();
    if (wlen > 1e-9) { _q.setFromAxisAngle(_v.copy(this.angV).divideScalar(wlen), wlen * dt); this.quat.premultiply(_q).normalize(); }
    // keep the centre of gravity on its path while the body turns about it
    this.pos.copy(cg0).sub(_v.copy(this.cg).applyQuaternion(this.quat));
    this.heave = this.vel.y;
  }
  get speed() { return this.vel.dot(this.forward(new THREE.Vector3())); }
  get heel() { const s = new THREE.Vector3(1, 0, 0).applyQuaternion(this.quat); return Math.asin(THREE.MathUtils.clamp(s.y, -1, 1)); }
  get pitch() { const f = this.forward(new THREE.Vector3()); return Math.asin(THREE.MathUtils.clamp(f.y, -1, 1)); }
}
