// The film: a scripted sequence of shots for recording (?render). Each shot sets the hour, the wind, where the ship
// is and what it is doing, lets the physics and the wake run for a while so the ship is already under way with a
// trail behind it, then moves the camera along a path given in the ship's frame. Times are seconds of film.
import * as THREE from 'three';

const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => t * t * (3 - 2 * t);

// camera keys: yaw (0 = behind the ship, + = toward port), pitch, dist (m), lift (target height above the waterline), fov
export const SHOTS = [
  { name: '夜明けの船出', dur: 5.5, hour: [6.72, 6.78], wind: 6.5, wdir: 0.9, place: 'home', out: 70, warm: 14, ctl: { hoist: 1 }, hoist0: 0.35,
    cam: [{ yaw: 0.42, pitch: 0.05, dist: 46, lift: 7, fov: 38 }, { yaw: 0.2, pitch: 0.035, dist: 34, lift: 8, fov: 38 }] },
  { name: '島々のあいだ', dur: 5.5, hour: [9.3, 9.35], wind: 7, wdir: 0.9, at: [-760, 620], hd: 0.35, warm: 40, ctl: { hoist: 1 },
    cam: [{ yaw: 1.75, pitch: 0.2, dist: 170, lift: 6, fov: 34 }, { yaw: 2.15, pitch: 0.16, dist: 150, lift: 6, fov: 34 }] },
  { name: '水面', dur: 4.5, hour: [11.2, 11.22], wind: 8, wdir: 0.9, at: [900, -900], hd: 0.5, warm: 45, ctl: { hoist: 1 },
    cam: [{ yaw: 1.15, pitch: 0.0, dist: 18, lift: 2.2, fov: 44, h: 1.6 }, { yaw: 1.5, pitch: 0.0, dist: 16, lift: 2.4, fov: 44, h: 1.5 }] },
  { name: '夕日', dur: 5.5, hour: [17.18, 17.24], wind: 6, wdir: 0.9, at: [-300, 1500], hd: -1.5, warm: 40, ctl: { hoist: 1 },
    cam: [{ yaw: -0.25, pitch: 0.03, dist: 60, lift: 9, fov: 34 }, { yaw: -0.05, pitch: 0.025, dist: 48, lift: 10, fov: 34 }] },
  { name: '灯', dur: 5.0, hour: [17.9, 18.12], wind: 3, wdir: 0.9, place: 'dest', out: 90, warm: 10, ctl: { hoist: 0 }, hoist0: 0, anchor: true,
    cam: [{ yaw: 0.55, pitch: 0.06, dist: 50, lift: 5, fov: 40 }, { yaw: 0.3, pitch: 0.045, dist: 40, lift: 5, fov: 40 }], title: [2.6, 5.0] },
];
// The making-of: the sea built up layer by layer, the wake on its own, the haze switched on over the islands.
// layers: [ripples, glints, swell in the shading, wake relief], haze: [from, to] strength over the shot
export const MAKING = [
  { name: 'swell', dur: 3.2, hour: [16.0, 16.02], wind: 7, wdir: 0.9, at: [900, -900], hd: 0.5, warm: 30, ctl: { hoist: 1 }, layers: [0, 0, 1, 0],
    cam: [{ yaw: 0.55, pitch: 0.05, dist: 58, lift: 4, fov: 38, sun: 1 }, { yaw: 0.45, pitch: 0.05, dist: 54, lift: 4, fov: 38, sun: 1 }] },
  { name: 'ripples', dur: 2.8, hour: [16.02, 16.04], wind: 7, wdir: 0.9, layers: [1, 0, 1, 0], cont: true,
    cam: [{ yaw: 0.45, pitch: 0.05, dist: 54, lift: 4, fov: 38, sun: 1 }, { yaw: 0.37, pitch: 0.05, dist: 51, lift: 4, fov: 38, sun: 1 }] },
  { name: 'glints', dur: 2.8, hour: [16.04, 16.06], wind: 7, wdir: 0.9, layers: [1, 1, 1, 0], cont: true,
    cam: [{ yaw: 0.37, pitch: 0.05, dist: 51, lift: 4, fov: 38, sun: 1 }, { yaw: 0.3, pitch: 0.05, dist: 48, lift: 4, fov: 38, sun: 1 }] },
  { name: 'haze', dur: 3.8, hour: [13.0, 13.02], wind: 5, wdir: 0.9, at: [-400, 2600], hd: 2.0, warm: 20, ctl: { hoist: 1 }, layers: [1, 1, 1, 0], haze: [0, 1],
    cam: [{ yaw: 0.0, pitch: 0.02, dist: 170, lift: 25, fov: 30, look: 3.6 }, { yaw: 0.0, pitch: 0.02, dist: 170, lift: 25, fov: 30, look: 3.6 }] },
  { name: 'final', dur: 3.2, hour: [17.18, 17.21], wind: 6, wdir: 0.9, at: [-300, 1500], hd: -1.5, warm: 40, ctl: { hoist: 1 }, layers: [1, 1, 1, 0],
    cam: [{ yaw: -0.2, pitch: 0.03, dist: 56, lift: 9, fov: 34 }, { yaw: -0.05, pitch: 0.025, dist: 48, lift: 10, fov: 34 }] },
];
export const MAKING_LEN = MAKING.reduce((s, x) => s + x.dur, 0);
export const FILM_LEN = SHOTS.reduce((s, x) => s + x.dur, 0);

