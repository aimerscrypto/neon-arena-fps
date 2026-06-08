/**
 * HumanoidBot – Optimized enemy AI.
 *
 * Key optimizations vs. previous version:
 * - Shared module-level geometries (created ONCE for all bots of any type).
 *   Each bot's group is scaled to match its size variant.
 * - Single material per bot (all body-parts share the same instance).
 *   Hit-flash mutates material directly — no traverse(), no setTimeout().
 * - No PointLight per bot (was the single biggest GPU bottleneck).
 * - All hot-path Vector3 / Box3 / Raycaster allocations replaced with
 *   pre-allocated instance fields.
 * - Separation check throttled to every other frame (O(n²) → O(n²/2)).
 * - Bot shoot() uses scene collidables directly — no array creation.
 */
import * as THREE from 'three';

// ── Bot-type definitions ──────────────────────────────────────────
const BOT_TYPES = {
  SHOOTER: { color: 0xff2200, speedMult: 1.0, healthMult: 1.0, size: 1.0, fireRate: 1.0 },
  FAST:    { color: 0xffee00, speedMult: 1.8, healthMult: 0.5, size: 0.7, fireRate: 1.2 },
  TANK:    { color: 0xcc00ff, speedMult: 0.5, healthMult: 3.0, size: 1.5, fireRate: 0.6 },
  SHIELD:  { color: 0x0088ff, speedMult: 0.65, healthMult: 1.5, size: 1.0, fireRate: 0 },
};

// ── Module-level shared geometries (allocated ONCE) ───────────────
let _GEO = null;
export function getSharedGeos() {
  if (_GEO) return _GEO;

  const arm = new THREE.BoxGeometry(0.25, 1.0, 0.25);
  arm.translate(0, -0.4, 0);

  const leg = new THREE.BoxGeometry(0.3, 1.0, 0.3);
  leg.translate(0, -0.4, 0);

  _GEO = {
    torso:  new THREE.BoxGeometry(0.8,  1.2,  0.4),
    head:   new THREE.BoxGeometry(0.5,  0.5,  0.5),
    eye:    new THREE.BoxGeometry(0.4,  0.15, 0.12),
    arm,
    leg,
    gun:    new THREE.BoxGeometry(0.15, 0.15, 0.6),
    hitbox: new THREE.CylinderGeometry(0.6, 0.6, 2.0, 8),
    headHitbox: new THREE.BoxGeometry(0.6, 0.6, 0.6),
    shield: new THREE.BoxGeometry(1.0, 1.5, 0.1),
  };
  return _GEO;
}
const _getGeos = getSharedGeos;

// Module-level constant directions — shared, never mutated
const _DOWN = new THREE.Vector3(0, -1, 0);

// Hitbox material — shared across all bots (invisible, so colour doesn't matter)
const _hitboxMat = new THREE.MeshBasicMaterial({ visible: false });

// Reusable scratch vectors for shield dot-product check
const _botFacing  = new THREE.Vector3();
const _playerDir  = new THREE.Vector3();

export class HumanoidBot {
  constructor(position, scene, player, botManager, type) {
    this.scene      = scene;
    this.player     = player;
    this.botManager = botManager;
    this.type       = type;
    this.stats      = BOT_TYPES[type] || BOT_TYPES.SHOOTER;
    this.isBoss     = false;

    const difficulty = this.botManager.wave;
    this.health      = (100 + difficulty * 20) * this.stats.healthMult;
    this.maxHealth   = this.health;
    this.maxSpeed    = (4 + Math.random() * 2 + difficulty * 0.5) * this.stats.speedMult;
    this.speed       = this.maxSpeed;
    this.shieldHealth = 250; // HP of the shield itself before breaking
    this.attackRange = this.type === 'SHIELD' ? 2 : 35;
    this.attackCooldown  = this.type === 'SHIELD' ? 1.0
      : Math.max(0.3, (1.5 - difficulty * 0.1)) / (this.stats.fireRate || 1);
    this.lastAttackTime  = 0;
    this.activationDelay = Math.random() * 0.5;

    this.strafeTimer     = 0;
    this.strafeDirection = 1;
    this.isDead          = false;
    this.isDying         = false;   // ragdoll in progress
    this.isFullyDead     = false;   // cleared from bot arrays by BotManager
    this._dyingTimer     = 0;
    this._DYING_DUR      = 0.4;
    this._deathStartY    = 0;
    this.animTime        = Math.random() * 100;
    this.jumpCooldown    = 0;
    this.velocityY       = 0;

    // Hit-flash — timer-based, mutates material color directly
    this._flashTimer    = 0;
    this._FLASH_DUR     = 0.08;
    this._origColor     = this.stats.color; // stored for restore

    // ── Pre-allocated working objects (no GC in hot path) ─────────
    this._moveDir       = new THREE.Vector3();
    this._sep           = new THREE.Vector3();
    this._toBot         = new THREE.Vector3(); // reused in separation loop
    this._botBox        = new THREE.Box3();
    this._downRayOrigin = new THREE.Vector3();
    this._downRay       = new THREE.Raycaster();
    this._downRay.far   = 40; // increased raycaster range so bots don't fall through map
    this._shootRay      = new THREE.Raycaster();
    this._shootRay.far  = 80;
    // Throttle separation check (O(n²)) to every other frame
    this._frameCount    = 0;


    this._buildMesh();

    // Scale the whole group to match bot size (uses shared unit-size geometries)
    this.mesh.scale.setScalar(this.stats.size);
    this.mesh.position.copy(position);

    // Snap to floor
    this._downRayOrigin.set(position.x, 20, position.z);
    this._downRay.set(this._downRayOrigin, _DOWN);
    const hits = this._downRay.intersectObjects(this.botManager.player.sceneManager.collidableMeshes, false);
    if (hits.length > 0) this.mesh.position.y = hits[0].point.y;

    this.scene.add(this.mesh);
  }

