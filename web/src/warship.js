// Warship visuals for the whole fleet. Everything is instanced: per type and side there is one InstancedMesh per level
// of detail for the hull, and shared ones for the masts, yards, rudders, sails and oars, so sixty ships cost a few
// dozen draw calls. Each frame the fleet writes every ship's matrices (from its physics body) into these.
//
// Hull material: the baked base colour (two sets: plain timber for the Noshima side, blackened for the attackers),
// AO/roughness/metalness from the ORM texture, wet and dark below the local sea surface, charred where it burned
// (per-ship burn amounts for bow, waist and stern, read along the hull).
// Oars: a Japanese ro is a sculling oar. Its blade stays in the water the whole time; the loom is swung fore and aft
// while the blade is twisted at each end of the swing (like a fish's tail). So the oars stay dipped and sway.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { wavesGLSL } from './waves.js';

export const KINDS = ['atake', 'seki', 'kobaya'];
export const SIDES = ['A', 'B'];         // A: Noshima (plain timber), B: the attackers (blackened)
const LOD_D = [140, 650];                // distances at which the hull switches to LOD 1 and 2

async function tex(loader, url, srgb, aniso) {
  const t = await loader.loadAsync(url);
  t.flipY = false;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = aniso;
  return t;
}
export const S2L = (p) => new THREE.Vector3(p[1], p[2], p[0]);

function hullMaterial(map, orm, { patch, U, seaU, key }) {
  const m = new THREE.MeshStandardMaterial({ map, aoMap: orm, roughnessMap: orm, metalnessMap: orm, roughness: 1, metalness: 1, aoMapIntensity: 1 });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, seaU, { uTime: U.uTime });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aBurn;\nvarying vec3 vWetW; varying vec3 vBurn; varying vec3 vLoc;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        { vec4 wp = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            wp = instanceMatrix * wp;
            vBurn = aBurn;
          #else
            vBurn = vec3(0.0);
          #endif
          vWetW = (modelMatrix * wp).xyz; vLoc = transformed; }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWetW; varying vec3 vBurn; varying vec3 vLoc; uniform float uTime;\n${wavesGLSL}
        float bh(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
        float bn(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(bh(i), bh(i + vec3(1,0,0)), f.x), mix(bh(i + vec3(0,1,0)), bh(i + vec3(1,1,0)), f.x), f.y),
                     mix(mix(bh(i + vec3(0,0,1)), bh(i + vec3(1,0,1)), f.x), mix(bh(i + vec3(0,1,1)), bh(i + vec3(1,1,1)), f.x), f.y), f.z); }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        float seaH = gerstner(vWetW.xz, uTime, 2.0).y;
        float wetM = smoothstep(0.45, 0.0, vWetW.y - seaH);
        diffuseColor.rgb *= mix(1.0, 0.5, wetM);
        roughnessFactor = mix(roughnessFactor, 0.28, wetM);
        // char: per-ship burn of bow / waist / stern, spread along the length, ragged, stronger higher up
        {
          float u = clamp(vLoc.z / 30.0 + 0.5, 0.0, 1.0);
          float b = u < 0.5 ? mix(vBurn.z, vBurn.y, u * 2.0) : mix(vBurn.y, vBurn.x, u * 2.0 - 1.0);
          float n = bn(vLoc * 1.7) * 0.6 + bn(vLoc * 5.3) * 0.4;
          float c = smoothstep(0.15, 0.6, b * (0.7 + 0.6 * n) + smoothstep(0.5, 3.0, vLoc.y) * b * 0.4);
          float ember = smoothstep(0.75, 1.0, b) * step(0.72, n);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.012, 0.01, 0.009), c);
          roughnessFactor = mix(roughnessFactor, 0.95, c);
          totalEmissiveRadiance += vec3(2.6, 0.7, 0.12) * ember * (0.6 + 0.4 * sin(uTime * 3.0 + n * 20.0));
        }`);
  };
  m.customProgramCacheKey = () => 'warwood' + key;
  patch?.(m);
  return m;
}

// Mat sail (mushiro-ho): panels of woven rush with horizontal battens of bamboo, bellied a little by the wind.
// Per instance: x = hoist (0 furled .. 1 set), y = belly depth (m), z = side (+1/-1), w = flog
function sailMaterial({ patch, U }) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = U.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aSail; uniform float uTime; varying vec2 vS; varying float vHoist;')
      .replace('#include <begin_vertex>', `
        vec2 q = uv; q.y = 1.0 - q.y;     // q.y: 0 at the yard, 1 at the foot
        float hoist = aSail.x;
        vec3 transformed = vec3((q.x - 0.5), -q.y * hoist, 0.0);
        float across = sin(3.14159 * q.x), down = sin(3.14159 * pow(max(q.y, 1e-3), 0.8));
        transformed.z = aSail.y * across * down * aSail.z * hoist + aSail.w * sin(q.x * 13.0 - uTime * 7.0 + q.y * 4.0) * 0.08 * down;
        // stiff battens: the mat bows between them in folds when furled
        transformed.z += (1.0 - hoist) * sin(q.y * 60.0) * 0.05;
        vS = q; vHoist = hoist;`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        objectNormal = vec3(0.0, 0.0, 1.0);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec2 vS; varying float vHoist;
        float sh1(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
        float sn(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3. - 2. * f);
          return mix(mix(sh1(i), sh1(i + vec2(1, 0)), u.x), mix(sh1(i + vec2(0, 1)), sh1(i + vec2(1, 1)), u.x), u.y); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          // woven rush: a fine diagonal weave, each mat panel its own tone, bamboo battens every ~1/9 of the height
          vec2 q = vS;
          float panel = floor(q.x * 6.0) + floor(q.y * 9.0) * 7.0;
          vec3 c = mix(vec3(0.19, 0.155, 0.09), vec3(0.27, 0.22, 0.13), sh1(vec2(panel, 2.0)));
          float weave = sin((q.x * 900.0 + q.y * 900.0)) * sin((q.x * 900.0 - q.y * 900.0));
          c *= 0.9 + 0.12 * weave + 0.1 * sn(q * vec2(40.0, 90.0));
          float bat = smoothstep(0.012, 0.0, abs(fract(q.y * 9.0) - 0.5) - 0.48);
          float seam = smoothstep(0.006, 0.0, abs(fract(q.x * 6.0) - 0.5) - 0.494);
          c = mix(c, vec3(0.12, 0.1, 0.06), max(bat * 0.8, seam * 0.5));
          c *= 1.0 - 0.3 * smoothstep(0.5, 0.95, sn(q * vec2(5.0, 3.0))) * q.y;   // grime toward the foot
          diffuseColor.rgb = c;
        }`);
  };
  m.customProgramCacheKey = () => 'matsail';
  patch?.(m);
  return m;
}

