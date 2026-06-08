/**
 * MultiplayerManager — orchestrates the FFA multiplayer session.
 *
 * Responsibilities:
 *  - Spawn / remove remote player meshes (humanoid capsule)
 *  - Lerp remote player positions per-frame
 *  - Run real HumanoidBot AI instances (same as single-player) for bots
 *  - Wire all NetworkManager callbacks for this session
 *  - Send local move each frame
 *  - Track kill scores locally for scoreboard
 */

import * as THREE from 'three';
import { getSharedGeos } from './HumanoidBot.js';
import { HumanoidBot } from './HumanoidBot.js';
import { BotManager } from './BotManager.js';

// ─── Constants ────────────────────────────────────────────────────────────────
const LERP_FACTOR    = 0.3;       // per-frame position lerp

// Colors — all entities (remote players AND bots) share the same neon orange
// so every enemy looks identical in multiplayer.
const COLOR_BOT    = 0xff6600;    // neon orange — used for everyone

// Spawn positions — deliberately placed in the open corridors between the
// 26×26 city blocks that sit at ±23 on X/Z. The old (±20, ±20) positions
// landed INSIDE those blocks. New positions stay in the safe lanes:
//   • Cardinal midpoints along the map edges (0, ±30) / (±30, 0)
//   • Corridor intersections between blocks at ±8 on both axes
//   • Near-centre positions clear of the central monument footprint (8×8)
const SPAWN_POSITIONS = [
  new THREE.Vector3(  0, 2,  30),  // north
  new THREE.Vector3(  0, 2, -30),  // south
  new THREE.Vector3( 30, 2,   0),  // east
  new THREE.Vector3(-30, 2,   0),  // west
  new THREE.Vector3(  8, 2,   8),  // corridor NE — clear of blocks
  new THREE.Vector3( -8, 2,   8),  // corridor NW
  new THREE.Vector3(  8, 2,  -8),  // corridor SE
  new THREE.Vector3( -8, 2,  -8),  // corridor SW
];

function randomSpawnVec3() {
  return SPAWN_POSITIONS[Math.floor(Math.random() * SPAWN_POSITIONS.length)].clone();
}

// ─── Remote player mesh builder (uses shared HumanoidBot geometries) ─────────
function _buildRemotePlayerMesh(color) {
  const geo   = getSharedGeos();
  const mat   = new THREE.MeshBasicMaterial({ color });
  const invis = new THREE.MeshBasicMaterial({ visible: false });
  const group = new THREE.Group();

  const torso = new THREE.Mesh(geo.torso, mat);
  torso.position.y = 1.4;
  group.add(torso);

  const head = new THREE.Mesh(geo.head, mat);
  head.position.y = 2.3;
  const eyeMesh = new THREE.Mesh(geo.eye, new THREE.MeshBasicMaterial({ color: 0xffffff }));
  eyeMesh.position.set(0, 0, 0.26);
  head.add(eyeMesh);
  group.add(head);

  const armL = new THREE.Mesh(geo.arm, mat);
  armL.position.set(-0.55, 1.9, 0);
  group.add(armL);
  group.armL = armL;

  const armR = new THREE.Mesh(geo.arm, mat);
  armR.position.set(0.55, 1.9, 0);
  group.add(armR);
  group.armR = armR;

  const gunMat = new THREE.MeshBasicMaterial({ color: 0x222222 });
  const gun = new THREE.Mesh(geo.gun, gunMat);
  gun.position.set(0, -0.8, 0.2);
  armR.add(gun);

  const legL = new THREE.Mesh(geo.leg, mat);
  legL.position.set(-0.25, 0.8, 0);
  group.add(legL);
  group.legL = legL;

  const legR = new THREE.Mesh(geo.leg, mat);
  legR.position.set(0.25, 0.8, 0);
  group.add(legR);
  group.legR = legR;

  // Invisible hitboxes (shared invis material, per-call instance)
  const hitbox = new THREE.Mesh(geo.hitbox, invis);
  hitbox.position.y = 1.0;
  group.add(hitbox);

  const headHitbox = new THREE.Mesh(geo.headHitbox, invis);
  headHitbox.position.y = 2.3;
  group.add(headHitbox);

  group.animTime = Math.random() * 100;
  group._hitboxes = [hitbox, headHitbox];
  return group;
}

