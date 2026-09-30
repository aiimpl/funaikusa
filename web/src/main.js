// Startup and the frame loop. Physics at a fixed step (1/120 s near the camera, 1/60 s for the rest), rendering on
// requestAnimationFrame. Render order: ship shadow map -> mirrored world (reflection, half res) -> world without water
// (colour + depth for refraction) -> water on top -> smoke and flames -> bloom and tone mapping (post.js).
import * as THREE from 'three';
import { makeSky, makeSkyUniforms, sunDirection, patchHaze } from './sky.js';
import { makeSea, seaUniforms } from './waves.js';
import { Wind } from './wind.js';
import { makeOcean } from './ocean.js';
import { Wake } from './wake.js';
import { Shadows, patchShadow } from './shadows.js';
import { Post } from './post.js';
import { Q as QL, MOBILE } from './quality.js';
import { Input } from './input.js';
import { OrbitCam } from './cam.js';
import { loadIslands } from './islands.js';
import { makeTrees } from './trees.js';
import { Tide } from './tide.js';
import { loadFleetArt, FleetView } from './warship.js';
import { Hull } from './hull.js';
import { Gunnery, GUN } from './gunnery.js';
import { FX } from './fx.js';
import { t, applyStatic, toggleLang } from './i18n.js';
import { Fleet, ORDERS } from './fleet.js';
import { setup as setupScenario, outcome, SCENARIOS } from './scenario.js';
import { makeHUD } from './hud.js';
import { CrewView } from './crew.js';
import { loadCastle } from './castle.js';
import { Sound } from './audio.js';

const QS = new URLSearchParams(location.search);
const RENDER = QS.has('render');
const W = 1600, H = 900;
const PR = RENDER ? 2 : Math.min(devicePixelRatio || 1, 1.5);
const DT = 1 / 120;

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(PR);
renderer.setSize(W, H, false);
renderer.toneMapping = THREE.NoToneMapping;
renderer.localClippingEnabled = true;

const scene = new THREE.Scene();
const world = new THREE.Group();
scene.add(world);
const camera = new THREE.PerspectiveCamera(40, W / H, 0.3, 30000);

// ---- Time of day: the Geiyo islands (34.2 N), late spring
const LAT = 34.2, DAY = 140;
const SCEN = SCENARIOS[QS.get('s')] ? QS.get('s') : 'horoku';
let hour = parseFloat(QS.get('t') ?? SCENARIOS[SCEN].hour);
const TIME_SCALE = parseFloat(QS.get('ts') ?? '6');        // game seconds per real second: a battle of 20 minutes lasts two hours of daylight
const sunDir = sunDirection(LAT, DAY, hour);
const sunCol = new THREE.Color();
const skyU = makeSkyUniforms(sunDir, new THREE.Vector3());
const U = { uTime: { value: 0 } };
const sky = makeSky(skyU);
world.add(sky);
const sunLight = new THREE.DirectionalLight(0xffffff, 1);
scene.add(sunLight, sunLight.target);
const hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 1);
scene.add(hemi);
function lightFromSun() {
  const el = Math.asin(sunDir.y);
  const air = 1 / Math.max(Math.sin(Math.max(el, 0.01)) + 0.15 * Math.pow(Math.max(el, 0) * 57.3 + 3.885, -1.253), 0.02);
  const tr = [Math.exp(-0.035 * air), Math.exp(-0.075 * air), Math.exp(-0.16 * air)];
  const up = THREE.MathUtils.smoothstep(el, -0.06, 0.05);
  const I = 7.0 * up;
  sunCol.setRGB(tr[0] * I, tr[1] * I, tr[2] * I);
  skyU.uSunCol.value.set(sunCol.r, sunCol.g, sunCol.b);
  sunLight.color.copy(sunCol); sunLight.intensity = 1;
  sunLight.position.copy(sunDir).multiplyScalar(100);
  const dusk = THREE.MathUtils.clamp(1 - (el - 0.02) / 0.3, 0, 1);
  skyU.uDusk.value = dusk * dusk;
  skyU.uNight.value = THREE.MathUtils.clamp((-el - 0.02) / 0.12, 0, 1);
  const k = THREE.MathUtils.clamp(0.15 + sunDir.y * 1.6, 0.02, 1.0) * (1 - skyU.uNight.value * 0.9);
  hemi.color.setRGB(0.62 * k, 0.68 * k, 0.78 * k);
  hemi.groundColor.setRGB(0.1 * k, 0.12 * k, 0.12 * k);
  hemi.intensity = 2.2;
}
lightFromSun();

