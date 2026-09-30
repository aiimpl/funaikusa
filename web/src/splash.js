// Splash: large droplets thrown from the entry point, soft spreading mist, and bubbles rising from the sinking car.
// Particles are camera-facing round points (Points). Sunlit ones are white, shaded ones bluish white.
import * as THREE from 'three';

const MAX = 2400;
export class Splash {
  constructor(waterY, onPop) {
    this.W = waterY; this.onPop = onPop;
    this.p = new Float32Array(MAX * 3); this.v = new Float32Array(MAX * 3);
    this.life = new Float32Array(MAX); this.age = new Float32Array(MAX); this.kind = new Uint8Array(MAX); this.size0 = new Float32Array(MAX);
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(new Float32Array(MAX * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(new Float32Array(MAX), 1).setUsage(THREE.DynamicDrawUsage);
    this.aAlpha = new THREE.BufferAttribute(new Float32Array(MAX), 1).setUsage(THREE.DynamicDrawUsage);
    this.aKind = new THREE.BufferAttribute(new Float32Array(MAX), 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos); g.setAttribute('aSize', this.aSize); g.setAttribute('aAlpha', this.aAlpha); g.setAttribute('aKind', this.aKind);
    this.uniforms = { uSunCol: { value: new THREE.Color() }, uAmb: { value: new THREE.Color(0.15, 0.17, 0.18) }, uH: { value: 1080 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false,
      vertexShader: /* glsl */`
        attribute float aSize, aAlpha, aKind; uniform float uH; varying float vA; varying float vK;
        void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
          gl_PointSize = min(aSize * uH * projectionMatrix[1][1] / max(-mv.z, 0.1) * 0.5, uH * 0.012 * (aKind > 0.5 && aKind < 1.5 ? 12.0 : 1.0));
          vA = aAlpha * smoothstep(1.0, 4.0, -mv.z); vK = aKind; }`,
      fragmentShader: /* glsl */`
        uniform vec3 uSunCol, uAmb; varying float vA; varying float vK;
        void main(){
          vec2 q = gl_PointCoord * 2.0 - 1.0; float r = dot(q, q);
          if (r > 1.0) discard;
          float a;
          vec3 c;
          if (vK < 0.5) { a = smoothstep(1.0, 0.55, r); c = uSunCol * 0.18 + uAmb * 1.6 + vec3(0.5) * pow(1.0 - r, 6.0); }      // droplet
          else if (vK < 1.5) { a = pow(1.0 - r, 2.0) * 0.14; c = uSunCol * 0.07 + uAmb * 1.1; }                                       // mist
          else { a = smoothstep(1.0, 0.7, r) - smoothstep(0.6, 0.0, r) * 0.6; c = uAmb * 1.2 + vec3(0.25, 0.35, 0.35); }     // bubble (ring with a bright rim)
          gl_FragColor = vec4(c, a * vA);
        }`,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.n = 0;
  }
  emit(kind, x, y, z, vx, vy, vz, life, size) {
    let i = -1;
    for (let k = 0; k < MAX; k++) { const j = (this.n + k) % MAX; if (this.life[j] <= 0) { i = j; break; } }
    if (i < 0) i = this.n;
    this.n = (i + 1) % MAX;
    this.p.set([x, y, z], i * 3); this.v.set([vx, vy, vz], i * 3);
    this.life[i] = life; this.age[i] = 0; this.kind[i] = kind; this.size0[i] = size;
  }
  // Entry: amount scaled by the fall speed vy and forward speed v
  burst(pt, vy, v) {
    const k = Math.min((vy + v * 0.25) / 6, 2.5);
    const n = Math.floor(90 * k + 20);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = (1.5 + Math.random() * 4.5) * (0.5 + k * 0.5);
      this.emit(0, pt.x + Math.cos(a) * 0.6, this.W + 0.05, pt.z + Math.sin(a) * 0.6,
        Math.cos(a) * s * 0.6, (2 + Math.random() * 5) * (0.6 + k * 0.5), Math.sin(a) * s * 0.6, 3, 0.05 + Math.random() * 0.09);
    }
    for (let i = 0; i < 6 * k + 2; i++) {
      const a = Math.random() * Math.PI * 2;
      this.emit(1, pt.x + Math.cos(a) * 1.2, this.W + 0.3 + Math.random(), pt.z + Math.sin(a) * 1.2,
        Math.cos(a) * 1.6, 0.6 + Math.random() * 0.8, Math.sin(a) * 1.6, 1.4 + Math.random(), 0.7 + Math.random() * 0.8);
    }
    this.onPop?.(pt.x, pt.z, Math.min(0.6 + k, 2.0));
  }
  // bubbles from the sinking car
  bubbles(pos, amount, dt) {
    const n = amount * dt * 60;
    for (let i = 0; i < n; i++) {
      if (Math.random() > n - i) break;
      this.emit(2, pos.x + (Math.random() - 0.5) * 2.4, pos.y + Math.random() * 1.6, pos.z + (Math.random() - 0.5) * 5,
        (Math.random() - 0.5) * 0.3, 0.6 + Math.random() * 0.9, (Math.random() - 0.5) * 0.3, 12, 0.03 + Math.random() * 0.07);
    }
  }
  clear() { this.life.fill(0); this.aAlpha.array.fill(0); this.aAlpha.needsUpdate = true; }
  update(dt, t) {
    let live = 0;
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) { this.aAlpha.array[i] = 0; continue; }
      const k = this.kind[i], o = i * 3;
      this.age[i] += dt;
      const v = this.v, p = this.p;
      if (k === 0) { v[o + 1] -= 9.81 * dt; v[o] *= 1 - dt * 0.4; v[o + 2] *= 1 - dt * 0.4; }
      else if (k === 1) { v[o] *= 1 - dt * 1.5; v[o + 1] *= 1 - dt * 1.5; v[o + 2] *= 1 - dt * 1.5; }
      else { v[o] = Math.sin(t * 5 + i) * 0.15; v[o + 2] = Math.cos(t * 4.3 + i) * 0.15; }
      p[o] += v[o] * dt; p[o + 1] += v[o + 1] * dt; p[o + 2] += v[o + 2] * dt;
      // Droplets vanish when they return to the surface. Bubbles pop at the surface, leaving a small ring
      if (k === 0 && p[o + 1] < this.W && v[o + 1] < 0) this.life[i] = 0;
      if (k === 2 && p[o + 1] > this.W - 0.02) { this.life[i] = 0; if (Math.random() < 0.04) this.onPop?.(p[o], p[o + 2], 0.25); }
      if (this.age[i] > this.life[i]) this.life[i] = 0;
      const u = this.age[i] / this.life[i];
      this.aPos.array.set([p[o], p[o + 1], p[o + 2]], o);
      this.aSize.array[i] = this.size0[i] * (k === 1 ? 1 + u * 2.5 : 1);
      this.aAlpha.array[i] = this.life[i] > 0 ? (k === 1 ? (1 - u) : k === 2 ? 0.8 : Math.min(1, (1 - u) * 3)) : 0;
      this.aKind.array[i] = k;
      live++;
    }
    this.aPos.needsUpdate = this.aSize.needsUpdate = this.aAlpha.needsUpdate = this.aKind.needsUpdate = true;
    return live;
  }
}