// ─── MultiplayerManager ───────────────────────────────────────────────────────
export class MultiplayerManager {
  /**
   * @param {{
   *   scene: THREE.Scene,
   *   camera: THREE.PerspectiveCamera,
   *   renderer: THREE.WebGLRenderer,
   *   ui: import('./UI.js').UI,
   *   networkManager: import('./NetworkManager.js').NetworkManager,
   *   effects: import('./Effects.js').Effects,
   *   player: import('./Player.js').Player,
   *   sceneManager: import('./SceneManager.js').SceneManager,
   *   audioManager: import('./AudioManager.js').AudioManager,
   * }} opts
   */
  constructor({ scene, camera, renderer, ui, networkManager, effects, player, sceneManager, audioManager }) {
    this.scene          = scene;
    this.camera         = camera;
    this.renderer       = renderer;
    this.ui             = ui;
    this.nm             = networkManager;
    this.effects        = effects;
    this.player         = player;
    this.sceneManager   = sceneManager;
    this.audioManager   = audioManager;

    /** Map<playerId, { mesh:THREE.Group, targetPos:THREE.Vector3, targetRotY:number, isBot:boolean, name:string }> */
    this.remotePlayers  = new Map();

    /** Map<playerId, { score:number, name:string, isBot:boolean }> */
    this.scores         = new Map();

    this.localPlayerId  = null;
    this.localScore     = 0;
    this.active         = false;

    // Scoreboard visible flag
    this._scoreboardVisible = false;

    // Tab key listener (stored for cleanup)
    this._tabListener = null;

    // Real HumanoidBot instances for multiplayer bots
    this.mpBots = [];
    this.mpBotTarget = null;

    // Saved player onDie for cleanup restore
    this._origPlayerDie = undefined;

    // Cached direction vector — reused every frame (FIX 5: avoids per-frame GC alloc)
    this._dir = new THREE.Vector3();

    // Listen for hits from Player.js
    this._hitListener = (e) => {
      if (this.active) {
        this.nm.sendHit(e.detail.targetId, e.detail.damage);
      }
    };
    document.addEventListener('mp_hit_player', this._hitListener);
  }

  getHitboxes() {
    const boxes = [];
    for (const rp of this.remotePlayers.values()) {
      if (rp.hitboxes) boxes.push(...rp.hitboxes);
    }
    if (this.mpBotTarget?._botMeshCache) {
      boxes.push(...this.mpBotTarget._botMeshCache);
    }
    return boxes;
  }

  // ─── Session lifecycle ───────────────────────────────────────────────────────