// ---- Sea, wind
const wind = new Wind({ speed: parseFloat(QS.get('wind') ?? SCENARIOS[SCEN].wind[0]), dir: parseFloat(QS.get('wdir') ?? SCENARIOS[SCEN].wind[1]) });
const sea = makeSea({ wind: wind.speed, windDir: wind.dir, swellDir: 1.35, swellH: 0.3 });
const seaU = seaUniforms(sea);

// ---- Post, reflection and shadows
const post = new Post(renderer, W * PR, H * PR, { samples: MOBILE ? 0 : 4, levels: QL.bloomLevels });
const rtRefl = new THREE.WebGLRenderTarget(Math.round(W * PR * 0.5), Math.round(H * PR * 0.5),
  { type: THREE.HalfFloatType, depthBuffer: true, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
const shadows = new Shadows(renderer, sunDir, { shipSize: 150, shipRes: MOBILE ? 1536 : 3072 });
const patch = (m, o) => patchHaze(patchShadow(m, shadows), skyU, o);

// ---- Islands
const NOLAND = QS.has('noland');
const islands = NOLAND ? { group: new THREE.Group(), shadowCasters: [], height: () => -40, update() {}, map: null } : await loadIslands('data/', patch);
world.add(islands.group);
for (const m of islands.shadowCasters) shadows.addCaster(m);
const trees = NOLAND ? null : makeTrees(islands, patch, { clear: [[0, 0, 125], [-9, 191, 60]] });
if (trees) world.add(trees.group);
const castle = NOLAND ? null : await loadCastle('data/', { aniso: renderer.capabilities.getMaxAnisotropy(), patch });
if (castle) { world.add(castle.group); for (const m of castle.meshes) shadows.addCaster(m); }
const tide = new Tide(islands.map?.strait ?? { x: 285, z: 60, dir: 2.16, width: 240 });
tide.setHour(hour);

// ---- Fleet
const art = await loadFleetArt('data/', { aniso: renderer.capabilities.getMaxAnisotropy(), patch, U, seaU });
const view = new FleetView(art);
world.add(view.group);
for (const m of view.casters()) shadows.addCaster(m, { ship: true });
shadows.renderLand(new THREE.Vector3());
let lastLandSun = sunDir.clone();

const crew = new CrewView(art, patch, U, wind);
world.add(crew.group);
for (const m of crew.casters()) shadows.addCaster(m, { ship: true });
const fx = new FX(skyU, wind);
scene.add(fx.lightGroup);
const gunnery = new Gunnery(fx, sea);
world.add(gunnery.mesh);
const fleet = new Fleet({ art, sea, wind, tide, ground: NOLAND ? null : islands.height, Hull, gunnery, fx });
const ships = fleet.ships;
// ?alone: just the player's ship (for looking at it and for the physics checks); ?kind= picks its type
if (QS.has('alone')) fleet.add(QS.get('kind') ?? 'seki', 'A', -300, 300, -1.9, { player: true, flagship: true });
else setupScenario(fleet, SCEN);
const player = ships.find((s) => s.player);
// ?auto: the player's ship is steered by a captain too (for balancing the battles and for the film)
if (QS.has('auto')) player.player = false;
// the approach is made under sail; the masts come down when the fleets close (see battleStart)
let battle = QS.has('alone') || QS.has('battle');
for (const s of ships) { s.body.ctl.hoist = battle ? 0 : 1; s.body.hoist = s.body.ctl.hoist; s.mastDown = battle ? 1 : 0; if (!s.player) s.body.ctl.beatL = s.body.ctl.beatR = 1; }
for (const g of player.guns) g.full = GUN[g.type].reload;

// ---- Water
const KIND_N = { atake: 0, seki: 1, kobaya: 2 };
const wake = new Wake(renderer, ['atake', 'seki', 'kobaya'].map((k) => art.kinds[k].meta.stations));
const waterScene = new THREE.Scene();
const ocean = makeOcean({ skyU, seaU, wakeU: wake.uniforms, windU: wind.uniforms, tideU: tide.uniforms, reflTarget: rtRefl, refrTarget: post.refr,
  shipShadowU: shadows.uniforms, timeU: U.uTime, quality: { oceanRings: +(QS.get('orings') ?? (MOBILE ? 150 : 240)), oceanSeg: +(QS.get('oseg') ?? (MOBILE ? 256 : 420)) } });
waterScene.add(ocean.mesh);
waterScene.add(fx.group);

// ---- Environment map (the sky in a small cube) for the wood's reflections
const pmrem = new THREE.PMREMGenerator(renderer);
const envScene = new THREE.Scene();
const envSky = new THREE.Mesh(sky.geometry, sky.material); envSky.scale.setScalar(0.005);
envScene.add(envSky);
envScene.add(new THREE.Mesh(new THREE.CircleGeometry(40, 24).rotateX(-Math.PI / 2).translate(0, -0.5, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.02, 0.04, 0.045) })));
let envRT = null;
function rebuildEnv() { envRT?.dispose(); envRT = pmrem.fromScene(envScene, 0.02); scene.environment = envRT.texture; }
rebuildEnv();
scene.traverse((o) => { if (o.material?.isMeshStandardMaterial) o.material.envMapIntensity = 0.9; });

