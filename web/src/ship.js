// Ship visuals: the hull, yard and rudder baked in Blender (bake/ship.py), plus the parts that move at runtime:
// the sail (cotton strips, bellied by the apparent wind), the running rigging (ropes with sag), and wetness at the waterline.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { wavesGLSL } from './waves.js';

export async function tex(loader, url, srgb, aniso) {
  const t = await loader.loadAsync(url);
  t.flipY = false;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = aniso;
  return t;
}

// ship coordinates (f forward, x port, z up) -> ship-local three.js (x, y, z) = (x, z, f)
export const S2L = (p) => new THREE.Vector3(p[1], p[2], p[0]);

// ---- Sail -------------------------------------------------------------------------------------------------
// Local frame of the sail mesh: x along the yard (port +), y down from the yard, z fore-aft (+ forward).
// Vertex shader bends the flat grid: belly depth follows the apparent wind pressure, the deepest point sits
// forward of centre when the wind comes from ahead of the beam; when it flogs, waves run along the cloth.
const SAIL_STRIPS = 25;
function sailGeometry(w, h, nx, ny) {
  const g = new THREE.PlaneGeometry(w, h, nx, ny);
  g.translate(0, -h / 2, 0);          // top edge at y = 0
  return g;
}
export const sailGLSL = /* glsl */`
uniform float uW, uH, uDepth, uDraft, uFlog, uTime, uSide, uHoist;
vec3 sailP(vec2 uv){
  float u = uv.x, v = uv.y, len = uHoist;
  vec3 p = vec3((u - 0.5) * uW, -v * len * uH, 0.0);
  float across = sin(3.14159 * clamp(u + uDraft * sin(3.14159 * u) * 0.25, 0.0, 1.0));
  float down = sin(3.14159 * pow(max(v, 1e-4), 0.8)) * (0.7 + 0.3 * v);
  float bag = uDepth * across * down * len;
  float fl = uFlog * (sin(u * 23.0 - uTime * 9.0 + v * 5.0) * 0.5 + sin(u * 11.0 + uTime * 6.3 - v * 7.0) * 0.5) * down * 0.35;
  p.z = (bag + fl) * uSide;
  float sp = fract(u * ${SAIL_STRIPS}.0);
  p.z -= uSide * 0.012 * uDepth * (1.0 - sin(3.14159 * sp)) * down;
  p.y += (1.0 - across) * 0.7 * v * v * len;
  float fold = (1.0 - len) * smoothstep(0.75, 1.0, v);
  p.z += fold * sin(u * 70.0) * 0.14;
  return p;
}`;

export function makeSailDepth(su) {
  return new THREE.ShaderMaterial({
    uniforms: su, side: THREE.DoubleSide,
    vertexShader: `${sailGLSL}\nvoid main(){ vec2 suv = vec2(uv.x, 1.0 - uv.y); gl_Position = projectionMatrix * modelViewMatrix * vec4(sailP(suv), 1.0); }`,
    fragmentShader: 'void main(){ gl_FragColor = vec4(1.0); }',
  });
}