  /**
   * Call after match_found. Spawns all existing remote players and wires events.
   * @param {{ players: [], roomId: string }} roomData
   */
  start(roomData) {
    this.active        = true;
    this.localPlayerId = this.nm.localPlayerId;
    this.localScore    = 0;

    // Initialise score table from room player list
    this.scores.clear();
    for (const p of roomData.players) {
      this.scores.set(p.id, { score: p.score || 0, name: p.name, isBot: p.isBot });
    }

    // Spawn remote real players (everyone except local and bots)
    for (const p of roomData.players) {
      if (p.id !== this.localPlayerId && !p.isBot) {
        this._spawnRemotePlayer(p);
      }
    }

    // Spawn real HumanoidBot instances for bot players
    const botPlayers = roomData.players.filter(p => p.isBot);
    if (botPlayers.length > 0) {
      // Minimal shim that satisfies all HumanoidBot interface requirements
      this.mpBotTarget = {
        wave: 1,
        bots: [],
        player: this.player,
        ui: this.ui,
        effects: this.effects,
        audioManager: this.audioManager,
        camera: this.camera,
        renderer: this.renderer,
        triggerSlowMo: () => {},
        _botMeshCache: [],
      // Called by HumanoidBot.die() — FIX 4: complete shim with score tracking
        onBotDeath: (bot) => {
          this.ui.showNotification('BOT ELIMINATED', '#ff2200');
          this.ui.addKillFeed(`You ✦ ${bot.type}`, 0x00ff88);
          if (this.mpBotTarget) {
            const h1 = this.mpBotTarget._botMeshCache.indexOf(bot.hitbox);
            if (h1 > -1) this.mpBotTarget._botMeshCache.splice(h1, 1);
            const h2 = this.mpBotTarget._botMeshCache.indexOf(bot.headHitbox);
            if (h2 > -1) this.mpBotTarget._botMeshCache.splice(h2, 1);
          }
          this.localScore++;
          const localEntry = this.scores.get(this.localPlayerId);
          if (localEntry) localEntry.score = this.localScore;
          if (this._scoreboardVisible) {
            this.ui.toggleScoreboard(true, this._getScoreboardData());
          }
        },
      };

      for (const _p of botPlayers) {
        const spawnPos = randomSpawnVec3();
        const type = 'SHOOTER'; // Bug 5: always use SHOOTER (red) in multiplayer
        const bot = new HumanoidBot(spawnPos, this.scene, this.player, this.mpBotTarget, type);
        this.mpBotTarget.bots.push(bot);
        this.mpBotTarget._botMeshCache.push(bot.hitbox);
        if (bot.headHitbox) this.mpBotTarget._botMeshCache.push(bot.headHitbox);
        this.mpBots.push(bot);
      }
    }

    // Override local player death — FIX 2: reset isDead + re-lock pointer after respawn
    this._origPlayerDie = this.player.onDie;
    this.player.onDie = () => {
      const spawn = randomSpawnVec3();
      this.player.camera.position.copy(spawn);
      this.player.health = 100;
      this.player.isDead = false;
      this.player.velocity.set(0, 0, 0);
      this.ui.updateHealth(100, 100);
      this.ui.showNotification('RESPAWNED', '#00f3ff');
      setTimeout(() => {
        if (this.active) this.player.controls.lock();
      }, 400);
    };

    // Wire network callbacks
    this._wireCallbacks();

    // Tab scoreboard
    this._tabListener = (e) => {
      if (e.code === 'Tab') {
        e.preventDefault();
        this._scoreboardVisible = !this._scoreboardVisible;
        this.ui.toggleScoreboard(this._scoreboardVisible, this._getScoreboardData());
      }
    };
    document.addEventListener('keydown', this._tabListener);
  }

  /**
   * Called every game frame (from main.js animate loop).
   * @param {number} delta — seconds since last frame
   */
  update(delta) {
    if (!this.active) return;

    // Send local move
    const localPos = this.camera.position;
    // rotationY is stored on the camera's parent (PointerLockControls yaw object)
    // We read it from camera.rotation but PointerLockControls stores yaw on the
    // object that camera is a child of. Use camera.getWorldDirection instead.
    // FIX 5: reuse cached _dir, no per-frame allocation
    this.camera.getWorldDirection(this._dir);
    const rotY = Math.atan2(this._dir.x, this._dir.z);
    this.nm.sendMove(
      { x: localPos.x, y: localPos.y, z: localPos.z },
      rotY,
    );

    // Lerp all remote player meshes toward their targets
    for (const rp of this.remotePlayers.values()) {
      if (rp.mesh) {
        // Calculate if moving to animate limbs
        const dist = rp.mesh.position.distanceTo(rp.targetPos);
        const isMoving = dist > 0.05;

        rp.mesh.position.lerp(rp.targetPos, LERP_FACTOR);
        // Lerp rotation via quaternion on Y axis
        const targetQuat = new THREE.Quaternion().setFromEuler(
          new THREE.Euler(0, rp.targetRotY, 0),
        );
        rp.mesh.quaternion.slerp(targetQuat, LERP_FACTOR);

        // Animate limbs
        rp.mesh.animTime += delta * 15.0; // speed multiplier
        if (isMoving) {
          rp.mesh.legL.rotation.x = Math.sin(rp.mesh.animTime)           * 0.8;
          rp.mesh.legR.rotation.x = Math.sin(rp.mesh.animTime + Math.PI) * 0.8;
          rp.mesh.armL.rotation.x = Math.sin(rp.mesh.animTime + Math.PI) * 0.5;
        } else {
          rp.mesh.legL.rotation.x = 0;
          rp.mesh.legR.rotation.x = 0;
          rp.mesh.armL.rotation.x = 0;
        }
        // ArmR holds the gun
        rp.mesh.armR.rotation.x = isMoving ? Math.sin(rp.mesh.animTime) * 0.5 : 0;
      }
    }

    // Real HumanoidBot AI update
    this._updateBots(delta);
  }

