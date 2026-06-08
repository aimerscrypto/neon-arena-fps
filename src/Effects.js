/**
 * Effects – Fully pooled particle and bullet-trail system.
 * Zero allocations in the hot update path. All objects are pre-created
 * and recycled from fixed-size pools.
 */
import * as THREE from 'three';

// ── Pool sizes (tune these to cap memory vs. visual quality) ──────
const PARTICLE_POOL  = 50;
const TRAIL_POOL     = 16;

// Shared geometry for every particle (one draw-call setup, reused forever)
const _particleGeo = new THREE.BoxGeometry(0.12, 0.12, 0.12);
const _ringGeo = new THREE.TorusGeometry(1, 0.05, 4, 24);
_ringGeo.rotateX(Math.PI / 2);

/** Creates a mutable 2-point line geometry. */
function _makeTrailGeo() {
  const arr = new Float32Array(6); // 2 vertices × 3 floats
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  return geo;
}

// Module-level reusable scratch vector (shared across all createImpact calls)
const _scratch = new THREE.Vector3();

export class Effects {
  constructor(scene, camera) {
    this.scene  = scene;
    this.camera = camera;

    // Camera shake state
    this.shakeIntensity = 0;
    this.shakeDecay     = 6.0;
    this.shakeTime      = 0;

    // ── Pre-allocate particle pool ────────────────────────────────
    this._pPool  = [];   // available (idle) particles
    this._pActive = [];  // currently animating particles

    for (let i = 0; i < PARTICLE_POOL; i++) {
      const mat  = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const mesh = new THREE.Mesh(_particleGeo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false; // no bounding-sphere maintenance needed
      scene.add(mesh);
      this._pPool.push({ mesh, mat, velocity: new THREE.Vector3(), life: 0, maxLife: 1 });
    }

    // ── Pre-allocate trail pool ───────────────────────────────────
    this._tPool  = [];
    this._tActive = [];

    for (let i = 0; i < TRAIL_POOL; i++) {
      const geo  = _makeTrailGeo();
      const mat  = new THREE.LineBasicMaterial({ color: 0x00f3ff, transparent: true, opacity: 1 });
      const line = new THREE.Line(geo, mat);
      line.visible = false;
      line.frustumCulled = false;
      scene.add(line);
      this._tPool.push({ geo, mat, line, life: 0, maxLife: 1 });
    }

    // ── Pre-allocate ring pool ────────────────────────────────────
    this._rPool = [];
    this._rActive = [];
    for (let i = 0; i < 4; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0x00f3ff, transparent: true, opacity: 1 });
      const mesh = new THREE.Mesh(_ringGeo, mat);
      mesh.visible = false;
      scene.add(mesh);
      this._rPool.push({ mesh, mat, life: 0, maxLife: 0.4 });
    }

