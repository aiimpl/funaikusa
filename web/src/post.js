// Post: render the scene to linear HDR (half float, MSAA), then bloom (dual-filter downsample chain), exposure,
// film shoulder (ACES approximation), grading (slightly blue shadows, slightly warm highlights), vignette and dither to screen.
// Bloom spreads only the overbright areas; the shoulder is an ACES approximation.
import * as THREE from 'three';

const VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

function target(w, h, samples = 0, depthTex = false) {
  const t = new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType, format: THREE.RGBAFormat, samples,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: samples > 0 || depthTex,
  });
  if (depthTex) { t.depthTexture = new THREE.DepthTexture(w, h, THREE.UnsignedIntType); }
  return t;
}

export class Post {
  constructor(renderer, w, h, { samples = 4, levels = 6 } = {}) {
    this.samples = samples;
    this.r = renderer; this.levels = levels;
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.qs = new THREE.Scene(); this.qs.add(this.quad);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.down = new THREE.ShaderMaterial({
      vertexShader: VERT, depthTest: false, depthWrite: false,
      uniforms: { uTex: { value: null }, uTexel: { value: new THREE.Vector2() }, uThresh: { value: 0 }, uFirst: { value: 0 } },
      fragmentShader: /* glsl */`
        uniform sampler2D uTex; uniform vec2 uTexel; uniform float uThresh; uniform float uFirst; varying vec2 vUv;
        vec3 tap(vec2 o){ vec3 c = min(texture2D(uTex, vUv + o * uTexel).rgb, vec3(80.0));
          if (uFirst > 0.5) c = max(c - uThresh, 0.0); return c; }
        void main(){
          vec3 c = tap(vec2(0.0)) * 4.0 + tap(vec2(-1.0, -1.0)) + tap(vec2(1.0, -1.0)) + tap(vec2(-1.0, 1.0)) + tap(vec2(1.0, 1.0));
          gl_FragColor = vec4(c / 8.0, 1.0);
        }`,
    });
    this.up = new THREE.ShaderMaterial({
      vertexShader: VERT, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTex: { value: null }, uTexel: { value: new THREE.Vector2() }, uW: { value: 1 } },
      fragmentShader: /* glsl */`
        uniform sampler2D uTex; uniform vec2 uTexel; uniform float uW; varying vec2 vUv;
        void main(){
          vec3 c = vec3(0.0);
          c += texture2D(uTex, vUv + vec2(-2.0, 0.0) * uTexel).rgb + texture2D(uTex, vUv + vec2(2.0, 0.0) * uTexel).rgb;
          c += texture2D(uTex, vUv + vec2(0.0, -2.0) * uTexel).rgb + texture2D(uTex, vUv + vec2(0.0, 2.0) * uTexel).rgb;
          c += (texture2D(uTex, vUv + vec2(-1.0, -1.0) * uTexel).rgb + texture2D(uTex, vUv + vec2(1.0, -1.0) * uTexel).rgb
              + texture2D(uTex, vUv + vec2(-1.0, 1.0) * uTexel).rgb + texture2D(uTex, vUv + vec2(1.0, 1.0) * uTexel).rgb) * 2.0;
          gl_FragColor = vec4(c / 12.0 * uW, 1.0);
        }`,
    });
    // Capture what lies below the water surface: color, with depth (distance from camera in m) in a
    this.copy = new THREE.ShaderMaterial({
      vertexShader: VERT, depthTest: false, depthWrite: false,
      uniforms: { uTex: { value: null }, uDepth: { value: null }, uNear: { value: 0.3 }, uFar: { value: 9000 } },
      fragmentShader: /* glsl */`
        uniform sampler2D uTex, uDepth; uniform float uNear, uFar; varying vec2 vUv;
        void main(){
          float z = texture2D(uDepth, vUv).r;
          float ndc = z * 2.0 - 1.0;
          float lin = 2.0 * uNear * uFar / (uFar + uNear - ndc * (uFar - uNear));
          gl_FragColor = vec4(texture2D(uTex, vUv).rgb, lin);
        }`,
    });
    this.final = new THREE.ShaderMaterial({
      vertexShader: VERT, depthTest: false, depthWrite: false,
      uniforms: {
        uTex: { value: null }, uBloom: { value: null }, uExposure: { value: 1.0 }, uBloomK: { value: 0.12 },
        uT: { value: 0 }, uVignette: { value: 0.45 }, uWarm: { value: new THREE.Vector3(1.1, 1.0, 0.84) },
        uCool: { value: new THREE.Vector3(1.0, 0.99, 0.98) }, uSat: { value: 1.08 }, uContrast: { value: 1.12 },
        uUnder: { value: 0 },
      },
      fragmentShader: /* glsl */`
        uniform sampler2D uTex, uBloom; uniform float uExposure, uBloomK, uT, uVignette, uSat, uContrast;
        uniform vec3 uWarm, uCool; uniform float uUnder; varying vec2 vUv;
        float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
        vec3 film(vec3 x){ return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
        void main(){
          // Underwater: the image wobbles and blurs slightly
          vec2 uv = vUv;
          if (uUnder > 0.0) uv += vec2(sin(vUv.y * 38.0 + uT * 2.1), cos(vUv.x * 31.0 + uT * 1.7)) * 0.0022 * uUnder;
          vec3 c = texture2D(uTex, uv).rgb * uExposure;
          if (uUnder > 0.0) c = mix(c, (texture2D(uTex, uv + vec2(0.003, 0.0)).rgb + texture2D(uTex, uv - vec2(0.003, 0.0)).rgb
            + texture2D(uTex, uv + vec2(0.0, 0.003)).rgb + texture2D(uTex, uv - vec2(0.0, 0.003)).rgb) * 0.25 * uExposure, 0.6 * uUnder);
          c += texture2D(uBloom, vUv).rgb * uExposure * uBloomK;
          vec2 q = vUv - 0.5;
          c *= 1.0 - uVignette * dot(q, q) * 1.6;
          float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
          c *= mix(uCool, uWarm, smoothstep(0.05, 0.6, l));        // slightly blue shadows, slightly warm highlights
          c = film(c);
          c = pow(c, vec3(1.0 / 2.2));
          c = (c - 0.5) * uContrast + 0.5;
          float g = dot(c, vec3(0.2126, 0.7152, 0.0722));
          c = mix(vec3(g), c, uSat);
          c += (h12(gl_FragCoord.xy + fract(uT) * 91.0) - 0.5) / 255.0 * 2.0;
          gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
        }`,
    });
    this.setSize(w, h, samples);
  }
  setSize(w, h, samples = this.samples) {
    this.w = w; this.h = h;
    this.scene?.dispose(); (this.chain || []).forEach((t) => t.dispose());
    this.scene = target(w, h, samples, true);
    this.refr?.dispose();
    this.refr = target(w >> 1, h >> 1);
    this.chain = [];
    let cw = w, ch = h;
    for (let i = 0; i < this.levels; i++) { cw = Math.max(2, cw >> 1); ch = Math.max(2, ch >> 1); this.chain.push(target(cw, ch)); }
  }
  pass(mat, src, dst) {
    mat.uniforms.uTex.value = src.texture ?? src;
    this.quad.material = mat;
    this.r.setRenderTarget(dst);
    this.r.render(this.qs, this.cam);
  }
  render(scene, camera, { exposure = 1, t = 0, thresh = 1.2, overlay = null, under = 0 } = {}) {
    const r = this.r;
    r.setRenderTarget(this.scene);
    r.render(scene, camera);
    // Water surface: capture the color and depth of the world below, then draw it on top
    if (overlay) {
      const c = this.copy.uniforms;
      c.uDepth.value = this.scene.depthTexture; c.uNear.value = camera.near; c.uFar.value = camera.far;
      this.pass(this.copy, this.scene, this.refr);
      r.setRenderTarget(this.scene);
      const ac0 = r.autoClear; r.autoClear = false;
      r.render(overlay, camera);
      r.autoClear = ac0;
    }
    // Bloom: blur only the bright areas while downsampling, add them back while upsampling
    let src = this.scene;
    for (let i = 0; i < this.levels; i++) {
      const d = this.chain[i];
      this.down.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);
      this.down.uniforms.uFirst.value = i === 0 ? 1 : 0;
      this.down.uniforms.uThresh.value = thresh;
      this.pass(this.down, src, d);
      src = d;
    }
    const ac = r.autoClear; r.autoClear = false;
    for (let i = this.levels - 1; i > 0; i--) {
      const s = this.chain[i], d = this.chain[i - 1];
      this.up.uniforms.uTexel.value.set(1 / s.width, 1 / s.height);
      this.up.uniforms.uW.value = 1.0;
      this.pass(this.up, s, d);
    }
    r.autoClear = ac;
    const f = this.final.uniforms;
    f.uBloom.value = this.chain[0].texture; f.uExposure.value = exposure; f.uT.value = t; f.uUnder.value = under;
    this.pass(this.final, this.scene, null);
  }
}