  // ─────────────────────────────────────────────────────────────────
  _buildMesh() {
    this.mesh = new THREE.Group();
    const geo = _getGeos();

    // ONE shared material per bot instance — flash changes it directly
    this.mat = new THREE.MeshBasicMaterial({
      color: this.stats.color,
    });

    // Body parts (all share this.mat — no per-part materials)
    this.torso = new THREE.Mesh(geo.torso, this.mat);
    this.torso.position.y = 1.4;
    this.mesh.add(this.torso);

    this.head = new THREE.Mesh(geo.head, this.mat);
    this.head.position.y = 2.3;
    // Eye strip (white emissive, cheap BasicMaterial, shared eye geo)
    const eyeMesh = new THREE.Mesh(geo.eye, new THREE.MeshBasicMaterial({ color: 0xffffff }));
    eyeMesh.position.set(0, 0, 0.26);
    this.head.add(eyeMesh);
    this.mesh.add(this.head);

    this.armL = new THREE.Mesh(geo.arm, this.mat);
    this.armL.position.set(-0.55, 1.9, 0);
    this.mesh.add(this.armL);

    this.armR = new THREE.Mesh(geo.arm, this.mat);
    this.armR.position.set(0.55, 1.9, 0);
    this.mesh.add(this.armR);

    // Weapon on right arm (dark material — separate from body)
    if (this.type !== 'SHIELD') {
      const gunMat = new THREE.MeshBasicMaterial({ color: 0x222222 });
      this.gun = new THREE.Mesh(geo.gun, gunMat);
      this.gun.position.set(0, -0.8, 0.2);
      this.armR.add(this.gun);
    } else {
      // Shield enemy carries no gun — add shield plate to torso front
      this._shieldMat = new THREE.MeshBasicMaterial({
        color: 0x00ccff,
        transparent: true,
        opacity: 0.75,
      });
      this._shieldMesh = new THREE.Mesh(geo.shield, this._shieldMat);
      this._shieldMesh.position.set(0, 0, 0.26); // front of torso
      this.torso.add(this._shieldMesh);
    }

    this.legL = new THREE.Mesh(geo.leg, this.mat);
    this.legL.position.set(-0.25, 0.8, 0);
    this.mesh.add(this.legL);

    this.legR = new THREE.Mesh(geo.leg, this.mat);
    this.legR.position.set(0.25, 0.8, 0);
    this.mesh.add(this.legR);

    // Hitbox: shared geometry, shared invisible material, per-bot userData
    this.hitbox = new THREE.Mesh(geo.hitbox, _hitboxMat);
    this.hitbox.position.y = 1.0;
    this.hitbox.userData.bot = this;
    this.mesh.add(this.hitbox);

    this.headHitbox = new THREE.Mesh(geo.headHitbox, _hitboxMat);
    this.headHitbox.position.y = 2.3;
    this.headHitbox.userData.bot = this;
    this.headHitbox.userData.isHeadshot = true;
    this.mesh.add(this.headHitbox);
    // NOTE: No PointLight — removed (was the #1 GPU bottleneck with many bots)
  }

