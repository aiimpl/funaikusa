// Particles for the guns and the fires: gun smoke, muzzle flash, spray and splash columns, splinters, flames, embers.
// Simulated on the CPU (a few thousand at most), drawn as camera-facing quads in two instanced meshes: one blended
// (smoke, spray, splinters, black fire smoke) and one additive (flash, flame, embers).
//
// Smoke is lit by the same rules as the haze in sky.js: each puff is a ball of scattering particles. Light from the
// sun reaches it through the puff itself (darker on the side away from the sun, by the puff's optical depth) and is
// scattered toward the eye with the same forward-peaked phase function as the haze (Henyey-Greenstein, g ~ 0.6):
// looking toward the sun the smoke glows bright, with the sun behind you it is a flat grey. Sky light fills the rest.
// Black-powder smoke is dense and white-grey; burning timber gives brown-black smoke. Distant particles are hazed.
import * as THREE from 'three';
import { skyGLSL } from './sky.js';

export const T = { SMOKE: 0, SPRAY: 1, SPLINTER: 2, SOOT: 3, FLASH: 4, FLAME: 5, EMBER: 6, MIST: 7 };
const MAX = 6000;

const VERT = /* glsl */`
attribute vec4 aP;       // xyz, size (m)
attribute vec4 aD;       // type, age/life (0..1), seed, alpha
uniform vec3 uCamR, uCamU;
varying vec2 vQ; varying vec4 vD; varying vec3 vW; varying float vSize;
void main(){
  vQ = position.xy * 2.0;
  float ang = aD.z * 6.283 + aD.y * (aD.z - 0.5) * 2.0;
  vec2 r = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * position.xy;
  vec3 w = aP.xyz + (uCamR * r.x + uCamU * r.y) * aP.w;
  vW = w; vD = aD; vSize = aP.w;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;

const NOISE = /* glsl */`
float fh(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float fn2(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3. - 2. * f);
  return mix(mix(fh(i), fh(i + vec2(1, 0)), u.x), mix(fh(i + vec2(0, 1)), fh(i + vec2(1, 1)), u.x), u.y); }
