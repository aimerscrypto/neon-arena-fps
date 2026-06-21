import * as THREE from 'three';
import { HumanoidBot } from './HumanoidBot.js';
import { DroneBot } from './DroneBot.js';

export class BotManager {
  constructor(scene, player, ui, effects, triggerSlowMo, audioManager, camera, renderer) {
    this.scene = scene;
    this.player = player;
    this.ui = ui;
    this.effects = effects;
    this.triggerSlowMo = triggerSlowMo;
    this.audioManager = audioManager;
    this.camera = camera;   // for floating text projection
    this.renderer = renderer; // for floating text projection

    this.bots = [];
    this._botMeshCache = [];  // kept in sync with this.bots — no allocation on read
    this.wave = 1;
    this.botsToSpawn = 0;
    this.spawnTimer = 0;

    // Combo system
    this.combo = 1;
    this.comboTimer = 0;
    this.maxComboTimer = 5.0;

    // Kill Streak
    this.killStreak = 0;

    // Kill counters
    this.totalKills = 0;  // resets on full game reset
    this.waveKills = 0;  // resets each wave
    this.waveScore = 0;  // score earned this wave, resets each wave

    this.startWave(1);
  }

  // ─────────────────────────────────────────────────────────────
  startWave(waveNum) {
    this.wave = waveNum;
    this.waveKills = 0;
    this.waveScore = 0;

    if (this.player && this.player.sceneManager) {
      let targetLayout = 1;
      if (waveNum > 6) targetLayout = 3;
      else if (waveNum > 3) targetLayout = 2;
      
      if (this.player.sceneManager.currentLayout !== targetLayout) {
        this.player.sceneManager.changeLayout(targetLayout);
        if (waveNum > 1) {
          this.ui.showNotification("ARENA SHIFT!", "#00f3ff");
        }
      }
    }

    if (waveNum % 3 === 0) {
      this.waveTotalBots = 1;
      this.botsToSpawn = 0; // Spawn manually
      this.ui.setWave(this.wave);
      this.ui.showBossAnnouncement();
      if (this.audioManager) this.audioManager.updateMusicIntensity(waveNum, true);
      this.spawnBot(true);
    } else {
      let totalBots = 4;
      for (let w = 2; w <= waveNum; w++) {
        if (w === 3 || w === 4 || w === 5) {
          totalBots += 1; // Add 1 when a new enemy is introduced
        } else {
          totalBots += 2; // Add 2 otherwise
        }
      }

      this.waveTotalBots = totalBots;
      this.botsToSpawn = this.waveTotalBots;
      this.ui.setWave(this.wave);
      this.ui.showWaveAnnouncement(this.wave);
      if (this.audioManager) {
        this.audioManager.updateMusicIntensity(waveNum, false);
        this.audioManager.playWaveStart();
      }
    }

    // Reset powerup wave counters so new drops are possible
    if (this.powerupManager) this.powerupManager.resetForWave();

    this._updateEnemyUI();
  }

  _updateEnemyUI() {
    let aliveCount = 0;
    for (let i = 0; i < this.bots.length; i++) {
      if (!this.bots[i].isDead) aliveCount++;
    }
    if (this.ui.updateEnemyCounter) {
      this.ui.updateEnemyCounter(aliveCount, this.waveTotalBots);
    }
  }

  reset() {
    this.bots.forEach(b => this.scene.remove(b.mesh));
    this.bots = [];
    this._botMeshCache = [];
    this.combo = 1;
    this.comboTimer = 0;
    this.killStreak = 0;
    this.totalKills = 0;
    this.waveKills = 0;
    this.waveScore = 0;
    this.ui.resetStreak();
    this.startWave(1);
  }