export function makeSailMaterial(U, skyU) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
  const su = { uW: { value: 18.75 }, uH: { value: 19 }, uDepth: { value: 1.6 }, uDraft: { value: 0 }, uFlog: { value: 0 }, uSide: { value: 1 }, uHoist: { value: 1 },
    uTime: U.uTime, uSunDirW: skyU.uSunDirW, uSunCol: skyU.uSunCol };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, su);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${sailGLSL}\nvarying vec2 vUvS; varying float vFold; varying float vBag;`)
      .replace('#include <beginnormal_vertex>', `
        vec2 suv = vec2(uv.x, 1.0 - uv.y);
        vec3 sp0 = sailP(suv), spx = sailP(suv + vec2(0.003, 0.0)), spy = sailP(suv + vec2(0.0, 0.003));
        vec3 objectNormal = normalize(cross(spx - sp0, spy - sp0));
        vUvS = suv; vFold = (1.0 - uHoist) * smoothstep(0.75, 1.0, suv.y); vBag = sp0.z * uSide;
        #ifdef USE_TANGENT
          vec3 objectTangent = vec3(1.0, 0.0, 0.0);
        #endif`)
      .replace('#include <begin_vertex>', 'vec3 transformed = sp0;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uTime; varying vec2 vUvS; varying float vFold; varying float vBag;
        float sh12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
        float svn(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3. - 2. * f);
          return mix(mix(sh12(i), sh12(i + vec2(1, 0)), u.x), mix(sh12(i + vec2(0, 1)), sh12(i + vec2(1, 1)), u.x), u.y); }
        float seamAt(vec2 q){ float sx = fract(q.x * ${SAIL_STRIPS}.0); return smoothstep(0.035, 0.0, sx) + smoothstep(0.965, 1.0, sx); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        // unbleached cotton, each strip its own bolt: some newer and whiter, some weathered to grey-beige
        float strip = floor(vUvS.x * ${SAIL_STRIPS}.0);
        float sx = fract(vUvS.x * ${SAIL_STRIPS}.0);
        float bolt = sh12(vec2(strip, 3.0));
        vec3 cloth = mix(vec3(0.25, 0.225, 0.185), vec3(0.34, 0.315, 0.27), bolt);
        // repairs: rectangles of different cloth sewn in
        vec2 pc = vec2(strip, floor(vUvS.y * 9.0 + sh12(vec2(strip, 1.0)) * 3.0));
        float patchK = step(0.9, sh12(pc + 17.0));
        cloth = mix(cloth, cloth * vec3(1.12, 1.1, 1.05) * (0.85 + 0.3 * sh12(pc)), patchK);
        float seam = seamAt(vUvS);
        cloth *= 1.0 - 0.35 * seam;
        // weave and weather: a faint cross grain, grime toward the foot and near the yard
        float grain = svn(vUvS * vec2(700.0, 30.0)) * 0.5 + svn(vUvS * vec2(25.0, 500.0)) * 0.5;
        cloth *= 0.93 + 0.1 * grain;
        float stain = smoothstep(0.45, 0.8, svn(vUvS * vec2(9.0, 5.0)) * 0.6 + svn(vUvS * vec2(30.0, 14.0)) * 0.4) * smoothstep(0.2, 1.0, vUvS.y);
        cloth = mix(cloth, cloth * vec3(0.7, 0.66, 0.58), stain * 0.55);
        cloth *= 1.0 - 0.18 * smoothstep(0.06, 0.0, vUvS.y);
        // vertical ropes sewn down the sail (the two dark lines in period photographs) and the bolt rope round the edge
        float band = smoothstep(0.004, 0.0, abs(vUvS.x - 0.36) - 0.002) + smoothstep(0.004, 0.0, abs(vUvS.x - 0.64) - 0.002);
        float bolt2 = smoothstep(0.006, 0.0, min(vUvS.x, 1.0 - vUvS.x)) + smoothstep(0.008, 0.0, 1.0 - vUvS.y);
        cloth = mix(cloth, vec3(0.06, 0.045, 0.03), clamp(band, 0.0, 1.0) * 0.85);
        cloth = mix(cloth, vec3(0.14, 0.1, 0.06), clamp(bolt2, 0.0, 1.0) * 0.8);
        diffuseColor.rgb = cloth;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          // cloth relief as a height (m): diagonal creases from the clews and yard ends, the sewn seams, fine crinkle.
          // Bump-mapped with screen-space derivatives (the same method as three's bump map)
          vec2 q = vUvS;
          float d1 = svn(vec2(q.x * 3.0 + q.y * 9.0, q.x * 40.0 - q.y * 4.0));
          float d2 = svn(vec2(q.x * 3.0 - q.y * 9.0, q.x * 40.0 + q.y * 4.0) + 7.0);
          float edge = 1.0 - sin(3.14159 * q.x) * sin(3.14159 * clamp(q.y * 1.1, 0.0, 1.0));
          float hgt = (d1 + d2) * (0.02 + 0.05 * edge) + svn(q * vec2(160.0, 90.0)) * 0.006 - seamAt(q) * 0.012;
          vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition);
          vec3 r1 = cross(sy, normal), r2 = cross(normal, sx);
          float det = dot(sx, r1);
          vec3 grad = sign(det) * (dFdx(hgt) * r1 + dFdy(hgt) * r2);
          normal = normalize(abs(det) * normal - grad);
        }`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        // light through the cloth: from the far side the sun glows through; seams and bands (two layers) stay darker
        {
          vec3 nW = normalize(inverseTransformDirection(normal, viewMatrix));
          vec3 vW = normalize(inverseTransformDirection(normalize(vViewPosition), viewMatrix));   // toward the eye
          float back = dot(nW, uSunDirW) * dot(nW, vW);          // sun and eye on opposite sides of the cloth
          float thin = (1.0 - 0.6 * seam) * (1.0 - 0.95 * band);
          if (back < 0.0) reflectedLight.directDiffuse += cloth * uSunCol * abs(dot(nW, uSunDirW)) * 0.16 * thin * (1.0 - stain * 0.3);
          // diffuse light passing through from the brighter side even when the sun is not directly behind
          reflectedLight.indirectDiffuse += cloth * uSunCol * 0.05 * max(uSunDirW.y, 0.0) * thin;
        }`);
  };
  m.customProgramCacheKey = () => 'sail';
  return { material: m, uniforms: su };
}