  /** Remove all remote meshes, clear state, remove listeners. */
  cleanup() {
    this.active = false;

    for (const rp of this.remotePlayers.values()) {
      if (rp.mesh) this.scene.remove(rp.mesh);
    }
    this.remotePlayers.clear();
    this.scores.clear();
    this.localScore = 0;

    // Clean up HumanoidBot instances
    if (this.mpBots) {
      for (const bot of this.mpBots) {
        if (!bot.isFullyDead && bot.mesh) this.scene.remove(bot.mesh);
      }
      this.mpBots = [];
    }
    this.mpBotTarget = null;

    // Restore player's original onDie handler
    if (this._origPlayerDie !== undefined) {
      this.player.onDie = this._origPlayerDie;
      this._origPlayerDie = undefined;
    }

    if (this._tabListener) {
      document.removeEventListener('keydown', this._tabListener);
      this._tabListener = null;
    }

    // Hide scoreboard
    this.ui.toggleScoreboard(false, []);

    // Null out nm callbacks to avoid stale refs
    this.nm.onRoomUpdate          = null;
    this.nm.onMatchStart          = null;
    this.nm.onTimerUpdate         = null;
    this.nm.onRemotePlayerMoved   = null;
    this.nm.onRemotePlayerShot    = null;
    this.nm.onRemotePlayerDamaged = null;
    this.nm.onKillEvent           = null;
    this.nm.onPlayerLeft          = null;
    this.nm.onMatchEnded          = null;
    this.nm.onCountdownTick       = null;
    this.nm.onCountdownStart      = null;
    this.nm.onHostChoiceRequired  = null;
    this.nm.onWaitingForHost      = null;
    this.nm.onRemotePlayerRespawned = null;
  }

  // ─── Private: Network callback wiring ────────────────────────────────────────

  _wireCallbacks() {
    this.nm.onRoomUpdate = ({ players }) => {
      // Add any newly joined players, update score table
      for (const p of players) {
        if (p.id === this.localPlayerId) continue;
        if (!p.isBot && !this.remotePlayers.has(p.id)) {
          this._spawnRemotePlayer(p);
        }
        this.scores.set(p.id, {
          score: p.score || 0,
          name: p.name,
          isBot: p.isBot,
        });
      }
    };

    this.nm.onRemotePlayerMoved = ({ playerId, position, rotationY }) => {
      const rp = this.remotePlayers.get(playerId);
      if (!rp) return;
      // Subtract the local camera eye-height (2) so the mesh root sits on the
      // ground rather than floating at camera height.
      rp.targetPos.set(position.x, position.y - 2, position.z);
      rp.targetRotY = rotationY;
    };

    this.nm.onRemotePlayerShot = ({ playerId, origin }) => {
      const rp = this.remotePlayers.get(playerId);
      if (!rp || !this.effects) return;
      // Muzzle flash at remote player gun position — use same orange as the model
      const flashPos = rp.mesh
        ? rp.mesh.position.clone().add(new THREE.Vector3(0, 1.4, 0))
        : new THREE.Vector3(origin.x, origin.y - 2, origin.z);
      this.effects.createExplosion(flashPos, COLOR_BOT);
    };

    this.nm.onRemotePlayerDamaged = ({ targetId, newHealth }) => {
      // If WE were the target, apply damage to local player
      if (targetId === this.localPlayerId && this.player) {
        const dmg = this.player.health - newHealth;
        if (dmg > 0) {
          this.player.takeDamage(dmg);
        }
      }
    };

    this.nm.onKillEvent = ({ killerName, killedName, killedId, killerId, scores }) => {
      // Update scoreboard data
      for (const s of scores) {
        const existing = this.scores.get(s.id);
        if (existing) existing.score = s.score;
        else this.scores.set(s.id, { score: s.score, name: s.name, isBot: s.isBot });
      }

      // Kill feed (reuse existing UI method)
      const isLocalKill = (killerId === this.localPlayerId);
      const color = isLocalKill ? 0x00ff88 : 0xff00ff;
      this.ui.addKillFeed(`${killerName} ✦ ${killedName}`, color);

      // "+1" score popup for local killer
      if (isLocalKill) {
        this.localScore++;
        this.ui.showNotification('+1 KILL', '#00ff88');
      }

      // Respawn local player if they were killed by a remote player (server-authoritative)
      if (killedId === this.localPlayerId && this.player) {
        const spawn = randomSpawnVec3();
        this.player.camera.position.copy(spawn);
        this.player.health = 100;
        this.ui.updateHealth(100, 100);
        this.ui.showNotification('RESPAWNED', '#00f3ff');
      }

      // Update HUD scoreboard if open
      if (this._scoreboardVisible) {
        this.ui.toggleScoreboard(true, this._getScoreboardData());
      }
    };

    this.nm.onPlayerLeft = ({ playerId, playerName }) => {
      this._removeRemotePlayer(playerId);
      this.scores.delete(playerId);
      this.ui.showNotification(`${playerName} left the match`, '#ffcc00');
    };

    this.nm.onMatchEnded = (data) => {
      this.active = false;
      this.ui.toggleScoreboard(false, []);
      // Bubble up to main.js via a custom event
      window.dispatchEvent(new CustomEvent('mp_match_ended', { detail: data }));
    };

    this.nm.onTimerUpdate = ({ secondsLeft }) => {
      this.ui.updateMatchTimer(secondsLeft);
    };

    this.nm.onRemotePlayerRespawned = ({ playerId, position }) => {
      const rp = this.remotePlayers.get(playerId);
      if (!rp) return;
      // Snap to new position (no lerp on respawn) — subtract eye-height offset
      rp.targetPos.set(position.x, position.y - 2, position.z);
      if (rp.mesh) rp.mesh.position.copy(rp.targetPos);
    };
  }