  // ─────────────────────────────────────────────────────────────────
  takeDamage(amount) {
    // ── Shield enemy front-block check ──
    if (this.type === 'SHIELD' && !this.isDead) {
      // Get the direction the bot is facing (its local +Z in world space)
      this.mesh.getWorldDirection(_botFacing);
      // Get direction from bot to player
      _playerDir.subVectors(
        this.player.camera.position,
        this.mesh.position
      ).normalize();
      // If player is in front of the shield (dot > 0.4 means within ~66° cone)
      if (_botFacing.dot(_playerDir) > 0.4) {
        if (this.shieldHealth > 0) {
          this.shieldHealth -= amount;
          if (this.shieldHealth <= 0) {
            // Shield breaks
            if (this._shieldMesh && this.torso) this.torso.remove(this._shieldMesh);
            if (this._shieldMat) this._shieldMat.dispose();
            this._shieldMat = null;
            if (this.botManager.camera && this.botManager.renderer) {
              this.botManager.ui.showFloatingText(this.mesh.position.clone().add(new THREE.Vector3(0, 2.5, 0)), 'SHIELD BROKEN!', this.botManager.camera, this.botManager.renderer, '#ffaa00');
            }
          } else {
            // Pulse shield to show it's blocking
            if (this._shieldMat) {
              this._shieldMat.opacity = 1.0;
              setTimeout(() => { if (this._shieldMat) this._shieldMat.opacity = 0.75; }, 120);
            }
            if (this.botManager.camera && this.botManager.renderer) {
              this.botManager.ui.showFloatingText(this.mesh.position.clone().add(new THREE.Vector3(0, 2.5, 0)), 'BLOCKED', this.botManager.camera, this.botManager.renderer, 'ft-ammo');
            }
          }
          return; // Shot blocked — no damage to bot HP
        }
      }
    }

    this.health -= amount;
    if (this.health <= 0 && !this.isDead) {
      this.die();
    } else {
      this._flash();
    }
  }

  /** Flash bright white by mutating material color — restored in update(). */
  _flash() {
    if (this._flashTimer > 0) return; // already flashing
    this.mat.color.setHex(0xffffff);
    this._flashTimer = this._FLASH_DUR;
  }

  _restoreColor() {
    this.mat.color.setHex(this._origColor);
  }

  die() {
    if (this.isDead) return;
    this.isDead  = true;
    this.isDying = true;
    this._dyingTimer  = 1.5;
    this._deathStartY = this.mesh.position.y;

    // Disable hitboxes so player can't hit a corpse
    this.hitbox.userData.bot = null;
    this.headHitbox.userData.bot = null;

    // Trigger effects immediately
    const deathPos = this.mesh.position.clone();
    deathPos.y += 1.0;
    this.botManager.effects.createExplosion(deathPos, this.stats.color);
    if (this.isBoss) {
      const bossPos2 = deathPos.clone();
      bossPos2.x += 0.8;
      this.botManager.effects.createExplosion(bossPos2, this.stats.color);
    }
    this.botManager.audioManager.playExplosion();
    this.botManager.audioManager.playKill();

    let shakeAmt = 0.25; // SHOOTER / SHIELD
    if (this.type === 'TANK')   shakeAmt = 0.5;
    else if (this.type === 'FAST') shakeAmt = 0.15;
    this.botManager.effects.shakeCamera(shakeAmt);

    // Notify BotManager (score, kill feed, powerup)
    this.botManager.onBotDeath(this);
  }

