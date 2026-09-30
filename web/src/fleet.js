// The fleet: every ship's state beyond its physics (crew, damage, fire, guns), the captains' orders, and the fights.
//
// Crew: rowers (below the shield walls, or open on a kobaya) and fighters (on the fighting deck). Fighters work the
// muskets through the ports, throw fire pots at close range, fight fires and board. Morale falls with losses and fire
// and rises with a flagship nearby; a ship whose morale breaks stops fighting and runs.
// Damage: a ball below the waterline makes a hole (the hull floods through it, hull.js); above, it kills and wounds
// behind the boards; on the oar tier it breaks oars and rowers. A fire pot sets a section (bow, waist, stern) alight:
// fire grows on its own, spreads to the next section, and is beaten down by fighters taken off the ports.
// Boarding: two ships side by side are grappled (a spring between them) and the fighters fight across; the losing
// side's ship is taken.
// Captains (AI) steer by the same controls as the player: a heading and a beat, from their order and target:
//   follow   hold a slot in the line on the flagship        scatter   spread out, close the enemy from wide angles
//   surround pick a bearing round the target and close     retreat   row away from the enemy
// Big ships (atake) keep their distance and point their bows (their guns) at the enemy; the small ones close in to
// throw fire pots and board.
import * as THREE from 'three';
import { GUN, shipBoxes } from './gunnery.js';
import { KIND } from './hull.js';

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _f = new THREE.Vector3();
const wrap = (a) => THREE.MathUtils.euclideanModulo(a + Math.PI, Math.PI * 2) - Math.PI;
const S2L = (p) => new THREE.Vector3(p[1], p[2], p[0]);

export const ORDERS = ['follow', 'scatter', 'surround', 'retreat'];

// closest points between segments p0-p1 and q0-q1 (outputs into a, b)
function closestSegSeg(p0, p1, q0, q1, a, b) {
  const d1 = new THREE.Vector3().subVectors(p1, p0), d2 = new THREE.Vector3().subVectors(q1, q0), r = new THREE.Vector3().subVectors(p0, q0);
  const A = d1.dot(d1), E = d2.dot(d2), F = d2.dot(r);
  let s = 0, t = 0;
  const C = d1.dot(r), Bb = d1.dot(d2), den = A * E - Bb * Bb;
  s = den > 1e-9 ? THREE.MathUtils.clamp((Bb * F - C * E) / den, 0, 1) : 0;
  t = (Bb * s + F) / E;
  if (t < 0) { t = 0; s = THREE.MathUtils.clamp(-C / A, 0, 1); } else if (t > 1) { t = 1; s = THREE.MathUtils.clamp((Bb - C) / A, 0, 1); }
  a.copy(p0).addScaledVector(d1, s); b.copy(q0).addScaledVector(d2, t);
}