// ---- Camera and input
const input = new Input();
const cam = new OrbitCam(camera, canvas);
cam.dist = 60;
input.onPress = (code) => {
  if (code === 'KeyC') cam.cycle();
  if (code === 'KeyM') player.body.ctl.hoist = player.body.ctl.hoist > 0.5 ? 0 : 1;
  if (code === 'KeyF') fireGuns();
  if (code === 'KeyG') hud.message(fleet.tryGrapple(player) ? t('grapple') : t('noGrapple'), 3);
  const oi = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(code);
  if (oi >= 0) { fleet.orders[player.side] = ORDERS[oi]; hud.message(t('orders')[oi], 2.5); }
};
// the player's bow guns: each fires when loaded, along the bow with the elevation set by aimElev
let aimElev = 0.015;
// the aiming line: where a ball from the first gun would come down (drawn while the guns are loaded)
const aimLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: 0xf2ede4, dashSize: 3, gapSize: 3, transparent: true, opacity: 0.55, depthWrite: false }));
aimLine.frustumCulled = false;
world.add(aimLine);
function updateAim() {
  const g = player.guns[0];
  aimLine.visible = !!g && battle;
  if (!aimLine.visible) return;
  const b = player.body;
  const muzzle = b.toWorld(new THREE.Vector3().copy(g.at).add(new THREE.Vector3(0, 0, 0.6)), new THREE.Vector3());
  const dir = new THREE.Vector3(0, Math.sin(aimElev), Math.cos(aimElev)).applyQuaternion(b.quat);
  const pts = gunnery.predict(g.type, muzzle, dir, b.vel, simT);
  aimLine.geometry.setFromPoints(pts); aimLine.computeLineDistances();
}
function fireGuns() {
  const b = player.body;
  if (!battle) return;
  for (const g of player.guns) {
    if (g.reload > 0) continue;
    const muzzle = b.toWorld(new THREE.Vector3().copy(g.at).add(new THREE.Vector3(0, 0, 0.6)), new THREE.Vector3());
    const dir = new THREE.Vector3(0, Math.sin(aimElev), Math.cos(aimElev)).applyQuaternion(b.quat);
    gunnery.fire(g.type, player, muzzle, dir, simT);
    g.reload = GUN[g.type].reload;
    g.kick = 0.01;
  }
}
const hud = makeHUD();
applyStatic();
document.getElementById('lang')?.addEventListener('click', (e) => { toggleLang(); e.currentTarget.blur(); });
// title card: the chosen battle starts at once if it is the one already set up behind the card, else the page reloads with it
let started = RENDER || QS.has('skip') || QS.has('alone');
const titleEl = document.getElementById('title');
if (started) { titleEl.style.transition = 'none'; titleEl.classList.add('gone'); }
for (const btn of document.querySelectorAll('.go')) {
  btn.disabled = false;
  btn.addEventListener('click', () => {
    if (btn.dataset.s !== SCEN) { const q = new URLSearchParams(location.search); q.set('s', btn.dataset.s); q.set('skip', ''); location.search = q.toString(); return; }
    started = true; titleEl.classList.add('gone');
  });
}
let ended = false;
let camShip = null;         // the camera follows the player's ship unless told otherwise
const sound = new Sound();
for (const evn of ['pointerdown', 'keydown']) addEventListener(evn, () => sound.start(), { once: true });
const _cr = new THREE.Vector3();
// distance and pan of a world point for the listener (the camera)
function ear(p) { _cr.set(1, 0, 0).applyQuaternion(camera.quaternion); const dx = p.x - camera.position.x, dz = p.z - camera.position.z, d = Math.hypot(dx, p.y - camera.position.y, dz) || 1; return [d, THREE.MathUtils.clamp((dx * _cr.x + dz * _cr.z) / d, -1, 1) * 0.8]; }
function sounds(dt, ev) {
  for (const e of ev) {
    if (e.kind === 'fire') { const [d, pan] = ear(e.at); sound.gun(d, pan, { oozutsu: 1, ishibiya: 0.4, teppo: 0.06 }[e.type] ?? 0.1); }
    else if (e.kind === 'splash' && e.type !== 'teppo') { const [d, pan] = ear(e.world); sound.splash(d, pan, e.type === 'oozutsu'); }
    else if (e.kind === 'hit' && e.type !== 'teppo') { const [d, pan] = ear(e.world); sound.strike(d, pan); }
  }
  let fire = 0;
  for (const s of ships) { const f = Math.max(...s.fire); if (f > 0) fire = Math.max(fire, f * Math.min(1, 60 / Math.max(s.body.pos.distanceTo(camera.position), 1))); }
  const b = player.body;
  sound.battle(dt, { beat: Math.round((b.ctl.beatL + b.ctl.beatR) / 2), stroke: b.stroke, fire, on: battle });
  sound.update(dt, { speed: b.speed, aw: b.appWind.length() || wind.speed, gust: wind.gust(b.pos.x, b.pos.z, simT), roll: b.heel, rollRate: b.angV.dot(b.forward(_cr.clone())), heave: b.vel.y,
    flog: b.sail.flog, force: b.sail.force, landDir: null, evening: false });
}
function battleStart() {
  if (battle) return;
  const enemies = ships.filter((s) => s.side !== player.side);
  const near = ships.some((a) => a.side === player.side && enemies.some((e) => e.body.pos.distanceTo(a.body.pos) < 950));
  if (!near) return;
  battle = true;
  hud.message(t('battle'), 5);
  sound.conch();
  for (const s of ships) { s.body.ctl.hoist = 0; if (!s.player) s.body.ctl.beatL = s.body.ctl.beatR = 2; }
}
// messages for what happens in the fleet (only the notable things)
let logN = 0;
function fleetNews() {
  for (; logN < fleet.log.length; logN++) {
    const e = fleet.log[logN];
    const k = t('kinds')[e.ship];
    if (e.kind === 'taken') hud.message(t('taken')(k), 4);
    else if (e.kind === 'sunk') hud.message(t('sunk')(k), 4);
    else if (e.kind === 'broken' && e.side !== player.side) hud.message(t('broken')(k), 3);
  }
  if (ended) return;
  const o = outcome(fleet, player);
  if (o) {
    ended = true;
    hud.message(`${t(o)}\n${t(o + 'Sub')}`, 20);
  }
}

