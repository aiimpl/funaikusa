// People: the crew (kako) on deck and fishermen in small boats. Simple figures built from tapered cylinders and
// spheres: indigo work coat (hanten) over a short kimono, bare shins, a cloth headband or a straw hat (kasa).
// They are small on screen, so the silhouette and the colours matter more than detail. Poses are set per figure;
// the helmsman leans on the tiller as it moves, the haulers sway, everyone rides the ship's motion.
import * as THREE from 'three';

const INDIGO = [0.045, 0.06, 0.11], INDIGO2 = [0.06, 0.065, 0.085], SKIN = [0.3, 0.19, 0.12], STRAW = [0.3, 0.24, 0.12], CLOTH = [0.45, 0.43, 0.4];

function part(pos, nrm, col, idx, a, b, r0, r1, c, seg = 7) {
  // tapered cylinder from a to b
  const ax = new THREE.Vector3().subVectors(b, a).normalize();
  const ref = Math.abs(ax.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const e1 = new THREE.Vector3().crossVectors(ax, ref).normalize(), e2 = new THREE.Vector3().crossVectors(ax, e1);
  const base = pos.length / 3;
  for (let r = 0; r < 2; r++) for (let k = 0; k < seg; k++) {
    const t = (k / seg) * Math.PI * 2, n = e1.clone().multiplyScalar(Math.cos(t)).addScaledVector(e2, Math.sin(t));
    const p = (r ? b : a).clone().addScaledVector(n, r ? r1 : r0);
    pos.push(p.x, p.y, p.z); nrm.push(n.x, n.y, n.z); col.push(...c);
  }
  for (let k = 0; k < seg; k++) { const i0 = base + k, i1 = base + (k + 1) % seg; idx.push(i0, i1, i0 + seg, i1, i1 + seg, i0 + seg); }
  // caps
  const ca = pos.length / 3; pos.push(a.x, a.y, a.z); nrm.push(-ax.x, -ax.y, -ax.z); col.push(...c);
  const cb = pos.length / 3; pos.push(b.x, b.y, b.z); nrm.push(ax.x, ax.y, ax.z); col.push(...c);
  for (let k = 0; k < seg; k++) { idx.push(ca, base + (k + 1) % seg, base + k); idx.push(cb, base + seg + k, base + seg + (k + 1) % seg); }
}
function ball(pos, nrm, col, idx, c0, r, c, sy = 1) {
  const base = pos.length / 3, lat = 5, lon = 8;
  for (let i = 0; i <= lat; i++) for (let j = 0; j < lon; j++) {
    const th = (i / lat) * Math.PI, ph = (j / lon) * Math.PI * 2;
    const n = new THREE.Vector3(Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph));
    pos.push(c0.x + n.x * r, c0.y + n.y * r * sy, c0.z + n.z * r); nrm.push(n.x, n.y, n.z); col.push(...c);
  }
  for (let i = 0; i < lat; i++) for (let j = 0; j < lon; j++) {
    const a = base + i * lon + j, b = base + i * lon + (j + 1) % lon;
    idx.push(a, b, a + lon, b, b + lon, a + lon);
  }
}
// pose: { lean (forward, rad), arms: 'down' | 'forward' | 'up' | 'tiller', sit: bool, hat: bool, coat: [r,g,b] }
export function figure(pose = {}) {
  const pos = [], nrm = [], col = [], idx = [];
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const lean = pose.lean ?? 0.05, sit = !!pose.sit;
  const hip = V(0, sit ? 0.45 : 0.86, 0);
  const up = V(0, Math.cos(lean), Math.sin(lean));
  const neck = hip.clone().addScaledVector(up, 0.62);
  const coat = pose.coat ?? INDIGO;
  // legs
  for (const s of [-1, 1]) {
    const knee = sit ? V(s * 0.1, 0.47, 0.42) : V(s * 0.1, 0.45, 0.04);
    const foot = sit ? V(s * 0.11, 0.03, 0.5) : V(s * 0.11 + s * 0.03, 0.03, 0.0);
    part(pos, nrm, col, idx, hip.clone().add(V(s * 0.09, 0, 0)), knee, 0.075, 0.06, SKIN);
    part(pos, nrm, col, idx, knee, foot, 0.055, 0.045, SKIN);
  }
  // kimono skirt and coat body
  part(pos, nrm, col, idx, hip.clone().addScaledVector(up, -0.18), hip.clone().addScaledVector(up, 0.12), 0.2, 0.17, INDIGO2);
  part(pos, nrm, col, idx, hip.clone().addScaledVector(up, 0.08), neck, 0.17, 0.2, coat);
  // arms
  const sh = (s) => neck.clone().add(V(s * 0.22, -0.06, 0));
  for (const s of [-1, 1]) {
    let el, hand;
    switch (pose.arms) {
      case 'forward': el = sh(s).add(V(s * 0.04, -0.12, 0.26)); hand = el.clone().add(V(-s * 0.05, 0.02, 0.28)); break;
      case 'up': el = sh(s).add(V(s * 0.05, 0.2, 0.1)); hand = el.clone().add(V(-s * 0.02, 0.28, 0.05)); break;
      case 'tiller': el = sh(s).add(V(s * 0.02, -0.2, 0.18)); hand = el.clone().add(V(-s * 0.1, -0.04, 0.24)); break;
      default: el = sh(s).add(V(s * 0.05, -0.28, 0.02)); hand = el.clone().add(V(0, -0.26, 0.05));
    }
    part(pos, nrm, col, idx, sh(s), el, 0.065, 0.055, coat);
    part(pos, nrm, col, idx, el, hand, 0.05, 0.04, SKIN);
  }
  // head, headband or straw hat
  const head = neck.clone().addScaledVector(up, 0.14);
  ball(pos, nrm, col, idx, head, 0.11, SKIN, 1.1);
  if (pose.hat) {
    const top = head.clone().add(V(0, 0.08, 0));
    part(pos, nrm, col, idx, top.clone().add(V(0, -0.03, 0)), top.clone().add(V(0, 0.12, 0)), 0.34, 0.03, STRAW, 10);
  } else part(pos, nrm, col, idx, head.clone().add(V(0, 0.02, 0)), head.clone().add(V(0, 0.07, 0)), 0.118, 0.115, CLOTH);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

// the crew, placed on the ship in ship-local coordinates (three: x port, y up, z forward)
export function makeCrew(ship, patch) {
  const mat = patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }));
  // deck height along the ship: the sheer of the station table, less the deck's drop, plus its camber
  const st = ship.meta.stations;
  const deckAt = (f) => {
    let i = 0; while (i < st.length - 2 && st[i + 1][0] < f) i++;
    const [f0, p0] = st[i], [f1, p1] = st[i + 1], t = Math.min(Math.max((f - f0) / (f1 - f0), 0), 1);
    return p0[p0.length - 1][1] + (p1[p1.length - 1][1] - p0[p0.length - 1][1]) * t - 0.5 + 0.07;
  };
  const list = [
    { pose: { arms: 'tiller', lean: 0.18, hat: true }, at: [0.5, 0, -7.4], yaw: Math.PI, role: 'helm' },
    { pose: { arms: 'forward', lean: 0.25 }, at: [1.3, 0, 0.6], yaw: 0.5, role: 'haul' },
    { pose: { arms: 'up', lean: 0.1 }, at: [-1.2, 0, 0.4], yaw: -0.3, role: 'haul' },
    { pose: { arms: 'forward', lean: 0.3, coat: [0.06, 0.05, 0.04] }, at: [0.3, 0, 7.3], yaw: 0, role: 'bow' },
    { pose: { sit: true, hat: true }, at: [2.4, 0, -4.2], yaw: -1.2, role: 'rest' },
    { pose: { arms: 'down', lean: 0.02 }, at: [-2.0, 0, -5.4], yaw: 2.4, role: 'watch' },
  ];
  for (const c of list) c.at[1] = deckAt(c.at[2]);
  const group = new THREE.Group();
  const men = list.map((c) => {
    const m = new THREE.Mesh(figure(c.pose), mat);
    m.position.set(...c.at); m.rotation.y = c.yaw;
    m.castShadow = true;
    group.add(m);
    return { m, c, ph: Math.random() * 6 };
  });
  ship.group.add(group);
  function update(t, rudder) {
    for (const { m, c, ph } of men) {
      if (c.role === 'helm') { m.position.x = c.at[0] - rudder * 1.6; m.rotation.z = rudder * 0.2; }
      else if (c.role === 'haul') m.rotation.x = 0.06 * Math.sin(t * 0.9 + ph);
      else m.rotation.x = 0.02 * Math.sin(t * 0.4 + ph);
    }
  }
  return { group, update, meshes: men.map((x) => x.m) };
}
