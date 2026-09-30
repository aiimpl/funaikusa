// Sea state: a set of Gerstner waves shared by the water shader (GLSL) and the ship's buoyancy (JS),
// so the ship rides exactly the surface that is drawn.
//
// The Seto Inland Sea is sheltered: wind waves from the local breeze plus a low, long swell working in from the open straits.
// Wind waves follow a Pierson-Moskowitz spectrum for the wind speed (peak w_p = 0.877 g / U),
// sampled at N frequencies with directions spread about the wind (cos^2 spread, fixed seed).
// Typical: U = 6 m/s -> peak wavelength ~ 30 m, significant height ~ 0.6 m.
import * as THREE from 'three';

export const NW = 16;          // number of Gerstner components
const G = 9.81;

function mulberry(seed) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

// Returns arrays of components: dir (unit xz), k, omega, amplitude a, steepness Q, phase
export function makeSea({ wind = 6, windDir = 0.6, swellDir = 1.4, swellH = 0.35, seed = 11 } = {}) {
  const rnd = mulberry(seed);
  const wp = 0.877 * G / Math.max(wind, 0.5);
  const comps = [];
  // two swell components (long, low, nearly the same direction)
  for (let i = 0; i < 2; i++) {
    const lam = [72, 51][i], k = 2 * Math.PI / lam;
    const a = swellH / 2 * [0.8, 0.55][i];
    const ang = swellDir + [0, 0.18][i];
    comps.push({ dx: Math.cos(ang), dz: Math.sin(ang), k, w: Math.sqrt(G * k), a, ph: rnd() * 6.283 });
  }
  // wind waves: frequencies from 0.75 wp to 3.2 wp, log spaced
  const n = NW - 2, w0 = wp * 0.75, w1 = wp * 3.2;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const w = w0 * Math.pow(w1 / w0, t);
    const dw = w * Math.log(w1 / w0) / n;
    // Pierson-Moskowitz: S(w) = 8.1e-3 g^2 w^-5 exp(-0.74 (g / (U w))^4)
    const S = 8.1e-3 * G * G / Math.pow(w, 5) * Math.exp(-0.74 * Math.pow(G / (wind * w), 4));
    const a = Math.sqrt(2 * S * dw);
    // direction: cos^2 spread about the wind, wider for the short waves
    let d = 0; for (let j = 0; j < 3; j++) d += rnd() - 0.5;
    const ang = windDir + d * (0.9 + 0.6 * t);
    const k = w * w / G;
    comps.push({ dx: Math.cos(ang), dz: Math.sin(ang), k, w, a, ph: rnd() * 6.283 });
  }
  // Gerstner steepness: keep the sum of Q k a below ~0.4. Sharper crests read as thin bright lines that run straight
  // across the whole sea (the crests of a sum of long-crested waves), which real water does not show
  const sumKA = comps.reduce((s, c) => s + c.k * c.a, 0);
  const q = Math.min(0.8, 0.4 / Math.max(sumKA, 1e-6));
  for (const c of comps) c.q = q;
  const hs = 4 * Math.sqrt(comps.reduce((s, c) => s + c.a * c.a / 2, 0));
  return { comps, wind, windDir, hs, wp };
}

// Uniform packing: vec4 A[i] = (dx, dz, k, omega), vec4 B[i] = (a, q, phase, 0)
export function seaUniforms(sea) {
  const A = sea.comps.map((c) => new THREE.Vector4(c.dx, c.dz, c.k, c.w));
  const B = sea.comps.map((c) => new THREE.Vector4(c.a, c.q, c.ph, 0));
  return { uWA: { value: A }, uWB: { value: B }, uSeaK: { value: 1 } };
}
export function setSea(U, sea) {
  sea.comps.forEach((c, i) => { U.uWA.value[i].set(c.dx, c.dz, c.k, c.w); U.uWB.value[i].set(c.a, c.q, c.ph, 0); });
}

// GLSL: displacement at rest position p (xz), and slope / jacobian for shading.
// fw = footprint (m) of a pixel or vertex; components shorter than a few footprints fade out (they alias)
export const wavesGLSL = /* glsl */`
#define NW ${NW}
uniform vec4 uWA[NW]; uniform vec4 uWB[NW]; uniform float uSeaK;
float waveFade(float k, float fw){ float lam = 6.2831853 / k; return smoothstep(fw * 2.0, fw * 6.0, lam); }
vec3 gerstner(vec2 p, float t, float fw){
  vec3 o = vec3(0.0);
  for (int i = 0; i < NW; i++){
    vec4 A = uWA[i], B = uWB[i];
    float th = A.z * dot(A.xy, p) - A.w * t + B.z;
    float a = B.x * uSeaK * waveFade(A.z, fw);
    float c = cos(th), s = sin(th);
    o.xz += A.xy * (B.y * a * c);
    o.y += a * s;
  }
  return o;
}
// returns (dh/dx, dh/dz) of the displaced surface, and the Jacobian determinant in w (below ~0.4 the crest is folding: foam).
// Only the long components (lambda > ~15 m) tilt the shading normal: the short ones have perfectly straight, endless crests
// that show as regular streaks and chevrons across the sea; the ripples (ocean.js), broken into groups, cover that scale
vec4 gerstnerSlope(vec2 p, float t, float fw){
  vec2 g = vec2(0.0); float jxx = 1.0, jzz = 1.0, jxz = 0.0, lift = 0.0;
  for (int i = 0; i < NW; i++){
    vec4 A = uWA[i], B = uWB[i];
    float th = A.z * dot(A.xy, p) - A.w * t + B.z;
    float a = B.x * uSeaK * waveFade(A.z, fw);
    float wa = A.z * a, c = cos(th), s = sin(th);
    g += A.xy * wa * c * smoothstep(0.42, 0.9, 6.2831853 / A.z / 16.0);
    lift += B.y * wa * s;
    jxx -= B.y * wa * A.x * A.x * s; jzz -= B.y * wa * A.y * A.y * s; jxz -= B.y * wa * A.x * A.y * s;
  }
  // divide by the vertical compression so crests get steeper than the plain sine sum
  float den = max(1.0 - lift, 0.6);
  return vec4(g / den, 0.0, jxx * jzz - jxz * jxz);
}
`;

// CPU: surface height at world (x, z). Gerstner moves water sideways, so find the rest point whose
// displaced position lands on (x, z) by fixed-point iteration, then return its height.
export function seaHeight(sea, x, z, t, k = 1) {
  let px = x, pz = z;
  for (let it = 0; it < 3; it++) {
    let ox = 0, oz = 0;
    for (const c of sea.comps) {
      const th = c.k * (c.dx * px + c.dz * pz) - c.w * t + c.ph;
      const a = c.a * k * c.q * Math.cos(th);
      ox += c.dx * a; oz += c.dz * a;
    }
    px = x - ox; pz = z - oz;
  }
  let h = 0;
  for (const c of sea.comps) h += c.a * k * Math.sin(c.k * (c.dx * px + c.dz * pz) - c.w * t + c.ph);
  return h;
}
// Water particle velocity at the surface (for drag on the hull): orbital motion
export function seaVelocity(sea, x, z, t, k = 1, out = { x: 0, y: 0, z: 0 }) {
  out.x = out.y = out.z = 0;
  for (const c of sea.comps) {
    const th = c.k * (c.dx * x + c.dz * z) - c.w * t + c.ph;
    const v = c.a * k * c.w;
    out.x += c.dx * v * Math.sin(th); out.z += c.dz * v * Math.sin(th); out.y -= v * Math.cos(th);
  }
  return out;
}