// ---- Ropes: fixed-topology tubes whose centre lines are updated every frame -------------------------------
class Rope {
  constructor(material, r = 0.03, n = 20, seg = 5) {
    this.n = n; this.seg = seg; this.r = r;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * seg * 3); this.nrm = new Float32Array(n * seg * 3);
    const idx = [];
    for (let i = 0; i < n - 1; i++) for (let k = 0; k < seg; k++) {
      const a = i * seg + k, b = i * seg + (k + 1) % seg;
      idx.push(a, b, a + seg, b, b + seg, a + seg);
    }
    g.setIndex(idx);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nrm, 3).setUsage(THREE.DynamicDrawUsage));
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.frustumCulled = false;
    this.pts = Array.from({ length: n }, () => new THREE.Vector3());
  }
  // a -> b with sag (m) in world-down direction 'down' (catenary approximated by a parabola)
  set(a, b, sag, down) {
    const n = this.n, P = this.pts;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      P[i].lerpVectors(a, b, t).addScaledVector(down, sag * 4 * t * (1 - t));
    }
    const T = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), ref = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < n; i++) {
      T.subVectors(P[Math.min(i + 1, n - 1)], P[Math.max(i - 1, 0)]).normalize();
      e1.crossVectors(T, Math.abs(T.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : ref).normalize();
      e2.crossVectors(T, e1);
      for (let k = 0; k < this.seg; k++) {
        const q = (k / this.seg) * Math.PI * 2, c = Math.cos(q), s = Math.sin(q);
        const o = (i * this.seg + k) * 3;
        const nx = e1.x * c + e2.x * s, ny = e1.y * c + e2.y * s, nz = e1.z * c + e2.z * s;
        this.pos[o] = P[i].x + nx * this.r; this.pos[o + 1] = P[i].y + ny * this.r; this.pos[o + 2] = P[i].z + nz * this.r;
        this.nrm[o] = nx; this.nrm[o + 1] = ny; this.nrm[o + 2] = nz;
      }
    }
    const g = this.mesh.geometry;
    g.attributes.position.needsUpdate = true; g.attributes.normal.needsUpdate = true;
    g.computeBoundingSphere();
  }
}

