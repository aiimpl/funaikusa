// Wake: a small patch of water simulated on the GPU around the ship (384 x 384 cells of 0.33 m = 127 m square).
// State per cell: R = height now, G = height one step ago, B = foam, A = unused.
//
// Height follows iWave (Tessendorf 2004): the vertical derivative sqrt(-laplacian) is applied as a
// convolution kernel (9 x 9), which gives deep-water dispersion (long waves run faster than short ones). With dispersion a
// moving hull trails the real Kelvin pattern (a 19.5 deg wedge of diverging waves with transverse waves inside)
// instead of a copy of its own outline. The hull's waterline footprint (from the station table) presses the
// surface down; as it moves it heaps water at the bow and leaves a trough at the stern.
// Foam is made along the hull and at the bow in proportion to speed, stays where it was made (so it trails
// behind in world space), spreads slowly and fades over ~20 s.
// The patch is re-centred in whole-cell jumps when the focus (the player's ship) strays from its middle.
// Up to MAXS ships press on it at once (the ones nearest the focus), each with its own type's waterline table;
// cannon balls landing in it drop a pit into the surface that rings outward.
import * as THREE from 'three';

const VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
export const WAKE_N = 512, WAKE_CELL = 0.4, WAKE_SIZE = WAKE_N * WAKE_CELL;
export const HULL_ST = 32;
export const MAXS = 8, NKIND = 3, MAXD = 12;
const KR = 4;

// iWave kernel G(r) = sum_n q_n^2 exp(-sigma q_n^2) J0(q_n r) / G0, in cell units (Tessendorf, "Interactive Water Surfaces")
function kernel() {
  const J0 = (x) => {         // Bessel J0 (Abramowitz & Stegun polynomial approximations)
    const ax = Math.abs(x);
    if (ax < 8) { const y = x * x; return (57568490574.0 + y * (-13362590354.0 + y * (651619640.7 + y * (-11214424.18 + y * (77392.33017 + y * -184.9052456))))) / (57568490411.0 + y * (1029532985.0 + y * (9494680.718 + y * (59272.64853 + y * (267.8532712 + y))))); }
    const z = 8 / ax, y = z * z, xx = ax - 0.785398164;
    const p1 = 1 + y * (-0.1098628627e-2 + y * (0.2734510407e-4 + y * (-0.2073370639e-5 + y * 0.2093887211e-6)));
    const p2 = -0.1562499995e-1 + y * (0.1430488765e-3 + y * (-0.6911147651e-5 + y * (0.7621095161e-6 - y * 0.934935152e-7)));
    return Math.sqrt(0.636619772 / ax) * (Math.cos(xx) * p1 - z * Math.sin(xx) * p2);
  };
  const dq = 0.001, sigma = 1.0;
  let G0 = 0;
  for (let n = 1; n <= 10000; n++) { const q = n * dq; G0 += q * q * Math.exp(-sigma * q * q); }
  const K = [];
  for (let j = 0; j <= KR; j++) for (let i = 0; i <= KR; i++) {
    const r = Math.hypot(i, j);
    let g = 0;
    for (let n = 1; n <= 10000; n++) { const q = n * dq; g += q * q * Math.exp(-sigma * q * q) * J0(q * r); }
    K.push(r > KR + 0.5 ? 0 : g / G0);
  }
  return K;
}