function sailGeometry() {
  const g = new THREE.PlaneGeometry(1, 1, 24, 18);
  return g;
}

function findNode(root, n) { let o = null; root.traverse((c) => { if (c.name === n) o = c; }); return o; }

export async function loadFleetArt(base, { aniso = 8, patch, U, seaU }) {
  const tl = new THREE.TextureLoader();
  const gl = new GLTFLoader();
  const art = { kinds: {} };
  await Promise.all(KINDS.map(async (k) => {
    const [mapA, mapB, orm, gltf, meta] = await Promise.all([
      tex(tl, `${base}${k}_base.webp`, true, aniso), tex(tl, `${base}${k}_base_k.webp`, true, aniso), tex(tl, `${base}${k}_orm.webp`, false, aniso),
      gl.loadAsync(`${base}${k}.glb`), fetch(`${base}${k}.json`).then((r) => r.json()),
    ]);
    const n = (x) => findNode(gltf.scene, x);
    const mats = { A: hullMaterial(mapA, orm, { patch, U, seaU, key: 'A' }), B: hullMaterial(mapB, orm, { patch, U, seaU, key: 'B' }) };
    const rud = n('rudder'), mast = n('mast'), yard = n('yard');
    art.kinds[k] = {
      meta, mats,
      geo: { lod: [n('hull').geometry, n('hull_lod1').geometry, n('hull_lod2').geometry], mast: mast.geometry, yard: yard.geometry, rudder: rud.geometry, oar: n('oar').geometry },
      rudderPos: rud.position.clone(), rudderQuat: rud.quaternion.clone(),
      mastPos: mast.position.clone(), yardPos: yard.position.clone(),
      guns: (meta.guns ?? []).map(S2L),
    };
  }));
  // the guns (bake/guns.py): bow gun and its bed, shared by every ship that carries them
  {
    const [map, orm, nrm, gltf] = await Promise.all([tex(tl, `${base}guns_base.webp`, true, aniso), tex(tl, `${base}guns_orm.webp`, false, aniso),
      tex(tl, `${base}guns_nrm.webp`, false, aniso), gl.loadAsync(`${base}guns.glb`)]);
    const m = new THREE.MeshStandardMaterial({ map, aoMap: orm, roughnessMap: orm, metalnessMap: orm, normalMap: nrm, roughness: 1, metalness: 1 });
    patch?.(m);
    const n = (x) => findNode(gltf.scene, x);
    art.guns = { mat: m, gun: n('oozutsu').geometry, bed: n('oozutsu_bed').geometry, muzzle: 1.4 };
  }
  art.sailMat = sailMaterial({ patch, U });
  art.sailGeo = sailGeometry();
  return art;
}

