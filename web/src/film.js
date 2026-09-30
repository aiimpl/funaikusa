// The film: a scripted sequence of shots for recording (?render). One battle (the fire-pot scenario) runs from dawn;
// before each shot the battle is fast-forwarded to the moment wanted (no drawing), then the camera follows one ship
// along a path given in that ship's frame. Times are seconds of film.
import * as THREE from 'three';

const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => t * t * (3 - 2 * t);

// pick: which ship the camera follows. cam keys: yaw (0 = behind, + = toward port), pitch, dist, lift, fov;
// bow: the gun layer's view from the fighting deck; fire: [time in the shot] the followed ship's bow guns go off
export const SHOTS = [
  { name: 'dawn', dur: 5.5, fast: 2, pick: (f) => f.ships.find((s) => s.side === 'A' && s.kind === 'seki' && !s.player),
    cam: [{ yaw: 2.75, pitch: 0.13, dist: 230, lift: 14, fov: 34 }, { yaw: 2.55, pitch: 0.11, dist: 200, lift: 14, fov: 34 }] },
  { name: 'oars', dur: 5.0, fast: 70, pick: (f) => f.ships.find((s) => s.side === 'B' && s.kind === 'atake' && s.flagship),
    cam: [{ yaw: 1.75, pitch: 0.02, dist: 34, lift: 3.5, fov: 40 }, { yaw: 1.45, pitch: 0.02, dist: 30, lift: 3.8, fov: 40 }] },
  { name: 'swarm', dur: 5.0, fast: 395, pick: (f) => mostBeset(f, 'B'), upwind: true,
    cam: [{ yaw: -1.05, pitch: 0.06, dist: 70, lift: 4, fov: 40 }, { yaw: -0.85, pitch: 0.07, dist: 62, lift: 4, fov: 40 }] },
  { name: 'gun', dur: 3.6, fast: 6, pick: (f) => f.ships.filter((s) => s.side === 'B' && s.kind === 'atake' && s.alive)[0], fire: [0.7, 1.4], upwind: true,
    cam: [{ yaw: 1.2, pitch: 0.05, dist: 50, lift: 4.5, fov: 38 }, { yaw: 1.1, pitch: 0.05, dist: 46, lift: 4.5, fov: 38 }] },
  { name: 'fire', dur: 4.5, fast: 90, pick: (f) => f.ships.filter((s) => s.alive).sort((a, b) => Math.max(...b.fire) - Math.max(...a.fire))[0],
    cam: [{ yaw: 2.2, pitch: 0.09, dist: 48, lift: 6, fov: 38 }, { yaw: 2.5, pitch: 0.12, dist: 56, lift: 7, fov: 38 }] },
  { name: 'overview', dur: 6.0, fast: 20, pick: (f) => f.ships.filter((s) => s.alive)[0], world: true,
    cam: [{ yaw: 1.25, pitch: 0.3, dist: 420, lift: 0, fov: 36 }, { yaw: 1.45, pitch: 0.34, dist: 470, lift: 0, fov: 36 }], title: [3.2, 6.0] },
];
export const FILM_LEN = SHOTS.reduce((s, x) => s + x.dur, 0);

// the ship of that side with the most enemies within 80 m (where the swarm is thickest)
function mostBeset(f, side) {
  let best = null, bn = -1;
  for (const s of f.ships) {
    if (s.side !== side || !s.alive) continue;
    const n = f.ships.filter((o) => o.side !== side && o.alive && o.body.pos.distanceTo(s.body.pos) < 80).length + (s.kind === 'atake' ? 0.5 : 0);
    if (n > bn) { bn = n; best = s; }
  }
  return best;
}

function nearestTo(f, side, kind, other) {
  let best = null, bd = 1e9;
  for (const s of f.ships) {
    if (s.side !== side || s.kind !== kind || !s.alive || s.taken) continue;
    const e = f.nearestEnemy(s);
    const d = e ? e.body.pos.distanceTo(s.body.pos) : 1e9;
    if (d < bd && d > 12) { bd = d; best = s; }
  }
  return best ?? f.ships.find((s) => s.side === side);
}