export class Film {
  constructor(ctx, shots = SHOTS) {
    this.c = ctx;            // { boat, wind, sea, setHour, warm(sec), ports, camera, ocean, skyU }
    this.shots = shots;
    this.cur = -1;
    this.haze0 = ctx.skyU?.uHazeB.value;
    this.title = document.getElementById('endcard');
  }
  shotAt(t) {
    let t0 = 0;
    const S = this.shots;
    for (let i = 0; i < S.length; i++) { if (t < t0 + S[i].dur || i === S.length - 1) return [i, t - t0]; t0 += S[i].dur; }
    return [S.length - 1, 0];
  }
  start(i) {
    const s = this.shots[i], c = this.c, b = c.boat;
    this.cur = i;
    if (c.ocean) c.ocean.uniforms.uLayers.value.fromArray(s.layers ?? [1, 1, 1, 0]);
    c.wind.set(s.wind, s.wdir);
    c.setHour(s.hour[0]);
    if (s.cont) return;            // a layer step of the same scene: keep the ship where it is
    let x, z, hd;
    if (s.place) {
      const p = c.ports[s.place === 'home' ? 0 : 1];
      x = p.x + Math.sin(p.face) * s.out; z = p.z + Math.cos(p.face) * s.out;
      hd = s.place === 'home' ? p.face : p.face + Math.PI * 0.85;
    } else { [x, z] = s.at; hd = s.hd; }
    // start upwind of the mark by the warm-up distance so the ship arrives there under way
    b.place(x, z, hd);
    b.ctl.anchor = null;
    Object.assign(b.ctl, s.ctl);
    c.resetWake?.(b.pos.x - Math.sin(hd) * 2.2 * (s.warm ?? 0), b.pos.z - Math.cos(hd) * 2.2 * (s.warm ?? 0));
    if (s.hoist0 !== undefined) b.hoist = s.hoist0; else b.hoist = s.ctl.hoist ?? 1;
    if (s.warm) {
      // run back from the mark: give the ship its cruising speed first, then let it sail into position
      b.vel.set(Math.sin(hd), 0, Math.cos(hd)).multiplyScalar(s.ctl.hoist ? 2.2 : 0);
      b.pos.x -= Math.sin(hd) * 2.2 * s.warm * (s.ctl.hoist ? 1 : 0);
      b.pos.z -= Math.cos(hd) * 2.2 * s.warm * (s.ctl.hoist ? 1 : 0);
      c.warm(s.warm);
    }
    if (s.hoist0 !== undefined) b.hoist = s.hoist0;
    if (s.anchor) b.ctl.anchor = { x: b.pos.x, z: b.pos.z, len: 25 };
    this.cur = i;
  }
  // called every frame after the physics: returns the hour for this frame and poses the camera
  apply(t) {
    const [i, u] = this.shotAt(t);
    if (i !== this.cur) this.start(i);
    const s = this.shots[i], k = ease(Math.min(Math.max(u / s.dur, 0), 1));
    this.c.setHour(lerp(s.hour[0], s.hour[1], u / s.dur));
    if (this.c.skyU) {
      const hz = s.haze ? lerp(s.haze[0], s.haze[1], THREE.MathUtils.smoothstep(u / s.dur, 0.35, 0.65)) : 1;
      this.c.skyU.uHazeB.value = this.haze0 * hz;
    }
    const [A, B] = s.cam;
    const K = {}; for (const key of Object.keys(A)) K[key] = lerp(A[key], B[key] ?? A[key], k);
    const b = this.c.boat, cam = this.c.camera;
    const hd = b.heading;
    const tgt = new THREE.Vector3(b.pos.x, K.lift, b.pos.z);
    // a: direction from the ship to the camera. 'sun' keys face the camera into the sun (glints, glitter path);
    // 'look' keys fix the view to a world bearing (rad, as heading) regardless of where the ship points
    let a = hd + Math.PI + K.yaw;
    const sd = this.c.sunDir;
    if (A.sun && sd) a = Math.atan2(-sd.x, -sd.z) + K.yaw;
    if (A.look !== undefined) a = A.look + Math.PI + K.yaw;
    const r = Math.cos(K.pitch) * K.dist;
    cam.position.set(tgt.x + Math.sin(a) * r, K.h ?? (K.lift + Math.sin(K.pitch) * K.dist), tgt.z + Math.cos(a) * r);
    cam.fov = K.fov; cam.updateProjectionMatrix();
    cam.lookAt(tgt);
    cam.updateMatrixWorld();
    // title card over the end of the last shot
    if (this.title) {
      const tt = s.title ? THREE.MathUtils.smoothstep(u, s.title[0], s.title[0] + 1.2) : 0;
      this.title.style.opacity = tt.toFixed(3);
    }
    // a short dip to black at each cut (not between the layer steps of one scene)
    const S = this.shots, nextCont = S[i + 1]?.cont;
    const fin = s.cont ? 1 : THREE.MathUtils.smoothstep(u, 0, 0.35);
    const fout = i < S.length - 1 && !nextCont ? 1 - THREE.MathUtils.smoothstep(u, s.dur - 0.3, s.dur) : 1;
    const fade = Math.min(fin, fout);
    return { shot: s.name, fade };
  }
}