const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);
const _e = new THREE.Euler();

// One set of instanced meshes for all the ships. ships: [{ kind, side, body (Hull), mastDown 0..1, burn [bow, waist, stern], alive }]
export class FleetView {
  constructor(art, max = { atake: 8, seki: 32, kobaya: 64 }) {
    this.art = art;
    this.group = new THREE.Group();
    this.sets = {};
    for (const k of KINDS) {
      const A = art.kinds[k], M = max[k];
      const s = { hull: {}, burn: {} };
      for (const side of SIDES) {
        s.hull[side] = A.geo.lod.map((g) => {
          const im = new THREE.InstancedMesh(g, A.mats[side], M);
          im.count = 0; im.frustumCulled = false;
          const ba = new THREE.InstancedBufferAttribute(new Float32Array(M * 3), 3);
          im.geometry = g.clone(); im.geometry.setAttribute('aBurn', ba);
          im.userData.burn = ba;
          this.group.add(im);
          return im;
        });
      }
      const mk = (g, mat, n) => { const im = new THREE.InstancedMesh(g, mat, n); im.count = 0; im.frustumCulled = false; this.group.add(im); return im; };
      s.mast = mk(A.geo.mast, A.mats.A, M); s.yard = mk(A.geo.yard, A.mats.A, M); s.rudder = mk(A.geo.rudder, A.mats.A, M);
      s.oar = mk(A.geo.oar, A.mats.A, M * A.meta.tholes.length);
      const sg = art.sailGeo.clone();
      const sa = new THREE.InstancedBufferAttribute(new Float32Array(M * 4), 4);
      sg.setAttribute('aSail', sa);
      s.sail = mk(sg, art.sailMat, M); s.sail.userData.attr = sa;
      const ng = A.meta.guns?.length ?? 0;
      if (ng) { s.gun = mk(art.guns.gun, art.guns.mat, M * ng); s.bed = mk(art.guns.bed, art.guns.mat, M * ng); }
      this.sets[k] = s;
    }
  }
  // meshes that cast shadows near the camera (the hull's LOD 0 and 1, masts, sails)
  casters() {
    const out = [];
    for (const k of KINDS) { const s = this.sets[k]; for (const side of SIDES) out.push(s.hull[side][0], s.hull[side][1]); out.push(s.mast, s.yard, s.sail, s.oar); if (s.gun) out.push(s.gun, s.bed); }
    return out;
  }
  update(ships, camPos, t) {
    for (const k of KINDS) {
      const s = this.sets[k];
      for (const side of SIDES) for (const im of s.hull[side]) im.count = 0;
      s.mast.count = s.yard.count = s.rudder.count = s.oar.count = s.sail.count = 0;
      if (s.gun) s.gun.count = s.bed.count = 0;
    }
    for (const sh of ships) {
      if (sh.gone) continue;
      const A = this.art.kinds[sh.kind], s = this.sets[sh.kind], b = sh.body;
      _m.compose(b.pos, b.quat, _s);
      const d = camPos.distanceTo(b.pos);
      const lod = d < LOD_D[0] ? 0 : d < LOD_D[1] ? 1 : 2;
      const im = s.hull[sh.side][lod];
      const i = im.count++;
      im.setMatrixAt(i, _m);
      const ba = im.userData.burn; ba.setXYZ(i, sh.burn[0], sh.burn[1], sh.burn[2]);
      // rudder: pivot raked with the transom, turns about its own axis
      _q.copy(A.rudderQuat).multiply(_q2.setFromAxisAngle(_v.set(0, 1, 0), -b.rudder));
      _m2.compose(A.rudderPos, _q, _s); s.rudder.setMatrixAt(s.rudder.count++, _m2.premultiply(_m));
      // mast: pivots aft about its foot to lie on the fighting deck
      const down = THREE.MathUtils.smoothstep(sh.mastDown ?? 0, 0, 1) * 1.45;
      _q.setFromAxisAngle(_v.set(1, 0, 0), -down);
      _m2.compose(A.mastPos, _q, _s).premultiply(_m);
      s.mast.setMatrixAt(s.mast.count++, _m2);
      // the yard hangs on the mast (lowered to the deck before the mast comes down)
      const yh = A.yardPos.y - A.mastPos.y;
      const yardY = THREE.MathUtils.lerp(2.2, yh, b.hoist > 0.02 ? Math.min(b.hoist * 1.2, 1) : 0);
      const ym = new THREE.Matrix4().compose(_v.set(0, yardY, -0.3), _q2.setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.brace), _s);
      const yw = ym.premultiply(_m2);
      s.yard.setMatrixAt(s.yard.count++, yw);
      // sail below the yard; sized per type
      const [SW, SH] = A.meta.sail;
      const hoist = THREE.MathUtils.clamp((yardY - 2.2) / Math.max(yh - 2.2, 0.1), 0, 1);
      const sm = new THREE.Matrix4().compose(_v.set(0, -0.2, -0.15), _q.identity(), new THREE.Vector3(SW, Math.max(SH, 0.01), 1)).premultiply(yw);
      const si = s.sail.count++;
      s.sail.setMatrixAt(si, sm);
      s.sail.userData.attr.setXYZW(si, hoist * (1 - down / 1.45), b.sail.depth, b.sail.side, b.sail.flog);
      // bow guns behind their ports: the muzzle at the port; the barrel runs back after each shot and is hauled out again
      if (s.gun && lod < 2 && sh.guns) {
        for (let g = 0; g < sh.guns.length; g++) {
          const gp = A.guns[g], G = sh.guns[g];
          const k = G.kick ?? 0;
          const off = k <= 0 ? 0 : k < 1 ? k * 0.9 : 0.9 * Math.max(0, 1 - (k - 1) / 0.9);
          const back = this.art.guns.muzzle + 0.15 + off;
          const el = sh.player ? (sh.aimElev ?? 0) : 0.02;
          _q.setFromAxisAngle(_v.set(1, 0, 0), -el);
          _m2.compose(_v.set(gp.x, gp.y, gp.z - back), _q, _s).premultiply(_m);
          s.gun.setMatrixAt(s.gun.count++, _m2);
          _m2.compose(_v.set(gp.x, gp.y, gp.z - back), _q.identity(), _s).premultiply(_m);
          s.bed.setMatrixAt(s.bed.count++, _m2);
        }
      }
      // oars: sculling sway at each thole, both sides in step with the beat
      if (lod < 2 && sh.alive !== false) {
        const th = A.meta.tholes;
        const pw = b.rowPow ?? 0;
        for (let j = 0; j < th.length; j++) {
          const p = th[j];
          const port = p[1] > 0;
          const ph = b.stroke + j * 0.07;
          const sway = (0.1 + 0.18 * pw) * Math.sin(ph);
          const twist = 0.5 * Math.cos(ph) * (pw > 0.01 ? 1 : 0.2);
          const dip = 0.42 - 0.06 * Math.cos(ph);
          // oar frame: loom along -x..+x with the blade toward +x (outboard on the port side)
          _e.set(0, 0, 0);
          _q.setFromAxisAngle(_v.set(0, 1, 0), port ? 0 : Math.PI);
          _q2.setFromAxisAngle(_v.set(0, 1, 0), -sway * (port ? 1 : -1)); _q.premultiply(_q2);
          _q2.setFromAxisAngle(_v.set(0, 0, 1), port ? -dip : dip); _q.premultiply(_q2);
          const tw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), twist);
          _q.multiply(tw);
          _m2.compose(_v.set(p[1], p[2], p[0]), _q, _s).premultiply(_m);
          s.oar.setMatrixAt(s.oar.count++, _m2);
        }
      }
    }
    for (const k of KINDS) {
      const s = this.sets[k];
      for (const side of SIDES) for (const im of s.hull[side]) { im.instanceMatrix.needsUpdate = true; im.userData.burn.needsUpdate = true; }
      for (const im of [s.mast, s.yard, s.rudder, s.oar, s.sail, s.gun, s.bed]) if (im) im.instanceMatrix.needsUpdate = true;
      s.sail.userData.attr.needsUpdate = true;
    }
  }
}