float fbm2(vec2 p){ return fn2(p) * 0.5 + fn2(p * 2.1 + 3.7) * 0.3 + fn2(p * 4.3 + 9.1) * 0.2; }
`;

function blendedMaterial(skyU, extra) {
  return new THREE.ShaderMaterial({
    uniforms: Object.assign({}, skyU, extra), transparent: true, depthWrite: false,
    vertexShader: VERT,
    fragmentShader: /* glsl */`
      ${skyGLSL}
      ${NOISE}
      uniform vec3 uAmbUp, uAmbDn; uniform vec3 uCamR, uCamU;
      varying vec2 vQ; varying vec4 vD; varying vec3 vW; varying float vSize;
      void main(){
        float type = vD.x, age = vD.y, seed = vD.z, alpha = vD.w;
        float r2 = dot(vQ, vQ);
        if (r2 > 1.0) discard;
        vec3 V = normalize(vW - cameraPosition);
        vec3 col; float a;
        if (type < 0.5 || (type > 2.5 && type < 3.5) || type > 6.5) {
          // a smoke puff: ragged edge from noise that drifts as it ages; density falls off to the rim
          float n = fbm2(vQ * 1.7 + seed * 19.0 + age * 1.3);
          float dens = clamp((1.0 - r2) * 1.4 - (n - 0.45) * 1.1, 0.0, 1.0);
          dens = dens * dens * (3.0 - 2.0 * dens);
          // sphere normal of the puff (toward the camera), for how much of the puff lies between this point and the sun
          vec3 nrm = normalize(uCamR * vQ.x + uCamU * vQ.y - V * sqrt(max(1.0 - r2, 0.0)));
          float toSun = dot(nrm, uSunDirW) * 0.5 + 0.5;
          bool soot = type > 2.5 && type < 3.5;
          bool mist = type > 6.5;
          float albedo = soot ? 0.18 : (mist ? 0.95 : 0.85);
          float od = (soot ? 3.0 : 1.6) * (0.5 + 0.5 * (1.0 - age));    // optical depth across the puff: thins as it spreads
          float trans = exp(-od * (1.0 - toSun));
          float ph = hgPhase(dot(V, uSunDirW), 0.6) * 12.566;           // 1 = isotropic
          float ms = 0.35;                                               // light scattered more than once: softens the dark side
          vec3 sun = uSunCol * albedo * (trans * mix(ph, 1.0, 0.25) + ms * (1.0 - trans) * 0.5) * 0.12;
          vec3 amb = mix(uAmbDn, uAmbUp, nrm.y * 0.5 + 0.5) * albedo;
          col = sun + amb;
          if (soot) col *= vec3(1.0, 0.9, 0.8);
          a = dens * alpha * (soot ? 0.9 : (mist ? 0.35 : 0.8));
        } else if (type < 1.5) {
          // spray: a droplet (small bright disc), catching the sun
          a = smoothstep(1.0, 0.4, r2) * alpha;
          col = uAmbUp * 1.4 + uSunCol * 0.06 * (1.0 + 3.0 * pow(max(dot(-V, uSunDirW) * -1.0, 0.0), 8.0));
        } else {
          // splinter: a small dark chip
          a = smoothstep(1.0, 0.6, r2) * alpha;
          col = vec3(0.05, 0.035, 0.02) * (uAmbUp * 2.0 + uSunCol * 0.1);
        }
        col = applyHaze(col, vW);
        gl_FragColor = vec4(col, a);
      }`,
  });
}

function additiveMaterial(skyU) {
  return new THREE.ShaderMaterial({
    uniforms: Object.assign({}, skyU, { uCamR: { value: new THREE.Vector3() }, uCamU: { value: new THREE.Vector3() } }),
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: VERT,
    fragmentShader: /* glsl */`
      ${skyGLSL}
      ${NOISE}
      varying vec2 vQ; varying vec4 vD; varying vec3 vW; varying float vSize;
      void main(){
        float type = vD.x, age = vD.y, seed = vD.z, alpha = vD.w;
        float r2 = dot(vQ, vQ);
        if (r2 > 1.0) discard;
        vec3 col;
        if (type < 4.5) {
          // muzzle flash: white-hot core, orange fringe, gone in a few frames
          float k = pow(1.0 - r2, 3.0);
          col = mix(vec3(9.0, 3.2, 0.9), vec3(30.0, 22.0, 12.0), pow(1.0 - r2, 8.0)) * k * alpha;
        } else if (type < 5.5) {
          // flame tongue: flickering noise, yellow at the base, dull red at the tips
          float n = fbm2(vec2(vQ.x * 2.0 + seed * 7.0, vQ.y * 1.2 - age * 6.0 - seed * 3.0));
          float f = clamp((1.0 - r2) * 1.6 - n * 1.1 + (1.0 - age) * 0.3, 0.0, 1.0);
          vec3 c = mix(vec3(2.4, 0.35, 0.05), vec3(6.0, 2.6, 0.6), smoothstep(0.3, 0.9, f));
          col = c * f * alpha;
        } else {
          col = vec3(5.0, 1.6, 0.3) * pow(1.0 - r2, 2.0) * alpha;    // ember
        }
        // haze swallows light with distance (no in-scatter for glowing things)
        col *= exp(-hazeDepth(vW));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

export class FX {
  constructor(skyU, wind) {
    this.wind = wind;
    this.p = new Float32Array(MAX * 3); this.v = new Float32Array(MAX * 3);
    this.size = new Float32Array(MAX); this.grow = new Float32Array(MAX);
    this.life = new Float32Array(MAX); this.age = new Float32Array(MAX); this.type = new Uint8Array(MAX);
    this.seed = new Float32Array(MAX); this.drag = new Float32Array(MAX); this.buoy = new Float32Array(MAX); this.a0 = new Float32Array(MAX);
    this.free = [];
    for (let i = MAX - 1; i >= 0; i--) this.free.push(i);
    this.live = [];
    this.U = { uCamR: { value: new THREE.Vector3() }, uCamU: { value: new THREE.Vector3() }, uAmbUp: { value: new THREE.Color() }, uAmbDn: { value: new THREE.Color() } };
    const quad = new THREE.PlaneGeometry(1, 1);
    const mk = (mat) => {
      const g = new THREE.InstancedBufferGeometry();
      g.index = quad.index; g.setAttribute('position', quad.attributes.position);
      const aP = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4).setUsage(THREE.DynamicDrawUsage);
      const aD = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4).setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('aP', aP); g.setAttribute('aD', aD);
      g.instanceCount = 0;
      const m = new THREE.Mesh(g, mat); m.frustumCulled = false;
      return { m, g, aP, aD };
    };
    const bm = blendedMaterial(skyU, this.U);
    const am = additiveMaterial(skyU);
    am.uniforms.uCamR = this.U.uCamR; am.uniforms.uCamU = this.U.uCamU;
    this.blend = mk(bm); this.add = mk(am);
    this.blend.m.renderOrder = 10; this.add.m.renderOrder = 11;
    this.group = new THREE.Group();
    this.group.add(this.blend.m, this.add.m);
    // light: short-lived point lights for the flashes and the fires (a few, reused)
    // (they light the world, so they live in their own group added to the main scene, not with the particles)
    this.lights = [];
    this.lightGroup = new THREE.Group();
    for (let i = 0; i < 4; i++) { const L = new THREE.PointLight(0xffb070, 0, 90, 2); this.lights.push({ L, t: 0, k: 0 }); this.lightGroup.add(L); }
  }
  spawn(type, x, y, z, vx, vy, vz, size, life, { grow = 0, drag = 1, buoy = 0, alpha = 1 } = {}) {
    const i = this.free.pop();
    if (i === undefined) return -1;
    this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z;
    this.v[i * 3] = vx; this.v[i * 3 + 1] = vy; this.v[i * 3 + 2] = vz;
    this.size[i] = size; this.grow[i] = grow; this.life[i] = life; this.age[i] = 0; this.type[i] = type;
    this.seed[i] = Math.random(); this.drag[i] = drag; this.buoy[i] = buoy; this.a0[i] = alpha;
    this.live.push(i);
    return i;
  }
  flashLight(pos, strength, dur) {
    const s = this.lights.reduce((a, b) => (a.k < b.k ? a : b));
    s.L.position.copy(pos); s.t = dur; s.dur = dur; s.k = strength;
  }
  // a gun going off: pos = muzzle, dir = bore direction (unit), charge ~ 1 for a big gun, 0.2 for a musket
  muzzle(pos, dir, charge = 1, vship = null) {
    const R = Math.random;
    const vx0 = vship?.x ?? 0, vz0 = vship?.z ?? 0;
    this.spawn(T.FLASH, pos.x + dir.x * 0.6 * charge, pos.y + dir.y * 0.6, pos.z + dir.z * 0.6 * charge, 0, 0, 0, 1.6 * charge + 0.3, 0.07);
    this.spawn(T.FLASH, pos.x + dir.x * 1.8 * charge, pos.y + dir.y * 1.8, pos.z + dir.z * 1.8 * charge, 0, 0, 0, 1.1 * charge + 0.2, 0.05);
    this.flashLight(pos, 3000 * charge, 0.09);
    // the cloud: a fast jet along the bore that stalls within metres, then billows slowly downwind
    const n = Math.round(10 + 26 * charge);
    for (let k = 0; k < n; k++) {
      const s = (4 + R() * 26) * Math.sqrt(charge);
      const sp = 0.25 + R() * 0.35;
      this.spawn(T.SMOKE, pos.x, pos.y, pos.z,
        vx0 + (dir.x + (R() - 0.5) * sp) * s, (dir.y + (R() - 0.3) * sp) * s, vz0 + (dir.z + (R() - 0.5) * sp) * s,
        (0.5 + R() * 0.8) * (0.4 + charge), 18 + R() * 22, { grow: 0.22 + R() * 0.25, drag: 2.2, buoy: 0.08, alpha: 0.9 });
    }
    // a puff at the touch hole
    if (charge > 0.5) this.spawn(T.SMOKE, pos.x - dir.x * 2.2, pos.y + 0.3, pos.z - dir.z * 2.2, 0, 0.8, 0, 0.5, 8, { grow: 0.2, drag: 1.5, buoy: 0.1, alpha: 0.7 });
    for (let k = 0; k < 8 * charge; k++) this.spawn(T.EMBER, pos.x, pos.y, pos.z, dir.x * 30 * R() + (R() - 0.5) * 4, dir.y * 30 * R() + R() * 3, dir.z * 30 * R() + (R() - 0.5) * 4, 0.06, 0.6 + R() * 0.8, { drag: 0.6 });
  }
  // a ball landing in the sea: a column of spray, falling back as mist
  splash(pos, energy = 1) {
    const R = Math.random;
    const n = Math.round(60 * energy + 20);
    for (let k = 0; k < n; k++) {
      const a = R() * Math.PI * 2, rr = R() * 0.6;
      const up = (6 + R() * 12) * Math.sqrt(energy);
      this.spawn(T.SPRAY, pos.x + Math.cos(a) * rr, 0.1, pos.z + Math.sin(a) * rr, Math.cos(a) * (0.5 + R() * 2.2), up, Math.sin(a) * (0.5 + R() * 2.2), 0.12 + R() * 0.2, 3.5, { drag: 0.08 });
    }
    for (let k = 0; k < 14 * energy; k++) {
      const a = R() * Math.PI * 2;
      this.spawn(T.MIST, pos.x + Math.cos(a) * 0.8, 1 + R() * 6 * energy, pos.z + Math.sin(a) * 0.8, Math.cos(a) * 0.8, 1 + R() * 2, Math.sin(a) * 0.8, 1.2 + R(), 6 + R() * 4, { grow: 0.35, drag: 1.2, buoy: -0.05, alpha: 0.7 });
    }
  }
  // shot striking timber: splinters and a puff of dust
  splinters(pos, dir, energy = 1) {
    const R = Math.random;
    for (let k = 0; k < 30 * energy; k++) {
      this.spawn(T.SPLINTER, pos.x, pos.y, pos.z, dir.x * 6 * R() + (R() - 0.5) * 9, R() * 8, dir.z * 6 * R() + (R() - 0.5) * 9, 0.05 + R() * 0.12, 2.5, { drag: 0.2 });
    }
    for (let k = 0; k < 6; k++) this.spawn(T.SMOKE, pos.x, pos.y, pos.z, (R() - 0.5) * 3, R() * 2, (R() - 0.5) * 3, 0.6, 6, { grow: 0.3, drag: 2, alpha: 0.5 });
  }
  // one burning spot, called every frame while it burns (intensity 0..1)
  burn(pos, k, dt) {
    const R = Math.random;
    if (R() < dt * 30 * k) this.spawn(T.FLAME, pos.x + (R() - 0.5) * 1.5, pos.y + R() * 0.5, pos.z + (R() - 0.5) * 1.5, (R() - 0.5), 2 + R() * 3, (R() - 0.5), 0.8 + R() * 1.2 * k, 0.6 + R() * 0.5, { grow: 0.4, drag: 1.2, buoy: 0.5 });
    if (R() < dt * 6 * k) this.spawn(T.SOOT, pos.x + (R() - 0.5), pos.y + 1.5, pos.z + (R() - 0.5), 0, 2 + R() * 2, 0, 1.0 + R() * k, 14 + R() * 10, { grow: 0.45, drag: 0.8, buoy: 0.35, alpha: 0.85 });
    if (R() < dt * 10 * k) this.spawn(T.EMBER, pos.x, pos.y + 1, pos.z, (R() - 0.5) * 2, 3 + R() * 4, (R() - 0.5) * 2, 0.05, 2 + R() * 2, { drag: 0.5, buoy: 0.3 });
  }
  update(dt, t, camera) {
    const e = camera.matrixWorld.elements;
    this.U.uCamR.value.set(e[0], e[1], e[2]); this.U.uCamU.value.set(e[4], e[5], e[6]);
    const wv = this.wind.uniforms.uWind.value;
    const bb = this.blend, ad = this.add;
    let nb = 0, na = 0;
    const out = [];
    for (const i of this.live) {
      this.age[i] += dt;
      const L = this.life[i];
      if (this.age[i] >= L) { this.free.push(i); continue; }
      out.push(i);
      const ty = this.type[i];
      const o = i * 3;
      const v = this.v, p = this.p;
      const drag = this.drag[i];
      const heavy = ty === T.SPRAY || ty === T.SPLINTER || ty === T.EMBER;
      // air: particles relax toward the wind (smoke fast, droplets slowly); gravity for heavy ones, lift for hot smoke
      const k = 1 - Math.exp(-drag * dt);
      v[o] += (wv.x - v[o]) * k; v[o + 2] += (wv.y - v[o + 2]) * k;
      v[o + 1] += (heavy ? -9.81 * dt : 0) + this.buoy[i] * dt - v[o + 1] * (heavy ? 0 : k);
      p[o] += v[o] * dt; p[o + 1] += v[o + 1] * dt; p[o + 2] += v[o + 2] * dt;
      if (heavy && p[o + 1] < 0) { this.age[i] = L; }
      this.size[i] += this.grow[i] * dt * (ty === T.SMOKE ? Math.max(0.2, 1 - this.age[i] / L) * 2 : 1);
      const u = this.age[i] / L;
      let a = this.a0[i];
      if (ty === T.SMOKE || ty === T.SOOT || ty === T.MIST) a *= Math.min(u * 12, 1) * Math.pow(1 - u, 1.5);
      else if (ty === T.FLAME) a *= Math.sin(Math.PI * Math.min(u * 1.3, 1));
      else if (ty === T.FLASH) a *= 1 - u;
      else a *= 1 - u * u;
      const tgt = ty >= T.FLASH && ty !== T.MIST ? ad : bb;
      const j = tgt === ad ? na++ : nb++;
      tgt.aP.array.set([p[o], p[o + 1], p[o + 2], this.size[i]], j * 4);
      tgt.aD.array.set([ty, u, this.seed[i], a], j * 4);
    }
    this.live = out;
    bb.g.instanceCount = nb; ad.g.instanceCount = na;
    for (const x of [bb, ad]) { x.aP.needsUpdate = true; x.aD.needsUpdate = true; }
    for (const s of this.lights) {
      if (s.t > 0) { s.t -= dt; s.L.intensity = s.k * Math.max(s.t / s.dur, 0); } else s.L.intensity = 0;
    }
  }
  // sky light on the smoke: from above (sky) and below (sea), set from the hemisphere light
  setAmbient(up, dn) { this.U.uAmbUp.value.copy(up); this.U.uAmbDn.value.copy(dn); }
}