// ---- Loader ---------------------------------------------------------------------------------------------
export async function loadShip(base, { aniso = 8, patch, U, skyU, seaU }) {
  const tl = new THREE.TextureLoader();
  const [map, orm, gltf, meta] = await Promise.all([
    tex(tl, base + 'ship_base.webp', true, aniso), tex(tl, base + 'ship_orm.webp', false, aniso),
    new GLTFLoader().loadAsync(base + 'ship.glb'), fetch(base + 'ship.json').then((r) => r.json()),
  ]);
  const wood = new THREE.MeshStandardMaterial({ map, aoMap: orm, roughnessMap: orm, roughness: 1, metalness: 0, aoMapIntensity: 1,  });
  // Wetness: below the local sea surface (plus a splash band that rises with the swell) the wood darkens and turns glossy
  wood.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, seaU, { uTime: U.uTime });
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWetW;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWetW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vWetW; uniform float uTime;\n${wavesGLSL}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        float seaH = gerstner(vWetW.xz, uTime, 2.0).y;
        float wetM = smoothstep(0.45, 0.0, vWetW.y - seaH);
        diffuseColor.rgb *= mix(1.0, 0.5, wetM);
        roughnessFactor = mix(roughnessFactor, 0.28, wetM);`);
  };
  wood.customProgramCacheKey = () => 'shipwood';
  patch?.(wood);
  const find = (n) => { let o = null; gltf.scene.traverse((c) => { if (c.name === n) o = c; }); return o; };
  const group = new THREE.Group();       // follows the physics body; origin at the waterline, midships
  const hull = new THREE.Mesh(find('hull').geometry, wood);
  const yardNode = find('yard'), rudNode = find('rudder');
  const yard = new THREE.Mesh(yardNode.geometry, wood);
  const rudder = new THREE.Mesh(rudNode.geometry, wood);
  group.add(hull);
  // rudder pivot: raked with the transom; the blade turns about the pivot's local y
  const rudPivot = new THREE.Group();
  rudPivot.position.copy(rudNode.position); rudPivot.quaternion.copy(rudNode.quaternion);
  rudPivot.add(rudder);
  group.add(rudPivot);
  // yard pivot on the mast axis: it turns (bracing) and slides up and down (hoisting)
  const rig = {};
  for (const [k, v] of Object.entries(meta.rig)) if (Array.isArray(v)) rig[k] = S2L(v);
  const yardPivot = new THREE.Group();
  yardPivot.position.copy(rig.mast_top).setY(rig.yard_home.y);
  yard.position.set(0, 0, rig.yard_home.z - rig.mast_top.z);   // the yard hangs just aft of the mast
  yardPivot.add(yard);
  group.add(yardPivot);
  // sail hangs from the yard
  const sailM = makeSailMaterial(U, skyU);
  patch?.(sailM.material);
  const [SW, SH] = meta.sail;
  sailM.uniforms.uW.value = SW; sailM.uniforms.uH.value = SH;
  const sail = new THREE.Mesh(sailGeometry(1, 1, 50, 36), sailM.material);
  sail.frustumCulled = false;
  sail.userData.depthMat = makeSailDepth(sailM.uniforms);
  sail.position.set(0, -0.25, rig.yard_home.z - rig.mast_top.z - 0.18);
  yardPivot.add(sail);
  // ropes
  const ropeM = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.2, 0.15, 0.09), roughness: 0.9 });
  patch?.(ropeM);
  const ropes = {};
  const mk = (name, r = 0.035, n = 18) => { const R = new Rope(ropeM, r, n); ropes[name] = R; return R; };
  ['halyardA', 'halyardB', 'braceP', 'braceS', 'sheetP', 'sheetS', 'forestay', 'stayP', 'stayS', 'yahoStay'].forEach((n) => mk(n, n === 'forestay' ? 0.06 : 0.035));
  const ropeGroup = new THREE.Group();
  for (const R of Object.values(ropes)) ropeGroup.add(R.mesh);

  const deckY = rig.mast_foot.y;
  const yardMin = deckY + 3.2, yardMax = rig.yard_home.y;
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), down = new THREE.Vector3(0, -1, 0);
  const W = (v) => v.clone().applyMatrix4(group.matrixWorld);
  // state: hoist 0..1, brace (rad, + = yard's port end aft), rudder (rad), apparent wind info for the sail shape
  function update(body, st) {
    group.position.copy(body.pos); group.quaternion.copy(body.quat);
    rudder.rotation.y = -st.rudder;
    yardPivot.position.y = yardMin + (yardMax - yardMin) * st.hoist;
    yardPivot.rotation.y = st.brace;
    const su = sailM.uniforms;
    su.uHoist.value = Math.max(0.05, (yardPivot.position.y - deckY - 1.9) / SH);
    su.uDepth.value = st.sailDepth; su.uSide.value = st.sailSide; su.uFlog.value = st.flog; su.uDraft.value = st.draft;
    group.updateMatrixWorld(true);
    // rope ends in world space
    const ym = new THREE.Matrix4().copy(yard.matrixWorld);
    const yEnd = (s) => new THREE.Vector3(s * SW / 2, 0, 0).applyMatrix4(ym);
    const clew = (s) => new THREE.Vector3(s * SW / 2 * 0.98, -su.uHoist.value * SH + 0.4, 0).applyMatrix4(sail.matrixWorld);
    const yc = new THREE.Vector3(0, 0.1, 0).applyMatrix4(ym);
    const sheave = W(rig.sheave);
    ropes.halyardA.set(_a.copy(sheave).add(new THREE.Vector3(0.12, 0, 0)), _b.copy(yc).add(new THREE.Vector3(0.12, 0, 0)), 0.02, down);
    ropes.halyardB.set(_a.copy(sheave).add(new THREE.Vector3(-0.12, 0, 0)), _b.copy(yc).add(new THREE.Vector3(-0.12, 0, 0)), 0.02, down);
    ropes.braceP.set(yEnd(1), W(rig.sheet_p), 0.35, down);
    ropes.braceS.set(yEnd(-1), W(rig.sheet_s), 0.35, down);
    ropes.sheetP.set(clew(1), W(rig.tack_p), 0.25, down);
    ropes.sheetS.set(clew(-1), W(rig.tack_s), 0.25, down);
    ropes.forestay.set(W(rig.mast_top), W(rig.forestay), 0.5, down);
    ropes.stayP.set(W(rig.mast_top).add(new THREE.Vector3(0, -1.5, 0)), W(rig.stay_p), 0.3, down);
    ropes.stayS.set(W(rig.mast_top).add(new THREE.Vector3(0, -1.5, 0)), W(rig.stay_s), 0.3, down);
    ropes.yahoStay.set(W(rig.yaho_top), W(rig.bow_top), 0.1, down);
  }
  // stern lantern (a paper chochin hung under the cabin eave) and its light, lit from dusk
  const lanternM = new THREE.MeshBasicMaterial({ color: new THREE.Color(0, 0, 0) });
  const lantern = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.5, 12), lanternM);
  lantern.position.set(1.4, rig.mast_foot.y + 1.6, -3.4);
  group.add(lantern);
  const lanternLight = new THREE.PointLight(0xffa250, 0, 28, 1.8);
  lanternLight.position.copy(lantern.position).add(new THREE.Vector3(0, -0.2, 0.3));
  group.add(lanternLight);
  function setNight(k) { lanternM.color.setRGB(7 * k, 3.8 * k, 1.4 * k); lanternLight.intensity = k * 60; }
  return { group, ropeGroup, hull, yard, rudder, sail, sailM, wood, rig, meta, update, setNight, casters: [hull, yard, rudder, sail] };
}
