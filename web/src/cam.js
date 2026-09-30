// Camera: orbits the ship (drag to look around, wheel for distance) and follows its heading slowly,
// so the view settles behind the ship when left alone. The height is kept above the waves.
import * as THREE from 'three';

export class OrbitCam {
  constructor(camera, el) {
    this.c = camera;
    this.yaw = 2.5; this.pitch = 0.12; this.dist = 55; this.follow = true;
    this.home = { yaw: 0.5, pitch: 0.16, dist: 48 };
    this.target = new THREE.Vector3(0, 6, 0);
    this.fov = camera.fov;
    let drag = false, lx = 0, ly = 0, idle = 99;
    this.idle = () => idle;
    el.addEventListener('pointerdown', (e) => { drag = true; lx = e.clientX; ly = e.clientY; el.setPointerCapture(e.pointerId); });
    el.addEventListener('pointerup', () => { drag = false; });
    el.addEventListener('pointermove', (e) => {
      if (!drag) return;
      this.yaw -= (e.clientX - lx) * 0.005; this.pitch = THREE.MathUtils.clamp(this.pitch + (e.clientY - ly) * 0.004, -0.05, 1.3);
      lx = e.clientX; ly = e.clientY; idle = 0;
    });
    el.addEventListener('wheel', (e) => { this.dist = THREE.MathUtils.clamp(this.dist * Math.exp(e.deltaY * 0.001), 12, 400); e.preventDefault(); }, { passive: false });
    this._tick = (dt) => { idle += dt; };
  }
  set(o) { Object.assign(this, o); }
  // C cycles the view: behind the ship, on deck at the stern (the master's place), far off the beam
  cycle() {
    const modes = [{ yaw: 0.5, pitch: 0.16, dist: 48 }, { yaw: 0, pitch: 0.05, dist: 12 }, { yaw: 1.6, pitch: 0.08, dist: 160 }];
    this.mode = ((this.mode ?? 0) + 1) % modes.length;
    Object.assign(this, modes[this.mode]);
  }
  update(dt, boat) {
    this._tick(dt);
    // left alone for a while (and under way), the view drifts back behind the ship
    if (this.idle() > 10 && boat.speed > 0.8 && !this.mode) {
      const k = 1 - Math.exp(-dt * 0.25);
      const dy = ((this.home.yaw - this.yaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      this.yaw += dy * k; this.pitch += (this.home.pitch - this.pitch) * k; this.dist += (this.home.dist - this.dist) * k;
    }
    // relative yaw is kept in the ship's frame, so the view turns with the ship
    const hd = boat.heading;
    const p = boat.pos;
    this.target.lerp(new THREE.Vector3(p.x, p.y + 6.5, p.z), 1 - Math.exp(-dt * 4));
    const a = hd + Math.PI + this.yaw;
    const h = Math.sin(this.pitch) * this.dist, r = Math.cos(this.pitch) * this.dist;
    const pos = new THREE.Vector3(this.target.x + Math.sin(a) * r, this.target.y + h, this.target.z + Math.cos(a) * r);
    pos.y = Math.max(pos.y, 1.6);
    this.c.position.copy(pos);
    this.c.lookAt(this.target);
    this.c.updateMatrixWorld();
  }
}