  // ─────────────────────────────────────────────────────────────
  spawnBot(isBoss = false) {
    let type = 'SHOOTER';
    if (isBoss) {
      type = 'TANK';
    } else if (this.wave > 2) {
      const r = Math.random();
      if (r < 0.15 && this.wave >= 4) type = 'SHIELD';
      else if (r < 0.30) type = 'FAST';
      else if (r < 0.42 && this.wave > 4) type = 'TANK';
      else if (r > 0.85 && this.wave >= 5) type = 'DRONE';
    }

    const colSize = isBoss ? 1.5 : 0.6;

    let pos = new THREE.Vector3();
    let valid = false;
    let tries = 0;
    while (!valid && tries < 50) {
      pos.x = (Math.random() - 0.5) * 76;
      pos.z = (Math.random() - 0.5) * 76;
      pos.y = 0;
      if (pos.distanceTo(this.player.camera.position) > 30) {
        // Check against collidable boxes to prevent spawning inside objects
        const testBox = new THREE.Box3(
          new THREE.Vector3(pos.x - colSize, pos.y, pos.z - colSize),
          new THREE.Vector3(pos.x + colSize, pos.y + 2.6, pos.z + colSize)
        );
        let blocked = false;
        for (let i = 0; i < this.player.sceneManager.collidableBoxes.length; i++) {
          if (this.player.sceneManager.collidableBoxes[i].intersectsBox(testBox)) {
            blocked = true;
            break;
          }
        }
        if (!blocked) valid = true;
      }
      tries++;
    }

    let bot;
    if (type === 'DRONE') {
      bot = new DroneBot(pos, this.scene, this.player, this);
    } else {
      bot = new HumanoidBot(pos, this.scene, this.player, this, type);
    }

    if (isBoss) {
      bot.health *= 4; // Reduced boss health by 50%
      bot.maxHealth = bot.health;
      bot.maxSpeed *= 1.3;
      bot.speed = bot.maxSpeed;
      bot.mesh.scale.setScalar(2.2);
      bot.mat.color.setHex(0xffaa00);
      bot._origColor = 0xffaa00; // So flash returns to correct color
      bot.isBoss = true;
      if (this.audioManager) this.audioManager.playBossAppear();
    }

    this.bots.push(bot);
    this._botMeshCache.push(bot.hitbox);
    if (bot.headHitbox) this._botMeshCache.push(bot.headHitbox);
    this._updateEnemyUI();
  }

  // ─────────────────────────────────────────────────────────────
  onBotDeath(bot) {
    // Kill feed & score are shown immediately; mesh removal happens once
    // the ragdoll animation finishes (isFullyDead flag set by HumanoidBot)

    // Kill counters
    this.totalKills++;
    this.waveKills++;

    // Kill feed notification
    this.ui.addKillFeed(`ELIMINATED ${bot.type}`, bot.stats.color);
    this._updateEnemyUI();

    // Boss defeat logic
    if (bot.isBoss) {
      if (this.audioManager) this.audioManager.updateMusicIntensity(this.wave, false);
      const bossScore = 1000 * this.combo;
      this.ui.addScore(bossScore);
      this.waveScore += bossScore;
      if (this.powerupManager) {
        const p1 = bot.mesh.position.clone(); p1.x -= 1.0;
        this.powerupManager.spawnEnemyDropAt(p1, 'HEALTH');
        const p2 = bot.mesh.position.clone(); p2.x += 0;
        this.powerupManager.spawnEnemyDropAt(p2, 'GRENADE');
        const p3 = bot.mesh.position.clone(); p3.x += 1.0;
        this.powerupManager.spawnEnemyDropAt(p3, 'AMMO');
      }
      this.ui.showNotification('BOSS DEFEATED!', '#ffaa00');
      if (this.triggerSlowMo) this.triggerSlowMo();
      this.effects.shakeCamera(0.8);
      // Floating boss kill text
      if (this.camera && this.renderer) {
        this.ui.showBossKillText(bot.mesh.position.clone(), bossScore, this.camera, this.renderer);
      }
    } else {
      if (this.powerupManager) {
        if (Math.random() <= 0.25) {
          this.powerupManager.spawnEnemyDropAt(bot.mesh.position.clone());
        }
      }
    }

    // Adrenaline: each kill triggers brief slow-mo
    if (this.player._adrenalineActive && this.triggerSlowMo) this.triggerSlowMo();
    // Scavenger: 40% chance to drop a mini health pickup on kill
    if (this.player._scavengerActive && this.powerupManager && Math.random() < 0.4) {
      this.powerupManager.spawnEnemyDropAt(bot.mesh.position.clone(), 'HEALTH');
    }

    // Combo
    this.combo++;
    this.comboTimer = this.maxComboTimer;

    if (this.combo === 5 || this.combo === 10 || this.combo === 15 || this.combo === 20) {
      this.ui.showRampage();
      // Floating combo milestone text
      this.ui.showComboText(this.combo);
    }

    // Kill Streak
    this.killStreak++;
    this.ui.showStreak(this.killStreak);

    if (this.killStreak === 3) {
      this.ui.showNotification('3 KILL STREAK!', '#00ff88');
    } else if (this.killStreak === 5) {
      this.ui.showNotification('5 KILL STREAK!', '#00ff88');
    } else if (this.killStreak === 7) {
      this.ui.showNotification('UNSTOPPABLE!', '#00ff88');
    } else if (this.killStreak === 10) {
      this.ui.showNotification('GODLIKE!', '#00ff88');
    }

    const baseScore = bot.killedByHeadshot ? 150 : 100;
    const earnedScore = baseScore * this.combo;
    this.ui.addScore(earnedScore);
    this.waveScore += earnedScore;

    // Floating kill / headshot text
    if (this.camera && this.renderer) {
      const pos = bot.mesh.position.clone();
      pos.y += 2; // float above the bot
      if (bot.killedByHeadshot) {
        this.ui.showHeadshotText(pos, earnedScore, this.camera, this.renderer);
      } else {
        this.ui.showKillText(pos, earnedScore, this.camera, this.renderer);
      }
    }
  }

