/**
 * Player – First-person controller with ADS, reload, sprint, and multi-weapon system.
 *
 * Optimizations:
 * - All hot-path Vector3 / Raycaster allocations replaced with cached instances.
 * - document.getElementById() cached once in constructor.
 * - camera.updateProjectionMatrix() skipped when FOV is unchanged.
 * - Shoot() collidables array reused (no spread/push-spread every shot).
 * - Muzzle-flash via intensity timer instead of setTimeout.
 * - ADS vignette DOM write skipped when value hasn't changed meaningfully.
 */
import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';

// Module-level constant directions shared across all calls
const _DOWN = new THREE.Vector3(0, -1, 0);
const _UP   = new THREE.Vector3(0,  1, 0);

export class Player {
  constructor(camera, domElement, sceneManager, ui, effects, audioManager, renderer) {
    this.camera       = camera;
    this.sceneManager = sceneManager;
    this.ui           = ui;
    this.effects      = effects;
    this.audioManager = audioManager;
    this.renderer     = renderer;

    this.controls = new PointerLockControls(camera, domElement);
    this.sceneManager.scene.add(this.camera);

    // ── Movement ──
    this.velocity  = new THREE.Vector3();
    this.direction = new THREE.Vector3();

    this.moveForward  = false;
    this.moveBackward = false;
    this.moveLeft     = false;
    this.moveRight    = false;
    this.canJump      = false;

    this.mass      = 18.0;
    this.baseSpeed = 250.0;
    this.speed     = this.baseSpeed;
    this.friction  = 12.0;
    this.jumpForce = 60.0;

    // ── Sprint ──
    this.isSprinting  = false;
    this.sprintSpeed  = this.speed * 1.55;
    this.sprintFOVAdd = 6;
    this._sprintLerp  = 0; // 0 = walk, 1 = full sprint

    // ── Health ──
    this.health    = 100;
    this.maxHealth = 100;

    // ── Weapon definitions ──
    this.weapons = [
      {
        name: 'RIFLE',
        magSize: 30,
        maxReserve: 90,
        shootDelay: 0.09,
        damage: 45,
        pellets: 1,
        spread: 0.038,
        adsSpread: 0.004,
        reloadDuration: 1.1,
        autoFire: true,
        ammo: 30,
        reserveAmmo: 90,
        isReloading: false,
        reloadTimer: 0,
        autoReloadTimer: 0,
      },
      {
        name: 'SHOTGUN',
        magSize: 8,
        maxReserve: 32,
        shootDelay: 0.37,
        damage: 18,
        pellets: 7,
        spread: 0.08,
        adsSpread: 0.04,
        reloadDuration: 2.6,
        autoFire: false,
        ammo: 8,
        reserveAmmo: 32,
        isReloading: false,
        reloadTimer: 0,
        autoReloadTimer: 0,
      },
      {
        name: 'SNIPER',
        magSize: 5,
        maxReserve: 25,
        shootDelay: 0.77,
        damage: 180,
        pellets: 1,
        spread: 0.001,
        adsSpread: 0.0001,
        reloadDuration: 3.0,
        autoFire: false,
        ammo: 5,
        reserveAmmo: 25,
        isReloading: false,
        reloadTimer: 0,
        autoReloadTimer: 0,
      },
      {
        name: 'ROCKET_LAUNCHER',
        magSize: 1,
        maxReserve: 6,
        shootDelay: 1.0,
        damage: 600,
        pellets: 1,
        spread: 0.0,
        adsSpread: 0.0,
        reloadDuration: 2.0,
        autoFire: false,
        ammo: 1,
        reserveAmmo: 6,
        isReloading: false,
        reloadTimer: 0,
        autoReloadTimer: 0,
      }
    ];
    this.currentWeaponIndex = 0;

    // Initialise ammo/stats from weapon 0
    const startW        = this.weapons[0];
    this.magSize        = startW.magSize;
    this.maxReserve     = startW.maxReserve;
    this.shootDelay     = startW.shootDelay;
    this.reloadDuration = startW.reloadDuration;
    this.ammo           = startW.ammo;
    this.reserveAmmo    = startW.reserveAmmo;

    // ── Reload ──
    this.isReloading     = startW.isReloading;
    this.reloadTimer     = startW.reloadTimer;
    this.isShooting      = false;
    this.autoReloadTimer = startW.autoReloadTimer;

    // ── Shooting ──
    this.raycaster      = new THREE.Raycaster();
    this.raycaster.far  = 400;
    this.lastShootTime  = 0;

    // Muzzle-flash timer (replaces setTimeout)
    this._muzzleTimer = 0;

    // Reusable shoot collidables array
    this._shootCollidables = [];

    // ── Weapon recoil ──
    this.weaponRecoilZ   = 0;
    this.weaponRecoilVel = 0;
    this.switchAnimProgress = 1;
    this.nextWeaponIndex = 0;

    // ── Head bob ──
    this.headBobTime = 0;
    this.baseY       = 2;

    // ── ADS ──
    this.isADS       = false;
    this.adsProgress = 0;
    this.baseFOV     = 75;
    this.adsFOV      = 55;
    this.adsMode     = 'hold';
    this._prevFOV    = this.baseFOV;
    this._prevVigOp  = -1;

    // ── Landing feel ──
    this.wasInAir      = false;
    this.landingBob    = 0;
    this.landingBobVel = 0;

    // Powerup timers
    this.speedTimer     = 0;
    this.rapidFireTimer = 0;
    this.shieldCharges  = 0;

    // ── Grenade ──
    this.grenadeCount        = 3;     // number of grenades left
    this.grenadeCooldown     = 0;     // seconds remaining on cooldown
    this.grenadeTotalCooldown = 10.0; // total cooldown in seconds
    this._grenades           = [];    // active grenade objects

    // ── Health regen ──
    this._regenTimer     = 0;    // seconds since last damage
    this._regenDelay     = 8.0;  // wait this long before regen kicks in
    this._regenRate      = 5.0;  // HP per second
    this._regenMax       = 50;   // regen cap
    this._isRegenerating = false;

    // ── Cached DOM elements ──
    this._adsVignette = document.getElementById('ads-vignette');
    this._crosshairEl = document.getElementById('crosshair');
    this._sniperScope = document.getElementById('sniper-scope');

    // ── Cached Raycasters / Vector3 ──
    this._floorRayOrigin = new THREE.Vector3();
    this._floorRay       = new THREE.Raycaster();
    this._floorRay.far   = 25;
    this._ceilRay        = new THREE.Raycaster();
    this._ceilRay.far    = 2;
    this._wallFrontRay   = new THREE.Raycaster();
    this._wallFrontRay.far = 1.2;
    this._wallDelta      = new THREE.Vector3();
    this._wallOrigin     = new THREE.Vector3();
    this._oldPos         = new THREE.Vector3();
    this._posAfterX      = new THREE.Vector3();
    this._muzzleWP       = new THREE.Vector3();
    this._rayDir         = new THREE.Vector3();
    this._rayEnd         = new THREE.Vector3();
    this._prevFootstepSin = 0; // for footstep zero-crossing detection
    this._footstepTime   = 0;

    // Safe spawn
    this.camera.position.set(0, this.baseY, 30);

    this._setupWeapon();
    this._setupInput();
    this._updateWeaponModel();
  }