export class Fleet {
  constructor({ art, sea, wind, tide, ground, Hull, gunnery, fx }) {
    this.art = art; this.sea = sea; this.wind = wind; this.tide = tide; this.ground = ground; this.Hull = Hull;
    this.gunnery = gunnery; this.fx = fx;
    this.ships = [];
    this.orders = { A: 'follow', B: 'follow' };
    this.grapples = [];
    this.log = [];
    this.aiT = 0;
  }
  add(kind, side, x, z, heading, { flagship = false, player = false } = {}) {
    const meta = this.art.kinds[kind].meta;
    const body = new this.Hull(meta, this.sea, this.wind, this.ground, this.tide);
    body.place(x, z, heading);
    const K = KIND[kind];
    const s = {
      id: this.ships.length, kind, side, meta, body, boxes: shipBoxes(meta), player, flagship,
      mastDown: 1, burn: [0, 0, 0], fire: [0, 0, 0], hp: [1, 1, 1, 1, 1, 1],
      rowers0: body.rowers, fighters0: K.fighters, fighters: K.fighters, morale: 1, broken: false, taken: false, gone: false, sinkT: 0,
      guns: (meta.guns ?? []).map((p) => ({ type: 'oozutsu', at: S2L(p), reload: Math.random() * 5 })),
      musketT: Math.random() * 2, horokuT: 2 + Math.random() * 3,
      ai: { target: null, slot: null, heading: heading, beat: 1, think: Math.random() * 0.2, bearing: Math.random() * Math.PI * 2 },
      alive: true, kills: 0,
    };
    // the seki carries a swivel gun at the bow instead of a big gun when it has no mount
    if (kind === 'seki' && s.guns.length) s.guns[0].type = 'oozutsu';
    if (kind === 'kobaya') s.guns = [];
    body.bailers = 0;
    this.ships.push(s);
    return s;
  }
  enemiesOf(s) { return this.ships.filter((o) => o.side !== s.side && o.alive && !o.taken); }
  flagshipOf(side) { return this.ships.find((o) => o.side === side && o.flagship && o.alive && !o.taken) ?? null; }
  nearestEnemy(s, maxD = 1e9) {
    let best = null, bd = maxD;
    for (const o of this.ships) {
      if (o.side === s.side || !o.alive || o.taken) continue;
      const d = o.body.pos.distanceTo(s.body.pos);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  // ---- per frame -----------------------------------------------------------------------------------------
  update(dt, t, events) {
    for (const ev of events) this.apply(ev, t);
    this.aiT += dt;
    const think = this.aiT >= 0.2;
    if (think) this.aiT = 0;
    for (const s of this.ships) {
      if (!s.alive) { this.sinking(s, dt); continue; }
      this.crewWork(s, dt);
      this.fires(s, dt);
      if (!s.player && think) this.captain(s, 0.2);
      if (!s.taken) this.weapons(s, dt, t);
      this.morale(s, dt);
      if (s.body.sunk || s.body.water > s.body.V0 * 0.6) this.founder(s, t);
    }
    this.boarding(dt, t);
    this.collide(dt);
  }
  // hulls do not pass through each other: each ship is a capsule (its centre line, radius half the beam); overlapping
  // pairs are pushed apart at the contact point with a stiff spring and damper, and rub along with some friction
  collide(dt) {
    const S = this.ships.filter((s) => !s.gone && s.body.pos.y > -2);
    const seg = (s, a, b) => { const f = s.body.forward(_f).setY(0).normalize(); const h = s.meta.L * 0.42; a.copy(s.body.pos).addScaledVector(f, -h).setY(0); b.copy(s.body.pos).addScaledVector(f, h).setY(0); };
    const a0 = new THREE.Vector3(), a1 = new THREE.Vector3(), b0 = new THREE.Vector3(), b1 = new THREE.Vector3();
    const pa = new THREE.Vector3(), pb = new THREE.Vector3();
    for (let i = 0; i < S.length; i++) for (let j = i + 1; j < S.length; j++) {
      const A = S[i], B = S[j];
      const R = (A.meta.L + B.meta.L) * 0.5;
      if (A.body.pos.distanceToSquared(B.body.pos) > R * R) continue;
      seg(A, a0, a1); seg(B, b0, b1);
      closestSegSeg(a0, a1, b0, b1, pa, pb);
      const d = _v.subVectors(pb, pa); const L = d.length();
      const rr = A.meta.B * 0.5 + B.meta.B * 0.5;
      if (L >= rr || L < 1e-6) continue;
      const n = d.divideScalar(L);
      const pen = rr - L;
      const m = Math.min(A.body.mass, B.body.mass);
      const va = A.body.pointVel(pa.setY(0.3), new THREE.Vector3()), vb = B.body.pointVel(pb.setY(0.3), new THREE.Vector3());
      const rv = vb.sub(va); rv.y = 0;
      const vn = rv.dot(n);
      const fn = Math.max(0, pen * m * 3.0 - vn * m * 1.2);
      const vt = rv.clone().addScaledVector(n, -vn);
      const J = n.clone().multiplyScalar(fn * dt).addScaledVector(vt, -0.25 * m * dt);
      B.body.impulse(J, pb);
      A.body.impulse(J.clone().negate(), pa);
      // a hard ram hurts the lighter ship (planks sprung at the waterline)
      // (once per meeting: the pair is remembered for a few seconds)
      const key = A.id * 1000 + B.id;
      this.rams ??= new Map();
      if (A.side !== B.side && -vn > 2.5 && !(this.rams.get(key) > A.body.t)) {
        this.rams.set(key, A.body.t + 4);
        const hurt = A.body.mass < B.body.mass ? A : B;
        hurt.body.hole(hurt.body.toLocal(hurt === A ? pa : pb, new THREE.Vector3()).setY(-0.2), 0.004 * (-vn));
        this.note('rammed', hurt);
      }
    }
  }
  crewWork(s, dt) {
    // fighters split between the ports, the fires and the bailing
    const burning = s.fire.reduce((a, b) => a + b, 0);
    const flooding = s.body.water > 0.2;
    const fF = Math.min(0.7, burning * 0.5), fB = flooding ? Math.min(0.4, s.body.water / 10) : 0;
    s.fireCrew = s.fighters * fF;
    s.body.bailers = s.fighters * fB + (flooding ? s.body.rowersAlive * 0.2 : 0);
    s.gunCrew = Math.max(0, s.fighters * (1 - fF - fB));
    s.body.rowersAlive = Math.max(0, Math.min(s.body.rowersAlive, s.rowers0));
  }
  fires(s, dt) {
    const f = s.fire;
    for (let i = 0; i < 3; i++) {
      if (f[i] <= 0) continue;
      // grows by itself, is beaten down by the crew on it, spreads fore and aft once it is well alight
      const fight = (s.fireCrew ?? 0) / 3 * 0.0035;
      f[i] = THREE.MathUtils.clamp(f[i] + dt * (0.018 * (0.3 + f[i]) - fight), 0, 1);
      if (f[i] > 0.55) for (const j of [i - 1, i + 1]) if (j >= 0 && j < 3 && f[j] < 0.05 && Math.random() < dt * 0.04 * f[i]) f[j] = 0.08;
      s.burn[2 - i] = Math.min(1, s.burn[2 - i] + f[i] * dt * 0.012);       // burn[] is bow, waist, stern; fire[] stern..bow
      // losses to the fire
      if (Math.random() < dt * f[i] * 0.15) { s.fighters = Math.max(0, s.fighters - 1); }
      s.hp[i * 2] = Math.max(0, s.hp[i * 2] - dt * f[i] * 0.004); s.hp[i * 2 + 1] = Math.max(0, s.hp[i * 2 + 1] - dt * f[i] * 0.004);
      // the flames themselves, at a few points on the burning section
      if (this.fx && f[i] > 0.03) {
        const m = s.meta;
        const fz = m.box ? THREE.MathUtils.lerp(m.box.y0, m.box.y1, (i + 0.5) / 3) : (i - 1) * m.L / 3;
        const p = s.body.toWorld(_v.set((Math.random() - 0.5) * m.B * 0.8, m.deck_top - 0.2, fz + (Math.random() - 0.5) * m.L / 4), new THREE.Vector3());
        this.fx.burn(p, f[i], dt);
      }
    }
    // a ship burnt through sinks
    if (s.burn.every((b) => b > 0.85)) s.body.hole(new THREE.Vector3(0, -0.3, 0), 0.4);
  }
  morale(s, dt) {
    const loss = 1 - (s.fighters + s.body.rowersAlive * 0.5) / (s.fighters0 + s.rowers0 * 0.5);
    const burning = Math.max(...s.fire);
    const fl = this.flagshipOf(s.side);
    const near = fl && fl !== s ? (fl.body.pos.distanceTo(s.body.pos) < 250 ? 0.15 : 0) : 0.15;
    const target = THREE.MathUtils.clamp(1 - loss * 1.3 - burning * 0.5 - (s.body.water / s.body.V0) * 1.5 + near, 0, 1);
    s.morale += (target - s.morale) * Math.min(dt * 0.25, 1);
    if (!s.player && s.morale < 0.25 && !s.broken) { s.broken = true; this.note('broken', s); }
  }
  founder(s, t) {
    if (!s.alive) return;
    s.alive = false; s.sinkT = t;
    s.body.sunk = true;
    this.note('sunk', s);
  }
  sinking(s, dt) {
    if (s.gone) return;
    s.body.step(dt, s.body.t + dt);
    if (s.body.pos.y < -s.meta.D - 8) s.gone = true;
  }
  note(kind, s, extra = {}) { this.log.push({ kind, id: s.id, side: s.side, ship: s.kind, t: s.body.t, ...extra }); }

  // ---- hits --------------------------------------------------------------------------------------------
  apply(ev, t) {
    if (ev.kind !== 'hit') return;
    const s = ev.ship;
    if (!s.alive) return;
    const L = ev.local, m = s.meta;
    const E = ev.energy;
    const comp = s.body.compAt(L.z, L.x);
    const fs = m.box ? THREE.MathUtils.clamp(Math.floor((L.z - m.box.y0) / ((m.box.y1 - m.box.y0) / 3)), 0, 2) : THREE.MathUtils.clamp(Math.floor((L.z / m.L + 0.5) * 3), 0, 2);
    const wl = L.y;
    if (ev.type === 'horoku') {
      // a fire pot bursting on deck or against the boards
      s.fire[fs] = Math.min(1, s.fire[fs] + 0.3 + Math.random() * 0.2);
      if (Math.random() < 0.6) s.fighters = Math.max(0, s.fighters - 1 - Math.floor(Math.random() * 2));
      this.note('fire', s, { by: ev.from?.id });
      return;
    }
    if (ev.type === 'teppo') {
      // a musket ball: the shield boards stop most of them; a kobaya's low sides don't
      const pen = s.kind === 'kobaya' ? 0.55 : ev.part === 'yagura' ? 0.12 : 0.02;
      if (Math.random() < pen) {
        if (s.kind === 'kobaya' && Math.random() < 0.5) s.body.rowersAlive = Math.max(0, s.body.rowersAlive - 1);
        else s.fighters = Math.max(0, s.fighters - 1);
      }
      return;
    }
    // round shot
    const k = E / 40000;              // ~1 for a 1-kanme ball at 150 m/s
    s.hp[comp] = Math.max(0, s.hp[comp] - 0.08 * k * (s.kind === 'atake' ? 0.5 : s.kind === 'seki' ? 1 : 2.2));
    if (wl < 0.25 && ev.part === 'hull') {
      // below or at the waterline: a hole the size of the ball and its splinters
      const a = Math.PI * (GUN[ev.type].d * 1.6) ** 2 / 4 * (1 + k * 0.5);
      s.body.hole(new THREE.Vector3(L.x, Math.min(wl, -0.05), L.z), a);
      this.note('holed', s, { by: ev.from?.id });
    }
    // people behind the boards: splinters kill more than the ball
    const box = m.box;
    const oarTier = box && wl > m.deck_top - box.gap - box.tiers.reduce((a, b) => a + b, 0) - 0.3 && wl < m.deck_top - box.tiers.reduce((a, b) => a + b, 0) + 0.2;
    const kill = Math.round((1 + Math.random() * 3) * Math.min(k, 2));
    if (oarTier || s.kind === 'kobaya') s.body.rowersAlive = Math.max(0, s.body.rowersAlive - kill);
    else s.fighters = Math.max(0, s.fighters - kill);
    if (ev.from) ev.from.kills += kill;
    // a hot ball in dry timber can start a fire
    if (Math.random() < 0.06 * k) s.fire[fs] = Math.max(s.fire[fs], 0.1);
  }

  // ---- weapons (the crew works them; the player's big guns are fired by hand) --------------------------------
  weapons(s, dt, t) {
    if (s.broken && s.morale < 0.15) return;
    const b = s.body;
    const enemy = this.nearestEnemy(s, 450);
    for (const g of s.guns) {
      g.reload = Math.max(0, g.reload - dt * (0.4 + 0.6 * Math.min(1, (s.gunCrew ?? 0) / 10)));
      // the barrel runs in on the recoil (kick 0..1 fast), then is hauled out again over a few seconds (1..0)
      if (g.kick > 0) g.kick = g.kick < 1 ? Math.min(1, g.kick + dt * 12) : (g.kick + dt * 0.25 > 1.9 ? 0 : g.kick + dt * 0.25);
    }
    if (!enemy) return;
    const d = enemy.body.pos.distanceTo(b.pos);
    // muskets through the ports: a steady fire from the gunners, aimed at the enemy's fighting deck
    const gunners = (s.gunCrew ?? 0) * 0.45;
    if (d < 140 && gunners >= 1) {
      s.musketT -= dt * gunners / GUN.teppo.reload;
      while (s.musketT <= 0) {
        s.musketT += 1;
        const from = b.toWorld(_v.set((Math.random() - 0.5) * s.meta.B, s.meta.deck_top - 0.6, (Math.random() - 0.5) * s.meta.L * 0.7), new THREE.Vector3());
        const aim = enemy.body.toWorld(_w.set((Math.random() - 0.5) * enemy.meta.B, enemy.meta.deck_top - 0.4 + Math.random() * 0.8, (Math.random() - 0.5) * enemy.meta.L * 0.8), new THREE.Vector3());
        const tof = from.distanceTo(aim) / GUN.teppo.v0;
        aim.addScaledVector(enemy.body.vel, tof).y += 0.5 * 9.81 * tof * tof;
        this.gunnery.fire('teppo', s, from, aim.sub(from).normalize(), t);
      }
    }
    // fire pots: at a few tens of metres, thrown on a rope sling in a high arc
    if (d < 32 && s.kind !== 'atake' && (s.gunCrew ?? 0) > 3) {
      s.horokuT -= dt;
      if (s.horokuT <= 0) {
        s.horokuT = 2.5 + Math.random() * 3;
        const from = b.toWorld(_v.set(0, s.meta.deck_top + 1.2, 0), new THREE.Vector3());
        const aim = enemy.body.toWorld(_w.set(0, enemy.meta.deck_top, (Math.random() - 0.5) * enemy.meta.L * 0.6), new THREE.Vector3());
        const dd = new THREE.Vector3().subVectors(aim, from);
        const hd = Math.hypot(dd.x, dd.z);
        // lob at ~40 deg: solve the speed for the distance, ignoring drag
        const ang = 0.7, v2 = 9.81 * hd * hd / (2 * Math.cos(ang) ** 2 * (hd * Math.tan(ang) - dd.y));
        const v = Math.sqrt(Math.max(v2, 4));
        const dir = new THREE.Vector3(dd.x / hd * Math.cos(ang), Math.sin(ang), dd.z / hd * Math.cos(ang));
        const g = GUN.horoku.v0; GUN.horoku.v0 = v;
        this.gunnery.fire('horoku', s, from, dir, t);
        GUN.horoku.v0 = g;
      }
    }
    // big guns (captains only; the player aims their own)
    if (s.player) return;
    if (d > 420 || d < 25) return;
    for (const g of s.guns) {
      if (g.reload > 0) continue;
      const muzzle = b.toWorld(_v.copy(g.at).add(_f.set(0, 0, 0.6)), new THREE.Vector3());
      const tgt = enemy.body.pos.clone().setY(0.6);
      const dir = new THREE.Vector3().subVectors(tgt, muzzle);
      const fwd = b.forward(new THREE.Vector3());
      const off = Math.abs(wrap(Math.atan2(dir.x, dir.z) - Math.atan2(fwd.x, fwd.z)));
      if (off > 0.26) continue;         // the gun can only be trained a few degrees either side of the bow
      // elevation for the range (flat fire: drop ~ g t^2 / 2)
      const tof = dir.length() / GUN[g.type].v0;
      dir.y += 0.5 * 9.81 * tof * tof * 1.15;
      // only fire as the bow rises through level, when the roll is small (the gunner waits for the sea)
      if (Math.abs(b.heel) > 0.06) continue;
      this.gunnery.fire(g.type, s, muzzle, dir.normalize(), t);
      g.reload = GUN[g.type].reload * (0.9 + Math.random() * 0.3);
      g.kick = 0.01;
    }
  }

  // ---- boarding ------------------------------------------------------------------------------------------
  tryGrapple(s) {
    const e = this.nearestEnemy(s, s.meta.B + 14);
    if (!e || this.grapples.some((g) => g.a === s || g.b === s)) return false;
    const rel = s.body.vel.distanceTo(e.body.vel);
    if (rel > 2.2) return false;
    this.grapples.push({ a: s, b: e, t: 0 });
    this.note('grapple', s, { with: e.id });
    return true;
  }
  boarding(dt, t) {
    const keep = [];
    for (const g of this.grapples) {
      const { a, b } = g;
      if (!a.alive || !b.alive || a.taken || b.taken) continue;
      g.t += dt;
      // a spring and damper between the two hulls (ropes and grapnels) keeps them side by side
      const pa = a.body.pos, pb = b.body.pos;
      const d = _v.subVectors(pb, pa); d.y = 0;
      const L = d.length(), rest = (a.meta.B + b.meta.B) / 2 + 1.2;
      const k = 4000 * Math.min(a.body.mass, b.body.mass) / 30000;
      const rv = _w.subVectors(b.body.vel, a.body.vel); rv.y = 0;
      const F = d.normalize().multiplyScalar(-(L - rest) * k - rv.dot(d) * k * 1.2);
      a.body.impulse(F.clone().multiplyScalar(-dt), a.body.cgWorld(new THREE.Vector3()));
      b.body.impulse(F.clone().multiplyScalar(dt), b.body.cgWorld(new THREE.Vector3()));
      // the fight across: each side loses men in proportion to the other's strength and spirit
      if (g.t > 4) {
        const fa = a.fighters * (0.4 + a.morale), fb = b.fighters * (0.4 + b.morale);
        const la = dt * fb * 0.03 * Math.random() * 2, lb = dt * fa * 0.03 * Math.random() * 2;
        a.fighters = Math.max(0, a.fighters - la); b.fighters = Math.max(0, b.fighters - lb);
        a.morale = Math.max(0, a.morale - la * 0.004); b.morale = Math.max(0, b.morale - lb * 0.004);
        const lost = (s) => s.fighters < s.fighters0 * 0.12 || s.morale < 0.12;
        if (lost(b) || lost(a)) {
          const loser = lost(b) ? b : a, winner = loser === a ? b : a;
          loser.taken = true; loser.takenBy = winner.side;
          loser.body.ctl.beatL = loser.body.ctl.beatR = 0;
          this.note('taken', loser, { by: winner.id });
          continue;
        }
      }
      keep.push(g);
    }
    this.grapples = keep;
  }

  // ---- captains ------------------------------------------------------------------------------------------
  captain(s, dt) {
    const b = s.body, ai = s.ai;
    if (s.taken) { b.ctl.beatL = b.ctl.beatR = 0; b.ctl.rudder = 0; return; }
    const order = s.broken ? 'retreat' : this.orders[s.side];
    const enemy = this.nearestEnemy(s);
    const fl = this.flagshipOf(s.side);
    const pos = b.pos;
    let goal = null, beat = 1;
    const dE = enemy ? enemy.body.pos.distanceTo(pos) : 1e9;
    if (order === 'retreat' || !enemy) {
      if (enemy) { goal = _v.subVectors(pos, enemy.body.pos).setY(0).normalize().multiplyScalar(300).add(pos); beat = s.broken ? 3 : 2; }
    } else if (s.kind === 'atake') {
      // stand off at 150-300 m and point the bow at the enemy
      const standoff = 190;
      goal = enemy.body.pos.clone();
      if (dE < standoff * 0.7) { goal = _v.subVectors(pos, enemy.body.pos).setY(0).normalize().multiplyScalar(80).add(pos); beat = 1; }
      else beat = dE > standoff * 1.3 ? 2 : 0.5;
      ai.aimBow = dE < 450 ? enemy.body.pos : null;
    } else if (order === 'follow' && fl && fl !== s && dE > 220) {
      // a slot in a line abreast on the flagship
      const n = this.ships.filter((o) => o.side === s.side && o !== fl).indexOf(s);
      const row = Math.floor(n / 2) + 1, sgn = n % 2 ? 1 : -1;
      const fw = fl.body.forward(new THREE.Vector3()).setY(0).normalize();
      const sd = new THREE.Vector3(fw.z, 0, -fw.x);
      goal = fl.body.pos.clone().addScaledVector(sd, sgn * row * 26).addScaledVector(fw, -row * 8);
      const dg = goal.distanceTo(pos);
      beat = dg > 60 ? 3 : dg > 20 ? 2 : 1;
      ai.matchHeading = fl.body.heading;
    } else {
      // close in: scatter comes in from a wide angle, surround from an assigned bearing round the target
      const tgt = enemy.body.pos;
      let bearing = Math.atan2(pos.x - tgt.x, pos.z - tgt.z);
      if (order === 'surround') bearing = ai.bearing;
      if (order === 'scatter') bearing += (s.id % 2 ? 1 : -1) * 0.6;
      const r = dE > 120 ? 60 : s.kind === 'kobaya' ? 6 : 10;
      goal = new THREE.Vector3(tgt.x + Math.sin(bearing) * r, 0, tgt.z + Math.cos(bearing) * r);
      beat = dE > 300 ? 2 : dE > 60 ? 3 : 1;
      // board when alongside and stronger
      if (dE < s.meta.B + 12 && s.fighters > enemy.fighters * 1.1) this.tryGrapple(s);
    }
    // steer: toward the goal, away from other ships ahead, away from land ahead
    let hd = b.heading;
    if (goal) {
      let want = Math.atan2(goal.x - pos.x, goal.z - pos.z);
      if (ai.aimBow) want = Math.atan2(ai.aimBow.x - pos.x, ai.aimBow.z - pos.z);
      if (ai.matchHeading !== undefined && goal.distanceTo(pos) < 25) want = ai.matchHeading;
      ai.matchHeading = undefined; ai.aimBow = null;
      // avoid: other ships inside ~2 lengths in front
      const fw = b.forward(new THREE.Vector3());
      for (const o of this.ships) {
        if (o === s || !o.alive) continue;
        const d = _w.subVectors(o.body.pos, pos); d.y = 0;
        const L = d.length();
        const lim = (s.meta.L + o.meta.L) * 0.8 + 6;
        if (L < lim && d.dot(fw) > 0 && !(o.side !== s.side && s.kind !== 'atake' && order !== 'retreat')) {
          const side = Math.sign(fw.x * d.z - fw.z * d.x) || 1;
          want += side * 0.8 * (1 - L / lim);
        }
      }
      // land: probe ahead; turn toward the deeper side
      if (this.ground) {
        const ahead = (a) => this.ground(pos.x + Math.sin(a) * s.meta.L * 3, pos.z + Math.cos(a) * s.meta.L * 3);
        if (ahead(want) > -3) want += ahead(want + 0.6) < ahead(want - 0.6) ? 0.6 : -0.6;
      }
      const err = wrap(want - hd);
      b.ctl.rudder = THREE.MathUtils.clamp(err * 1.4 - b.angV.y * 2.0, -0.6, 0.6);
      // row one side harder to turn a big ship quickly (and slow when turning hard)
      const turn = THREE.MathUtils.clamp(err, -1, 1);
      const bt = Math.min(beat, b.fatigue > 0.7 ? 1 : 3);
      b.ctl.beatL = THREE.MathUtils.clamp(bt + (turn < -0.4 ? 1 : turn > 0.4 ? -1 : 0), 0, 3);
      b.ctl.beatR = THREE.MathUtils.clamp(bt + (turn > 0.4 ? 1 : turn < -0.4 ? -1 : 0), 0, 3);
    } else { b.ctl.beatL = b.ctl.beatR = 0; }
  }
}
