// Small fishing boats (kobune) about the islands: a flat-bottomed skiff of two strakes, a fisherman, some with a small
// square sail. They drift slowly, ride the same waves as the ship and turn now and then. Life at the scale of the view.
import * as THREE from 'three';
import { seaHeight } from './waves.js';
import { figure } from './people.js';

function mulberry(seed) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

// hull: lofted from three edge lines (bottom, chine, gunwale), sharp bow, small transom; vertex colours
function skiff(L = 7) {
  const pos = [], col = [], idx = [];
  const n = 16;
  const wood = [0.11, 0.085, 0.06], dark = [0.03, 0.025, 0.02];
  const edge = (lev, t) => {
    const f = -L / 2 + t * L;
    const bow = Math.max(0, (t - 0.6) / 0.4);
    const w = [0.3, 0.62, 0.72][lev] * (1 - bow ** 1.7) + 0.02;
    const z = [-0.28, 0.02, 0.35][lev] + (lev ? 0.35 * bow * bow : 0.3 * bow * bow) + 0.08 * (1 - t) ** 3;
    return [w, z, f];
  };
  for (const s of [-1, 1]) for (let lev = 0; lev < 2; lev++) {
    const base = pos.length / 3;
    for (let i = 0; i <= n; i++) for (const l of [lev, lev + 1]) {
      const [w, z, f] = edge(l, i / n);
      pos.push(s * w, z, f); col.push(...(l === 0 ? dark : wood));
    }
    for (let i = 0; i < n; i++) {
      const a = base + i * 2, b = a + 2;
      if (s > 0) idx.push(a, a + 1, b, b, a + 1, b + 1); else idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  // bottom and the inside (dark), drawn double-sided by the material
  const base = pos.length / 3;
  for (let i = 0; i <= n; i++) { const [w, z, f] = edge(0, i / n); pos.push(-w, z, f, w, z, f); col.push(...dark, ...dark); }
  for (let i = 0; i < n; i++) { const a = base + i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function makeBoats(islands, sea, patch, count = 16) {
  const rnd = mulberry(23);
  const hullM = patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide }));
  const manM = patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }));
  const sailM = patch(new THREE.MeshStandardMaterial({ color: new THREE.Color(0.3, 0.28, 0.23), roughness: 0.9, side: THREE.DoubleSide }));
  const mastM = patch(new THREE.MeshStandardMaterial({ color: new THREE.Color(0.1, 0.08, 0.06), roughness: 0.8 }));
  const hullG = skiff(), manG = figure({ arms: 'forward', lean: 0.4, hat: true }), sitG = figure({ sit: true, hat: true });
  const group = new THREE.Group();
  const boats = [];
  let tries = 0;
  while (boats.length < count && tries++ < 4000) {
    const x = (rnd() - 0.5) * 12000, z = (rnd() - 0.5) * 12000;
    const h = islands.height(x, z);
    // in water a few metres deep, within 120-600 m of a coast
    if (h > -4 || h < -30) continue;
    let near = false;
    for (let a = 0; a < 8 && !near; a++) { const q = a / 8 * Math.PI * 2; if (islands.height(x + Math.cos(q) * 400, z + Math.sin(q) * 400) > 0) near = true; }
    if (!near) continue;
    const b = new THREE.Group();
    b.add(new THREE.Mesh(hullG, hullM));
    const man = new THREE.Mesh(rnd() < 0.5 ? manG : sitG, manM);
    man.position.set(0, -0.2, -1.8); b.add(man);
    if (rnd() < 0.45) {
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 4.2, 6), mastM);
      mast.position.set(0, 1.9, 0.9); b.add(mast);
      const sail = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.8, 4, 4), sailM);
      const p = sail.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) p.setZ(i, 0.35 * Math.sin(Math.PI * (p.getX(i) / 2.4 + 0.5)) * Math.sin(Math.PI * (p.getY(i) / 2.8 + 0.5)));
      sail.geometry.computeVertexNormals();
      sail.position.set(0, 2.5, 0.75); b.add(sail);
    }
    b.traverse((m) => { if (m.isMesh) m.castShadow = true; });
    group.add(b);
    boats.push({ g: b, x, z, hd: rnd() * Math.PI * 2, v: 0.2 + rnd() * 0.4, turn: 0 });
  }
  function update(dt, t, cam) {
    for (const o of boats) {
      if (Math.hypot(o.x - cam.x, o.z - cam.z) > 3500) { o.g.visible = false; continue; }
      o.g.visible = true;
      if (rnd() < dt * 0.02) o.turn = (rnd() - 0.5) * 0.08;
      o.hd += o.turn * dt;
      const nx = o.x + Math.sin(o.hd) * o.v * dt, nz = o.z + Math.cos(o.hd) * o.v * dt;
      if (islands.height(nx, nz) < -3) { o.x = nx; o.z = nz; } else o.hd += Math.PI * 0.5;
      const h = seaHeight(sea, o.x, o.z, t), hf = seaHeight(sea, o.x + Math.sin(o.hd) * 3, o.z + Math.cos(o.hd) * 3, t);
      const hs = seaHeight(sea, o.x + Math.cos(o.hd) * 0.7, o.z - Math.sin(o.hd) * 0.7, t);
      o.g.position.set(o.x, h + 0.05, o.z);
      o.g.rotation.set(-Math.atan2(hf - h, 3), o.hd, Math.atan2(hs - h, 0.7) * 0.6, 'YXZ');
    }
  }
  return { group, update, boats };
}
