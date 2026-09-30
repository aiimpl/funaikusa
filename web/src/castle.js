// Noshima castle: the baileys, palisades, buildings, watch tower and landing, with the castle islands' own 1 m ground
// (bake/castle.py). Placed in world coordinates as baked.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

async function tex(loader, url, srgb, aniso) {
  const t = await loader.loadAsync(url);
  t.flipY = false; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = aniso;
  return t;
}

export async function loadCastle(base, { aniso = 8, patch }) {
  const tl = new THREE.TextureLoader();
  const [map, orm, gltf] = await Promise.all([tex(tl, base + 'castle_base.webp', true, aniso), tex(tl, base + 'castle_orm.webp', false, aniso),
    new GLTFLoader().loadAsync(base + 'castle.glb')]);
  const m = new THREE.MeshStandardMaterial({ map, aoMap: orm, roughnessMap: orm, roughness: 1, metalness: 0 });
  patch?.(m);
  const group = new THREE.Group();
  const meshes = [];
  gltf.scene.traverse((o) => { if (o.isMesh) { const mm = new THREE.Mesh(o.geometry, m); mm.position.copy(o.position); mm.quaternion.copy(o.quaternion); group.add(mm); meshes.push(mm); } });
  return { group, meshes };
}