const clipUnder = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
function renderReflection() {
  if (trees) trees.group.visible = false;
  world.scale.y = -1; world.updateMatrixWorld(true);
  shadows.uniforms.uMirror.value = -1;
  renderer.clippingPlanes = [clipUnder];
  renderer.setRenderTarget(rtRefl); renderer.render(scene, camera);
  renderer.clippingPlanes = [];
  world.scale.y = 1; world.updateMatrixWorld(true);
  if (trees) trees.group.visible = true;
  shadows.uniforms.uMirror.value = 1;
  renderer.setRenderTarget(null);
}

let simT = 0, acc = 0, accFar = 0;
const EXPOSURE = parseFloat(QS.get('ev') ?? '0.9');
function controls(dt) {
  const c = player.body.ctl, k = input.keys;
  if (k.KeyR) aimElev = Math.min(aimElev + dt * 0.05, 0.3);
  if (k.KeyV) aimElev = Math.max(aimElev - dt * 0.05, -0.06);
  if (k.KeyA) c.rudder = Math.min(c.rudder + dt * 0.8, 0.6);
  if (k.KeyD) c.rudder = Math.max(c.rudder - dt * 0.8, -0.6);
  if (!k.KeyA && !k.KeyD && input.autoCenter) c.rudder *= Math.exp(-dt * 0.8);
}
addEventListener('keydown', (e) => {
  const c = player.body.ctl;
  if (e.code === 'KeyW' && !e.repeat) { c.beatL = c.beatR = Math.min(Math.round((c.beatL + c.beatR) / 2) + 1, 3); }
  if (e.code === 'KeyS' && !e.repeat) { c.beatL = c.beatR = Math.max(Math.round((c.beatL + c.beatR) / 2) - 1, 0); }
});
// near ships (to the camera) get the full hull and the fine step; the rest are stepped at half the rate
function stepSim(dt) {
  controls(dt);
  for (const s of ships) s.body.setDetail(s === player || s.body.pos.distanceTo(camera.position) < 200);
  for (const s of ships) if (!s.alive) s.body.setDetail(false);
  acc += dt;
  while (acc >= DT) {
    acc -= DT; simT += DT;
    accFar += DT;
    const far = accFar >= 2 * DT - 1e-9;
    for (const s of ships) {
      if (!s.alive) continue;
      if (s.body.near) s.body.step(DT, simT);
      else if (far) s.body.step(2 * DT, simT);
    }
    if (far) accFar = 0;
  }
  U.uTime.value = simT;
  for (const s of ships) s.mastDown += THREE.MathUtils.clamp((s.body.ctl.hoist > 0.5 ? 0 : 1) - s.mastDown, -dt * 0.06, dt * 0.06);
}