  // ─────────────────────────────────────────────────────────────────
  _setupWeapon() {
    this.weaponGroup = new THREE.Group();

    const darkMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8 });

    // Body mesh — stored so _updateWeaponModel can resize it
    this._weaponBody = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.15, 0.4), darkMat);
    this.weaponGroup.add(this._weaponBody);

    // Barrel — stored for model updates
    const barrelGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.4, 8);
    barrelGeo.rotateX(Math.PI / 2);
    this._weaponBarrel = new THREE.Mesh(barrelGeo,
      new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.9 }));
    this._weaponBarrel.position.set(0, 0.02, -0.3);
    this.weaponGroup.add(this._weaponBarrel);

    // Glowing energy core — stored for color updates
    this._coreMat = new THREE.MeshStandardMaterial({
      color: 0x00f3ff, emissive: 0x00f3ff, emissiveIntensity: 2.0
    });
    this._weaponCore = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.05, 0.2), this._coreMat);
    this._weaponCore.position.set(0, 0, -0.05);
    this.weaponGroup.add(this._weaponCore);

    const scope = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.15), darkMat);
    scope.position.set(0, 0.1, 0);
    this.weaponGroup.add(scope);

    // Muzzle flash
    this.muzzleFlash = new THREE.PointLight(0x00f3ff, 0, 8);
    this.muzzleFlash.position.set(0, 0.02, -0.55);
    
    const flashGeo = new THREE.ConeGeometry(0.12, 0.25, 6);
    flashGeo.rotateX(-Math.PI / 2);
    flashGeo.translate(0, 0, -0.125);
    this.muzzleFlashMesh = new THREE.Mesh(
      flashGeo, 
      new THREE.MeshBasicMaterial({
        color: 0x00f3ff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    );
    this.muzzleFlash.add(this.muzzleFlashMesh);

    this.weaponGroup.add(this.muzzleFlash);

    this.weaponGroup.position.set(0.3, -0.2, -0.5);
    this.camera.add(this.weaponGroup);
  }

  // ─────────────────────────────────────────────────────────────────
  _updateWeaponModel() {
    const w = this.weapons[this.currentWeaponIndex];
    
    this._weaponBody.scale.set(1, 1, 1);
    this._weaponBody.material.color.setHex(0x111111);
    this._weaponBarrel.material.color.setHex(0x333333);

    if (w.name === 'SHOTGUN') {
      // Shorter, wider body
      this._weaponBody.geometry.dispose();
      this._weaponBody.geometry = new THREE.BoxGeometry(0.14, 0.16, 0.32);
      // Wider barrel
      this._weaponBarrel.geometry.dispose();
      const sg = new THREE.CylinderGeometry(0.05, 0.05, 0.4, 8);
      sg.rotateX(Math.PI / 2);
      this._weaponBarrel.geometry = sg;
      // Orange core & muzzle flash
      this._coreMat.color.setHex(0xff6600);
      this._coreMat.emissive.setHex(0xff6600);
      this.muzzleFlash.color.setHex(0xff6600);
      if (this.muzzleFlashMesh) this.muzzleFlashMesh.material.color.setHex(0xff6600);
    } else if (w.name === 'SNIPER') {
      this._weaponBody.geometry.dispose();
      this._weaponBody.geometry = new THREE.BoxGeometry(0.1, 0.15, 0.4);
      this._weaponBody.scale.set(1, 1, 1.8);
      this._weaponBody.material.color.setHex(0x333333);
      
      this._weaponBarrel.geometry.dispose();
      const snp = new THREE.CylinderGeometry(0.02, 0.02, 0.7, 8);
      snp.rotateX(Math.PI / 2);
      this._weaponBarrel.geometry = snp;
      this._weaponBarrel.material.color.setHex(0xcccccc); // silver barrel
      
      this._coreMat.color.setHex(0xffffff); // white core for sniper
      this._coreMat.emissive.setHex(0xffffff);
      this.muzzleFlash.color.setHex(0xffffff);
      if (this.muzzleFlashMesh) this.muzzleFlashMesh.material.color.setHex(0xffffff);
    } else if (w.name === 'ROCKET_LAUNCHER') {
      this._weaponBody.geometry.dispose();
      this._weaponBody.geometry = new THREE.BoxGeometry(0.18, 0.22, 0.6);
      this._weaponBody.material.color.setHex(0x113311);
      
      this._weaponBarrel.geometry.dispose();
      const rlGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.7, 8);
      rlGeo.rotateX(Math.PI / 2);
      this._weaponBarrel.geometry = rlGeo;
      this._weaponBarrel.material.color.setHex(0x222222);
      
      this._coreMat.color.setHex(0x44ff44); 
      this._coreMat.emissive.setHex(0x44ff44);
      this.muzzleFlash.color.setHex(0x44ff44);
      if (this.muzzleFlashMesh) this.muzzleFlashMesh.material.color.setHex(0x44ff44);
    } else {
      // Rifle defaults
      this._weaponBody.geometry.dispose();
      this._weaponBody.geometry = new THREE.BoxGeometry(0.1, 0.15, 0.4);
      this._weaponBarrel.geometry.dispose();
      const rg = new THREE.CylinderGeometry(0.03, 0.03, 0.4, 8);
      rg.rotateX(Math.PI / 2);
      this._weaponBarrel.geometry = rg;
      this._coreMat.color.setHex(0x00f3ff);
      this._coreMat.emissive.setHex(0x00f3ff);
      this.muzzleFlash.color.setHex(0x00f3ff);
      if (this.muzzleFlashMesh) this.muzzleFlashMesh.material.color.setHex(0x00f3ff);
    }
  }

  // ─────────────────────────────────────────────────────────────────
  switchWeapon(index) {
    if (index === this.currentWeaponIndex || this.switchAnimProgress < 1) return;

    if (this.isReloading) {
      this.isReloading = false;
      this.autoReloadTimer = 0;
      this.ui.hideReloadBar();
    }

    const curW = this.weapons[this.currentWeaponIndex];
    curW.ammo = this.ammo;
    curW.reserveAmmo = this.reserveAmmo;
    curW.isReloading = this.isReloading;
    curW.reloadTimer = this.reloadTimer;
    curW.autoReloadTimer = this.autoReloadTimer;

    this.nextWeaponIndex = index;
    this.switchAnimProgress = 0;

    const w = this.weapons[index];
    this.ui.showNotification(w.name, w.name === 'SHOTGUN' ? '#ff8800' : '#00f3ff');
    this.ui.updateWeaponName(w.name);
    this.ui.showWeaponSwitcher(this.weapons, index);
  }

  _finishSwitchWeapon() {
    this.currentWeaponIndex = this.nextWeaponIndex;
    const w = this.weapons[this.currentWeaponIndex];
    this.magSize        = w.magSize;
    this.maxReserve     = w.maxReserve;
    this.shootDelay     = w.shootDelay;
    this.reloadDuration = w.reloadDuration;
    this.ammo           = w.ammo;
    this.reserveAmmo    = w.reserveAmmo;
    this.isReloading    = w.isReloading;
    this.reloadTimer    = w.reloadTimer;
    this.autoReloadTimer = w.autoReloadTimer;
    this.ui.updateAmmo(this.ammo, this.reserveAmmo);
    this.ui.hideReloadBar();
    this._updateWeaponModel();
  }

  // ─────────────────────────────────────────────────────────────────
  _setupInput() {
    document.addEventListener('keydown', (e) => {
      switch (e.code) {
        case 'ArrowUp':   case 'KeyW': this.moveForward  = true;  break;
        case 'ArrowLeft': case 'KeyA': this.moveLeft     = true;  break;
        case 'ArrowDown': case 'KeyS': this.moveBackward = true;  break;
        case 'ArrowRight':case 'KeyD': this.moveRight    = true;  break;
        case 'ShiftLeft': case 'ShiftRight': this.isSprinting = true; break;
        case 'KeyR':   this.reload(); break;
        case 'KeyQ':   this.switchWeapon((this.currentWeaponIndex + 1) % this.weapons.length); break;
        case 'Digit3': case 'Numpad3': this.switchWeapon(2); break;
        case 'KeyG':
          if (this.controls.isLocked) this.throwGrenade();
          break;
        case 'Space':
          if (this.canJump) { this.velocity.y = this.jumpForce; this.canJump = false; }
          break;
      }
    });

    document.addEventListener('keyup', (e) => {
      switch (e.code) {
        case 'ArrowUp':   case 'KeyW': this.moveForward  = false; break;
        case 'ArrowLeft': case 'KeyA': this.moveLeft     = false; break;
        case 'ArrowDown': case 'KeyS': this.moveBackward = false; break;
        case 'ArrowRight':case 'KeyD': this.moveRight    = false; break;
        case 'ShiftLeft': case 'ShiftRight': this.isSprinting = false; break;
      }
    });

    document.addEventListener('mousedown', (e) => {
      if (!this.controls.isLocked) return;
      if (e.button === 0) {
        this.isShooting = true;
        // Semi-auto: fire immediately on click
        const ww = this.weapons[this.currentWeaponIndex];
        if (!ww.autoFire) this.shoot();
      } else if (e.button === 2) {
        this.isADS = this.adsMode === 'hold' ? true : !this.isADS;
      }
    });

    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) { this.isShooting = false; }
      else if (e.button === 2 && this.adsMode === 'hold') { this.isADS = false; }
    });

    document.addEventListener('wheel', (e) => {
      if (!this.controls.isLocked) return;
      const next = e.deltaY > 0
        ? (this.currentWeaponIndex + 1) % this.weapons.length
        : (this.currentWeaponIndex - 1 + this.weapons.length) % this.weapons.length;
      this.switchWeapon(next);
    });

    document.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // ─────────────────────────────────────────────────────────────────


  // ─────────────────────────────────────────────────────────────────
  reload() {
    if (this.isReloading || this.ammo === this.magSize || this.reserveAmmo === 0) return;
    this.isReloading     = true;
    this.reloadTimer     = this.reloadDuration;
    this.autoReloadTimer = 0;
    this.ui.showReloadBar(this.reloadDuration);
    
    const w = this.weapons[this.currentWeaponIndex];
    if (w.name === 'SHOTGUN') {
      this.audioManager.playShotgunReload();
    } else if (w.name === 'SNIPER') {
      this.audioManager.playSniperReload();
    } else {
      this.audioManager.playRifleReload();
    }
  }

  // ─────────────────────────────────────────────────────────────────
  shoot() {
    if (this.ammo <= 0 || this.switchAnimProgress < 0.75) return;

    if (this.isReloading) {
      this.isReloading = false;
      this.autoReloadTimer = 0;
      this.ui.hideReloadBar();
    }

    const w    = this.weapons[this.currentWeaponIndex];
    const time = performance.now() / 1000;
    if (time - this.lastShootTime < this.shootDelay) return;
    this.lastShootTime = time;

    this._headshotNotifiedThisShot = false;

    this.ammo--;
    this.ui.updateAmmo(this.ammo, this.reserveAmmo);
    if (this.ammo === 0 && this.reserveAmmo > 0) this.autoReloadTimer = 0.05;

    if (w.name === 'SHOTGUN') {
      this.audioManager.playShotgunBlast();
    } else if (w.name === 'SNIPER') {
      this.audioManager.playSniperShot();
    } else if (w.name === 'ROCKET_LAUNCHER') {
      this.audioManager.playRocketFire();
      this.audioManager.playExplosion(); // Extra heavy bass blast
      this.effects.createExplosion(this._muzzleWP, 0x44ff44); // Green muzzle blast
    } else {
      this.audioManager.playShoot();
    }

    const recoilMult = 1.0 - this.adsProgress * 0.6;
    const recoilForce = w.name === 'SNIPER' ? 0.6 : 0.28;
    this.weaponRecoilVel += recoilForce * recoilMult;
    const shakeAmt = w.name === 'SNIPER' ? 0.3 : 0.12;
    this.effects.shakeCamera(shakeAmt * recoilMult);

    // Muzzle flash
    this.muzzleFlash.intensity = 8;
    if (this.muzzleFlashMesh) {
      this.muzzleFlashMesh.material.opacity = 1.0;
      this.muzzleFlashMesh.rotation.z = Math.random() * Math.PI * 2;
      const flashScale = w.name === 'SHOTGUN' ? 2.2 : (w.name === 'ROCKET_LAUNCHER' ? 3.8 : (w.name === 'SNIPER' ? 3.0 : 1.4));
      this.muzzleFlashMesh.scale.set(flashScale, flashScale, flashScale);
    }
    this._muzzleTimer = 0.055;

    // Build collidables once per shot
    this._shootCollidables.length = 0;
    const sm = this.sceneManager.collidableMeshes;
    for (let i = 0; i < sm.length; i++) this._shootCollidables.push(sm[i]);
    if (this.botManager) {
      const bm = this.botManager.getBotMeshes();
      for (let i = 0; i < bm.length; i++) this._shootCollidables.push(bm[i]);
    }
    if (this.multiplayerManager && this.multiplayerManager.active) {
      const rpMeshes = this.multiplayerManager.getHitboxes();
      for (let i = 0; i < rpMeshes.length; i++) this._shootCollidables.push(rpMeshes[i]);
    }

    const spread    = this.adsProgress > 0.7 ? w.adsSpread : w.spread;
    this.muzzleFlash.getWorldPosition(this._muzzleWP);

    if (w.name === 'ROCKET_LAUNCHER') {
      this._rayDir.set(0, 0, -1)
        .unproject(this.camera)
        .sub(this.camera.position)
        .normalize();
      
      if (this.projectileManager) {
        // position, direction, damage, radius, speed
        this.projectileManager.spawnRocket(this._muzzleWP, this._rayDir, w.damage, 16.0, 35);
      }
    } else {
      // Fire all pellets (1 for rifle, 7 for shotgun)
      for (let p = 0; p < w.pellets; p++) {
        const sX = (Math.random() - 0.5) * spread;
        const sY = (Math.random() - 0.5) * spread;

        this._rayDir.set(sX, sY, -1)
          .unproject(this.camera)
          .sub(this.camera.position)
          .normalize();
        this.raycaster.set(this.camera.position, this._rayDir);

        const hits = this.raycaster.intersectObjects(this._shootCollidables, false);
        let hitPoint = null;

        let piercedEnemy = null; // the bot the bullet passed through (for piercing)

        if (hits.length > 0) {
          const hit = hits[0];
          hitPoint = hit.point;

          if (hit.object.userData?.bot) {
            const bot = hit.object.userData.bot;
            const isHeadshot = hit.object.userData?.isHeadshot;
            const damage = isHeadshot ? w.damage * 1.5 : w.damage;

            if (isHeadshot && bot.health - damage <= 0) {
              bot.killedByHeadshot = true;
            }

            bot.takeDamage(damage);
            if (isHeadshot) {
              this.audioManager.playKill();
            } else {
              this.audioManager.playEnemyHitFlesh();
            }
            this.ui.showHitMarker();
            this.ui.showHitCrosshair();
            if (this.renderer) {
              const color = isHeadshot ? '#ffcc00' : '#ff4444';
              const fontSize = isHeadshot ? 24 : 18;
              this.ui.showDamageNumber(hit.point, damage, this.camera, this.renderer, color, fontSize);
            }
            if (isHeadshot && !this._headshotNotifiedThisShot) {
              this._headshotNotifiedThisShot = true;
              this.ui.showNotification('HEADSHOT!', '#ffcc00');
            }
            this.effects.shakeCamera(0.08);

            // Piercing: bullet continues through this enemy, hitting the next target
            if (w.piercing) {
              piercedEnemy = bot;
              hitPoint = null; // trail continues past this enemy
              // Check remaining hits for next collidable
              for (let h = 1; h < hits.length; h++) {
                const nextHit = hits[h];
                if (nextHit.object.userData?.bot && nextHit.object.userData.bot === piercedEnemy) continue;
                hitPoint = nextHit.point;
                if (nextHit.object.userData?.bot) {
                  const bot2 = nextHit.object.userData.bot;
                  const isHS2 = nextHit.object.userData?.isHeadshot;
                  const dmg2 = isHS2 ? w.damage * 1.5 : w.damage;
                  if (isHS2 && bot2.health - dmg2 <= 0) bot2.killedByHeadshot = true;
                  bot2.takeDamage(dmg2);
                  this.ui.showHitMarker();
                  this.ui.showHitCrosshair();
                } else {
                  this.effects.createImpact(nextHit.point, nextHit.face?.normal);
                }
                break;
              }
            }
          } else if (hit.object.userData?.isRemotePlayer) {
            const playerId = hit.object.userData.playerId;
            const isHeadshot = hit.object.userData?.isHeadshot;
            const damage = isHeadshot ? w.damage * 1.5 : w.damage;

            // Dispatch event for MultiplayerManager to pick up
            document.dispatchEvent(new CustomEvent('mp_hit_player', {
              detail: { targetId: playerId, damage, isHeadshot }
            }));

            // Client-side visual feedback for hitting remote player
            if (isHeadshot) {
              this.audioManager.playKill();
            } else {
              this.audioManager.playEnemyHitFlesh();
            }
            this.ui.showHitMarker();
            this.ui.showHitCrosshair();
            if (this.renderer) {
              const color = isHeadshot ? '#ffcc00' : '#ff4444';
              const fontSize = isHeadshot ? 24 : 18;
              this.ui.showDamageNumber(hit.point, damage, this.camera, this.renderer, color, fontSize);
            }
            if (isHeadshot && !this._headshotNotifiedThisShot) {
              this._headshotNotifiedThisShot = true;
              this.ui.showNotification('HEADSHOT!', '#ffcc00');
            }
            this.effects.shakeCamera(0.08);
          } else {
            this.effects.createImpact(hit.point, hit.face?.normal);
          }
        }

        const endPos = hitPoint ?? this._rayEnd.copy(this.camera.position).addScaledVector(this._rayDir, 100);
        if (w.name === 'SHOTGUN') {
          this.effects.createBulletTrail(this._muzzleWP, endPos, 2.5, 0xff6600);
        } else {
          this.effects.createBulletTrail(this._muzzleWP, endPos);
        }
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────
  throwGrenade() {
    if (this.grenadeCount <= 0) return;

    this.grenadeCount--;
    this.ui.updateGrenadeCount(this.grenadeCount);

    // Visual: small neon cyan sphere
    const geo = new THREE.SphereGeometry(0.15, 12, 12);
    const mat = new THREE.MeshStandardMaterial({ 
      color: 0x00f3ff, 
      emissive: 0x00f3ff, 
      emissiveIntensity: 2.0 
    });
    const mesh = new THREE.Mesh(geo, mat);

    // Spawn at camera position
    mesh.position.copy(this.camera.position);
    // Small forward offset so it doesn't clip the weapon
    const fwd = new THREE.Vector3();
    this.camera.getWorldDirection(fwd);
    mesh.position.addScaledVector(fwd, 0.6);

    this.sceneManager.scene.add(mesh);

    // Velocity: camera forward × 18 + upward kick of 8
    const vel = fwd.clone().multiplyScalar(18);
    vel.y += 8;

    const grenade = { mesh, vel, timer: 0, exploded: false };
    this._grenades.push(grenade);

    // Start cooldown
    this.grenadeCooldown = 0;
    this.ui.updateGrenadeCooldown(0, this.grenadeTotalCooldown);
  }

  _updateGrenades(delta) {
    const gravity = -30;
    for (let i = this._grenades.length - 1; i >= 0; i--) {
      const g = this._grenades[i];
      if (g.exploded) {
        this._grenades.splice(i, 1);
        continue;
      }

      // Physics
      g.vel.y += gravity * delta;
      g.mesh.position.addScaledVector(g.vel, delta);
      g.mesh.rotation.x += delta * 8;
      g.mesh.rotation.z += delta * 5;

      g.timer += delta;
      if (g.timer >= 2.5 || g.mesh.position.y < 0.5) {
        if (g.mesh.position.y < 0.5) g.mesh.position.y = 0.5;
        this._explodeGrenade(g);
      }
    }
  }

  _explodeGrenade(g) {
    g.exploded = true;
    const pos = g.mesh.position.clone();
    this.sceneManager.scene.remove(g.mesh);
    g.mesh.geometry.dispose();
    g.mesh.material.dispose();

    // Explosion effects
    this.effects.createExplosion(pos.clone().add(new THREE.Vector3(0.5, 0, 0.5)), 0x00f3ff);
    this.effects.createExplosion(pos.clone().add(new THREE.Vector3(-0.5, 0, -0.5)), 0x00f3ff);
    this.effects.createExplosion(pos.clone().add(new THREE.Vector3(0, 0.5, 0)), 0x00f3ff);
    if (this.effects.createExpandingRing) {
      this.effects.createExpandingRing(pos, 0x00f3ff);
    }
    this.effects.shakeCamera(1.5);
    this.audioManager.playExplosion();

    // Damage all bots in radius
    if (this.botManager) {
      const RADIUS = 8;
      const bots = this.botManager.bots;
      let killCount = 0;
      for (let i = 0; i < bots.length; i++) {
        const bot = bots[i];
        if (bot.isDead) continue;
        const d = bot.mesh.position.distanceTo(pos);
        if (d <= RADIUS) {
          // Damage falls off linearly with distance
          const falloff = 1.0 - (d / RADIUS);
          const damage = 300 * falloff; // Doubled grenade damage
          const wasAlive = bot.health > 0;
          bot.takeDamage(damage);
          if (bot.health > 0) {
            this.ui.showDamageNumber(bot.mesh.position.clone(), Math.round(damage), this.camera, this.renderer, '#ff8800', 20);
          } else if (wasAlive) {
            killCount++;
          }
        }
      }
      if (killCount >= 2) {
        this.ui.showNotification(`MULTI KILL! x${killCount}`, '#ff8800');
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────
  applyUpgrade(upgradeId) {
    switch (upgradeId) {
      case 'MAX_HEALTH':
        this.maxHealth = Math.ceil(this.maxHealth * 1.5);
        this.health = this.maxHealth;
        this.ui.updateHealth(this.health, this.maxHealth);
        this.ui.showNotification('MAX HEALTH ↑ +50%', '#ffcc00');
        break;
      case 'EXTENDED_MAG':
        for (let i = 0; i < this.weapons.length; i++) {
          this.weapons[i].magSize    = Math.ceil(this.weapons[i].magSize    * 1.5);
          this.weapons[i].maxReserve = Math.ceil(this.weapons[i].maxReserve * 1.5);
        }
        const w1 = this.weapons[this.currentWeaponIndex];
        this.magSize    = w1.magSize;
        this.maxReserve = w1.maxReserve;
        // Refill current ammo to new mag size
        this.ammo = this.magSize;
        this.ui.updateAmmo(this.ammo, this.reserveAmmo);
        this.ui.showNotification('ALL GUN MAGS ↑ +50%', '#ffcc00');
        break;
      case 'DAMAGE_BOOST':
        for (let i = 0; i < this.weapons.length; i++) {
          this.weapons[i].damage = Math.ceil(this.weapons[i].damage * 1.5);
        }
        this.ui.showNotification('ALL GUN DAMAGE ↑ +50%', '#ffcc00');
        break;
    }
  }

  // ─────────────────────────────────────────────────────────────────
  takeDamage(amount) {
    this.health -= amount;
    // Stop regen on any damage
    this._regenTimer     = 0;
    this._isRegenerating = false;
    this.ui.hideRegenPulse();
    this.ui.updateHealth(this.health, this.maxHealth);
    this.ui.showDamageOverlay();
    this.effects.shakeCamera(0.7);
    if (this.health <= 0) this.die();
  }

  die() {
    if (this.isDead) return;
    this.isDead = true;
    this.isADS       = false;
    this.adsProgress = 0;
    this.camera.fov  = this.baseFOV;
    this.camera.updateProjectionMatrix();
    this._prevFOV = this.baseFOV;
    if (this._adsVignette) this._adsVignette.style.opacity = '0';
    this.audioManager.playDeath();

    // If multiplayer override is set, use it instead of solo death screen
    if (typeof this.onDie === 'function') {
      this.onDie();
      return;
    }

    // Solo death flow
    window.CrazyGames?.SDK?.game?.gameplayStop();
    this.controls.unlock();
    // Pass wave and total kills from botManager if available
    const wave  = this.botManager ? this.botManager.wave       : undefined;
    const kills = this.botManager ? this.botManager.totalKills : undefined;
    this.ui.showDeathScreen(wave, kills);
  }

  applyPowerup(type) {
    if (type === 'HEALTH') {
      this.health = this.maxHealth;
      this.ui.updateHealth(this.health, this.maxHealth);
      this.ui.showNotification('HEALTH REFILLED', '#ff2244');
    } else if (type === 'AMMO') {
      this.weapons.forEach(w => {
        w.reserveAmmo = w.maxReserve;
      });
      const cur = this.weapons[this.currentWeaponIndex];
      this.reserveAmmo = cur.reserveAmmo;
      this.ui.updateAmmo(this.ammo, this.reserveAmmo);
      this.ui.showNotification('MAX AMMO REFILLED', '#00ff88');
    } else if (type === 'GRENADE') {
      this.grenadeCount = 5;
      this.ui.updateGrenadeCount(this.grenadeCount);
      this.ui.showNotification('MAX GRENADES REFILLED', '#00ffff');
    }
  }

  reset() {
    this.isDead = false;
    this.weapons.forEach(w => {
      w.ammo = w.magSize;
      w.reserveAmmo = w.maxReserve;
      w.isReloading = false;
      w.reloadTimer = 0;
      w.autoReloadTimer = 0;
    });
    this.maxHealth       = 100;
    this.health          = this.maxHealth;
    this.speedTimer      = 0;
    this.rapidFireTimer  = 0;
    this.shieldCharges   = 0;
    this.speed           = this.baseSpeed;
    this.ammo            = this.magSize;
    this.reserveAmmo     = this.weapons[this.currentWeaponIndex].maxReserve;
    this.isReloading     = false;
    this.isShooting      = false;
    this.isADS           = false;
    this.adsProgress     = 0;
    this.autoReloadTimer = 0;
    this.landingBob      = 0;
    this.wasInAir        = false;
    this._muzzleTimer    = 0;
    this._sprintLerp     = 0;
    this.isSprinting     = false;
    this.muzzleFlash.intensity = 0;
    this._prevFOV        = this.baseFOV;
    this._prevVigOp      = -1;

    // Grenade reset
    this.grenadeCount = 3;
    this.ui.updateGrenadeCount(this.grenadeCount);
    this.grenadeCooldown = 0;
    // Remove any active grenades from scene
    for (let i = 0; i < this._grenades.length; i++) {
      this.sceneManager.scene.remove(this._grenades[i].mesh);
    }
    this._grenades.length = 0;

    // Regen reset
    this._regenTimer     = 0;
    this._isRegenerating = false;
    this.ui.hideRegenPulse();

    this.camera.position.set(0, 2, 30);
    this.camera.rotation.set(0, 0, 0);
    this.camera.fov = this.baseFOV;
    this.camera.updateProjectionMatrix();
    this.velocity.set(0, 0, 0);

    if (this._adsVignette) this._adsVignette.style.opacity = '0';
    if (this._sniperScope) this._sniperScope.classList.add('hidden');
    if (this._crosshairEl) this._crosshairEl.style.display = '';

    this.ui.updateHealth(this.health, this.maxHealth);
    this.ui.updateAmmo(this.ammo, this.reserveAmmo);
    this.ui.hideReloadBar();
  }

  // ─────────────────────────────────────────────────────────────────
  /** Returns true if the move from startPos→endPos hits a vertical wall. */
  _checkWall(startPos, endPos) {
    this._wallDelta.subVectors(endPos, startPos);
    const lenSq = this._wallDelta.lengthSq();
    if (lenSq === 0) return false;

    const dist = Math.sqrt(lenSq);
    this._wallDelta.divideScalar(dist);

    this._wallOrigin.copy(startPos);
    this._wallOrigin.y -= 0.5;

    this.raycaster.set(this._wallOrigin, this._wallDelta);
    const hits = this.raycaster.intersectObjects(this.sceneManager.collidableMeshes, false);

    for (let i = 0; i < hits.length; i++) {
      if (hits[i].distance < dist + 1.1 &&
          hits[i].face && Math.abs(hits[i].face.normal.y) < 0.7) {
        return true;
      }
    }
    return false;
  }

  // ─────────────────────────────────────────────────────────────────
  update(delta) {
    // ── Low health warning ──
    if (this.health > 0 && this.health <= 25) {
      if (!this._lowHealthPlaying) {
        this._lowHealthPlaying = true;
        this._lowHealthTimer = 0;
      }
      this._lowHealthTimer -= delta;
      if (this._lowHealthTimer <= 0) {
        this.audioManager.playLowHealthWarning();
        this._lowHealthTimer = 1.0;
      }
    } else {
      this._lowHealthPlaying = false;
    }

    // ── Grenade cooldown ──
    if (this.grenadeCooldown > 0) {
      this.grenadeCooldown -= delta;
      if (this.grenadeCooldown <= 0) {
        this.grenadeCooldown = 0;
        this.ui.showGrenadeReady();
      }
      this.ui.updateGrenadeCooldown(this.grenadeCooldown, this.grenadeTotalCooldown);
    }

    // ── Grenade physics ──
    if (this._grenades.length > 0) {
      this._updateGrenades(delta);
    }

    // ── Health regen ──
    if (this.health < this._regenMax && this.health > 0) {
      this._regenTimer += delta;
      if (this._regenTimer >= this._regenDelay) {
        if (!this._isRegenerating) {
          this._isRegenerating = true;
          this.ui.showRegenPulse();
        }
        this.health = Math.min(this._regenMax, this.health + this._regenRate * delta);
        this.ui.updateHealth(this.health, this.maxHealth);
      }
    } else if (this._isRegenerating && this.health >= this._regenMax) {
      this._isRegenerating = false;
      this.ui.hideRegenPulse();
    }

    // ── Auto-reload countdown ──
    if (this.autoReloadTimer > 0 && !this.isReloading) {
      this.autoReloadTimer -= delta;
      if (this.autoReloadTimer <= 0) this.reload();
    }

    // ── Reload timer ──
    if (this.isReloading) {
      this.reloadTimer -= delta;
      if (this.reloadTimer <= 0) {
        this.isReloading = false;
        const needed      = this.magSize - this.ammo;
        const reloadAmt   = Math.min(needed, this.reserveAmmo);
        this.ammo        += reloadAmt;
        this.reserveAmmo -= reloadAmt;
        this.ui.updateAmmo(this.ammo, this.reserveAmmo);
        this.ui.hideReloadBar();
      }
    }

    // ── Muzzle flash timer ──
    if (this._muzzleTimer > 0) {
      this._muzzleTimer -= delta;
      if (this.muzzleFlashMesh) {
        this.muzzleFlashMesh.material.opacity = Math.max(0, this._muzzleTimer / 0.055);
      }
      if (this._muzzleTimer <= 0) {
        this._muzzleTimer = 0;
        this.muzzleFlash.intensity = 0;
      }
    }

    // ── Auto-fire (only for auto weapons) ──
    const w = this.weapons[this.currentWeaponIndex];
    if (this.isShooting && !this.isReloading && this.ammo > 0) {
      if (w.autoFire) {
        this.shoot();
      } else {
        // Semi-auto: shoot only once per press (handled by mousedown; just guard here)
      }
    }

    if (!this.controls.isLocked) return;

    // ── ADS lerp ──
    const adsTarget   = this.isADS ? 1.0 : 0.0;
    this.adsProgress += (adsTarget - this.adsProgress) * Math.min(1, 10.0 * delta);
    if (this.adsProgress < 0.001) this.adsProgress = 0;
    if (this.adsProgress > 0.999) this.adsProgress = 1;

    // ── Sprint lerp ──
    const canSprint = this.isSprinting && !this.isADS && !this.isReloading
      && (this.moveForward || this.moveLeft || this.moveRight || this.moveBackward);
    this._sprintLerp += ((canSprint ? 1 : 0) - this._sprintLerp) * Math.min(1, 8 * delta);
    const sprintMult = 1.0 + this._sprintLerp * 0.55;

    // ── FOV update (includes sprint) ──
    const targetAdsFOV = w.name === 'SNIPER' ? 25 : this.adsFOV;
    const newFOV = this.baseFOV
      + (targetAdsFOV - this.baseFOV) * this.adsProgress
      + this.sprintFOVAdd * this._sprintLerp * (1 - this.adsProgress);
    if (Math.abs(newFOV - this._prevFOV) > 0.01) {
      this.camera.fov = newFOV;
      this.camera.updateProjectionMatrix();
      this._prevFOV = newFOV;
    }

    // ── ADS vignette ──
    if (this._adsVignette) {
      const isSniper = w.name === 'SNIPER';
      if (isSniper) {
        this._adsVignette.style.opacity = 0;
        this._prevVigOp = 0;
        if (this._sniperScope) {
          if (this.adsProgress > 0.8) {
            this._sniperScope.classList.remove('hidden');
            if (this._crosshairEl) this._crosshairEl.style.display = 'none';
          } else {
            this._sniperScope.classList.add('hidden');
            if (this._crosshairEl) this._crosshairEl.style.display = '';
          }
        }
      } else {
        if (this._sniperScope) this._sniperScope.classList.add('hidden');
        if (this._crosshairEl) this._crosshairEl.style.display = '';
        
        const vigOp = Math.round(this.adsProgress * 65) / 100;
        if (vigOp !== this._prevVigOp) {
          this._adsVignette.style.opacity = vigOp;
          this._prevVigOp = vigOp;
        }
      }
    }

    // ── Crosshair spread ──
    const chSpread = this.isShooting && !this.isReloading
      ? 14 + (1 - this.adsProgress) * 10
      : 6 + (1 - this.adsProgress) * 4;
    const ch = this._crosshairEl;
    if (ch) {
      const top    = ch.querySelector('.ch-top');
      const bottom = ch.querySelector('.ch-bottom');
      const left   = ch.querySelector('.ch-left');
      const right  = ch.querySelector('.ch-right');
      if (top)    top.style.top    = `-${chSpread}px`;
      if (bottom) bottom.style.top = `${chSpread - 8}px`;
      if (left)   left.style.left  = `-${chSpread}px`;
      if (right)  right.style.left = `${chSpread - 8}px`;
    }

    // ── Weapon recoil spring ──
    this.weaponRecoilVel -= this.weaponRecoilZ * 40 * delta;
    this.weaponRecoilVel *= Math.pow(0.5, delta * 60);
    this.weaponRecoilZ   += this.weaponRecoilVel * delta;

    this.weaponGroup.position.x = 0.3 * (1 - this.adsProgress);

    // ── Weapon retraction when facing walls ──
    this.camera.getWorldDirection(this._rayDir);
    this._wallFrontRay.set(this.camera.position, this._rayDir);
    const frontHits = this._wallFrontRay.intersectObjects(this.sceneManager.collidableMeshes, false);
    this._weaponRetracted = frontHits.length > 0;

    const weaponTargetZ = this._weaponRetracted ? -0.2 : (-0.5 + this.weaponRecoilZ + 0.04 * this.adsProgress);
    if (this._currentWeaponZ === undefined) this._currentWeaponZ = -0.5;
    this._currentWeaponZ += (weaponTargetZ - this._currentWeaponZ) * Math.min(1, 15 * delta);

    this.weaponGroup.position.z = this._currentWeaponZ;
    this.weaponGroup.rotation.x = this.weaponRecoilZ * 0.5;

    // ── Velocity ──
    this.velocity.x -= this.velocity.x * this.friction * delta;
    this.velocity.z -= this.velocity.z * this.friction * delta;
    this.velocity.y -= 9.8 * this.mass * delta;

    this.direction.z = Number(this.moveForward)  - Number(this.moveBackward);
    this.direction.x = Number(this.moveRight)    - Number(this.moveLeft);
    this.direction.normalize();

    const speedMult = 1.0 - this.adsProgress * 0.28;
    if (this.moveForward  || this.moveBackward)
      this.velocity.z -= this.direction.z * this.speed * speedMult * sprintMult * delta;
    if (this.moveLeft     || this.moveRight)
      this.velocity.x -= this.direction.x * this.speed * speedMult * sprintMult * delta;

    // Snapshot position before X move
    this._oldPos.copy(this.camera.position);

    // ── Move X ──
    this.controls.moveRight(-this.velocity.x * delta);
    if (this._checkWall(this._oldPos, this.camera.position)) {
      this.camera.position.copy(this._oldPos);
      this.velocity.x = 0;
    }

    // ── Move Z ──
    this._posAfterX.copy(this.camera.position);
    this.controls.moveForward(-this.velocity.z * delta);
    if (this._checkWall(this._posAfterX, this.camera.position)) {
      this.camera.position.copy(this._posAfterX);
      this.velocity.z = 0;
    }

    // ── Boundary clamp ──
    const pos = this.camera.position;
    pos.x = Math.max(-38, Math.min(38, pos.x));
    pos.z = Math.max(-38, Math.min(38, pos.z));

    // ── Floor detection ──
    this._floorRayOrigin.set(pos.x, pos.y + 1, pos.z);
    this._floorRay.set(this._floorRayOrigin, _DOWN);
    const downHits = this._floorRay.intersectObjects(this.sceneManager.collidableMeshes, false);
    this.baseY = (downHits.length > 0 ? downHits[0].point.y : 0) + 2;

    // ── Landing detection ──
    const nowInAir = pos.y > this.baseY + 0.1;
    if (this.wasInAir && !nowInAir && this.velocity.y < -6) {
      this.landingBobVel = -0.07;
      this.effects.shakeCamera(0.12);
    }
    this.wasInAir = nowInAir;

    // Landing bob spring
    this.landingBobVel += (-this.landingBob * 22 - this.landingBobVel * 4) * delta;
    this.landingBob    += this.landingBobVel * delta * 12;

    // ── Ceiling detection ──
    if (this.velocity.y > 0) {
      this._ceilRay.set(pos, _UP);
      const upHits = this._ceilRay.intersectObjects(this.sceneManager.collidableMeshes, false);
      if (upHits.length > 0 && upHits[0].distance < 0.5) {
        this.velocity.y = 0;
      }
    }

    // ── Y movement ──
    pos.y += this.velocity.y * delta;
    if (pos.y <= this.baseY) {
      this.velocity.y = 0;
      pos.y           = this.baseY;
      this.canJump    = true;
    }

    // ── Footsteps & Landing Bob ──
    const isMoving = Math.abs(this.velocity.x) > 1 || Math.abs(this.velocity.z) > 1;
    const sprintWeaponY = -0.2 - 0.08 * this._sprintLerp;
    
    if (this.canJump && isMoving) {
      const spd = Math.sqrt(this.velocity.x * this.velocity.x + this.velocity.z * this.velocity.z);
      this._footstepTime += delta * spd * 0.11;

      // Footstep: fire when sine crosses from negative to positive (each new step)
      const curFootstepSin = Math.sin(this._footstepTime);
      if (this._prevFootstepSin < 0 && curFootstepSin >= 0) {
        this.audioManager.playFootstep();
      }
      this._prevFootstepSin = curFootstepSin;
    } else {
      this._footstepTime = 0;
      this._prevFootstepSin = 0;
    }

    const targetWY = sprintWeaponY - 0.03 * this.adsProgress + this.landingBob * 0.04;
    this.weaponGroup.position.y += (targetWY - this.weaponGroup.position.y) * delta * 10;

    if (pos.y < this.baseY) pos.y = this.baseY;

    // ── Weapon switch animation ──
    let switchAnimYOffset = 0;
    if (this.switchAnimProgress < 1) {
      const prevProgress = this.switchAnimProgress;
      this.switchAnimProgress += delta * 5.0; // 0.2s duration
      if (this.switchAnimProgress > 1) this.switchAnimProgress = 1;

      if (this.switchAnimProgress < 0.5) {
        const p = this.switchAnimProgress / 0.5;
        switchAnimYOffset = -0.4 * p;
        this.weaponGroup.children.forEach(c => {
          if (c.material) { c.material.transparent = true; c.material.opacity = 1 - p; }
        });
      } else {
        if (prevProgress < 0.5 && this.switchAnimProgress >= 0.5) {
          this._finishSwitchWeapon();
        }
        const p = (this.switchAnimProgress - 0.5) / 0.5;
        switchAnimYOffset = -0.4 * (1 - p);
        this.weaponGroup.children.forEach(c => {
          if (c.material) { c.material.transparent = true; c.material.opacity = p; }
        });
      }
    } else {
      this.weaponGroup.children.forEach(c => {
        if (c.material && c.material.transparent && c.material.opacity < 1) {
          c.material.transparent = false;
          c.material.opacity = 1;
        }
      });
    }
    this.weaponGroup.position.y += switchAnimYOffset;
  }
}
