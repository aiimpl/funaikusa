// Sea surface.
// Geometry: a polar grid around the camera (rings get wider with distance, out to 16 km) displaced by the
// Gerstner waves (waves.js) and the ship's wake patch (wake.js). Components too short for the local grid
// spacing fade out of the displacement but stay in the per-pixel normal, so near water is sharp and far water never aliases.
// Shading (built on the lake of hai-no-michi):
//   reflection  = the world drawn upside down at half resolution, pushed around by the slope, blended with the analytic sky
//   below       = the world under the surface (the hull), absorbed and scattered by turbid green water
//   glints      = wave facets that happen to mirror the sun; far away they merge into the glitter path (slope distribution)
//   wind bands  = where gusts touch down the ripples thicken and the water darkens (the same field drives the sail)
//   foam        = wake foam and folding crests (Gerstner Jacobian)
//   haze        = sky.js, the same as for the islands, so the sea melts into the horizon
import * as THREE from 'three';
import { skyGLSL, curveGLSL } from './sky.js';
import { wavesGLSL } from './waves.js';
import { wakeGLSL } from './wake.js';
import { gustGLSL } from './wind.js';
import { tideGLSL } from './tide.js';

const vert = /* glsl */`
${wavesGLSL}
${wakeGLSL}
${curveGLSL}
uniform float uTime; uniform vec3 uCenter;
attribute float aFw;
varying vec3 vW; varying vec2 vRest; varying vec4 vClip; varying float vDepth; varying float vWakeFoam; varying float vH;
void main(){
  vec2 p = position.xz + uCenter.xz;
  vec3 d = gerstner(p, uTime, aFw);
  vec4 wk = wakeAt(p);
  vec3 w = vec3(p.x + d.x, d.y + wk.x, p.y + d.z);
  vH = w.y;
  w = curveDrop(w);
  vW = w; vRest = p; vWakeFoam = wk.w;
  vec4 mv = viewMatrix * vec4(w, 1.0);
  vDepth = -mv.z;
  vClip = projectionMatrix * mv;
  gl_Position = vClip;
}`;

