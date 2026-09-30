// Sun shadows with two depth maps of our own (three's shadow system is bypassed, as in hai-no-michi):
//  land map: the islands, a wide area redrawn only when the sun has moved
//  ship map: 64 m around the ship (hull, yard, sail), redrawn every frame; also darkens the water in the ship's shadow
import * as THREE from 'three';

function depthTarget(res) {
  const rt = new THREE.WebGLRenderTarget(res, res, { depthBuffer: true, stencilBuffer: false });
  const d = new THREE.DepthTexture(res, res, THREE.UnsignedIntType);
  d.compareFunction = THREE.LessEqualCompare;
  d.magFilter = d.minFilter = THREE.LinearFilter;
  rt.depthTexture = d;
  return rt;
}

export class Shadows {
  constructor(renderer, sunDir, { landSize = 6000, landRes = 4096, shipSize = 64, shipRes = 2048 } = {}) {
    this.r = renderer; this.sun = sunDir;
    this.landRT = depthTarget(landRes); this.shipRT = depthTarget(shipRes);
    const h = landSize / 2, c = shipSize / 2;
    this.shipSize = shipSize; this.shipRes = shipRes;
    this.landCam = new THREE.OrthographicCamera(-h, h, h, -h, 10, 9000);
    this.shipCam = new THREE.OrthographicCamera(-c, c, c, -c, 1, 400);
    this.landScene = new THREE.Scene(); this.shipScene = new THREE.Scene();
    this.uniforms = {
      uLandSM: { value: this.landRT.depthTexture }, uLandVP: { value: new THREE.Matrix4() }, uLandTexel: { value: 1 / landRes },
      uShipSM: { value: this.shipRT.depthTexture }, uShipVP: { value: new THREE.Matrix4() }, uShipTexel: { value: 1 / shipRes },
      uShadowOn: { value: 1 }, uMirror: { value: 1 },
    };
    this.depthMat = new THREE.MeshDepthMaterial();
  }
  aim(cam, center, dist) {
    cam.position.copy(center).addScaledVector(this.sun, dist);
    cam.up.set(0, 1, 0);
    cam.lookAt(center);
    cam.updateMatrixWorld(); cam.updateProjectionMatrix();
  }
  addCaster(mesh, { ship = false } = {}) {
    const mat = mesh.userData.depthMat ?? this.depthMat;
    const p = mesh.isInstancedMesh ? new THREE.InstancedMesh(mesh.geometry, mat, mesh.count) : new THREE.Mesh(mesh.geometry, mat);
    if (mesh.isInstancedMesh) { p.instanceMatrix = mesh.instanceMatrix; p.count = mesh.count; }
    p.matrixAutoUpdate = false; p.frustumCulled = false;
    p.userData.src = mesh;
    (ship ? this.shipScene : this.landScene).add(p);
    return p;
  }
  sync(scene) {
    for (const p of scene.children) {
      const s = p.userData.src; if (!s) continue;
      p.matrix.copy(s.matrixWorld); p.matrixWorld.copy(s.matrixWorld);
      if (s.isInstancedMesh) p.count = s.count;
      p.visible = s.visible;
    }
  }
  renderLand(center) {
    this.aim(this.landCam, center, 4000);
    this.sync(this.landScene);
    this._draw(this.landRT, this.landScene, this.landCam);
    this.uniforms.uLandVP.value.multiplyMatrices(this.landCam.projectionMatrix, this.landCam.matrixWorldInverse);
  }
  renderShip(center) {
    // snap to texels across the light so shadow edges don't shimmer while the ship moves
    this.aim(this.shipCam, center, 200);
    const t = this.shipSize / this.shipRes, c = center.clone();
    const e = this.shipCam.matrixWorld.elements;
    const right = new THREE.Vector3(e[0], e[1], e[2]), up = new THREE.Vector3(e[4], e[5], e[6]);
    const r = right.dot(c), u = up.dot(c);
    c.addScaledVector(right, Math.round(r / t) * t - r).addScaledVector(up, Math.round(u / t) * t - u);
    this.aim(this.shipCam, c, 200);
    this.sync(this.shipScene);
    this._draw(this.shipRT, this.shipScene, this.shipCam);
    this.uniforms.uShipVP.value.multiplyMatrices(this.shipCam.projectionMatrix, this.shipCam.matrixWorldInverse);
  }
  _draw(rt, scene, cam) {
    const r = this.r, prev = r.getRenderTarget(), ac = r.autoClear;
    r.setRenderTarget(rt); r.autoClear = true; r.clear(true, true, false);
    r.render(scene, cam);
    r.setRenderTarget(prev); r.autoClear = ac;
  }
}

export const shadowGLSL = /* glsl */`
uniform highp sampler2DShadow uLandSM; uniform mat4 uLandVP; uniform float uLandTexel;
uniform highp sampler2DShadow uShipSM; uniform mat4 uShipVP; uniform float uShipTexel;
uniform float uShadowOn;
float smLookup(highp sampler2DShadow m, mat4 vp, vec3 wp, float texel, float bias){
  vec4 p = vp * vec4(wp, 1.0);
  vec3 c = p.xyz / p.w * 0.5 + 0.5;
  if (c.x < 0.0 || c.x > 1.0 || c.y < 0.0 || c.y > 1.0 || c.z > 1.0) return 1.0;
  float z = c.z - bias, s = 0.0;
  for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) s += texture(m, vec3(c.xy + vec2(i, j) * texel * 1.2, z));
  return s / 9.0;
}
float sunShadowAt(vec3 wp, vec3 wn){
  if (uShadowOn < 0.5) return 1.0;
  float a = smLookup(uLandSM, uLandVP, wp + wn * 1.5, uLandTexel, 0.0001);
  float b = smLookup(uShipSM, uShipVP, wp + wn * 0.03, uShipTexel, 0.0003);
  return min(a, b);
}
`;

export function patchShadow(material, shadows) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (sh, r) => {
    prev?.call(material, sh, r);
    Object.assign(sh.uniforms, shadows.uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vShW; varying vec3 vShN; uniform float uMirror;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        { vec4 swp = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            swp = instanceMatrix * swp;
          #endif
          vShW = (modelMatrix * swp).xyz;
          vShN = normalize(inverseTransformDirection(transformedNormal, viewMatrix));
          vShW.y *= uMirror; vShN.y *= uMirror; }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vShW; varying vec3 vShN;\n${shadowGLSL}`)
      .replace('#include <lights_fragment_begin>', `#include <lights_fragment_begin>
        float shadowF = sunShadowAt(vShW, normalize(vShN));
        reflectedLight.directDiffuse *= shadowF; reflectedLight.directSpecular *= shadowF;`);
  };
  const key = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => (key ? key() : '') + '|sh';
  return material;
}