  // ─── Private: Remote player mesh lifecycle ────────────────────────────────────

  _spawnRemotePlayer(playerData) {
    const color = COLOR_BOT;
    const mesh  = _buildRemotePlayerMesh(color);

    // Assign random starting spawn — Y=0 so feet are on the ground
    // (remote player positions received over the network are camera Y, which
    //  is 2 units above ground, so we keep the spawn at ground level here).
    const spawnPos = randomSpawnVec3();
    spawnPos.y = 0;
    mesh.position.copy(spawnPos);

    // Wire hitbox userData
    const [hitbox, headHitbox] = mesh._hitboxes;
    hitbox.userData.isRemotePlayer    = true;
    hitbox.userData.playerId          = playerData.id;
    headHitbox.userData.isRemotePlayer = true;
    headHitbox.userData.playerId       = playerData.id;
    headHitbox.userData.isHeadshot     = true;

    this.scene.add(mesh);

    this.remotePlayers.set(playerData.id, {
      mesh,
      hitboxes:   [hitbox, headHitbox],
      targetPos:  spawnPos.clone(),
      targetRotY: 0,
      isBot:      false,
      name:       playerData.name,
    });

    this.scores.set(playerData.id, {
      score: playerData.score || 0,
      name:  playerData.name,
      isBot: playerData.isBot,
    });
  }

  _removeRemotePlayer(playerId) {
    const rp = this.remotePlayers.get(playerId);
    if (!rp) return;
    if (rp.mesh) this.scene.remove(rp.mesh);
    this.remotePlayers.delete(playerId);
  }

  // ─── Private: Bot AI (real HumanoidBot instances) ────────────────────────────

  _updateBots(delta) {
    if (!this.mpBots || this.mpBots.length === 0) return;
    const time = performance.now() / 1000;
    for (const bot of this.mpBots) {
      if (!bot.isFullyDead) bot.update(delta, time);
    }
    // FIX 3: prune fully-dead bots from both mpBots and mpBotTarget.bots
    for (let i = this.mpBots.length - 1; i >= 0; i--) {
      if (this.mpBots[i].isFullyDead) {
        const dead = this.mpBots[i];
        this.mpBots.splice(i, 1);
        if (this.mpBotTarget) {
          const j = this.mpBotTarget.bots.indexOf(dead);
          if (j > -1) this.mpBotTarget.bots.splice(j, 1);
        }
      }
    }
  }

  // ─── Private: Scoreboard data builder ────────────────────────────────────────

  _getScoreboardData() {
    const arr = [];
    // Add local player
    const localScoreEntry = this.scores.get(this.localPlayerId);
    arr.push({
      id:      this.localPlayerId,
      name:    localScoreEntry?.name || 'You',
      score:   this.localScore,
      isBot:   false,
      isLocal: true,
    });
    // Add all remote players
    for (const [id, s] of this.scores) {
      if (id === this.localPlayerId) continue;
      arr.push({ id, name: s.name, score: s.score, isBot: s.isBot, isLocal: false });
    }
    // Sort by score descending
    arr.sort((a, b) => b.score - a.score);
    return arr;
  }
}