const frag = /* glsl */`
uniform float uTime;
${skyGLSL}
${wavesGLSL}
${wakeGLSL}
${gustGLSL}
${tideGLSL}
uniform sampler2D uRefl; uniform vec2 uReflTexel; uniform sampler2D uRefr;
uniform vec3 uSunIrr;
// layers for the making-of film: x = ripples, y = glints, z = swell in the shading, w = relief view of the wake (1 = on)
uniform vec4 uLayers;
uniform highp sampler2DShadow uShipSM; uniform mat4 uShipVP; uniform float uShipTexel;
varying vec3 vW; varying vec2 vRest; varying vec4 vClip; varying float vDepth; varying float vWakeFoam; varying float vH;
float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec3 h32(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xxy + p3.yzz) * p3.zyx); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3. - 2. * f);
  return mix(mix(h12(i), h12(i + vec2(1, 0)), u.x), mix(h12(i + vec2(0, 1)), h12(i + vec2(1, 1)), u.x), u.y); }
// Ripples: 40 short waves (6 m down to a few cm) leaning to the wind (normals only), longest first. Their constants come from JS
// (makeRipples): uRA = (dir.x, dir.z, k, omega), uRB = (amplitude at full gust, phase, variance of this and all shorter ones, lambda).
// Once a ripple is too short for the pixel, it and every shorter one only add slope variance (for the glitter).
// g = local gust strength
uniform vec4 uRA[40]; uniform vec4 uRB[40];
vec3 rippleSlope(vec2 p0, float fw, float g){
  vec2 s = vec2(0.); float unres = 0.;
  float gk = mix(0.5, 1.1, g);
  // bend the crests: a slow warp of the coordinates (a few metres), so no crest runs straight for long
  vec2 p = p0 + vec2(vn(p0 * 0.045 + 3.7) - 0.5, vn(p0 * 0.045 + 11.3) - 0.5) * 5.0;
  for (int i = 0; i < 40; i++){
    vec4 A = uRA[i], B = uRB[i];
    if (B.w < fw * 3.0) { unres = B.z * gk * gk; break; }
    float filt = smoothstep(fw * 3., fw * 8., B.w);
    float ph = A.z * dot(A.xy, p) - A.w * uTime + B.y;
    // wave groups: the amplitude swells and fades along and across the crest (short-crested sea)
    vec2 q = vec2(dot(A.xy, p), dot(vec2(-A.y, A.x), p)) * A.z;
    float grp = sin(q.x * 0.13 + B.y * 3.0 - A.w * uTime * 0.5) * sin(q.y * 0.21 + B.y * 5.0);
    float env = 0.25 + 1.5 * grp * grp;
    float ak = B.x * A.z * gk * env;
    s += A.xy * ak * cos(ph) * filt;
    unres += ak * ak * 0.5 * (1. - filt);
  }
  return vec3(s, unres);
}
float glints(vec2 p, vec2 need, float fw, float sigma, float rate){
  float acc = 0.;
  for (int l = 0; l < 2; l++){
    float cs = max(l == 0 ? 0.035 : 0.09, fw * 1.2);
    vec2 q = p / cs + float(l) * 17.3;
    vec2 id = floor(q), f = fract(q);
    vec3 h0 = h32(id);
    float tt = uTime * rate + h0.z * 7.;
    vec3 hr = h32(id + floor(tt) * 1.618);
    float r = sqrt(-2. * log(max(hr.x, 1e-4)));
    vec2 sl = r * vec2(cos(6.2831 * hr.y), sin(6.2831 * hr.y)) * sigma;
    float hit = exp(-dot(sl - need, sl - need) / (0.06 * 0.06));
    vec2 c = h0.xy * 0.6 + 0.2;
    float r2 = max(0.012, pow(0.5 * fw / cs, 2.));
    acc += hit * exp(-dot(f - c, f - c) / r2) * 0.012 / r2 * sin(3.14159 * fract(tt)) * 2.2;
  }
  return acc;
}
float shipShadow(vec3 wp){
  vec4 p = uShipVP * vec4(wp, 1.0);
  vec3 c = p.xyz / p.w * 0.5 + 0.5;
  if (c.x < 0.0 || c.x > 1.0 || c.y < 0.0 || c.y > 1.0 || c.z > 1.0) return 1.0;
  float s = 0.0;
  for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) s += texture(uShipSM, vec3(c.xy + vec2(i, j) * uShipTexel * 1.5, c.z - 0.0006));
  return s / 9.0;
}
void main(){
  vec2 p = vRest;
  vec3 V = normalize(cameraPosition - vW);
  float dist = length(cameraPosition - vW);
  float fw = max(length(fwidth(p)), 1e-4);
  float g = gustAt(p, uTime);
  // the tidal stream: fast water is choppy (it runs against the waves), and a seam of foam marks the tide line
  vec2 cur = tideAt(p);
  float cs = length(cur);
  float shear = tideShear(p);
  g = max(g, smoothstep(0.5, 1.8, cs) * 0.9);
  vec4 gs = gerstnerSlope(p, uTime, fw);
  vec3 rp = rippleSlope(p, fw, g) * vec3(uLayers.x, uLayers.x, uLayers.x * uLayers.x);
  vec4 wk = wakeAt(p);
  vec2 grad = gs.xy * uLayers.z + rp.xy + wk.yz * 0.7;
  vec3 N = normalize(vec3(-grad.x, 1.0, -grad.y));
  vec2 suv = vClip.xy / vClip.w * 0.5 + 0.5;
  float shd = shipShadow(vW);
  float sunK = clamp(length(uSunIrr) / 5.0, 0.02, 1.2);
  // Below the surface: the hull and anything else under water, fading fast in the turbid green water
  vec2 ro = vec2(grad.x, grad.y) * 0.05 / max(dist * 0.02, 0.3);
  vec4 refr = texture2D(uRefr, suv + ro);
  if (refr.a < vDepth) refr = texture2D(uRefr, suv);
  float thick = refr.a > 0.0 ? max(refr.a - vDepth, 0.0) : 1e4;
  vec3 ext = exp(-thick * vec3(0.95, 0.42, 0.4));
  // deep-water colour: light scattered back up by suspended matter, brighter where the sun reaches in
  vec3 deep = vec3(0.0065, 0.022, 0.024) * (0.35 + 0.9 * max(uSunDirW.y, 0.0)) * sunK * (0.7 + 0.3 * shd);
  vec3 below = refr.rgb * ext + deep * (1.0 - exp(-thick * 0.35));
  // light through the back of wave crests (seen against the sun): a green glow on the faces that face us
  vec3 L = uSunDirW;
  float sss = pow(max(dot(-V, L) * 0.5 + 0.5, 0.0), 5.0) * max(vH + 0.25, 0.0) * max(dot(N, V), 0.0);
  below += vec3(0.02, 0.08, 0.07) * sss * sunK * 1.4 * shd;
  // Reflection
  float NV = max(dot(N, V), 1e-3);
  float F = 0.02 + 0.98 * pow(1. - NV, 5.);
  // mirror distortion: the slope shifts the reflected image. The shift is limited (a few % of the screen): close to the
  // camera an unlimited shift reads the mirror image at scattered places and draws a lattice of bright lines
  vec2 off = vec2(grad.x, -grad.y) * 70. / max(dist, 12.);
  float offL = length(off);
  off *= min(1.0, 0.3 / max(offL, 1e-4));          // at most ~18 texels of the half-resolution mirror (~2 % of the screen)
  // the rougher the water, the blurrier the mirror: pick a mip level from the unresolved slope spread (sig, below)
  // and the resolved slope, so only the large shapes of sail, hull and islands survive in a breeze
  vec2 ro2 = off * uReflTexel * 60.;
  // resolved ripples break a mirror image into blotches too: fine, high-contrast detail (lattice, nails) must not survive
  float blurL = clamp(log2(1.0 + sqrt(rp.z) * 130.0 + length(grad) * 70.0), 0.0, 5.0);
  vec3 refl = textureLod(uRefl, suv + ro2, blurL).rgb;
  // The mirrored render already holds the sky (clouds included) and everything standing on the water. It is used for
  // every facet, steep or not: switching steep facets to the sky colour draws bright lines along every ripple crest
  // wherever the mirror shows something dark (the hull). Only far out, where the mirror is off screen, the sky fills in
  vec3 R = reflect(-V, N); R.y = abs(R.y);
  vec2 su2 = suv + ro2;
  float outside = max(max(-su2.x, su2.x - 1.0), max(-su2.y, su2.y - 1.0));
  refl = mix(refl, skyBase(R), smoothstep(0.0, 0.05, outside));
  vec3 col = below * (1. - F) + refl * F;
  // Sun glints and the glitter path
  vec3 Hh = normalize(L + V);
  vec2 need = vec2(-Hh.x / Hh.y, -Hh.z / Hh.y) - grad;
  // slope spread that the pixel cannot resolve: the ripples finer than a pixel, plus (far away) the whole Cox-Munk
  // distribution for this wind (sigma^2 = 0.003 + 0.00512 U), which is what makes the glitter path wide
  float cm = 0.003 + 0.00512 * uWindS * (0.6 + 0.8 * g);
  // near the camera the capillary roughness (sub-millimetre) still spreads the highlight: without this floor the sun
  // shows as thin contour lines along the ripples
  float sig = sqrt(0.0055 + rp.z + cm * smoothstep(0.0, 400.0, dist));
  float gl = glints(p + vec2(0., uTime * 0.12), need, fw, sig, 1.7);
  float Fs = 0.02 + 0.98 * pow(1. - max(dot(V, Hh), 0.), 5.);
  col += uLayers.y * uSunIrr * 40.0 * Fs * gl * 0.3 * smoothstep(0.02, 0.2, g + 0.1) * shd;
  float pdf = exp(-dot(need, need) / (2. * sig * sig)) / (6.2831 * sig * sig);
  float mask = NV / (NV + 0.06);
  col += uLayers.y * uSunIrr * Fs * pdf / (4. * NV * pow(Hh.y, 4.)) * mask * smoothstep(8., 90., dist) * shd;
  // Foam: wake patch and folding crests. Lacy (holes open as it thins), white in sun, blue-white in shade
  float crest = smoothstep(0.55, 0.15, gs.w) * smoothstep(0.3, 0.9, g + 0.2);
  float lace = vn(p * 2.2 + vec2(uTime * 0.2, 0.0)) * 0.6 + vn(p * 7.0 - uTime * 0.4) * 0.4;
  float fo = clamp(max(wk.w, vWakeFoam) * 0.9, 0.0, 2.0);
  float foam = smoothstep(0.25, 0.9, fo * (0.55 + 0.9 * lace)) * min(fo * 1.4, 1.0);
  foam = max(foam, crest * smoothstep(0.45, 0.8, lace) * 0.8);
  // tide line: only at the edges of the fast jet, where the stream shears against slack water; broken patches of scum
  float edgeK = smoothstep(0.004, 0.012, shear) * smoothstep(0.5, 1.2, abs(uTide) * 2.0);
  if (edgeK > 0.001) {
    vec2 fd = cs > 0.01 ? cur / cs : vec2(1.0, 0.0);
    vec2 sq = vec2(dot(p, fd), dot(p, vec2(-fd.y, fd.x)));
    float streak = vn(vec2(sq.x * 0.05 - uTime * cs * 0.05, sq.y * 0.22)) * 0.6 + vn(p * 0.6 + uTime * 0.1) * 0.4;
    foam = max(foam, smoothstep(0.52, 0.72, streak) * edgeK * 0.8);
  }
  vec3 foamCol = vec3(0.62, 0.64, 0.63) * (uSunIrr * max(dot(N, L), 0.0) * 0.18 * shd + skyBase(vec3(0.0, 1.0, 0.0)) * 0.35);
  col = mix(col, foamCol, clamp(foam, 0.0, 1.0) * 0.92);
  col = applyHaze(col, vW);
  if (uLayers.w > 0.0) {
    // relief view: the wake field lit from one side, like a plaster cast of the water
    vec3 Nw = normalize(vec3(-wk.y * 30.0, 1.0, -wk.z * 30.0));
    float lum = clamp(dot(Nw, normalize(vec3(-0.6, 0.55, 0.45))), 0.0, 1.0);
    vec3 relief = mix(vec3(0.003, 0.01, 0.015), vec3(0.22, 0.27, 0.3), pow(lum, 1.8)) + vec3(0.25, 0.27, 0.27) * clamp(wk.w, 0.0, 1.0) * 0.6;
    col = mix(col, relief, uLayers.w);
  }
  gl_FragColor = vec4(col, 1.0);
}`;

