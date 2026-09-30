// Islands: the near heightfield (16 km, 8 m grid) cut into 512 m tiles with two levels of detail, and the far
// heightfield (96 km, 96 m grid) as one coarse mesh. Tiles are built only where there is land or shallow water.
// Surface: dark pine and evergreen forest, pale granite on steep faces and ridges, orange-beige weathered granite
// soil (masa) in scars, terraced orchards on the gentler sunny slopes, pale sand in the coves, wet rock and weed at
// the tide line, and the sea bed below it (seen through the water near the shore).
// Distance: every vertex drops with the curvature of the earth and every pixel goes through the haze (sky.js),
// so the ranges beyond fade layer by layer into the horizon sky.
import * as THREE from 'three';
import { noiseGLSL } from './sky.js';

async function inflate(buf) {
  const s = new Blob([buf]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
async function loadField(base, name) {
  const meta = await (await fetch(base + name + '.json')).json();
  const raw = await inflate(await (await fetch(base + name + '.bin')).arrayBuffer());
  const n = meta.n, d = new Int16Array(raw.buffer, raw.byteOffset, n * n), H = new Float32Array(n * n);
  const k = (meta.hmax - meta.hmin) / 65535;
  for (let j = 0; j < n; j++) { let a = 0; for (let i = 0; i < n; i++) { a = (a + d[j * n + i]) & 0xffff; H[j * n + i] = meta.hmin + a * k; } }
  return { ...meta, H, cell: meta.size / (n - 1), half: meta.size / 2 };
}
function heightAt(F, x, z) {
  let fx = (x + F.half) / F.cell, fz = (z + F.half) / F.cell;
  const n = F.n;
  fx = Math.min(Math.max(fx, 0), n - 1.001); fz = Math.min(Math.max(fz, 0), n - 1.001);
  const i = fx | 0, j = fz | 0, u = fx - i, v = fz - j, o = j * n + i, H = F.H;
  return (H[o] + (H[o + 1] - H[o]) * u) * (1 - v) + (H[o + n] + (H[o + n + 1] - H[o + n]) * u) * v;
}
// normal + curvature texture: rgb = normal (three axes), a = curvature (128 = flat, > 128 = gully)
function normalTexture(F, curvR = 3) {
  const { n, H, cell } = F;
  const tex = new Uint8Array(n * n * 4);
  const at = (i, j) => H[Math.min(n - 1, Math.max(0, j)) * n + Math.min(n - 1, Math.max(0, i))];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const o = j * n + i;
    const hx = at(i + 1, j) - at(i - 1, j), hz = at(i, j + 1) - at(i, j - 1);
    let nx = -hx, ny = 2 * cell, nz = -hz; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const r = curvR;
    const lap = (at(i + r, j) + at(i - r, j) + at(i, j + r) + at(i, j - r) - 4 * H[o]) / (r * r * cell * cell);
    tex[o * 4] = (nx * 0.5 + 0.5) * 255; tex[o * 4 + 1] = (ny * 0.5 + 0.5) * 255; tex[o * 4 + 2] = (nz * 0.5 + 0.5) * 255;
    tex[o * 4 + 3] = Math.max(0, Math.min(255, 128 + lap * 2400 * cell / 8));
  }
  const t = new THREE.DataTexture(tex, n, n, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}
function grid(F, i0, j0, cells, step, minH) {
  const m = Math.floor(cells / step) + 1, n = F.n;
  const pos = new Float32Array(m * m * 3), uv = new Float32Array(m * m * 2);
  let any = false;
  for (let b = 0; b < m; b++) for (let a = 0; a < m; a++) {
    const i = Math.min(i0 + a * step, n - 1), j = Math.min(j0 + b * step, n - 1), k = b * m + a;
    const h = F.H[j * n + i];
    if (h > minH) any = true;
    pos[k * 3] = -F.half + i * F.cell; pos[k * 3 + 1] = h; pos[k * 3 + 2] = -F.half + j * F.cell;
    uv[k * 2] = (i + 0.5) / n; uv[k * 2 + 1] = (j + 0.5) / n;
  }
  if (!any) return null;
  const idx = [];
  for (let b = 0; b < m - 1; b++) for (let a = 0; a < m - 1; a++) {
    const p = b * m + a;
    idx.push(p, p + m, p + 1, p + 1, p + m, p + m + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(m * m * 3).map((_, q) => (q % 3 === 1 ? 1 : 0)), 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

const landFrag = /* glsl */`
  vec4 fq = texture2D(uLandN, vLandUv);
  vec3 wN = normalize(fq.xyz * 2.0 - 1.0);
  float curv = (fq.w - 0.502) * 2.0;                     // + = gully, - = ridge
  vec2 P = vLandW.xz;
  float h0 = vLandW.y, slope = wN.y;
  float px = length(fwidth(P));
  float aF = 1.0 - smoothstep(0.5, 3.0, px);
  float big = ffbm(P * 0.004), mid = ffbm(P * 0.03 + 7.0), fine = mix(0.5, fnoise(P * 0.35), aF);
  // forest: red and black pine with evergreen oak; crowns mottle dark and light, gaps are near black
  float crowns = fnoise(P * 0.22 + big * 3.0) * 0.6 + fnoise(P * 0.61) * 0.4;
  crowns = mix(0.5, crowns, 1.0 - smoothstep(4.0, 20.0, px));
  vec3 forest = mix(vec3(0.006, 0.011, 0.008), vec3(0.018, 0.027, 0.016), crowns);
  forest = mix(forest, forest * vec3(1.3, 1.25, 0.9), smoothstep(0.55, 0.75, mid) * 0.5);   // broadleaf patches, lighter
  forest *= 0.75 + 0.5 * crowns * (1.0 - smoothstep(4.0, 30.0, px));                            // crown shadows
  // granite: pale grey-beige, jointed; weathered soil (masa): orange-beige
  float joint = smoothstep(0.62, 0.7, fnoise(vec2(dot(P, vec2(0.8, 0.6)) * 0.08, h0 * 0.12)));
  vec3 granite = mix(vec3(0.1, 0.095, 0.085), vec3(0.2, 0.19, 0.17), mid) * (0.85 + 0.3 * fine) * (1.0 - 0.35 * joint);
  vec3 masa = mix(vec3(0.24, 0.17, 0.1), vec3(0.33, 0.26, 0.17), fine);
  float steep = smoothstep(0.66, 0.46, slope);
  float ridge = smoothstep(0.03, 0.25, -curv);
  float gully = smoothstep(0.03, 0.25, curv);
  float rockK = clamp(steep * 0.9 + ridge * 0.25 * smoothstep(90.0, 220.0, h0), 0.0, 1.0) * smoothstep(0.42, 0.62, ffbm(P * 0.012 + 3.0) + steep * 0.3);
  float scar = smoothstep(0.8, 0.88, ffbm(P * 0.011 + 19.0) + steep * 0.15) * (1.0 - gully) * 0.7;
  vec3 col = forest;
  col = mix(col, masa, scar * 0.8);
  col = mix(col, granite, rockK);
  // terraced orchards on gentle south-facing slopes below 110 m (Seto citrus terraces): rows along the contour
  float south = smoothstep(0.1, 0.6, wN.z);
  float gentle = smoothstep(0.84, 0.93, slope) * smoothstep(8.0, 20.0, h0) * (1.0 - smoothstep(90.0, 130.0, h0 + 30.0 * big));
  float terr = gentle * south * smoothstep(0.45, 0.6, ffbm(P * 0.002 + 41.0));
  float rows = smoothstep(0.35, 0.5, abs(fract(h0 / 2.2) - 0.5)) * aF;
  vec3 orch = mix(vec3(0.035, 0.05, 0.018), vec3(0.075, 0.08, 0.035), rows) * (0.85 + 0.3 * fine);
  col = mix(col, orch, terr * 0.9);
  // shore: sand in the coves, wet dark rock and weed in the tidal band, sea bed below
  float cove = smoothstep(0.04, 0.2, curv + 0.1 * (mid - 0.5)) * smoothstep(0.75, 0.93, slope);
  vec3 sand = mix(vec3(0.28, 0.25, 0.2), vec3(0.4, 0.37, 0.31), fine);
  float beach = (1.0 - smoothstep(1.2, 3.5, h0)) * cove;
  float tide = 1.0 - smoothstep(0.0, 1.4, h0 - 0.25 * sin(P.x * 0.02 + P.y * 0.03));
  vec3 wetRock = mix(vec3(0.03, 0.028, 0.024), vec3(0.06, 0.055, 0.045), fine);
  col = mix(col, mix(granite * 0.6, wetRock, 0.65), (1.0 - smoothstep(1.5, 5.0, h0)) * (1.0 - cove) * 0.8);   // bare rock at the foot of the woods
  col = mix(col, sand, beach);
  col = mix(col, mix(wetRock, sand * 0.55, cove), tide);
  vec3 bed = mix(vec3(0.05, 0.05, 0.04), vec3(0.14, 0.13, 0.1), cove) * (0.8 + 0.3 * fine);
  col = mix(col, bed, smoothstep(0.0, -1.0, h0));
  diffuseColor.rgb = col;
`;

function landMaterial(tex, patch, { far = false } = {}) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.93, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uLandN = { value: tex };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vLandUv; varying vec3 vLandW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLandUv = uv; vLandW = (modelMatrix * vec4(position, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform sampler2D uLandN; varying vec2 vLandUv; varying vec3 vLandW;\n${noiseGLSL}`)
      .replace('#include <normal_fragment_begin>', `float faceDirection = 1.0;
        vec3 wNrm = normalize(texture2D(uLandN, vLandUv).xyz * 2.0 - 1.0);
        vec3 normal = normalize((viewMatrix * vec4(wNrm, 0.0)).xyz);
        vec3 nonPerturbedNormal = normal;`)
      .replace('#include <color_fragment>', landFrag + (far ? 'if (max(abs(vLandW.x), abs(vLandW.z)) < 7300.0) discard;' : ''));
  };
  m.customProgramCacheKey = () => (far ? 'landfar' : 'land');
  return patch(m, { curve: true });
}

export async function loadIslands(base, patch) {
  const [near, far, map] = await Promise.all([loadField(base, 'near'), loadField(base, 'far'), fetch(base + 'map.json').then((r) => r.json())]);
  const nTex = normalTexture(near, 3), fTex = normalTexture(far, 2);
  const nearM = landMaterial(nTex, patch), farM = landMaterial(fTex, patch, { far: true });
  const group = new THREE.Group();
  const tiles = [];
  const T = 64;                                  // cells per tile (512 m)
  for (let j0 = 0; j0 < near.n - 1; j0 += T) for (let i0 = 0; i0 < near.n - 1; i0 += T) {
    const hi = grid(near, i0, j0, T, 1, -16);
    if (!hi) continue;
    const lo = grid(near, i0, j0, T, 4, -16);
    const mh = new THREE.Mesh(hi, nearM), ml = new THREE.Mesh(lo, nearM);
    mh.receiveShadow = ml.receiveShadow = true;
    const c = new THREE.Vector3(-near.half + (i0 + T / 2) * near.cell, 0, -near.half + (j0 + T / 2) * near.cell);
    group.add(mh, ml);
    tiles.push({ hi: mh, lo: ml, c });
  }
  // far: two rings of detail
  const farMeshes = [];
  for (const [step, r0, r1] of [[1, 7000, 26000], [2, 25000, 48000]]) {
    const n = far.n, m = Math.floor((n - 1) / step) + 1;
    const pos = [], uv = [], map2 = new Int32Array(m * m).fill(-1);
    for (let b = 0; b < m; b++) for (let a = 0; a < m; a++) {
      const i = a * step, j = b * step, x = -far.half + i * far.cell, z = -far.half + j * far.cell;
      const c = Math.max(Math.abs(x), Math.abs(z));
      if (c < r0 - far.cell * 2 * step || c > r1 + far.cell * 2 * step) continue;
      map2[b * m + a] = pos.length / 3;
      pos.push(x, far.H[j * n + i], z); uv.push((i + 0.5) / n, (j + 0.5) / n);
    }
    const idx = [];
    for (let b = 0; b < m - 1; b++) for (let a = 0; a < m - 1; a++) {
      const p = map2[b * m + a], q = map2[b * m + a + 1], r = map2[(b + 1) * m + a], s = map2[(b + 1) * m + a + 1];
      if (p < 0 || q < 0 || r < 0 || s < 0) continue;
      const hmax = Math.max(pos[p * 3 + 1], pos[q * 3 + 1], pos[r * 3 + 1], pos[s * 3 + 1]);
      if (hmax < -12) continue;
      idx.push(p, r, q, q, r, s);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length).map((_, q) => (q % 3 === 1 ? 1 : 0)), 3));
    g.setIndex(idx);
    const mesh = new THREE.Mesh(g, farM);
    mesh.frustumCulled = false;
    group.add(mesh); farMeshes.push(mesh);
  }
  function update(camPos) {
    for (const t of tiles) {
      const d = Math.hypot(t.c.x - camPos.x, t.c.z - camPos.z);
      const near = d < 1400;
      t.hi.visible = near; t.lo.visible = !near;
    }
  }
  return { group, tiles, near, far, map, height: (x, z) => heightAt(near, x, z), update, shadowCasters: tiles.map((t) => t.lo) };
}