export class Wake {
  // tables: one station list per type (index = kind number)
  constructor(renderer, tables) {
    this.r = renderer;
    const opt = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false };
    this.rt = [new THREE.WebGLRenderTarget(WAKE_N, WAKE_N, opt), new THREE.WebGLRenderTarget(WAKE_N, WAKE_N, opt)];
    this.cur = 0;
    this.origin = new THREE.Vector2(0, 0);      // world xz of the patch centre
    // half-breadth at the waterline along the hull, as (f, halfwidth) samples from stern to bow
    this.hull = [].concat(...tables.map((st) => this.hullTable(st)));
    const V2 = () => new THREE.Vector2(), V4 = () => new THREE.Vector4();
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.scene = new THREE.Scene(); this.scene.add(this.quad);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.sim = new THREE.ShaderMaterial({
      vertexShader: VERT, depthTest: false, depthWrite: false,
      uniforms: {
        uS: { value: null }, uTexel: { value: 1 / WAKE_N }, uOrigin: { value: this.origin }, uSize: { value: WAKE_SIZE },
        uDt: { value: 1 / 60 }, uShipP: { value: Array.from({ length: MAXS }, V4) }, uShipF: { value: Array.from({ length: MAXS }, V4) },
        uNS: { value: 0 }, uHull: { value: this.hull }, uShift: { value: new THREE.Vector2() },
        uTime: { value: 0 }, uK: { value: kernel() }, uGdt2: { value: 0 }, uA: { value: 0 },
        uDrop: { value: Array.from({ length: MAXD }, V4) }, uND: { value: 0 },
      },
      fragmentShader: /* glsl */`
        uniform sampler2D uS; uniform float uTexel, uSize, uDt, uTime;
        uniform vec2 uOrigin, uShift;
        // per ship: P = (x, z, heave, sub), F = (fwd.x, fwd.z, speed, kind)
        uniform vec4 uShipP[${MAXS}], uShipF[${MAXS}]; uniform int uNS;
        uniform vec2 uHull[${HULL_ST * NKIND}];
        uniform vec4 uDrop[${MAXD}]; uniform int uND;
        uniform float uK[${(KR + 1) * (KR + 1)}]; uniform float uGdt2, uA;
        varying vec2 vUv;
        float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
        float vn(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3. - 2. * f);
          return mix(mix(h12(i), h12(i + vec2(1, 0)), u.x), mix(h12(i + vec2(0, 1)), h12(i + vec2(1, 1)), u.x), u.y); }
        // signed distance (m) from the waterline outline of the hull, in ship-local (f forward, x port)
        float hullSDF(vec2 q, int k){
          int o = k * ${HULL_ST};
          float f = q.x, x = abs(q.y);
          vec2 h0 = uHull[o], h1 = uHull[o + ${HULL_ST - 1}];
          if (f < h0.x || f > h1.x) {
            float e = f < h0.x ? h0.x - f : f - h1.x;
            return max(e, x - (f < h0.x ? h0.y : h1.y));
          }
          float w = 0.0;
          for (int i = 0; i < ${HULL_ST - 1}; i++){
            vec2 a = uHull[o + i], b = uHull[o + i + 1];
            if (f >= a.x && f <= b.x) w = mix(a.y, b.y, (f - a.x) / max(b.x - a.x, 1e-3));
          }
          return x - w;
        }
        void main(){
          vec2 uv = vUv + uShift;                        // re-centring shifts the whole field by whole cells
          vec4 s = texture2D(uS, uv);
          if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) s = vec4(0.0);
          float hl = texture2D(uS, uv - vec2(uTexel, 0.0)).r, hr = texture2D(uS, uv + vec2(uTexel, 0.0)).r;
          float hd = texture2D(uS, uv - vec2(0.0, uTexel)).r, hu = texture2D(uS, uv + vec2(0.0, uTexel)).r;
          // vertical derivative by convolution (the kernel is symmetric: store one quadrant)
          float vd = 0.0;
          for (int j = -${KR}; j <= ${KR}; j++) for (int i = -${KR}; i <= ${KR}; i++) {
            float kk = uK[abs(j) * ${KR + 1} + abs(i)];
            if (kk != 0.0) vd += kk * texture2D(uS, uv + vec2(float(i), float(j)) * uTexel).r;
          }
          float hn = (s.r * (2.0 - uA) - s.g - uGdt2 * vd) / (1.0 + uA);
          // bleed off grid-scale ripple (the kernel does not resolve it and it shows as a saw edge on the hull)
          hn = mix(hn, (hl + hr + hd + hu) * 0.25, 0.12);
          hn = clamp(hn, -0.7, 0.7);
          vec2 w = uOrigin + (uv - 0.5) * uSize;           // world xz of this cell
          float make = 0.0, inside = 0.0;
          for (int si = 0; si < ${MAXS}; si++){
            if (si >= uNS) break;
            vec4 P = uShipP[si], Fw = uShipF[si];
            vec2 d = w - P.xy;
            int kind = int(Fw.w + 0.5);
            float reach = uHull[kind * ${HULL_ST} + ${HULL_ST - 1}].x + 6.0;
            if (dot(d, d) > reach * reach * 1.6) continue;
            vec2 fwd = Fw.xy, side = vec2(fwd.y, -fwd.x);   // side points to port in three.js axes (x left)
            vec2 q = vec2(dot(d, fwd), dot(d, side));
            float sdf = hullSDF(q, kind);
            float spd = Fw.z, sub = P.w, heave = P.z;
            // inside the waterline the hull holds the surface down; its edge is soft
            float ins = smoothstep(1.2, -1.0, sdf) * sub;
            float press = -0.035 * spd - heave * 0.5;
            hn = mix(hn, press, ins * 0.2 * smoothstep(0.2, 1.5, spd + abs(heave) * 3.0));
            inside = max(inside, ins);
            // foam along the sides, at the bow and in the stern eddies
            float band = exp(-max(sdf, 0.0) * 2.2) * smoothstep(-0.05, 0.25, sdf);
            float bowF = uHull[kind * ${HULL_ST} + ${HULL_ST - 1}].x, sternF = uHull[kind * ${HULL_ST}].x;
            float bow = smoothstep(4.0, 0.0, length(q - vec2(bowF - 1.0, 0.0)));
            float stern = smoothstep(5.0, 0.0, length(q - vec2(sternF - 1.5, 0.0))) * step(q.x, sternF + 1.0);
            float n = vn(w * 3.1 + uTime * 0.7) * vn(w * 0.9 - uTime * 0.3);
            make += (band * (0.25 + 0.75 * n) * 0.7 + bow * 1.3 + stern * n * 0.25) * smoothstep(0.5, 3.5, spd) * sub;
            // the oars: a row of small stirred patches along each side, just outboard
            float oarBand = smoothstep(2.5, 0.0, abs(abs(q.y) - (uHull[kind * ${HULL_ST} + ${HULL_ST / 2}].y + 3.2))) * step(sternF + 2.0, q.x) * step(q.x, bowF - 3.0);
            make += oarBand * n * 0.35 * sub * smoothstep(0.3, 1.5, spd);
          }
          // balls landing: a pit that rings out, and foam
          for (int di = 0; di < ${MAXD}; di++){
            if (di >= uND) break;
            vec4 D = uDrop[di];
            float r = length(w - D.xy);
            float k = exp(-r * r / (D.z * D.z));
            hn -= D.w * k;
            make += k * D.w * 30.0;
          }
          float slope = length(vec2(hr - hl, hu - hd)) / (2.0 * uSize * uTexel);
          make += smoothstep(0.35, 0.6, slope) * 0.6;    // only really steep water breaks white (the bow wave crest)
          // foam spreads a little and decays (half-life ~ 12 s)
          float fb = (texture2D(uS, uv - vec2(uTexel, 0.0)).b + texture2D(uS, uv + vec2(uTexel, 0.0)).b
                    + texture2D(uS, uv - vec2(0.0, uTexel)).b + texture2D(uS, uv + vec2(0.0, uTexel)).b) * 0.25;
          float foam = mix(s.b, fb, 0.06) * exp(-uDt / 9.0) + make * uDt * 1.6;
          foam *= 1.0 - inside;
          // fade everything toward the patch border so the edge never shows
          vec2 e = min(uv, 1.0 - uv);
          float edge = smoothstep(0.0, 0.06, min(e.x, e.y));
          gl_FragColor = vec4(hn * edge, s.r * edge, clamp(foam, 0.0, 3.0) * edge, 1.0);
        }`,
    });
    for (const t of this.rt) { renderer.setRenderTarget(t); renderer.clear(); }
    renderer.setRenderTarget(null);
    this.acc = 0;
    this.t = 0;
    this.uniforms = { uWake: { value: this.rt[0].texture }, uWakeO: { value: this.origin }, uWakeS: { value: WAKE_SIZE }, uWakeTexel: { value: 1 / WAKE_N } };
  }
  // start over (the ship was moved somewhere else: the old field must not follow it)
  reset(x, z) {
    for (const t of this.rt) { this.r.setRenderTarget(t); this.r.setClearColor(0x000000, 0); this.r.clear(); }
    this.r.setRenderTarget(null);
    this.origin.set(x, z);
  }
  hullTable(stations) {
    // stations: [(f, [(x, z) edge points bottom->sheer])] -> half-breadth at z = 0 for each station
    const out = [];
    const pick = (i) => stations[Math.round(i * (stations.length - 1) / (HULL_ST - 1))];
    for (let i = 0; i < HULL_ST; i++) {
      const [f, pts] = pick(i);
      let w = 0;
      for (let k = 0; k + 1 < pts.length; k++) {
        const [x0, z0] = pts[k], [x1, z1] = pts[k + 1];
        if (z0 <= 0 && z1 >= 0) w = x0 + (x1 - x0) * (0 - z0) / Math.max(z1 - z0, 1e-6);
      }
      if (pts[0][1] > 0) w = 0.05;
      out.push(new THREE.Vector2(f, w));
    }
    return out;
  }
  // focus: world point the patch follows; ships: [{pos, fwd (Vector2), speed, heave, sub, kind}] (nearest first);
  // drops: [{x, z, r, h}] cannon balls that landed since the last call
  step(dt, focus, ships, drops = []) {
    const u = this.sim.uniforms;
    if (this.pending?.length) { drops = this.pending.concat(drops); this.pending = null; }
    const dx = focus.x - this.origin.x, dz = focus.z - this.origin.y;
    let sx = 0, sy = 0;
    if (Math.abs(dx) > WAKE_SIZE * 0.12) sx = Math.round(dx / WAKE_CELL);
    if (Math.abs(dz) > WAKE_SIZE * 0.12) sy = Math.round(dz / WAKE_CELL);
    this.acc = Math.min(this.acc + dt, 0.1);
    const h = 1 / 60;
    u.uGdt2.value = (9.81 / WAKE_CELL) * h * h;
    u.uA.value = 0.18 * h;
    u.uDt.value = h;
    const n = Math.min(ships.length, MAXS);
    for (let i = 0; i < n; i++) {
      const s = ships[i];
      u.uShipP.value[i].set(s.pos.x, s.pos.z, s.heave, s.sub ?? 1);
      u.uShipF.value[i].set(s.fwd.x, s.fwd.y, s.speed, s.kind);
    }
    u.uNS.value = n;
    const nd = Math.min(drops.length, MAXD);
    for (let i = 0; i < nd; i++) u.uDrop.value[i].set(drops[i].x, drops[i].z, drops[i].r, drops[i].h);
    let first = true;
    while (this.acc >= h) {
      this.acc -= h;
      this.t += h;
      u.uTime.value = this.t;
      if (first && (sx || sy)) {
        u.uShift.value.set(sx / WAKE_N, sy / WAKE_N);
        this.origin.x += sx * WAKE_CELL; this.origin.y += sy * WAKE_CELL;
      } else u.uShift.value.set(0, 0);
      u.uND.value = first ? nd : 0;
      first = false;
      u.uS.value = this.rt[this.cur].texture;
      this.quad.material = this.sim;
      this.r.setRenderTarget(this.rt[1 - this.cur]);
      this.r.render(this.scene, this.cam);
      this.cur = 1 - this.cur;
    }
    if (first) this.pending = drops;         // no step this frame: keep the drops for the next one
    this.r.setRenderTarget(null);
    this.uniforms.uWake.value = this.rt[this.cur].texture;
  }
}

// GLSL for the water shader: height, slope and foam of the wake at world xz
export const wakeGLSL = /* glsl */`
uniform sampler2D uWake; uniform vec2 uWakeO; uniform float uWakeS, uWakeTexel;
vec4 wakeAt(vec2 w){
  vec2 uv = (w - uWakeO) / uWakeS + 0.5;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec4(0.0);
  float h = texture2D(uWake, uv).r;
  float hx = texture2D(uWake, uv + vec2(uWakeTexel, 0.0)).r - texture2D(uWake, uv - vec2(uWakeTexel, 0.0)).r;
  float hz = texture2D(uWake, uv + vec2(0.0, uWakeTexel)).r - texture2D(uWake, uv - vec2(0.0, uWakeTexel)).r;
  float cell = uWakeS * uWakeTexel;
  return vec4(h, hx / (2.0 * cell), hz / (2.0 * cell), texture2D(uWake, uv).b);
}
`;