  /** Returns the pre-maintained hitbox array — zero allocation. */
  getBotMeshes() {
    return this._botMeshCache;
  }

  // ─────────────────────────────────────────────────────────────
  update(delta, time) {
    // Combo timer
    if (this.comboTimer > 0) {
      this.comboTimer -= delta;
      if (this.comboTimer <= 0) {
        this.combo = 1;
        this.comboTimer = 0;
        this.killStreak = 0;
        this.ui.resetStreak();
      }
      this.ui.setCombo(this.combo, this.comboTimer / this.maxComboTimer);
    }

    // Spawn timer
    if (this.botsToSpawn > 0) {
      this.spawnTimer -= delta;
      if (this.spawnTimer <= 0) {
        let aliveCount = 0;
        for (let i = 0; i < this.bots.length; i++) {
          if (!this.bots[i].isDead) aliveCount++;
        }
        if (aliveCount < 8) {
          this.spawnBot();
          this.botsToSpawn--;
          this.spawnTimer = Math.max(0.3, 2.0 - this.wave * 0.18);
        }
      }
    }

    for (let i = 0; i < this.bots.length; i++) {
      const bot = this.bots[i];
      let botDelta = delta;
      if (!bot.isDead && bot.mesh.position.distanceTo(this.player.camera.position) > 35) {
        if (bot._frameCount % 3 !== 0) {
          bot._frameCount++;
          continue;
        }
        botDelta = delta * 3;
      }
      bot.update(botDelta, time);
    }

    // Cull bots whose ragdoll animation has fully finished
    for (let i = this.bots.length - 1; i >= 0; i--) {
      if (this.bots[i].isFullyDead) {
        const bot = this.bots[i];
        this.bots.splice(i, 1);

        // Remove both hitboxes from cache
        const h1 = this._botMeshCache.indexOf(bot.hitbox);
        if (h1 > -1) this._botMeshCache.splice(h1, 1);
        const h2 = this._botMeshCache.indexOf(bot.headHitbox);
        if (h2 > -1) this._botMeshCache.splice(h2, 1);
      }
    }

    // Boss Health Panel update
    const bosses = this.bots.filter(b => !b.isDead && b.isBoss);
    const bossPanel = document.getElementById('boss-health-panel');
    if (bossPanel) {
      if (bosses.length > 0) {
        if (bossPanel.classList.contains('hidden')) {
          bossPanel.classList.remove('hidden');
          const bossNameLabel = document.getElementById('boss-name-label');
          if (bossNameLabel) {
            bossNameLabel.textContent = bosses[0].type === 'TANK' ? 'TANK COMMANDER' : 'ELITE SHOOTER';
          }
        }
        let lowestBoss = bosses[0];
        for (let i = 1; i < bosses.length; i++) {
          if (bosses[i].health < lowestBoss.health) lowestBoss = bosses[i];
        }
        const healthBar = document.getElementById('boss-health-bar');
        const healthText = document.getElementById('boss-health-text');
        if (healthBar && healthText) {
          const pct = Math.max(0, Math.min(100, (lowestBoss.health / lowestBoss.maxHealth) * 100));
          healthBar.style.width = `${pct}%`;
          healthText.textContent = `${Math.round(lowestBoss.health)} / ${Math.round(lowestBoss.maxHealth)}`;
          healthBar.classList.remove('danger', 'critical');
          if (pct <= 10) {
            healthBar.classList.add('critical');
          } else if (pct <= 30) {
            healthBar.classList.add('danger');
          }
        }
      } else {
        if (!bossPanel.classList.contains('hidden')) {
          bossPanel.classList.add('hidden');
        }
      }
    }

    // Wave-clear check (re-evaluated here in case dying bots just finished)
    if (this.bots.length === 0 && this.botsToSpawn <= 0 && !this._waveClearPending) {
      this._waveClearPending = true;
      if (this.triggerSlowMo) this.triggerSlowMo();
      if (this.audioManager) this.audioManager.playWaveClear();

      // Snapshot stats for the wave complete screen
      const completedWave = this.wave;
      const waveKills = this.waveKills;
      const waveScore = this.waveScore;
      const currentCombo = this.combo;
      const nextWaveNum = completedWave + 1;
      const isNextBoss = nextWaveNum % 3 === 0;
      const nextEnemies = isNextBoss ? 1 : (3 + Math.floor(nextWaveNum * 1.8));
      const isUpgradeWave = completedWave % 3 === 0; // Trigger upgrades after every boss wave

      this.ui.showWaveComplete(
        completedWave,
        waveKills,
        waveScore,
        currentCombo,
        nextEnemies,
        isNextBoss,
        () => {
          const runNext = () => {
            if (isUpgradeWave && this.player) {
              const choices = this._buildUpgradeChoices();
              this.player.controls.unlock();
              this.ui.showUpgradeScreen(
                'GLOBAL UPGRADES',
                choices,
                (upgradeId) => {
                  this.player.controls.lock();
                  this.player.applyUpgrade(upgradeId);
                  this._waveClearPending = false;
                  this.startWave(this.wave + 1);
                }
              );
            } else {
              this._waveClearPending = false;
              this.startWave(this.wave + 1);
            }
          };

          if (completedWave % 3 === 0 && window.CrazyGames?.SDK?.ad) {
            let adHandled = false;
            let timeoutId = setTimeout(() => {
              if (!adHandled) safeRunNext();
            }, 1000); // Fallback if SDK hangs

            const safeRunNext = () => {
              if (adHandled) return;
              adHandled = true;
              clearTimeout(timeoutId);
              runNext();
            };

            try {
              window.CrazyGames.SDK.ad.requestAd('midgame', {
                callbacks: {
                  adFinished: safeRunNext,
                  adError: (error) => {
                    console.error('Ad Error', error);
                    safeRunNext();
                  },
                  adStarted: () => {
                    clearTimeout(timeoutId); // Ad started properly, wait for finish
                  }
                }
              });
            } catch (e) {
              safeRunNext();
            }
          } else {
            runNext();
          }
        }
      );
    }
  }

