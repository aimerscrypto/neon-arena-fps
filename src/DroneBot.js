import * as THREE from 'three';

const _hitboxMat = new THREE.MeshBasicMaterial({ visible: false });

export class DroneBot {
  constructor(position, scene, player, botManager) {
    this.scene = scene;
    this.player = player;
    this.botManager = botManager;
    this.isDead = false;
    this.isFullyDead = false;

    this.type = 'DRONE';
    this.health = 50;
    this.maxHealth = 50;
    this.speed = 5.0;
    this.scoreValue = 150;
    this.attackRange = 35;
    this.stats = { color: 0xaa00ff };
    
    // Core states
    this.lastShootTime = 0;
    this.activationDelay = 1.0;
    this._flashTimer = 0;
    
    this._moveDir = new THREE.Vector3();
    this.hoverTime = Math.random() * Math.PI * 2;
    this.targetAltitude = 4.0;
    
    this._shootRay = new THREE.Raycaster();
    this._botBox = new THREE.Box3();

    this._buildMesh();
    this.mesh.position.copy(position);
    this.mesh.position.y = this.targetAltitude;
    this.scene.add(this.mesh);
  }

  _buildMesh() {
    this.mesh = new THREE.Group();
    
    this.mat = new THREE.MeshBasicMaterial({ color: 0xaa00ff }); // Purple drone
    this._origColor = 0xaa00ff;

    // Chassis
    this.chassis = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.4, 0.8), this.mat);
    this.mesh.add(this.chassis);

    // Eye
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    this.eye = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.1, 0.2), eyeMat);
    this.eye.position.set(0, 0, 0.41);
    this.chassis.add(this.eye);

    // Thrusters
    this.thrusterL = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.15, 0.4, 8), this.mat);
    this.thrusterL.position.set(-0.5, -0.2, 0);
    this.mesh.add(this.thrusterL);
    
    this.thrusterR = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.15, 0.4, 8), this.mat);
    this.thrusterR.position.set(0.5, -0.2, 0);
    this.mesh.add(this.thrusterR);

    // Hitbox
    this.hitbox = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.0, 1.4), _hitboxMat);
    this.hitbox.userData.bot = this;
    this.mesh.add(this.hitbox);
  }

  takeDamage(amount, hitDir = new THREE.Vector3(0,0,1)) {
    this.health -= amount;
    if (this.health <= 0 && !this.isDead) {
      this.die(hitDir);
    } else {
      this._flash();
    }
  }

  _flash() {
    if (this._flashTimer > 0) return;
    this.mat.color.setHex(0xffffff);
    this._flashTimer = 0.1;
  }
  
  _restoreColor() {
    this.mat.color.setHex(this._origColor);
  }

  die() {
    if (this.isDead) return;
    this.isDead = true;
    this.isDying = true;
    this._dyingTimer = 1.5;
    this._deathStartY = this.mesh.position.y;

    this.hitbox.userData.bot = null;

    const deathPos = this.mesh.position.clone();
    this.botManager.effects.createExplosion(deathPos, 0xaa00ff);
    this.botManager.audioManager.playExplosion();
    this.botManager.audioManager.playKill();
    this.botManager.effects.shakeCamera(0.2);

    this.botManager.onBotDeath(this);
  }

  update(delta, time) {
    if (this.isFullyDead) return;
    
    if (this.isDying) {
      this._dyingTimer -= delta;
      const t = 1 - Math.max(0, this._dyingTimer / 1.5);
      this.mesh.rotation.x = t * (Math.PI / 2);
      this.mesh.position.y = this._deathStartY - t * 5.0; // falls to the floor quickly
      if (this._dyingTimer <= 0) {
        this.mat.dispose();
        this.scene.remove(this.mesh);
        this.isFullyDead = true;
        this.isDying = false;
      }
      return;
    }

    if (this.activationDelay > 0) {
      this.activationDelay -= delta;
      return;
    }

    if (this._flashTimer > 0) {
      this._flashTimer -= delta;
      if (this._flashTimer <= 0) this._restoreColor();
    }

    const playerPos = this.player.camera.position;
    const pos = this.mesh.position;
    const dist = pos.distanceTo(playerPos);

    // Look at player
    this.mesh.lookAt(playerPos);

    // Hover logic
    this.hoverTime += delta * 2.0;
    this.targetAltitude = playerPos.y + 3.5 + Math.sin(this.hoverTime) * 0.5;

    // Movement
    if (dist > 8) {
      this._moveDir.subVectors(playerPos, pos).normalize();
      this._moveDir.y = 0; // Only horizontal drive
    } else {
      // Strafe slowly
      this._moveDir.set(Math.cos(this.hoverTime), 0, Math.sin(this.hoverTime)).normalize();
    }

    // X Collision
    let oldX = pos.x;
    pos.x += this._moveDir.x * this.speed * delta;
    this._botBox.min.set(pos.x - 0.8, pos.y - 0.5, pos.z - 0.8);
    this._botBox.max.set(pos.x + 0.8, pos.y + 1.0, pos.z + 0.8);
    for (let i = 0; i < this.botManager.player.sceneManager.collidableBoxes.length; i++) {
      const box = this.botManager.player.sceneManager.collidableBoxes[i];
      if (box.max.y > pos.y && box.min.y < pos.y + 1.0 && this._botBox.intersectsBox(box)) {
        // Push drone away from box center instead of just restoring old position
        const boxCenterX = (box.min.x + box.max.x) * 0.5;
        const pushDir = pos.x - boxCenterX;
        pos.x = boxCenterX + (pushDir >= 0 ? 1.4 : -1.4); // 0.8 radius + 0.6
        break;
      }
    }

    // Z Collision
    let oldZ = pos.z;
    pos.z += this._moveDir.z * this.speed * delta;
    this._botBox.min.set(pos.x - 0.8, pos.y - 0.5, pos.z - 0.8);
    this._botBox.max.set(pos.x + 0.8, pos.y + 1.0, pos.z + 0.8);
    for (let i = 0; i < this.botManager.player.sceneManager.collidableBoxes.length; i++) {
      const box = this.botManager.player.sceneManager.collidableBoxes[i];
      if (box.max.y > pos.y && box.min.y < pos.y + 1.0 && this._botBox.intersectsBox(box)) {
        // Push drone away from box center instead of just restoring old position
        const boxCenterZ = (box.min.z + box.max.z) * 0.5;
        const pushDir = pos.z - boxCenterZ;
        pos.z = boxCenterZ + (pushDir >= 0 ? 1.4 : -1.4); // 0.8 radius + 0.6
        break;
      }
    }
    
    // Altitude adjustment
    pos.y += (this.targetAltitude - pos.y) * 2.0 * delta;

    // Boundary clamp
    pos.x = Math.max(-38, Math.min(38, pos.x));
    pos.z = Math.max(-38, Math.min(38, pos.z));

    // Shooting
    if (dist < this.attackRange && time - this.lastShootTime > 1.2) {
      const muzzlePos = pos.clone();
      muzzlePos.y -= 0.3;
      
      const dirToPlayer = new THREE.Vector3().subVectors(playerPos, muzzlePos).normalize();
      this._shootRay.set(muzzlePos, dirToPlayer);
      this._shootRay.far = dist;
      const losHits = this._shootRay.intersectObjects(this.botManager.player.sceneManager.collidableMeshes, false);
      const blocked = losHits.length > 0 && losHits[0].distance < dist - 0.3;

      if (!blocked) {
        this.lastShootTime = time;
        
        // Simple downward blast
        const hitChance = Math.random();
        if (hitChance > 0.4) {
          this.player.takeDamage(8);
          this.botManager.ui.showDamageOverlay();
          this.botManager.effects.shakeCamera(0.2);
          this.botManager.audioManager.playEnemyHitFlesh();
        }
        
        // Visual tracer
        const targetOff = playerPos.clone();
        targetOff.x += (Math.random() - 0.5) * 2;
        targetOff.z += (Math.random() - 0.5) * 2;
        this.botManager.effects.createBulletTrail(muzzlePos, targetOff, 1.5, 0xff0000);
        this.botManager.audioManager.playShoot();
      }
    }
  }
}