let envAt = hour;
function advanceClock(dt) {
  if (window.__freezeClock || !started) return;
  hour += dt * TIME_SCALE / 3600;
  sunDirection(LAT, DAY, hour, sunDir); lightFromSun(); tide.setHour(hour);
  if (Math.abs(hour - envAt) > 0.25) { rebuildEnv(); envAt = hour; }
}
const _f = new THREE.Vector3();
function frame(dt) {
  advanceClock(dt);
  stepSim(dt);
  if (started) battleStart();
  const ev = gunnery.update(dt, simT, ships);
  if (started) fleet.update(dt, simT, ev);
  sounds(dt, ev);
  for (const s of ships) if (s.body.hoist > 0.02) s.body.ctl.brace = s.body.autoBrace();
  fx.setAmbient(hemi.color, hemi.groundColor);
  fx.update(dt, simT, camera);
  view.update(ships, camera.position, simT);
  crew.update(ships, camera.position, simT);
  const b = player.body;
  b.forward(_f);
  // the wake patch follows the player; the nearest ships press on it, and balls that landed ring out in it
  const near = ships.filter((s) => s.alive || s.body.pos.y > -2).sort((p, q) => p.body.pos.distanceToSquared(b.pos) - q.body.pos.distanceToSquared(b.pos)).slice(0, 8);
  wake.step(dt, b.pos, near.map((s) => { const f = s.body.forward(_f); return { pos: s.body.pos, fwd: new THREE.Vector2(f.x, f.z).normalize(), speed: Math.hypot(s.body.vel.x, s.body.vel.z), heave: s.body.heave, sub: s.alive ? 1 : 0.5, kind: KIND_N[s.kind] }; }),
    ev.filter((e) => e.kind === 'splash' && e.type !== 'teppo').map((e) => ({ x: e.world.x, z: e.world.z, r: e.type === 'oozutsu' ? 1.6 : 0.9, h: e.type === 'oozutsu' ? 0.9 : 0.4 })));
  cam.update(dt, camShip?.alive !== false && camShip ? camShip.body : b);
  updateAim();
  player.aimElev = aimElev;
  hud.update({ ship: player, hour, wind, tide, target: fleet.flagshipOf(player.side === 'A' ? 'B' : 'A') ?? fleet.nearestEnemy(player), fleet, dt });
  fleetNews();
  ocean.update(camera);
  islands.update(camera.position);
  trees?.update(camera.position);
  if (sunDir.angleTo(lastLandSun) > 0.003) { shadows.renderLand(new THREE.Vector3(b.pos.x, 0, b.pos.z)); lastLandSun.copy(sunDir); }
  skyU.uCloudT.value = simT;
  shadows.renderShip(new THREE.Vector3().copy(camera.position).lerp(cam.target, 0.8).setY(4));
  renderReflection();
  const adapt = 1 + 3.2 * THREE.MathUtils.smoothstep(-sunDir.y, -0.04, 0.16);
  post.render(scene, camera, { exposure: EXPOSURE * adapt, t: simT, overlay: waterScene, thresh: 1.6 * adapt });
}

