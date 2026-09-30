// Wind: a mean breeze plus gusts. Gusts are patches that drift downwind at about the wind speed;
// on the water they show as dark bands of thicker ripples (cat's paws), and the sail feels the same field.
// The field is written twice, in GLSL (for the water) and JS (for the ship), with the same hash and noise.
import * as THREE from 'three';

export const gustGLSL = /* glsl */`
uniform vec2 uWind; uniform float uWindS; uniform float uGustK;
float gh(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float gn(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3. - 2. * f);
  return mix(mix(gh(i), gh(i + vec2(1, 0)), u.x), mix(gh(i + vec2(0, 1)), gh(i + vec2(1, 1)), u.x), u.y); }
// 0 = lull, 1 = strong gust
float gustAt(vec2 p, float t){
  vec2 side = vec2(-uWind.y, uWind.x);
  // stretched along the wind (bands), carried downwind at 0.8 x the wind speed
  vec2 q = vec2(dot(p, uWind) - uWindS * 0.8 * t, dot(p, side));
  vec2 s = vec2(q.x * 0.0045, q.y * 0.0022);
  float n = gn(s) * 0.55 + gn(s * 2.3 + 7.1) * 0.3 + gn(s * 5.1 + 3.3) * 0.15;
  return clamp(smoothstep(0.32, 0.72, n) * uGustK + 0.12, 0.0, 1.0);
}
`;

function fract(x) { return x - Math.floor(x); }
// the same hash as GLSL (float math in double precision; differences are far below what matters)
function gh(x, y) {
  let a = fract(x * 0.1031), b = fract(y * 0.1031), c = fract(x * 0.1031);
  const d = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33);
  a += d; b += d; c += d;
  return fract((a + b) * c);
}
function gn(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = gh(ix, iy), b = gh(ix + 1, iy), c = gh(ix, iy + 1), d = gh(ix + 1, iy + 1);
  return (a + (b - a) * ux) * (1 - uy) + (c + (d - c) * ux) * uy;
}
const ss = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

export class Wind {
  constructor({ speed = 6, dir = 0.6, gust = 1 } = {}) {
    this.uniforms = { uWind: { value: new THREE.Vector2(Math.cos(dir), Math.sin(dir)) }, uWindS: { value: speed }, uGustK: { value: gust } };
    this.speed = speed; this.dir = dir;
  }
  set(speed, dir, gust = this.uniforms.uGustK.value) {
    this.speed = speed; this.dir = dir;
    this.uniforms.uWind.value.set(Math.cos(dir), Math.sin(dir)); this.uniforms.uWindS.value = speed; this.uniforms.uGustK.value = gust;
  }
  gust(x, z, t) {
    const w = this.uniforms.uWind.value, S = this.uniforms.uWindS.value;
    const qx = x * w.x + z * w.y - S * 0.8 * t, qy = -x * w.y + z * w.x;
    const sx = qx * 0.0045, sy = qy * 0.0022;
    const n = gn(sx, sy) * 0.55 + gn(sx * 2.3 + 7.1, sy * 2.3 + 7.1) * 0.3 + gn(sx * 5.1 + 3.3, sy * 5.1 + 3.3) * 0.15;
    return Math.min(1, Math.max(0, ss(0.32, 0.72, n) * this.uniforms.uGustK.value + 0.12));
  }
  // true wind vector (m/s, world xz, the direction the air moves) at a point: lulls at 70 %, gusts at 140 % of the mean
  at(x, z, t, out = new THREE.Vector2()) {
    const g = this.gust(x, z, t);
    const s = this.speed * (0.7 + 0.7 * g);
    return out.copy(this.uniforms.uWind.value).multiplyScalar(s);
  }
}
