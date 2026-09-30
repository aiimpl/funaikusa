// Tidal stream. The Seto Inland Sea fills and empties along its length twice a day (semi-diurnal, 12.42 h): the flood
// runs one way along the east-west axis, the ebb the other. In the open water it is gentle (~0.3 m/s at its strongest);
// squeezed through a narrow strait it runs several times faster (here up to ~2 m/s, 4 knots), and where the fast
// water meets the slack the surface shows a tide line (shiome): a seam of foam and choppy water.
// The same field drives the ship (drag against moving water) and the water shader. Written in JS and GLSL.
import * as THREE from 'three';

export const tideGLSL = /* glsl */`
uniform float uTide;          // signed strength: +1 = full flood (running east), -1 = full ebb
uniform vec4 uStrait;         // x, z, direction (rad), half-width
vec2 tideAt(vec2 p){
  vec2 base = vec2(0.3 * uTide, 0.0);
  vec2 d = vec2(cos(uStrait.z), sin(uStrait.z)), a = vec2(-d.y, d.x);
  vec2 q = p - uStrait.xy;
  float along = dot(q, d), across = dot(q, a);
  float k = exp(-pow(across / uStrait.w, 2.0)) * exp(-pow(along / 1100.0, 2.0));
  float sgn = sign(dot(d, vec2(1.0, 0.0)) + 1e-4);       // the flood runs east through the strait too
  return base * (1.0 - k) + d * sgn * uTide * 4.2 * k;
}
// how sharply the stream changes across here (0 = uniform): the tide line
float tideShear(vec2 p){
  float e = 12.0;
  vec2 a = tideAt(p + vec2(e, 0.0)) - tideAt(p - vec2(e, 0.0));
  vec2 b = tideAt(p + vec2(0.0, e)) - tideAt(p - vec2(0.0, e));
  return (length(a) + length(b)) / (2.0 * e);
}
`;

export class Tide {
  constructor(strait) {
    this.s = strait;
    this.uniforms = { uTide: { value: 0 }, uStrait: { value: new THREE.Vector4(strait.x, strait.z, strait.dir, strait.width * 0.5) } };
    this.phase0 = 0.25;       // tide phase at 0:00 (fraction of a cycle)
  }
  // hour of day -> signed strength (sinusoid of the 12.42 h cycle)
  setHour(hour) {
    const ph = hour / 12.42 + this.phase0;
    this.uniforms.uTide.value = Math.sin(ph * Math.PI * 2);
    // height of the tide (m) for the quay steps, +-1.6 m (a spring tide on the Seto coast is about 3 m)
    this.height = 1.6 * Math.cos(ph * Math.PI * 2);
  }
  at(x, z, out = { x: 0, z: 0 }) {
    const T = this.uniforms.uTide.value, s = this.s;
    const dx = Math.cos(s.dir), dz = Math.sin(s.dir);
    const qx = x - s.x, qz = z - s.z;
    const along = qx * dx + qz * dz, across = -qx * dz + qz * dx;
    const k = Math.exp(-((across / (s.width * 0.5)) ** 2)) * Math.exp(-((along / 1100) ** 2));
    const sgn = Math.sign(dx + 1e-4);
    out.x = 0.3 * T * (1 - k) + dx * sgn * T * 4.2 * k;
    out.z = dz * sgn * T * 4.2 * k;
    return out;
  }
}