  // ─────────────────────────────────────────────────────────────────
  update(delta, time) {
    if (this.isFullyDead) return;

    if (this.activationDelay > 0) {
      this.activationDelay -= delta;
      return;
    }

    // ── Death animation ──
    if (this.isDying) {
      this._dyingTimer -= delta;
      const t = 1 - Math.max(0, this._dyingTimer / 1.5); // 0 → 1
      this.mesh.rotation.x = t * (Math.PI / 2);             // pitch forward
      this.mesh.position.y = this._deathStartY - t * 1.2;   // sink into floor
      if (this._dyingTimer <= 0) {
        // Clean up
        this.mat.dispose();
        if (this._shieldMat) this._shieldMat.dispose();
        this.scene.remove(this.mesh);
        this.isFullyDead = true;
        this.isDying     = false;
      }
      return; // skip AI while dying
    }

    this._frameCount++;

    // ── Flash timer ──
    if (this._flashTimer > 0) {
      this._flashTimer -= delta;
      if (this._flashTimer <= 0) this._restoreColor();
    }

    // ── Shield pulse animation ──
    if (this.type === 'SHIELD' && this._shieldMat) {
      const t = performance.now() * 0.002;
      this._shieldMat.opacity = 0.55 + Math.sin(t) * 0.2;
    }

    const playerPos = this.player.camera.position;
    const pos       = this.mesh.position;
    const dist      = pos.distanceTo(playerPos);

    this.mesh.lookAt(playerPos.x, pos.y, playerPos.z);

    // ── Movement direction ──
    this._moveDir.set(0, 0, 0);
    let isMoving = false;

    if (this.type === 'SHIELD') {
      // Shield enemy always moves directly toward player
      if (dist > 1.5) {
        this._moveDir.subVectors(playerPos, pos).normalize();
        isMoving = true;
      }
    } else if (dist > 6) {
      if (dist > this.attackRange) {
        // Pure chase
        this._moveDir.subVectors(playerPos, pos).normalize();
      } else {
        // Blend chase and strafe
        this.strafeTimer -= delta;
        if (this.strafeTimer <= 0) {
          this.strafeDirection = Math.random() > 0.5 ? 1 : -1;
          this.strafeTimer     = 1.0 + Math.random() * 2.0;
        }
        
        this._toBot.subVectors(playerPos, pos).normalize().multiplyScalar(0.6);
        this._moveDir.set(1, 0, 0).applyQuaternion(this.mesh.quaternion)
                     .multiplyScalar(this.strafeDirection * 0.4);
        this._moveDir.add(this._toBot).normalize();
      }
      isMoving = true;
    } else {
      // Pure strafe
      this.strafeTimer -= delta;
      if (this.strafeTimer <= 0) {
        this.strafeDirection = Math.random() > 0.5 ? 1 : -1;
        this.strafeTimer     = 1.0 + Math.random() * 2.0;
      }
      this._moveDir.set(1, 0, 0).applyQuaternion(this.mesh.quaternion)
                   .multiplyScalar(this.strafeDirection);
      isMoving = true;
    }

    // ── Separation (O(n²), throttled to every other frame) ──
    if (this._frameCount % 2 === 0) {
      this._sep.set(0, 0, 0);
      let neighbors = 0;
      const bots = this.botManager.bots;
      for (let i = 0; i < bots.length; i++) {
        const other = bots[i];
        if (other === this || other.isDead) continue;
        const d = pos.distanceTo(other.mesh.position);
        if (d < 4.0 && d > 0.001) {
          // Reuse _toBot scratch vector
          this._toBot.subVectors(pos, other.mesh.position).normalize().multiplyScalar(4.0 - d);
          this._sep.add(this._toBot);
          neighbors++;
        }
      }
      if (neighbors > 0) {
        this._sep.divideScalar(neighbors);
        this._moveDir.addScaledVector(this._sep, 0.5).normalize();
      }
    }
    this._moveDir.y = 0;

    // ── Pre-calculate bot box bounds ──
    const r = 0.6 * this.stats.size;
    const h = 2.0 * this.stats.size;

    // ── X collision ──
    let collidedX = false;
    const oldX = pos.x;
    pos.x += this._moveDir.x * this.speed * delta;
    this._botBox.min.set(pos.x - r, pos.y, pos.z - r);
    this._botBox.max.set(pos.x + r, pos.y + h, pos.z + r);
    for (let i = 0; i < this.botManager.player.sceneManager.collidableBoxes.length; i++) {
      const box = this.botManager.player.sceneManager.collidableBoxes[i];
      if (box.max.y > pos.y + 0.05 && box.min.y < pos.y + 3.0 * this.stats.size && this._botBox.intersectsBox(box)) {
        pos.x = oldX;
        collidedX = true;
        break;
      }
    }

    // ── Z collision ──
    let collidedZ = false;
    const oldZ = pos.z;
    pos.z += this._moveDir.z * this.speed * delta;
    this._botBox.min.set(pos.x - r, pos.y, pos.z - r);
    this._botBox.max.set(pos.x + r, pos.y + h, pos.z + r);
    for (let i = 0; i < this.botManager.player.sceneManager.collidableBoxes.length; i++) {
      const box = this.botManager.player.sceneManager.collidableBoxes[i];
      if (box.max.y > pos.y + 0.05 && box.min.y < pos.y + 3.0 * this.stats.size && this._botBox.intersectsBox(box)) {
        pos.z = oldZ;
        collidedZ = true;
        break;
      }
    }

    // ── Jump cooldown ──
    if (this.jumpCooldown > 0) this.jumpCooldown -= delta;

    // ── Floor & gravity (cached raycaster, no new object) ──
    this._downRayOrigin.set(pos.x, pos.y + 2, pos.z);
    this._downRay.set(this._downRayOrigin, _DOWN);
    const downHits = this._downRay.intersectObjects(this.botManager.player.sceneManager.collidableMeshes, false);
    if (downHits.length > 0) {
      const targetY = downHits[0].point.y;
      if (pos.y > targetY + 0.1) {
        this.velocityY -= 40.0 * delta;
      } else {
        if (this.velocityY < 0) this.velocityY = 0;
        pos.y = targetY;

        // Jump over obstacles only when genuinely blocked (reduced probability)
        if ((collidedX || collidedZ) && this.jumpCooldown <= 0 && Math.random() < 0.04) {
          this.velocityY    = this.isBoss ? 32.0 : 18.0;
          this.jumpCooldown = this.isBoss ? 0.8 : 1.5;
        }
      }
    } else {
      this.velocityY -= 40.0 * delta;
    }
    pos.y += this.velocityY * delta;

    if (pos.y < -10 && !this.isDead) {
      this.takeDamage(this.health);
    }

    // ── Limb animations ──
    this.animTime += delta * this.speed * 2.0;
    if (isMoving) {
      this.legL.rotation.x = Math.sin(this.animTime)           * 0.8;
      this.legR.rotation.x = Math.sin(this.animTime + Math.PI) * 0.8;
      this.armL.rotation.x = Math.sin(this.animTime + Math.PI) * 0.5;
    } else {
      this.legL.rotation.x = 0;
      this.legR.rotation.x = 0;
      this.armL.rotation.x = 0;
    }

    // ── Attack ──
    if (this.type === 'SHIELD') {
      // Shield enemy: melee only
      if (dist <= 3.5 && time - this.lastAttackTime > this.attackCooldown) {
        this.lastAttackTime = time;
        this.player.takeDamage(15);
        this.botManager.effects.shakeCamera(0.3);
      }
    } else {
      // Shooting enemies: don't shoot at melee range (< 2 units)
      if (dist <= this.attackRange && dist >= 2.0) {
        this.armR.rotation.x = -Math.PI / 2;
        if (time - this.lastAttackTime > this.attackCooldown) {
          this.lastAttackTime = time;
          this.shoot();
        }
      } else {
        this.armR.rotation.x = isMoving ? Math.sin(this.animTime) * 0.5 : 0;
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────
  shoot() {
    this.botManager.audioManager.playEnemyShoot();

    const accuracy = Math.min(0.82, 0.4 + this.botManager.wave * 0.05);

    // Get gun world position (one allocation per shot — not per frame)
    const startPos = new THREE.Vector3();
    this.gun.getWorldPosition(startPos);

    // Aim at player's head height
    const targetPos = this.player.camera.position.clone();

    const distToPlayer = startPos.distanceTo(targetPos);
    const dirToPlayer  = new THREE.Vector3().subVectors(targetPos, startPos).normalize();

    // ── Single clean line-of-sight check ──
    // Cast ray from gun toward player. If ANY collidable is hit before the
    // player (with a small 0.3 unit tolerance for floating point), the shot
    // is fully blocked — no second chance, no damage.
    this._shootRay.set(startPos, dirToPlayer);
    this._shootRay.far = distToPlayer; // only need to test up to the player
    const losHits = this._shootRay.intersectObjects(this.botManager.player.sceneManager.collidableMeshes, false);

    const blocked = losHits.length > 0 && losHits[0].distance < (distToPlayer - 0.3);

    if (blocked) {
      // Visual feedback: bullet stops at the wall
      this.botManager.effects.createBulletTrail(startPos, losHits[0].point);
      this.botManager.effects.createImpact(losHits[0].point, losHits[0].face?.normal);
    } else if (Math.random() < accuracy) {
      // Line of sight is clear — accurate shot hits the player
      const damage = this.isBoss ? 10 : 5;
      this.player.takeDamage(damage);
      this.botManager.effects.createBulletTrail(startPos, targetPos);
    } else {
      // Miss — visible tracer veers slightly off-center
      const missDir = new THREE.Vector3(
        dirToPlayer.x + (Math.random() - 0.5) * 0.15,
        dirToPlayer.y + (Math.random() - 0.5) * 0.12,
        dirToPlayer.z + (Math.random() - 0.5) * 0.15
      ).normalize();
      this._shootRay.set(startPos, missDir);
      this._shootRay.far = 80;
      const missHits = this._shootRay.intersectObjects(this.botManager.player.sceneManager.collidableMeshes, false);
      const endpoint = missHits.length > 0
        ? missHits[0].point
        : startPos.clone().addScaledVector(missDir, 40);
      this.botManager.effects.createBulletTrail(startPos, endpoint);
    }

    // Always reset far to full range after shot
    this._shootRay.far = 80;
  }
}
