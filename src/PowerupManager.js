import * as THREE from 'three';

const POWERUP_TYPES = [
  { type: 'HEALTH',     color: 0xff2244, name: 'MAX HEALTH' },
  { type: 'AMMO',       color: 0x00ff88, name: 'MAX AMMO'   },
  { type: 'GRENADE',    color: 0x00ffff, name: 'MAX GRENADES' },
];

export class PowerupManager {
  constructor(scene, player) {
    this.scene  = scene;
    this.player = player;
    this.powerups = [];

    this.spawnedHealthThisWave = 0;
    this.spawnedAmmoThisWave   = 0;
    this.spawnedGrenadeThisWave = 0;
  }

  resetForWave() {
    this.spawnedHealthThisWave = 0;
    this.spawnedAmmoThisWave   = 0;
    this.spawnedGrenadeThisWave = 0;
  }

  reset() {
    this.powerups.forEach(p => {
      this.scene.remove(p.mesh);
    });
    this.powerups = [];
    this.resetForWave();
  }

  spawnAt(position, typeOverride = null) {
    // Pick type
    let data;
    if (typeOverride) {
      data = POWERUP_TYPES.find(p => p.type === typeOverride);
    } else {
      data = POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)];
    }
    if (!data) return;

    // Wave limit: max 1 health + 2 ammo + 1 grenade per wave
    if (data.type === 'HEALTH') {
      if (this.spawnedHealthThisWave >= 1) return;
      this.spawnedHealthThisWave++;
    } else if (data.type === 'AMMO') {
      if (this.spawnedAmmoThisWave >= 2) return;
      this.spawnedAmmoThisWave++;
    } else if (data.type === 'GRENADE') {
      if (this.spawnedGrenadeThisWave >= 1) return;
      this.spawnedGrenadeThisWave++;
    }

    const group = new THREE.Group();

    if (data.type === 'HEALTH') {
      this._buildHealthCrate(group);
    } else if (data.type === 'AMMO') {
      this._buildAmmoCrate(group);
    } else if (data.type === 'GRENADE') {
      this._buildGrenadeCrate(group);
    }

    // Snap to floor above the death position
    const sm      = this.player.sceneManager;
    const downRay = new THREE.Raycaster(
      new THREE.Vector3(position.x, position.y + 5, position.z),
      new THREE.Vector3(0, -1, 0)
    );
    const hits = downRay.intersectObjects(sm.collidableMeshes, false);
    const floorY = hits.length > 0 ? hits[0].point.y : (position.y || 0);

    group.position.set(position.x, floorY + 0.7, position.z);

    this.scene.add(group);
    this.powerups.push({
      mesh:    group,
      type:    data.type,
      name:    data.name,
      color:   data.color,
      timer:   30.0,
      baseY:   floorY + 0.7,
    });
  }

  /**
   * Spawn a small pickup box dropped by enemies.
   * 33% chance each for AMMO, HEALTH, or GRENADE.
   */
  spawnEnemyDropAt(position, typeOverride = null) {
    let type, color, name;
    if (typeOverride === 'AMMO') {
      type = 'AMMO'; color = 0x00ff88; name = 'MAX AMMO';
    } else if (typeOverride === 'HEALTH') {
      type = 'HEALTH'; color = 0xff2244; name = 'MAX HEALTH';
    } else if (typeOverride === 'GRENADE') {
      type = 'GRENADE'; color = 0x00ffff; name = 'MAX GRENADES';
    } else {
      const r = Math.random();
      if (r < 0.333) {
        type = 'AMMO'; color = 0x00ff88; name = 'MAX AMMO';
      } else if (r < 0.666) {
        type = 'HEALTH'; color = 0xff2244; name = 'MAX HEALTH';
      } else {
        type = 'GRENADE'; color = 0x00ffff; name = 'MAX GRENADES';
      }
    }

    const group = new THREE.Group();
    if (type === 'HEALTH') {
      this._buildHealthCrate(group);
    } else if (type === 'AMMO') {
      this._buildAmmoCrate(group);
    } else {
      this._buildGrenadeCrate(group);
    }
    // Scale small drops to 50% size
    group.scale.setScalar(0.5);

    const sm      = this.player.sceneManager;
    const downRay = new THREE.Raycaster(
      new THREE.Vector3(position.x, position.y + 5, position.z),
      new THREE.Vector3(0, -1, 0)
    );
    const hits = downRay.intersectObjects(sm.collidableMeshes, false);
    const floorY = hits.length > 0 ? hits[0].point.y : (position.y || 0);

    group.position.set(position.x, floorY + 0.4, position.z);
    this.scene.add(group);

    this.powerups.push({
      mesh:   group,
      type:   type,
      name:   name,
      color:  color,
      timer:  Infinity, // Never despawns
      baseY:  floorY + 0.4
    });
  }

  // ─── Crate builders ──────────────────────────────────────────

  _buildHealthCrate(group) {
    // White medic box
    const boxGeo = new THREE.BoxGeometry(1.3, 1.3, 1.3);
    const boxMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.4, metalness: 0.1 });
    const box    = new THREE.Mesh(boxGeo, boxMat);
    group.add(box);

    // Red cross on all 6 faces via thin boxes
    const crossMat = new THREE.MeshStandardMaterial({
      color: 0xff1133,
      emissive: 0xff1133,
      emissiveIntensity: 0.6,
    });
    const cross = (w, h, d) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), crossMat);

    const OFFSET = 0.66;
    // Front & back
    [OFFSET, -OFFSET].forEach(z => {
      const v = cross(0.25, 0.75, 0.05); v.position.z = z; group.add(v);
      const h = cross(0.75, 0.25, 0.05); h.position.z = z; group.add(h);
    });
    // Left & right
    [OFFSET, -OFFSET].forEach(x => {
      const v = cross(0.05, 0.75, 0.25); v.position.x = x; group.add(v);
      const h = cross(0.05, 0.25, 0.75); h.position.x = x; group.add(h);
    });
    // Top & bottom
    [OFFSET, -OFFSET].forEach(y => {
      const v = cross(0.25, 0.05, 0.75); v.position.y = y; group.add(v);
      const h = cross(0.75, 0.05, 0.25); h.position.y = y; group.add(h);
    });

    // Strong red glow
    const glow = new THREE.PointLight(0xff2244, 4, 14);
    group.add(glow);
  }

  _buildAmmoCrate(group) {
    // Olive drab ammo box
    const boxGeo = new THREE.BoxGeometry(1.5, 1.0, 1.0);
    const boxMat = new THREE.MeshStandardMaterial({
      color: 0x2e4225,
      roughness: 0.85,
      metalness: 0.15,
    });
    const box = new THREE.Mesh(boxGeo, boxMat);
    group.add(box);

    // Metal straps
    const strapMat = new THREE.MeshStandardMaterial({ color: 0x888866, metalness: 0.8, roughness: 0.4 });
    const strap = (w, h, d) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), strapMat);
    group.add(strap(1.55, 1.05, 0.15));           // front strap
    group.add(strap(0.15, 1.05, 1.05));           // center strap
    group.add(strap(1.55, 0.08, 1.05)); // top rim
    const bottomRim = strap(1.55, 0.08, 1.05);
    bottomRim.position.y = -0.46;
    group.add(bottomRim);

    // Latch
    const latch = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.08), strapMat);
    latch.position.set(0, 0, 0.55);
    group.add(latch);

    // Green glow
    const glow = new THREE.PointLight(0x00ff88, 4, 14);
    group.add(glow);
  }

  _buildGrenadeCrate(group) {
    // Dark gray box
    const boxGeo = new THREE.BoxGeometry(1.2, 1.2, 1.2);
    const boxMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6, metalness: 0.4 });
    const box    = new THREE.Mesh(boxGeo, boxMat);
    group.add(box);

    // Cyan glowing lines
    const lineMat = new THREE.MeshStandardMaterial({
      color: 0x00ffff,
      emissive: 0x00ffff,
      emissiveIntensity: 0.8,
    });
    const line = (w, h, d) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), lineMat);
    group.add(line(1.25, 0.1, 1.25));
    group.add(line(0.1, 1.25, 1.25));
    group.add(line(1.25, 1.25, 0.1));

    // Cyan glow light
    const glow = new THREE.PointLight(0x00ffff, 3, 12);
    group.add(glow);
  }


  // ─────────────────────────────────────────────────────────────
  update(delta) {
    const playerPos = this.player.camera.position;
    const t = performance.now() * 0.001;

    for (let i = this.powerups.length - 1; i >= 0; i--) {
      const p = this.powerups[i];

      // Float + slow spin
      const floatAmp = 0.22;
      p.mesh.position.y  = p.baseY + Math.sin(t * 1.4 + i) * floatAmp;
      p.mesh.rotation.y += delta * 0.9;

      // Pulse scale
      const pulse = 1.0 + Math.sin(t * 3.0 + i * 1.5) * 0.04;
      p.mesh.scale.setScalar(pulse);

      // Despawn logic removed completely

      // Pickup radius
      const pickupRadius = 3.0;
      if (p.mesh.position.distanceTo(playerPos) < pickupRadius) {
        this.player.applyPowerup(p.type);
        if (this.player.ui?.showNotification) {
          this.player.ui.showNotification(p.name, '#' + p.color.toString(16).padStart(6, '0'));
        }
        this.scene.remove(p.mesh);
        this.powerups.splice(i, 1);
      }
    }
  }
}