    // ── Pools initialized ─────────────────────────────────────────
  }

  // ── Pool helpers (zero allocation) ───────────────────────────────

  _pGet()  { return this._pPool.length  ? this._pPool.pop()  : null; }
  _tGet()  { return this._tPool.length  ? this._tPool.pop()  : null; }

  _pFree(p) { p.mesh.visible = false; this._pPool.push(p); }
  _tFree(t) { t.line.visible = false; this._tPool.push(t); }

  // ── Main update (zero allocation) ────────────────────────────────

  update(delta) {
    const grav = 20 * delta;

    // Particles (iterate backwards so splicing is safe)
    for (let i = this._pActive.length - 1; i >= 0; i--) {
      const p = this._pActive[i];
      p.velocity.y -= grav;
      p.mesh.position.x += p.velocity.x * delta;
      p.mesh.position.y += p.velocity.y * delta;
      p.mesh.position.z += p.velocity.z * delta;
      p.life -= delta;
      if (p.life <= 0) {
        this._pActive.splice(i, 1);
        this._pFree(p);
      } else {
        p.mesh.scale.setScalar(p.life / p.maxLife);
      }
    }

    // Trails
    for (let i = this._tActive.length - 1; i >= 0; i--) {
      const t = this._tActive[i];
      t.life -= delta;
      if (t.life <= 0) {
        this._tActive.splice(i, 1);
        this._tFree(t);
      } else {
        t.mat.opacity = (t.life / t.maxLife) * 0.7;
      }
    }

    // Rings
    for (let i = this._rActive.length - 1; i >= 0; i--) {
      const r = this._rActive[i];
      r.life -= delta;
      if (r.life <= 0) {
        this._rActive.splice(i, 1);
        r.mesh.visible = false;
        this._rPool.push(r);
      } else {
        const pct = 1.0 - (r.life / r.maxLife);
        r.mesh.scale.setScalar(pct * 8 + 0.1);
        r.mat.opacity = 1.0 - pct;
      }
    }

    // Camera shake (no allocation)
    if (this.shakeIntensity > 0) {
      this.shakeTime += delta * 30;
      this.camera.position.x += Math.sin(this.shakeTime * 1.7) * this.shakeIntensity * delta;
      this.camera.position.y += Math.cos(this.shakeTime * 2.3) * this.shakeIntensity * delta;
      this.shakeIntensity = Math.max(0, this.shakeIntensity - this.shakeDecay * delta);
    }
  }

  // ── Public API ────────────────────────────────────────────────────

  /**
   * Burst of 16 particles for enemy death.
   * Reduced from 40 — still looks great, half the cost.
   */
  createExplosion(position, colorHex) {
    const N      = Math.min(16, this._pPool.length);
    const colors = [colorHex, 0xffaa00, 0xffffff];

    for (let i = 0; i < N; i++) {
      const p = this._pGet();
      if (!p) break;

      p.mat.color.setHex(colors[i % colors.length]);
      p.mesh.position.copy(position);
      p.mesh.scale.setScalar(1);
      p.mesh.visible = true;

      const spd = 4 + Math.random() * 12;
      p.velocity.set(
        (Math.random() - 0.5) * spd,
        (Math.random() * 0.6 + 0.2) * spd,
        (Math.random() - 0.5) * spd
      );
      p.maxLife = 0.3 + Math.random() * 0.45;
      p.life    = p.maxLife;

      this._pActive.push(p);
    }
  }

  /**
   * Large explosion for grenade detonation.
   * 28 particles with wider spread and longer life than createExplosion.
   */
  createLargeExplosion(position, colorHex = 0xff8800) {
    const N      = Math.min(28, this._pPool.length);
    const colors = [colorHex, 0xff4400, 0xffcc00, 0xffffff];

    for (let i = 0; i < N; i++) {
      const p = this._pGet();
      if (!p) break;

      p.mat.color.setHex(colors[i % colors.length]);
      p.mesh.position.copy(position);
      // Slight random offset so particles don't all start at exact same point
      p.mesh.position.x += (Math.random() - 0.5) * 0.8;
      p.mesh.position.y += Math.random() * 0.5;
      p.mesh.position.z += (Math.random() - 0.5) * 0.8;
      p.mesh.scale.setScalar(1.4);
      p.mesh.visible = true;

      const spd = 8 + Math.random() * 20;
      p.velocity.set(
        (Math.random() - 0.5) * spd,
        (Math.random() * 0.7 + 0.3) * spd,
        (Math.random() - 0.5) * spd
      );
      p.maxLife = 0.5 + Math.random() * 0.7;
      p.life    = p.maxLife;

      this._pActive.push(p);
    }
  }

  createExpandingRing(position, colorHex) {
    const r = this._rPool.length ? this._rPool.pop() : null;
    if (!r) return;
    
    if (colorHex) r.mat.color.setHex(colorHex);
    r.mesh.position.copy(position);
    r.mesh.scale.setScalar(0.1);
    r.mat.opacity = 1.0;
    r.maxLife = 0.4;
    r.life = 0.4;
    r.mesh.visible = true;
    
    this._rActive.push(r);
  }

  /**
   * Small spark burst for bullet impacts on surfaces.
   * Reduced from 14 → 7 sparks.
   */
  createImpact(position, normal) {
    const N = Math.min(7, this._pPool.length);

    for (let i = 0; i < N; i++) {
      const p = this._pGet();
      if (!p) break;

      p.mat.color.setHex(i < 3 ? 0xffdd66 : 0xbbbbbb);
      p.mesh.position.copy(position);
      if (normal) p.mesh.position.addScaledVector(normal, 0.03);
      p.mesh.scale.setScalar(1);
      p.mesh.visible = true;

      // Reuse scratch vector to avoid allocation
      _scratch.set(Math.random() - 0.5, Math.random() * 0.6 + 0.1, Math.random() - 0.5).normalize();
      if (normal) _scratch.add(normal).normalize();
      const spd = 3 + Math.random() * 6;
      p.velocity.set(_scratch.x * spd, _scratch.y * spd, _scratch.z * spd);

      p.maxLife = 0.12 + Math.random() * 0.16;
      p.life    = p.maxLife;

      this._pActive.push(p);
    }
  }

  /**
   * Bullet tracer line between muzzle and hit point.
   * Updates pre-allocated BufferGeometry — zero allocation.
   */
  createBulletTrail(startPos, endPos, size = 1.0, colorHex = 0x00ffff) {
    const t = this._tGet();
    if (!t) return;

    // Write directly into the pre-allocated Float32Array
    const arr = t.geo.getAttribute('position').array;
    arr[0] = startPos.x; arr[1] = startPos.y; arr[2] = startPos.z;
    arr[3] = endPos.x;   arr[4] = endPos.y;   arr[5] = endPos.z;
    t.geo.getAttribute('position').needsUpdate = true;

    t.mat.color.setHex(colorHex);
    t.mat.linewidth = size; // WebGL support varies

    t.mat.opacity  = 0.7;
    t.maxLife      = 0.07;
    t.life         = 0.07;
    t.line.visible = true;

    this._tActive.push(t);
  }

  /** Add to shake; clamps to avoid over-shaking on rapid hits. */
  shakeCamera(intensity) {
    if (intensity > this.shakeIntensity) this.shakeIntensity = intensity;
  }

  /** Full cleanup for page unload or game reset. */
  dispose() {
    const allP = [...this._pActive, ...this._pPool];
    allP.forEach(p => { this.scene.remove(p.mesh); p.mat.dispose(); });

    const allT = [...this._tActive, ...this._tPool];
    allT.forEach(t => { this.scene.remove(t.line); t.geo.dispose(); t.mat.dispose(); });

    const allR = [...this._rActive, ...this._rPool];
    allR.forEach(r => { this.scene.remove(r.mesh); r.mat.dispose(); });
  }
}