let rscale = 1, dtSum = 0, dtN = 0;
function setScale(s) {
  rscale = s;
  const w = Math.round(W * PR * s), h = Math.round(H * PR * s);
  post.setSize(w, h);
  ocean.uniforms.uRefr.value = post.refr.texture;
  rtRefl.setSize(Math.round(w * 0.5), Math.round(h * 0.5));
  ocean.uniforms.uReflTexel.value.set(1 / rtRefl.width, 1 / rtRefl.height);
}
let last = performance.now();
function loop(now) {
  const dt = Math.min((now - last) / 1000, 0.1); last = now;
  frame(dt);
  dtSum += dt; dtN++;
  if (dtSum > 2) {
    const avg = dtSum / dtN;
    window.__fps = 1 / avg;
    if (avg > 0.021 && rscale > 0.61) setScale(Math.max(0.6, rscale - 0.1));
    else if (avg < 0.0135 && rscale < 0.99) setScale(Math.min(1, rscale + 0.1));
    dtSum = 0; dtN = 0;
  }
  requestAnimationFrame(loop);
}

// ---- probes for checks and recording (tools/probe.py)
const st = (s) => ({ kind: s.kind, pos: s.body.pos.toArray().map((v) => +v.toFixed(2)), speed: +s.body.speed.toFixed(2),
  heel: +(s.body.heel * 57.3).toFixed(1), pitch: +(s.body.pitch * 57.3).toFixed(1), heading: +(s.body.heading * 57.3).toFixed(1),
  mass: Math.round(s.body.mass), water: +s.body.water.toFixed(2), fatigue: +s.body.fatigue.toFixed(3), sunk: s.body.sunk });
