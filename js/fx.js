// טקסטורות, שמיים, חלקיקים ושרשרת
import * as THREE from 'three';

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

const cache = {};
export const tex = {
  get grid() {
    return (cache.grid ||= canvasTex(256, 256, (g, w) => {
      g.fillStyle = '#aab4cc'; g.fillRect(0, 0, w, w);
      g.fillStyle = '#c9d2e6'; g.fillRect(10, 10, w - 20, w - 20);
      g.strokeStyle = '#59647f'; g.lineWidth = 6; g.strokeRect(0, 0, w, w);
      g.strokeStyle = '#e8eefc'; g.lineWidth = 2; g.strokeRect(10, 10, w - 20, w - 20);
      g.fillStyle = '#7f8aa6';
      for (const [x, y] of [[26, 26], [w - 26, 26], [26, w - 26], [w - 26, w - 26]]) { g.beginPath(); g.arc(x, y, 5, 0, 7); g.fill(); }
    }));
  },
  get stripes() {
    return (cache.stripes ||= canvasTex(128, 128, (g, w) => {
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, w);
      g.fillStyle = '#2a2a33';
      for (let i = -w; i < w * 2; i += 64) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 32, 0); g.lineTo(i + 32 - w, w); g.lineTo(i - w, w); g.fill(); }
    }));
  },
  get checker() {
    return (cache.checker ||= canvasTex(128, 128, (g, w) => {
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { g.fillStyle = (x + y) % 2 ? '#111' : '#fff'; g.fillRect(x * 32, y * 32, 32, 32); }
    }));
  },
  get chevron() {
    return (cache.chevron ||= canvasTex(128, 128, (g, w) => {
      g.clearRect(0, 0, w, w);
      g.strokeStyle = '#fff'; g.lineWidth = 16; g.lineJoin = 'miter';
      for (const y of [44, 108]) { g.beginPath(); g.moveTo(14, y); g.lineTo(64, y - 38); g.lineTo(114, y); g.stroke(); }
    }));
  },
  get glow() {
    return (cache.glow ||= canvasTex(64, 64, (g) => {
      const gr = g.createRadialGradient(32, 32, 1, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    }));
  },
};

export class Sky {
  constructor(scene, top = 0x0a1a5c, mid = 0x6a3fb8, bot = 0x05060f) {
    this.group = new THREE.Group();
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color(top) }, mid: { value: new THREE.Color(mid) }, bot: { value: new THREE.Color(bot) } },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 bot; varying vec3 vDir;
        void main(){ float h = normalize(vDir).y;
          vec3 c = h > 0.0 ? mix(mid, top, pow(h, 0.5)) : mix(mid, bot, pow(-h, 0.45));
          c += vec3(1.0, 0.45, 0.2) * 0.35 * exp(-abs(h) * 9.0);
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1500, 32, 16), mat);
    dome.renderOrder = -10;
    this.group.add(dome);
    const n = 1400, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      pos.set([Math.cos(a) * s * 1400, u * 1400, Math.sin(a) * s * 1400], i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: new THREE.Color(0xbfd4ff).multiplyScalar(1.6), size: 2.2, sizeAttenuation: false, fog: false, depthWrite: false }));
    this.group.add(stars);
    this.group.traverse((o) => (o.frustumCulled = false));
    scene.add(this.group);
  }
  update(camera) { this.group.position.copy(camera.position); }
}

export class Particles {
  constructor(scene, n = 700) {
    this.n = n; this.i = 0;
    this.pos = new Float32Array(n * 3).fill(1e6);
    this.col = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.base = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.max = new Float32Array(n).fill(1);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.points = new THREE.Points(g, new THREE.PointsMaterial({
      size: 1.1, map: tex.glow, vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);
  }
  emit(p, v, color, life = 0.5, k = 2) {
    const i = this.i; this.i = (i + 1) % this.n;
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([v.x, v.y, v.z], i * 3);
    this.base.set([color.r * k, color.g * k, color.b * k], i * 3);
    this.life[i] = this.max[i] = life;
  }
  update(dt) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const j = i * 3, f = Math.max(0, this.life[i] / this.max[i]);
      if (f <= 0) { this.pos[j] = 1e6; this.col[j] = this.col[j + 1] = this.col[j + 2] = 0; continue; }
      this.pos[j] += this.vel[j] * dt; this.pos[j + 1] += this.vel[j + 1] * dt; this.pos[j + 2] += this.vel[j + 2] * dt;
      this.col[j] = this.base[j] * f; this.col[j + 1] = this.base[j + 1] * f; this.col[j + 2] = this.base[j + 2] * f;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }
}

const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _t = new THREE.Vector3(), _s = new THREE.Vector3(1.5, 1, 1), _x = new THREE.Vector3(1, 0, 0), _a = new THREE.Vector3();

export class ChainVisual {
  constructor(scene, length) {
    this.L = length;
    this.n = Math.ceil(length / 0.42);
    this.mat = new THREE.MeshStandardMaterial({ color: 0xd5dcea, metalness: 1, roughness: 0.25, emissive: 0x000000, envMapIntensity: 1.5 });
    this.mesh = new THREE.InstancedMesh(new THREE.TorusGeometry(0.2, 0.055, 6, 10), this.mat, this.n);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    scene.add(this.mesh);
  }
  update(a, b, visible) {
    this.mesh.visible = visible;
    if (!visible) return;
    const d = a.distanceTo(b);
    // כשהשרשרת רפויה היא שוקעת מעט (לא חודרת לרצפה) ומוצגות רק החוליות שנחוצות למרחק
    const sag = Math.min(0.75, Math.max(0, this.L - d) * 0.5);
    const tension = Math.max(0, Math.min(1, (d - this.L) / 1.5 + (d > this.L ? 0.3 : 0)));
    this.mat.emissive.setRGB(tension * 0.9, tension * 0.2, 0);
    const pt = (t, out) => out.lerpVectors(a, b, t).setY(out.y - sag * 4 * t * (1 - t));
    const count = Math.max(2, Math.min(this.n, Math.ceil((d + sag) / 0.42)));
    this.mesh.count = count;
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count;
      pt(t, _p);
      pt(Math.min(1, t + 0.02), _t); pt(Math.max(0, t - 0.02), _a);
      _t.sub(_a).normalize();
      _q.setFromUnitVectors(_x, _t);
      if (i % 2) _q.multiply(_q2.setFromAxisAngle(_x, Math.PI / 2));
      this.mesh.setMatrixAt(i, _m.compose(_p, _q, _s));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  dispose() { this.mesh.geometry.dispose(); this.mat.dispose(); this.mesh.removeFromParent(); }
}