function polarGrid(rings, seg, r0, r1) {
  // radii grow geometrically; the first ring is a small disc
  const pos = [], fw = [], idx = [];
  const radii = [0];
  const q = Math.pow(r1 / r0, 1 / (rings - 1));
  for (let i = 0; i < rings; i++) radii.push(r0 * Math.pow(q, i));
  for (let i = 0; i < radii.length; i++) {
    const r = radii[i];
    const spacing = Math.max((radii[i + 1] ?? r * q) - r, (2 * Math.PI * Math.max(r, r0)) / seg);
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      pos.push(r * Math.cos(a), 0, r * Math.sin(a));
      fw.push(spacing);
    }
  }
  for (let i = 0; i < radii.length - 1; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * seg + j, b = i * seg + (j + 1) % seg, c = (i + 1) * seg + j, d = (i + 1) * seg + (j + 1) % seg;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aFw', new THREE.Float32BufferAttribute(fw, 1));
  g.setIndex(idx);
  return g;
}

// Ripple constants for the shader (the same hash as before, evaluated once on the CPU)
function h12(x, y) {
  const fr = (v) => v - Math.floor(v);
  let a = fr(x * 0.1031), b = fr(y * 0.1031), c = fr(x * 0.1031);
  const d = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33);
  a += d; b += d; c += d;
  return fr((a + b) * c);
}
export function makeRipples(windDir, A = [], B = []) {
  const rows = [];
  for (let i = 0; i < 40; i++) {
    const lam = 6.0 * Math.pow(0.855, i) * (0.8 + 0.4 * h12(i, 9.1));
    const ang = windDir + (h12(i, 3.1) - 0.5) * 2.8;
    const k = 2 * Math.PI / lam, om = Math.sqrt(9.81 * k + 0.074 / 1000 * k * k * k);
    const ss = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
    const stp = 0.11 * (0.5 + h12(i, 7.7)) * (0.45 + 0.55 * ss(1.2, 0.05, lam));
    rows.push({ dx: Math.cos(ang), dz: Math.sin(ang), k, om, amp: stp / k, ph: h12(i, 1.3) * 6.2831, lam });
  }
  rows.sort((a, b) => b.lam - a.lam);
  let suffix = 0;
  const suf = new Array(40);
  for (let i = 39; i >= 0; i--) { suffix += (rows[i].amp * rows[i].k) ** 2 * 0.5; suf[i] = suffix; }
  rows.forEach((r, i) => {
    (A[i] ||= new THREE.Vector4()).set(r.dx, r.dz, r.k, r.om);
    (B[i] ||= new THREE.Vector4()).set(r.amp, r.ph, suf[i], r.lam);
  });
  return { A, B };
}

export function makeOcean({ skyU, seaU, wakeU, windU, tideU, reflTarget, refrTarget, shipShadowU, timeU, quality }) {
  const uniforms = Object.assign({}, skyU, seaU, wakeU, windU, tideU, shipShadowU, {
    uTime: timeU, uCenter: { value: new THREE.Vector3() },
    uRefl: { value: reflTarget.texture }, uRefr: { value: refrTarget.texture },
    uReflTexel: { value: new THREE.Vector2(1 / reflTarget.width, 1 / reflTarget.height) },
    uSunIrr: { value: skyU.uSunCol.value },
    uRA: { value: [] }, uRB: { value: [] }, uLayers: { value: new THREE.Vector4(1, 1, 1, 0) },
  });
  const wv = windU.uWind.value;
  makeRipples(Math.atan2(wv.y, wv.x), uniforms.uRA.value, uniforms.uRB.value);
  const geo = polarGrid(quality.oceanRings, quality.oceanSeg, 0.35, 16000);
  const mat = new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, uniforms, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  function update(camera) {
    // follow the camera, snapped to 1 m so the near rings don't crawl
    uniforms.uCenter.value.set(Math.round(camera.position.x), 0, Math.round(camera.position.z));
  }
  return { mesh, uniforms, update };
}