export class Film {
  // ctx: { fleet, fast(sec), camera, fire(ship), bowAt(ship) }
  constructor(ctx, shots = SHOTS) {
    this.c = ctx; this.shots = shots; this.cur = -1;
    this.title = document.getElementById('endcard');
    this.fired = new Set();
  }
  shotAt(t) {
    let t0 = 0;
    const S = this.shots;
    for (let i = 0; i < S.length; i++) { if (t < t0 + S[i].dur || i === S.length - 1) return [i, t - t0]; t0 += S[i].dur; }
    return [S.length - 1, 0];
  }
  start(i) {
    const s = this.shots[i];
    this.cur = i;
    if (s.fast) this.c.fast(s.fast);
    this.ship = s.pick(this.c.fleet);
    this.fired.clear();
  }
  // before the frame: shot changes, scripted events
  apply(t) {
    const [i, u] = this.shotAt(t);
    if (i !== this.cur) this.start(i);
    const s = this.shots[i];
    for (const ft of s.fire ?? []) if (u >= ft && !this.fired.has(ft)) { this.fired.add(ft); this.c.fire(this.ship, s.fire.indexOf(ft)); }
    if (this.title) {
      const k = s.title ? THREE.MathUtils.clamp((u - s.title[0]) / 1.2, 0, 1) : 0;
      this.title.style.opacity = k;
    }
    return { fade: Math.min(1, t / 0.6, (FILM_LEN - t) / 0.4 + 0.0001) };
  }
  // after the physics: place the camera
  camera(t) {
    const [i, u] = this.shotAt(t);
    const s = this.shots[i], b = this.ship.body, cam = this.c.camera;
    const k = ease(Math.min(u / s.dur, 1));
    const [A, B] = s.cam;
    cam.fov = lerp(A.fov ?? 40, B.fov ?? 40, k); cam.updateProjectionMatrix();
    if (s.bow) {
      const p0 = b.toWorld(this.c.bowAt(this.ship), new THREE.Vector3());
      const f = b.forward(new THREE.Vector3()); f.y = 0; f.normalize();
      cam.position.copy(p0);
      cam.lookAt(p0.clone().addScaledVector(f, 100).add(new THREE.Vector3(0, -9, 0)));
      cam.updateMatrixWorld();
      return;
    }
    const yaw = lerp(A.yaw, B.yaw, k), pitch = lerp(A.pitch, B.pitch, k), dist = lerp(A.dist, B.dist, k), lift = lerp(A.lift, B.lift, k);
    if (s.world) {
      // a fixed bearing in the world, looking at the middle between the castle island and the fight
      if (!this.mid) {
        const al = this.c.fleet.ships.filter((q) => q.alive);
        const c = al.reduce((a, q) => a.add(q.body.pos), new THREE.Vector3()).divideScalar(Math.max(al.length, 1));
        this.mid = new THREE.Vector3(c.x * 0.5, 0, c.z * 0.5);
      }
      const m = this.mid;
      cam.position.set(m.x + Math.sin(yaw) * Math.cos(pitch) * dist, Math.sin(pitch) * dist, m.z + Math.cos(yaw) * Math.cos(pitch) * dist);
      cam.lookAt(m);
      cam.updateMatrixWorld();
      return;
    }
    const tgt = new THREE.Vector3(b.pos.x, lift, b.pos.z);
    // upwind: the camera stands to windward of the ship (the gun smoke blows away from it); yaw is then an offset
    // from straight upwind, in world terms
    let a = b.heading + Math.PI + yaw;
    if (s.upwind) { const w = this.c.wind.uniforms.uWind.value; a = Math.atan2(-w.x, -w.y) + yaw; }
    cam.position.set(tgt.x + Math.sin(a) * Math.cos(pitch) * dist, tgt.y + Math.sin(pitch) * dist, tgt.z + Math.cos(a) * Math.cos(pitch) * dist);
    cam.position.y = Math.max(cam.position.y, 1.4);
    cam.lookAt(tgt);
    cam.updateMatrixWorld();
  }
}