  // ── Upgrade helpers ──────────────────────────────────────────────

  _buildUpgradeChoices() {
    const POOL = [
      { id: 'MAX_HEALTH',   name: 'Steel Core',    icon: '❤️',  desc: '+40 max HP. Heal to new max.' },
      { id: 'NANO_REGEN',   name: 'Nano Regen',    icon: '💉',  desc: 'Regen starts 40% faster.' },
      { id: 'GHOST_STEP',   name: 'Ghost Step',    icon: '👟',  desc: 'Move speed +20%.' },
      { id: 'IRON_SKIN',    name: 'Iron Skin',     icon: '🛡️',  desc: 'Take 15% less damage.' },
      { id: 'OVERCHARGE',   name: 'Overcharge',    icon: '🔥',  desc: 'All weapon damage +25%.' },
      { id: 'HAIR_TRIGGER', name: 'Hair Trigger',  icon: '⚡',  desc: 'Fire rate +20% all weapons.' },
      { id: 'SPEED_LOADER', name: 'Speed Loader',  icon: '🔄',  desc: 'Reload 30% faster all weapons.' },
      { id: 'EXTENDED_MAG', name: 'Extended Mag',  icon: '📦',  desc: 'Mag size +50% all weapons.' },
      { id: 'GRENADE_BELT', name: 'Grenade Belt',  icon: '💣',  desc: '+2 max grenades. Refill now.' },
      { id: 'BLAST_RADIUS', name: 'Blast Radius',  icon: '💥',  desc: 'Grenade AoE radius +30%.' },
      { id: 'SCAVENGER',    name: 'Scavenger',     icon: '🧲',  desc: 'Kills have 40% chance to drop mini health.' },
      { id: 'ADRENALINE',   name: 'Adrenaline',    icon: '🌀',  desc: 'Each kill triggers brief slow-mo.' },
    ];

    // Fisher-Yates partial shuffle — pick 3 unique entries
    const pool = POOL.slice();
    const picks = [];
    for (let i = 0; i < 3; i++) {
      const j = i + Math.floor(Math.random() * (pool.length - i));
      [pool[i], pool[j]] = [pool[j], pool[i]];
      picks.push(pool[i]);
    }
    return picks;
  }
}