window.__ships = ships;
window.__fleet = fleet;
window.__fire = fireGuns;
window.__aim = (e) => { aimElev = e; };
window.__renderer = renderer;
window.__state = () => ({ t: +simT.toFixed(2), hour: +hour.toFixed(3), player: st(player) });
window.__set = (o) => {
  if (o.hour !== undefined) { hour = o.hour; sunDirection(LAT, DAY, hour, sunDir); lightFromSun(); tide.setHour(hour); rebuildEnv(); envAt = hour; }
  if (o.cam) cam.set(o.cam);
  if (o.follow !== undefined) camShip = o.follow === null ? null : ships[o.follow];
  if (o.ctl) Object.assign(player.body.ctl, o.ctl);
  if (o.place) player.body.place(...o.place);
  if (o.mastDown !== undefined) for (const s of ships) s.mastDown = o.mastDown;
  if (o.burn) ships[o.burn[0]].burn = o.burn.slice(1);
  if (o.hide) for (const k of o.hide) ({ trees: trees?.group, land: islands.group, ships: view.group, ocean: ocean.mesh })[k].visible = false;
  if (o.show) for (const k of o.show) ({ trees: trees?.group, land: islands.group, ships: view.group, ocean: ocean.mesh })[k].visible = true;
  if (o.seaK !== undefined) { for (const s of ships) s.body.seaK = o.seaK; seaU.uSeaK.value = o.seaK; }
  if (o.wind !== undefined) wind.set(o.wind, wind.dir);
};
// physics only: step one ship (index i, default the player) for sec seconds; returns its state every 10 s
window.__sim = (sec, ctl, i = 0) => {
  const s = ships[i];
  if (ctl) Object.assign(s.body.ctl, ctl);
  const out = [];
  s.body.setDetail(true);
  for (let n = 0; n < sec * 120; n++) {
    simT += DT; s.body.step(DT, simT);
    if (n % 1200 === 0) out.push({ t: +simT.toFixed(1), ...st(s) });
  }
  U.uTime.value = simT;
  out.push({ t: +simT.toFixed(1), ...st(s) });
  return out;
};
// fast-forward the battle without drawing (physics, captains, guns): for checking a whole fight in a few seconds
window.__fast = (sec, dt = 1 / 30) => {
  started = true;
  for (let k = 0; k < sec / dt; k++) {
    advanceClock(dt); stepSim(dt); battleStart();
    const ev = gunnery.update(dt, simT, ships);
    fleet.update(dt, simT, ev);
    for (const s of ships) if (s.body.hoist > 0.02) s.body.ctl.brace = s.body.autoBrace();
    fx.update(dt, simT, camera);
    fleetNews();
  }
  const sum = (side) => { const a = ships.filter((s) => s.side === side); return { n: a.length, alive: a.filter((s) => s.alive).length, taken: a.filter((s) => s.taken).length, broken: a.filter((s) => s.broken).length,
    fighters: Math.round(a.reduce((q, s) => q + s.fighters, 0)), water: +a.reduce((q, s) => q + s.body.water, 0).toFixed(1), fire: +a.reduce((q, s) => q + s.fire.reduce((x, y) => x + y, 0), 0).toFixed(2) }; };
  const B = ships.filter((s) => s.side === 'B'), A = ships.filter((s) => s.side === 'A');
  const gap = Math.min(...A.map((a) => Math.min(...B.map((b) => a.body.pos.distanceTo(b.body.pos)))));
  return { t: +simT.toFixed(0), hour: +hour.toFixed(2), battle, ended, gap: Math.round(gap), A: sum('A'), B: sum('B'), log: fleet.log.length };
};
window.__renderAt = (f, fps) => {
  const target = f / fps;
  while (simT < target - 1e-6) frame(Math.min(1 / fps, target - simT));
  return window.__state();
};
window.__ready = true;
if (!RENDER) requestAnimationFrame(loop);
