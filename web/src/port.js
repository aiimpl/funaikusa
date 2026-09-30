// Harbour towns: pieces baked by bake/port.py placed along each harbour from map.json.
// Stone steps (gangi) where the basin meets the shore, the lantern tower (joyato) at their end, two or three rows of
// townhouses and storehouses on the flat ground behind, a stone breakwater from one side of the basin.
// Kit axes (three.js local): +z = inland, +x = along the shore, y up; origin at the front foot.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { tex } from './ship.js';

function mulberry(seed) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

export async function loadPorts(base, islands, patch, aniso) {
  const tl = new THREE.TextureLoader();
  const [map, orm, gltf] = await Promise.all([tex(tl, base + 'port_base.webp', true, aniso), tex(tl, base + 'port_orm.webp', false, aniso),
    new GLTFLoader().loadAsync(base + 'port.glb')]);
  const mat = patch(new THREE.MeshStandardMaterial({ map, aoMap: orm, roughnessMap: orm, roughness: 1, metalness: 0 }));
  const geo = {};
  gltf.scene.traverse((c) => { if (c.isMesh) geo[c.name] = c.geometry; });
  const group = new THREE.Group();
  const H = islands.height;
  const lanterns = [];
  const put = (name, x, z, yaw, y = null) => {
    const m = new THREE.Mesh(geo[name], mat);
    m.position.set(x, y ?? H(x, z), z); m.rotation.y = yaw;
    m.castShadow = m.receiveShadow = true;
    group.add(m);
    return m;
  };
  for (const [pi, p] of islands.map.ports.entries()) {
    const rnd = mulberry(7 + pi * 13);
    const sea = new THREE.Vector2(Math.sin(p.face), Math.cos(p.face));     // toward open water
    const inland = sea.clone().negate();
    const along = new THREE.Vector2(-sea.y, sea.x);
    const yaw = Math.atan2(inland.x, inland.y);
    // the shore: walk inland from the harbour centre until the ground rises above 1 m
    let s = 0;
    while (s < 400 && H(p.x + inland.x * s, p.z + inland.y * s) < 1.0) s += 1;
    const qx = p.x + inland.x * s, qz = p.z + inland.y * s;
    for (const k of [-1, 0, 1]) put('gangi', qx + along.x * k * 24, qz + along.y * k * 24, yaw, 0.0);
    const jx = qx + along.x * 40 + inland.x * 1.5, jz = qz + along.y * 40 + inland.y * 1.5;
    put('joyato', jx, jz, yaw, 2.6);
    lanterns.push(new THREE.Vector3(jx, 2.6 + 5.95, jz));
    // townhouses in rows behind the quay, following the ground
    const kinds = ['machiya0', 'machiya1', 'machiya2', 'machiya3', 'machiya0', 'machiya1', 'kura0', 'kura1'];
    for (let row = 0; row < 3; row++) {
      let a = -70 + rnd() * 6;
      while (a < 70) {
        const kind = kinds[Math.floor(rnd() * kinds.length)];
        const w = kind.startsWith('kura') ? 5.6 : kind === 'machiya1' ? 6.6 : 5.6;
        const d = 4 + row * 14 + rnd() * 1.5;
        const x = qx + along.x * a + inland.x * d, z = qz + along.y * a + inland.y * d;
        const h = H(x, z), hb = H(x + inland.x * 8, z + inland.y * 8);
        if (h > 1.5 && h < 16 && Math.abs(hb - h) < 3.5) put(kind, x, z, yaw, Math.min(h, hb) - 0.15);
        a += w + 0.3 + (rnd() < 0.15 ? 3 + rnd() * 5 : 0);     // an alley now and then
      }
    }
    // breakwater: from the shore at one side of the basin, out into the water
    const bx0 = qx + along.x * 95, bz0 = qz + along.y * 95;
    for (let k = 0; k < 9; k++) {
      const t = k * 12;
      const x = bx0 + sea.x * (t - 6) - along.x * t * 0.35, z = bz0 + sea.y * (t - 6) - along.y * t * 0.35;
      put('breakwater', x, z, Math.atan2(sea.x - along.x * 0.35, sea.y - along.y * 0.35) + Math.PI / 2, 0.0);
    }
  }
  // the lamps: a glowing paper box inside each lantern tower, lit from dusk (brightness set by setNight)
  const glowM = new THREE.MeshBasicMaterial({ color: new THREE.Color(0, 0, 0) });
  for (const l of lanterns) {
    const g = new THREE.Mesh(new THREE.BoxGeometry(1.25, 1.1, 1.25), glowM);
    g.position.copy(l); group.add(g);
  }
  const lamp = new THREE.PointLight(0xffb060, 0, 70, 1.6);
  group.add(lamp);
  function setNight(k, near) {
    glowM.color.setRGB(9 * k, 5.2 * k, 2.2 * k);
    lamp.intensity = k * 900;
    if (near) lamp.position.copy(near);
  }
  return { group, lanterns, material: mat, setNight };
}
