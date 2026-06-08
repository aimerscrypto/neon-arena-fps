import * as THREE from 'three';

export class ProjectileManager {
  constructor(scene, botManager, effects, audioManager, sceneManager) {
    this.scene = scene;
    this.botManager = botManager;
    this.effects = effects;
    this.audioManager = audioManager;
    this.sceneManager = sceneManager;

    this.projectiles = [];
    
    // Reusable geometry for the rockets
    this.rocketGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.4, 8);
    this.rocketGeo.rotateX(Math.PI / 2);
    this.rocketMat = new THREE.MeshStandardMaterial({ color: 0x22aa22, emissive: 0x115511 });
    
    // Raycaster for continuous collision detection
    this.raycaster = new THREE.Raycaster();
  }

  spawnRocket(position, direction, damage, explosionRadius, speed = 40) {
    const mesh = new THREE.Mesh(this.rocketGeo, this.rocketMat);
    mesh.position.copy(position);
    
    // Orient the rocket to face its direction
    const target = position.clone().add(direction);
    mesh.lookAt(target);

    // Add a small light to the rocket so it glows as it flies
    const light = new THREE.PointLight(0x44ff44, 2, 5);
    mesh.add(light);

    this.scene.add(mesh);

    this.projectiles.push({
      mesh,
      direction: direction.clone().normalize(),
      speed,
      damage,
      explosionRadius,
      life: 5.0 // Max 5 seconds lifetime to prevent infinite flying
    });
  }

  update(delta) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= delta;

      if (p.life <= 0) {
        this._destroyProjectile(i);
        continue;
      }

      // Calculate new position
      const moveDist = p.speed * delta;
      const oldPos = p.mesh.position.clone();
      const newPos = oldPos.clone().addScaledVector(p.direction, moveDist);

      // ── Collision Detection ──
      // Raycast from oldPos to newPos to prevent tunneling through thin walls
      this.raycaster.set(oldPos, p.direction);
      this.raycaster.far = moveDist;

      // 1. Check walls/floors
      let hitPos = null;
      let hitNormal = null;
      let hitSomething = false;

      const envHits = this.raycaster.intersectObjects(this.sceneManager.collidableMeshes, false);
      if (envHits.length > 0) {
        hitPos = envHits[0].point;
        hitNormal = envHits[0].face ? envHits[0].face.normal : null;
        hitSomething = true;
      }

      // 2. Check enemies (basic sphere check for early detonation)
      if (!hitSomething) {
        // Solo bots
        if (this.botManager && this.botManager.bots) {
          for (let j = 0; j < this.botManager.bots.length; j++) {
            const bot = this.botManager.bots[j];
            if (bot.isDead) continue;
            
            // Simple ray-to-point distance check for the bot's body
            const botCenter = bot.mesh.position.clone();
            botCenter.y += 1.2; // approx center of mass
            
            const distToRay = this.raycaster.ray.distanceSqToPoint(botCenter);
            
            if (distToRay < 0.64) {
              const toBot = botCenter.clone().sub(oldPos);
              const projection = toBot.dot(p.direction);
              if (projection > 0 && projection < moveDist) {
                hitPos = oldPos.clone().addScaledVector(p.direction, projection);
                hitSomething = true;
                break;
              }
            }
          }
        }
        
        // Remote players (Multiplayer)
        if (!hitSomething && this.multiplayerManager && this.multiplayerManager.active) {
          for (const rp of this.multiplayerManager.remotePlayers.values()) {
            if (!rp.mesh) continue;
            const rpCenter = rp.mesh.position.clone();
            rpCenter.y += 1.2;
            const distToRay = this.raycaster.ray.distanceSqToPoint(rpCenter);
            if (distToRay < 0.64) {
              const toRp = rpCenter.clone().sub(oldPos);
              const projection = toRp.dot(p.direction);
              if (projection > 0 && projection < moveDist) {
                hitPos = oldPos.clone().addScaledVector(p.direction, projection);
                hitSomething = true;
                break;
              }
            }
          }
          // Also proximity-check multiplayer AI bots during flight
          if (!hitSomething && this.multiplayerManager.mpBots) {
            for (const bot of this.multiplayerManager.mpBots) {
              if (bot.isDead || bot.isFullyDead) continue;
              const botCenter = bot.mesh.position.clone();
              botCenter.y += 1.2;
              const distToRay = this.raycaster.ray.distanceSqToPoint(botCenter);
              if (distToRay < 0.64) {
                const toBot = botCenter.clone().sub(oldPos);
                const projection = toBot.dot(p.direction);
                if (projection > 0 && projection < moveDist) {
                  hitPos = oldPos.clone().addScaledVector(p.direction, projection);
                  hitSomething = true;
                  break;
                }
              }
            }
          }
        }
      }

      if (hitSomething) {
        this._explode(hitPos, hitNormal, p.damage, p.explosionRadius);
        this._destroyProjectile(i);
      } else {
        // No collision, apply movement
        p.mesh.position.copy(newPos);
      }
    }
  }

  _explode(position, normal, maxDamage, radius) {
    // 1. Visual/Audio Effects
    // Triple the explosion particles and color it like fire!
    this.effects.createLargeExplosion(position, 0xff5500); 
    this.effects.createLargeExplosion(position, 0xffaa00);
    this.effects.createLargeExplosion(position, 0xff3300);
    
    if (this.effects.createExpandingRing) {
      this.effects.createExpandingRing(position, 0xff5500); // Cool orange ring
      this.effects.createExpandingRing(position, 0xffaa00); // Second internal ring
    }
    if (normal) {
      this.effects.createImpact(position, normal);
    }
    
    // Stack the explosion and rocket impact sounds for a massive bass hit
    this.audioManager.playExplosion();
    this.audioManager.playRocketImpact();
    this.effects.shakeCamera(0.9);

    // 2. AoE Damage
    const radiusSq = radius * radius;
    
    // Solo bots
    if (this.botManager && this.botManager.bots) {
      for (let j = 0; j < this.botManager.bots.length; j++) {
        const bot = this.botManager.bots[j];
        if (bot.isDead) continue;

        const distSq = bot.mesh.position.distanceToSquared(position);
        if (distSq < radiusSq) {
          const dist = Math.sqrt(distSq);
          // Damage falloff: full damage at center, 20% at edge
          const damageMultiplier = Math.max(0.2, 1.0 - (dist / radius));
          const finalDamage = maxDamage * damageMultiplier;
          
          // Calculate hit direction pushing outward from explosion
          const hitDir = bot.mesh.position.clone().sub(position).normalize();
          hitDir.y += 0.5;
          hitDir.normalize();

          // Deal damage
          bot.takeDamage(finalDamage, hitDir);
        }
      }
    }
    
    // Multiplayer Remote Players
    if (this.multiplayerManager && this.multiplayerManager.active) {
      for (const [playerId, rp] of this.multiplayerManager.remotePlayers.entries()) {
        if (!rp.mesh) continue;
        
        const distSq = rp.mesh.position.distanceToSquared(position);
        if (distSq < radiusSq) {
          const dist = Math.sqrt(distSq);
          const damageMultiplier = Math.max(0.2, 1.0 - (dist / radius));
          const finalDamage = maxDamage * damageMultiplier;
          
          // Dispatch mp_hit_player to send hit to server
          document.dispatchEvent(new CustomEvent('mp_hit_player', {
            detail: { targetId: playerId, damage: finalDamage, isHeadshot: false }
          }));
        }
      }

      // Multiplayer AI bots (HumanoidBot instances owned by MultiplayerManager)
      if (this.multiplayerManager.mpBots) {
        for (const bot of this.multiplayerManager.mpBots) {
          if (bot.isDead || bot.isFullyDead) continue;
          const distSq = bot.mesh.position.distanceToSquared(position);
          if (distSq < radiusSq) {
            const dist = Math.sqrt(distSq);
            const damageMultiplier = Math.max(0.2, 1.0 - (dist / radius));
            const finalDamage = maxDamage * damageMultiplier;
            bot.takeDamage(finalDamage);
          }
        }
      }
    }
  }

  _destroyProjectile(index) {
    const p = this.projectiles[index];
    this.scene.remove(p.mesh);
    this.projectiles.splice(index, 1);
  }
}
