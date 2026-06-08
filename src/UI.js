/**
 * UI – manages all HUD and menu DOM interactions.
 * Improvements: upgraded death screen, floating text pool, wave complete screen,
 * kill/headshot/boss/combo floating text methods.
 */
import * as THREE from 'three';

export class UI {
  constructor() {
    // Health
    this.healthVal = document.getElementById('health-val');
    this.healthBar = document.getElementById('health-bar');

    // Score / Wave
    this.scoreVal     = document.getElementById('score-val');
    this.waveVal      = document.getElementById('wave-val');
    this.highScoreVal = document.getElementById('high-score-val');
    this.enemyCounter = document.getElementById('enemy-counter');

    // Death screen
    this.finalScore     = document.getElementById('final-score');
    this.finalHighScore = document.getElementById('final-high-score');
    this.finalWave      = document.getElementById('death-wave-val');
    this.finalKills     = document.getElementById('death-kills-val');

    // Combo
    this.comboVal = document.getElementById('combo-val');
    this.comboBar = document.getElementById('combo-bar');

    // Kill Streak
    this.streakPanel = document.getElementById('streak-panel');
    this.streakVal   = document.getElementById('streak-val');

    // Minimap
    this.minimapCanvas = document.getElementById('minimap-canvas');
    if (this.minimapCanvas) {
      this.minimapCtx = this.minimapCanvas.getContext('2d');
      this.minimapRange = 60;
    }

    // Ammo (new split elements)
    this.ammoCurrent = document.getElementById('ammo-current');
    this.ammoReserve = document.getElementById('ammo-reserve');

    // Reload bar
    this.reloadBarContainer = document.getElementById('reload-bar-container');
    this.reloadBar          = document.getElementById('reload-bar');

    // Overlays & notifications
    this.rampageText      = document.getElementById('rampage-text');
    this.notificationText = document.getElementById('notification-text');
    this.damageOverlay    = document.getElementById('damage-overlay');
    this.hitMarker        = document.getElementById('hit-marker');
    this.killFeed         = document.getElementById('kill-feed');

    // Screens
    this.blocker     = document.getElementById('blocker');
    this.deathScreen = document.getElementById('death-screen');
    this.hud         = document.getElementById('hud');
    this.newBestLabel   = document.getElementById('new-best-label');
    this.waveAnnounce   = document.getElementById('wave-announce');
    this.waveAnnounceNum = document.getElementById('wave-announce-num');

    // Wave complete screen
    this.waveCompleteScreen = document.getElementById('wave-complete-screen');
    this.wcNum    = document.getElementById('wc-num');
    this.wcKills  = document.getElementById('wc-kills');
    this.wcScore  = document.getElementById('wc-score');
    this.wcCombo  = document.getElementById('wc-combo');
    this.wcNextWave     = document.getElementById('wc-next-wave');
    this.wcBossWarning  = document.getElementById('wc-boss-warning');

    // Grenade HUD
    this.grenadeHud     = document.getElementById('grenade-hud');
    this.grenadeTimer   = document.getElementById('grenade-timer');
    this.grenadeArcFill = document.getElementById('grenade-arc-fill');
    this.grenadeCountEl = document.getElementById('grenade-count');

    // Upgrade screen
    this.upgradeScreen = document.getElementById('upgrade-screen');

    // Leaderboard
    this.leaderboardPanel = document.getElementById('leaderboard-panel');
    const lbCloseBtn = document.getElementById('leaderboard-close-btn');
    if (lbCloseBtn) {
      lbCloseBtn.addEventListener('click', () => {
        if (this.leaderboardPanel) this.leaderboardPanel.classList.add('hidden');
      });
    }

    // State
    this.score = 0;
    this.wave  = 1;
    this.highScore = parseInt(localStorage.getItem('neonArenaHighScore')) || 0;
    if (this.highScoreVal) this.highScoreVal.textContent = this.highScore;

    // Floating text pool
    this._ftPool    = [];
    this._ftInUse   = [];
    this._initFloatingTextPool();
  }

  async initData() {
    try {
      if (window.CrazyGames?.SDK?.data) {
        const cgScore = await window.CrazyGames.SDK.data.getItem('neonArenaHighScore');
        if (cgScore) {
          this.highScore = parseInt(cgScore);
          if (this.highScoreVal) this.highScoreVal.textContent = this.highScore;
          localStorage.setItem('neonArenaHighScore', this.highScore);
        }
      }
    } catch (e) {
      console.warn("CrazyGames SDK data fetch failed, using local high score.", e);
    }
  }

  // ── Floating text pool ───────────────────────────────────────────

  _initFloatingTextPool() {
    const els = document.querySelectorAll('.floating-text');
    els.forEach(el => {
      this._ftPool.push(el);
      this._ftInUse.push(false);
    });
  }

  _acquirePoolEl() {
    for (let i = 0; i < this._ftPool.length; i++) {
      if (!this._ftInUse[i]) {
        this._ftInUse[i] = true;
        return { el: this._ftPool[i], idx: i };
      }
    }
    return null; // pool exhausted — skip
  }

  _releasePoolEl(idx) {
    if (idx >= 0 && idx < this._ftInUse.length) {
      this._ftInUse[idx] = false;
    }
  }

  /**
   * Show floating text at a 3D world position projected to screen.
   * @param {THREE.Vector3} worldPos - 3D world position
   * @param {string} text - text to display
   * @param {THREE.Camera} camera
   * @param {THREE.WebGLRenderer} renderer
   * @param {string} cssClass - 'ft-score' | 'ft-headshot' | 'ft-boss' | 'ft-ammo'
   */
  showFloatingText(worldPos, text, camera, renderer, cssClass = 'ft-score') {
    const slot = this._acquirePoolEl();
    if (!slot) return;
    const { el, idx } = slot;

    // Project world → screen
    const vec = worldPos.clone().project(camera);
    const x = ( vec.x * 0.5 + 0.5) * renderer.domElement.clientWidth;
    const y = (-vec.y * 0.5 + 0.5) * renderer.domElement.clientHeight;

    // Don't show if behind camera
    if (vec.z > 1) { this._releasePoolEl(idx); return; }

    el.textContent = text;
    el.className   = `floating-text ${cssClass}`;
    el.style.left  = `${x}px`;
    el.style.top   = `${y}px`;

    // Force reflow then add active class to trigger animation
    void el.offsetWidth;
    el.classList.add('ft-active');

    const duration = cssClass === 'ft-boss' ? 1500 : 1200;
    setTimeout(() => {
      el.classList.remove('ft-active');
      el.className = 'floating-text';
      this._releasePoolEl(idx);
    }, duration);
  }

  /** Show fixed combo text at screen top-center */
  showComboText(comboNum) {
    const slot = this._acquirePoolEl();
    if (!slot) return;
    const { el, idx } = slot;

    el.textContent = `COMBO x${comboNum}!`;
    el.className   = 'floating-text ft-combo';
    // ft-combo positions itself via CSS fixed positioning
    el.style.left  = '';
    el.style.top   = '';

    void el.offsetWidth;
    el.classList.add('ft-active');

    setTimeout(() => {
      el.classList.remove('ft-active');
      el.className = 'floating-text';
      this._releasePoolEl(idx);
    }, 1200);
  }

  showKillText(worldPos, score, camera, renderer) {
    this.showFloatingText(worldPos, `+${score}`, camera, renderer, 'ft-score');
  }

  showHeadshotText(worldPos, score, camera, renderer) {
    this.showFloatingText(worldPos, `HEADSHOT! +${score}`, camera, renderer, 'ft-headshot');
  }

  showBossKillText(worldPos, score, camera, renderer) {
    this.showFloatingText(worldPos, `BOSS DOWN! +${score}`, camera, renderer, 'ft-boss');
  }

  showAmmoPickupText(worldPos, camera, renderer) {
    this.showFloatingText(worldPos, '+15 AMMO', camera, renderer, 'ft-ammo');
  }

  // ── Screens ─────────────────────────────────────────────────────

  showMenu() {
    if (this.blocker)     this.blocker.style.display = 'flex';
    if (this.hud)         this.hud.style.display = 'none';
    if (this.deathScreen) this.deathScreen.style.display = 'none';
  }

  hideMenu() {
    if (this.blocker) this.blocker.style.display = 'none';
    if (this.hud)     this.hud.style.display = 'block';
  }

  showDeathScreen(waveNum, kills) {
    if (this.hud)         this.hud.style.display = 'none';
    if (this.deathScreen) this.deathScreen.style.display = 'flex';
    if (this.finalScore)  this.finalScore.textContent = this.score;
    if (this.finalWave)   this.finalWave.textContent  = waveNum != null ? waveNum : this.wave;
    if (this.finalKills)  this.finalKills.textContent = kills != null ? kills : 0;

    const isNewBest = this.score > this.highScore;
    if (isNewBest) {
      this.highScore = this.score;
      localStorage.setItem('neonArenaHighScore', this.highScore);
      try {
        if (window.CrazyGames?.SDK?.data) {
          window.CrazyGames.SDK.data.setItem('neonArenaHighScore', this.highScore.toString());
        }
      } catch (e) { console.warn('Failed to save high score to CrazyGames cloud', e); }
      // Show new-best label
      if (this.newBestLabel) this.newBestLabel.style.display = 'block';
      // Gold color on high score stat + brief white flash
      if (this.finalHighScore) {
        this.finalHighScore.style.color = 'var(--neon-yellow)';
        this.finalHighScore.style.textShadow = '0 0 16px var(--neon-yellow), 0 0 40px var(--neon-yellow)';
      }
      if (this.damageOverlay) {
        this.damageOverlay.classList.remove('heartbeat');
        this.damageOverlay.style.opacity = '0.18';
        setTimeout(() => { if (this.damageOverlay) this.damageOverlay.style.opacity = '0'; }, 200);
      }
    } else {
      if (this.finalHighScore) {
        this.finalHighScore.style.color = '';
        this.finalHighScore.style.textShadow = '';
      }
    }
    if (this.finalHighScore) this.finalHighScore.textContent = this.highScore;
    if (this.highScoreVal)   this.highScoreVal.textContent   = this.highScore;
  }

  hideDeathScreen() {
    if (this.deathScreen) this.deathScreen.style.display = 'none';
    if (this.newBestLabel) this.newBestLabel.style.display = 'none';
  }

  // ── Leaderboard Screen ───────────────────────────────────────────
  showLeaderboard(scores, userBest) {
    if (!this.leaderboardPanel) return;
    this.leaderboardPanel.classList.remove('hidden');
    const listEl = this.leaderboardPanel.querySelector('.lb-list');
    const footerEl = this.leaderboardPanel.querySelector('.lb-footer');

    if (!scores) {
      listEl.innerHTML = '<div class="lb-loading">LOADING...</div>';
    } else if (scores.length === 0) {
      listEl.innerHTML = '<div class="lb-empty">NO SCORES YET — BE THE FIRST!</div>';
    } else {
      listEl.innerHTML = '';
      scores.forEach((sc, idx) => {
        const rank = idx + 1;
        const row = document.createElement('div');
        row.className = 'lb-row rank-' + rank;
        row.innerHTML = `
          <div class="lb-rank">${rank}</div>
          <div class="lb-name">${sc.username || sc.name || 'Player'}</div>
          <div class="lb-score">${sc.score}</div>
        `;
        listEl.appendChild(row);
      });
    }

    if (userBest && typeof userBest.score !== 'undefined') {
      footerEl.innerHTML = `
        <div class="lb-divider"></div>
        <div class="lb-row user-best">
          <div class="lb-label">YOUR BEST</div>
          <div class="lb-score">${userBest.score}</div>
        </div>
      `;
    } else {
      footerEl.innerHTML = `
        <div class="lb-divider"></div>
        <div class="lb-row user-best">
          <div class="lb-label">YOUR BEST</div>
          <div class="lb-score">${this.highScore}</div>
        </div>
      `;
    }
  }

  // ── Wave Complete Screen ─────────────────────────────────────────

  /**
   * Show wave-complete overlay.
   * @param {number} waveNum  - wave that just completed
   * @param {number} kills    - kills this wave
   * @param {number} score    - score earned this wave
   * @param {number} combo    - current combo multiplier
   * @param {number} nextEnemies - enemy count for next wave
   * @param {boolean} isNextBoss  - true if next wave is a boss wave
   * @param {Function} onContinue - called when player dismisses
   */
  showWaveComplete(waveNum, kills, score, combo, nextEnemies, isNextBoss, onContinue) {
    if (!this.waveCompleteScreen) return;

    if (this.wcNum)   this.wcNum.textContent   = waveNum;
    if (this.wcKills) this.wcKills.textContent = kills;
    if (this.wcScore) this.wcScore.textContent = score;
    if (this.wcCombo) this.wcCombo.textContent = `x${combo}`;

    const nextWaveNum = waveNum + 1;
    if (this.wcNextWave) {
      if (isNextBoss) {
        this.wcNextWave.textContent = `WAVE ${nextWaveNum}`;
      } else {
        this.wcNextWave.textContent = `WAVE ${nextWaveNum} INCOMING — ${nextEnemies} ENEMIES`;
      }
    }
    if (this.wcBossWarning) {
      if (isNextBoss) {
        this.wcBossWarning.classList.remove('hidden');
      } else {
        this.wcBossWarning.classList.add('hidden');
      }
    }

    this.waveCompleteScreen.classList.remove('hidden');

    // Dismiss on any key or click
    const dismiss = () => {
      this.hideWaveComplete();
      cleanup();
      if (onContinue) onContinue();
    };

    const cleanup = () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('mousedown', onClick, true);
    };

    const onKey   = () => dismiss();
    const onClick = () => dismiss();

    // Short delay before enabling dismiss (prevent accidental skip)
    setTimeout(() => {
      document.addEventListener('keydown', onKey, true);
      document.addEventListener('mousedown', onClick, true);
    }, 400);
  }

  hideWaveComplete() {
    if (this.waveCompleteScreen) {
      this.waveCompleteScreen.classList.add('hidden');
    }
  }

  // ── Health ───────────────────────────────────────────────────────

  updateHealth(health, maxHealth) {
    const hp      = Math.max(0, health);
    const percent = Math.max(0, (hp / maxHealth) * 100);

    if (this.healthVal) this.healthVal.textContent = Math.ceil(hp);
    if (this.healthBar) {
      this.healthBar.style.width = `${percent}%`;

      if (percent < 30) {
        this.healthBar.style.background   = 'linear-gradient(90deg,#cc0000,#ff4444)';
        this.healthBar.style.boxShadow    = '0 0 10px #ff0000';
        this.healthBar.parentElement.style.borderColor = 'rgba(255,0,0,0.5)';
        if (this.damageOverlay && !this.damageOverlay.classList.contains('heartbeat')) {
          this.damageOverlay.classList.remove('active');
          this.damageOverlay.classList.add('heartbeat');
        }
      } else if (percent < 60) {
        this.healthBar.style.background   = 'linear-gradient(90deg,#cc7700,#ffcc44)';
        this.healthBar.style.boxShadow    = '0 0 10px #ffaa00';
        this.healthBar.parentElement.style.borderColor = 'rgba(255,170,0,0.4)';
        if (this.damageOverlay) this.damageOverlay.classList.remove('heartbeat');
      } else {
        this.healthBar.style.background   = 'linear-gradient(90deg,#0066cc,#00f3ff)';
        this.healthBar.style.boxShadow    = '0 0 8px #00f3ff';
        this.healthBar.parentElement.style.borderColor = 'rgba(0,243,255,0.25)';
        if (this.damageOverlay) this.damageOverlay.classList.remove('heartbeat');
      }
    }
  }

  // ── Score ────────────────────────────────────────────────────────

  addScore(points) {
    this.score += points;
    if (this.scoreVal) {
      this.scoreVal.textContent = this.score;
      // Pop animation
      this.scoreVal.classList.remove('score-pop');
      void this.scoreVal.offsetWidth; // reflow
      this.scoreVal.classList.add('score-pop');
    }
  }

  updateMinimap(camera, bots, powerups = []) {
    if (!this.minimapCtx) return;

    const playerPos = camera.position;
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    const Fx = fwd.x;
    const Fz = fwd.z;
    const Rx = -Fz;
    const Rz = Fx;

    const ctx = this.minimapCtx;
    const cw = this.minimapCanvas.width;
    const ch = this.minimapCanvas.height;
    const cx = cw / 2;
    const cy = ch / 2;

    // Clear and background
    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = 'rgba(4, 8, 22, 0.85)';
    ctx.fillRect(0, 0, cw, ch);

    ctx.save();
    // Clip to circle
    ctx.beginPath();
    ctx.arc(cx, cy, (cw / 2) - 2, 0, Math.PI * 2);
    ctx.clip();

    // Subtle grid
    ctx.strokeStyle = 'rgba(0, 243, 255, 0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < 5; i++) {
      let x = (cw / 5) * i;
      let y = (ch / 5) * i;
      ctx.moveTo(x, 0); ctx.lineTo(x, ch);
      ctx.moveTo(0, y); ctx.lineTo(cw, y);
    }
    ctx.stroke();

    // Setup transform relative to center
    ctx.save();
    ctx.translate(cx, cy);
    // Removed ctx.rotate to use robust vector projection instead

    // Draw bots
    for (let i = 0; i < bots.length; i++) {
      const bot = bots[i];
      if (bot.isDead || bot.isFullyDead) continue;

      const dx = bot.mesh.position.x - playerPos.x;
      const dz = bot.mesh.position.z - playerPos.z;
      
      const relX = dx * Rx + dz * Rz;
      const relZ = -(dx * Fx + dz * Fz);

      // Scale coordinates to minimap range
      const mx = (relX / this.minimapRange) * (cw / 2);
      const mz = (relZ / this.minimapRange) * (ch / 2);

      let color = '#ff2200'; // SHOOTER
      if (bot.type === 'FAST') color = '#ffee00';
      if (bot.type === 'TANK') color = '#cc00ff';

      ctx.beginPath();
      ctx.arc(mx, mz, 3, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    }

    // Draw powerups
    for (let i = 0; i < powerups.length; i++) {
      const p = powerups[i];
      const dx = p.mesh.position.x - playerPos.x;
      const dz = p.mesh.position.z - playerPos.z;

      const relX = dx * Rx + dz * Rz;
      const relZ = -(dx * Fx + dz * Fz);

      const mx = (relX / this.minimapRange) * (cw / 2);
      const mz = (relZ / this.minimapRange) * (ch / 2);

      let color = '#00ff88'; // AMMO / GRENADE
      if (p.type === 'HEALTH') color = '#ff2244';
      if (p.type === 'AMMO') color = '#00ccff';

      ctx.beginPath();
      ctx.rect(mx - 2, mz - 2, 4, 4);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
    }

    ctx.restore(); // restore rotation
    ctx.restore(); // restore clipping

    // Draw player in center (triangle)
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(cx, cy - 6);
    ctx.lineTo(cx + 4, cy + 4);
    ctx.lineTo(cx - 4, cy + 4);
    ctx.closePath();
    ctx.fill();

    // Canvas border (circle)
    ctx.strokeStyle = 'rgba(0, 243, 255, 0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, (cw / 2) - 1, 0, Math.PI * 2);
    ctx.stroke();

    // RADAR label
    ctx.fillStyle = 'rgba(0, 243, 255, 0.6)';
    ctx.font = '10px "Orbitron", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('RADAR', cx, 14);
  }

  showWeaponSwitcher(weapons, currentIndex) {
    if (!this.weaponSwitcher) {
      this.weaponSwitcher = document.getElementById('weapon-switcher');
      if (!this.weaponSwitcher) return;
    }
    
    this.weaponSwitcher.innerHTML = '';
    weapons.forEach((weapon, i) => {
      const card = document.createElement('div');
      card.className = 'weapon-card';
      if (i === currentIndex) card.classList.add('active');
      
      const name = document.createElement('div');
      name.className = 'weapon-card-name';
      name.textContent = weapon.name;
      
      const ammo = document.createElement('div');
      ammo.className = 'weapon-card-ammo';
      ammo.textContent = `${weapon.ammo} / ${weapon.reserveAmmo}`;
      
      card.appendChild(name);
      card.appendChild(ammo);
      this.weaponSwitcher.appendChild(card);
    });
    
    this.weaponSwitcher.classList.remove('hidden');
    
    if (this.weaponSwitcherTimer) clearTimeout(this.weaponSwitcherTimer);
    this.weaponSwitcherTimer = setTimeout(() => {
      this.weaponSwitcher.classList.add('hidden');
    }, 2500);
  }

  setWave(waveNumber) {
    this.wave = waveNumber;
    if (this.waveVal) this.waveVal.textContent = this.wave;
  }

  // ── Enemies ──────────────────────────────────────────────────────

  updateEnemyCounter(alive, total) {
    if (this.enemyCounter) {
      this.enemyCounter.textContent = `${alive} / ${total}`;
    }
  }

  // ── Combo ────────────────────────────────────────────────────────

  setCombo(multiplier, timerPercent) {
    if (this.comboVal) this.comboVal.textContent = `x${multiplier}`;
    if (this.comboBar) this.comboBar.style.width = `${Math.max(0, timerPercent * 100)}%`;
  }

  // ── Kill Streak ──────────────────────────────────────────────────

  showStreak(count) {
    if (!this.streakPanel || !this.streakVal) return;
    this.streakPanel.classList.remove('hidden');
    this.streakVal.textContent = count;
    if (count >= 3) {
      this.streakPanel.classList.add('streak-fire');
    } else {
      this.streakPanel.classList.remove('streak-fire');
    }
  }

  hideStreak() {
    if (this.streakPanel) this.streakPanel.classList.add('hidden');
  }

  resetStreak() {
    this.hideStreak();
    if (this.streakPanel) this.streakPanel.classList.remove('streak-fire');
    if (this.streakVal) this.streakVal.textContent = '0';
  }

  // ── Ammo ─────────────────────────────────────────────────────────

  updateAmmo(ammo, reserve) {
    if (this.ammoCurrent) {
      this.ammoCurrent.textContent = ammo;
      this.ammoCurrent.classList.toggle('empty', ammo === 0);
      this.ammoCurrent.classList.toggle('low',   ammo > 0 && ammo <= 5);
    }
    if (this.ammoReserve) {
      this.ammoReserve.textContent = reserve;
    }
  }

  // ── Reload Bar ───────────────────────────────────────────────────

  showReloadBar(duration) {
    if (!this.reloadBarContainer || !this.reloadBar) return;
    this.reloadBarContainer.classList.remove('hidden');
    // Animate width from 0 to 100% over duration seconds
    this.reloadBar.style.transition = 'none';
    this.reloadBar.style.width = '0%';
    // Double rAF to let the browser apply the 0% before starting the transition
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.reloadBar.style.transition = `width ${duration}s linear`;
        this.reloadBar.style.width = '100%';
      });
    });
  }

  hideReloadBar() {
    if (!this.reloadBarContainer || !this.reloadBar) return;
    this.reloadBarContainer.classList.add('hidden');
    this.reloadBar.style.transition = 'none';
    this.reloadBar.style.width = '0%';
  }

  // ── Kill Feed ────────────────────────────────────────────────────

  addKillFeed(text, colorHex) {
    if (!this.killFeed) return;
    const entry = document.createElement('div');
    entry.className = 'kill-feed-entry';
    const hex = '#' + colorHex.toString(16).padStart(6, '0');
    entry.style.borderRightColor = hex;
    entry.innerHTML = `<span class="kf-icon" style="color:${hex}">✦</span> ${text}`;
    this.killFeed.prepend(entry);

    // Slide in
    requestAnimationFrame(() => entry.classList.add('visible'));

    // Fade out and remove
    setTimeout(() => {
      entry.classList.remove('visible');
      setTimeout(() => {
        if (this.killFeed.contains(entry)) this.killFeed.removeChild(entry);
      }, 350);
    }, 3000);

    // Keep max 5 entries
    while (this.killFeed.children.length > 5) {
      this.killFeed.removeChild(this.killFeed.lastChild);
    }
  }

  // ── Rampage ──────────────────────────────────────────────────────

  showRampage() {
    if (!this.rampageText) return;
    this.rampageText.classList.remove('rampage-active');
    void this.rampageText.offsetWidth; // reflow
    this.rampageText.classList.add('rampage-active');

    if (this.damageOverlay) {
      this.damageOverlay.style.boxShadow = 'inset 0 0 200px 80px rgba(255,255,255,0.12)';
      setTimeout(() => {
        if (this.damageOverlay) this.damageOverlay.style.boxShadow = '';
      }, 400);
    }

    setTimeout(() => {
      if (this.rampageText) this.rampageText.classList.remove('rampage-active');
    }, 1000);
  }

  // ── Notifications ────────────────────────────────────────────────

  showNotification(text, color) {
    if (!this.notificationText) return;
    this.notificationText.textContent = text;
    this.notificationText.style.color = color;
    this.notificationText.classList.add('visible');

    clearTimeout(this._notifTimeout);
    this._notifTimeout = setTimeout(() => {
      this.notificationText.classList.remove('visible');
    }, 2200);
  }

  // ── Combat feedback ──────────────────────────────────────────────

  showHitMarker() {
    if (!this.hitMarker) return;
    this.hitMarker.classList.remove('hit-active');
    void this.hitMarker.offsetWidth; // reflow to restart animation
    this.hitMarker.classList.add('hit-active');
  }

  showDamageOverlay() {
    if (!this.damageOverlay) return;
    this.damageOverlay.classList.add('active');
    clearTimeout(this._dmgTimeout);
    this._dmgTimeout = setTimeout(() => {
      this.damageOverlay.classList.remove('active');
    }, 280);
  }

  // ── Reset ────────────────────────────────────────────────────────

  reset() {
    this.score = 0;
    this.wave  = 1;
    if (this.scoreVal)    this.scoreVal.textContent = 0;
    if (this.waveVal)     this.waveVal.textContent  = 1;
    if (this.killFeed)    this.killFeed.innerHTML   = '';
    if (this.highScoreVal) this.highScoreVal.textContent = this.highScore;
    if (this.newBestLabel) this.newBestLabel.style.display = 'none';
    if (this.damageOverlay) this.damageOverlay.classList.remove('heartbeat');
    this.updateHealth(100, 100);
    this.setCombo(1, 0);
    this.resetStreak();
    this.hideReloadBar();
    this.hideWaveComplete();
    this.hideUpgradeScreen();
    this.updateGrenadeCooldown(0, 10); // reset to ready
    // Clear any lingering notifications
    if (this.notificationText) this.notificationText.classList.remove('visible');
    if (this.rampageText)      this.rampageText.classList.remove('rampage-active');
  }

  // ── Grenade HUD ──────────────────────────────────────────────────

  /**
   * Update grenade cooldown HUD.
   * @param {number} remaining - seconds remaining on cooldown (0 = ready)
   * @param {number} total     - total cooldown duration in seconds
   */
  updateGrenadeCooldown(remaining, total) {
    if (!this.grenadeHud) return;
    const ready = remaining <= 0;

    if (ready) {
      this.grenadeHud.classList.remove('on-cooldown');
      if (this.grenadeTimer) {
        this.grenadeTimer.textContent = 'READY';
        this.grenadeTimer.classList.add('ready');
      }
      // Full arc
      if (this.grenadeArcFill) {
        this.grenadeArcFill.style.strokeDashoffset = '0';
        this.grenadeArcFill.setAttribute('stroke', '#00ff88');
      }
    } else {
      this.grenadeHud.classList.add('on-cooldown');
      if (this.grenadeTimer) {
        this.grenadeTimer.textContent = `${Math.ceil(remaining)}s`;
        this.grenadeTimer.classList.remove('ready');
      }
      // Arc fill: 0 = empty, 100 = full. We want 0→100 as cooldown drains.
      const pct = 1 - (remaining / total);          // 0 when just thrown, 1 when ready
      const offset = 100 - (pct * 100);              // stroke-dashoffset: 100=empty, 0=full
      if (this.grenadeArcFill) {
        this.grenadeArcFill.style.strokeDashoffset = `${offset}`;
        this.grenadeArcFill.setAttribute('stroke', '#00f3ff');
      }
    }
  }

  updateGrenadeCount(count) {
    if (this.grenadeCountEl) {
      this.grenadeCountEl.textContent = `x${count}`;
    }
    if (this.grenadeHud) {
      if (count <= 0) {
        this.grenadeHud.classList.add('depleted');
      } else {
        this.grenadeHud.classList.remove('depleted');
      }
    }
  }

  showGrenadeReady() {
    this.showNotification('GRENADE READY', '#00ff88');
    // Extra: pulse the arc
    if (this.grenadeArcFill) {
      this.grenadeArcFill.setAttribute('stroke', '#00ff88');
    }
  }

  // ── Health regen pulse ───────────────────────────────────────────

  showRegenPulse() {
    if (this.healthBar) this.healthBar.classList.add('regenerating');
  }

  hideRegenPulse() {
    if (this.healthBar) this.healthBar.classList.remove('regenerating');
  }

  // ── Weapon Upgrade Screen ────────────────────────────────────────

  /**
   * Show the weapon upgrade choice screen.
   * @param {string}   weaponName - name of the weapon being upgraded
   * @param {Array}    choices    - array of { id, name, desc, icon } objects (length 3)
   * @param {Function} onChoose  - called with the chosen upgrade id
   */
  showUpgradeScreen(weaponName, choices, onChoose) {
    if (!this.upgradeScreen) return;

    const nameEl = document.getElementById('upgrade-weapon-name');
    if (nameEl) nameEl.textContent = weaponName;

    for (let i = 0; i < 3; i++) {
      const c = choices[i];
      const card = document.getElementById(`upgrade-card-${i}`);
      if (!card) continue;

      // Update icon / name / desc
      const iconEl = card.querySelector('.upgrade-card-icon');
      const nameEl2 = document.getElementById(`upgrade-name-${i}`);
      const descEl  = document.getElementById(`upgrade-desc-${i}`);
      if (iconEl)  iconEl.textContent  = c.icon || '⚡';
      if (nameEl2) nameEl2.textContent = c.name;
      if (descEl)  descEl.textContent  = c.desc;

      // Wire click — clone node to remove stale listeners
      const fresh = card.cloneNode(true);
      card.parentNode.replaceChild(fresh, card);
      fresh.addEventListener('click', () => {
        if (this._upgradeKeyHandler) {
          window.removeEventListener('keydown', this._upgradeKeyHandler);
          this._upgradeKeyHandler = null;
        }
        this.hideUpgradeScreen();
        onChoose(c.id);
      });
    }

    if (this._upgradeKeyHandler) {
      window.removeEventListener('keydown', this._upgradeKeyHandler);
    }
    this._upgradeKeyHandler = (e) => {
      if (e.key === '1' || e.key === '2' || e.key === '3') {
        const index = parseInt(e.key) - 1;
        if (choices[index]) {
          window.removeEventListener('keydown', this._upgradeKeyHandler);
          this._upgradeKeyHandler = null;
          this.hideUpgradeScreen();
          onChoose(choices[index].id);
        }
      }
    };
    window.addEventListener('keydown', this._upgradeKeyHandler);

    this.upgradeScreen.classList.remove('hidden');
  }

  hideUpgradeScreen() {
    if (this.upgradeScreen) this.upgradeScreen.classList.add('hidden');
  }

  // ── Wave Announcement ────────────────────────────────────────────

  showWaveAnnouncement(waveNumber) {
    if (!this.waveAnnounce || !this.waveAnnounceNum) return;
    document.getElementById('wave-announce-label').textContent = 'WAVE';
    this.waveAnnounceNum.textContent = waveNumber;
    // Re-trigger animation by removing/re-adding class
    this.waveAnnounce.classList.remove('active');
    void this.waveAnnounce.offsetWidth; // force reflow
    this.waveAnnounce.classList.add('active');
    // Clean up class after animation completes
    clearTimeout(this._waveAnnounceTimeout);
    this._waveAnnounceTimeout = setTimeout(() => {
      if (this.waveAnnounce) this.waveAnnounce.classList.remove('active');
    }, 2200);
  }

  showBossAnnouncement() {
    if (!this.waveAnnounce || !this.waveAnnounceNum) return;
    const label = document.getElementById('wave-announce-label');
    label.textContent = 'BOSS WAVE';
    this.waveAnnounceNum.textContent = '';
    
    this.waveAnnounce.style.color = '#ffaa00';
    this.waveAnnounce.style.textShadow = '0 0 20px #ffaa00, 0 0 50px #ffaa00, 0 0 100px #ffaa00';
    
    this.waveAnnounce.classList.remove('active');
    void this.waveAnnounce.offsetWidth;
    this.waveAnnounce.classList.add('active');
    
    clearTimeout(this._waveAnnounceTimeout);
    this._waveAnnounceTimeout = setTimeout(() => {
      if (this.waveAnnounce) {
        this.waveAnnounce.classList.remove('active');
        this.waveAnnounce.style.color = '';
        this.waveAnnounce.style.textShadow = '';
      }
    }, 2200);
  }

  // ── Weapon name ──────────────────────────────────────────────────

  updateWeaponName(name) {
    const el = document.getElementById('weapon-name');
    if (el) el.textContent = name;
  }

  // ── Hit crosshair (red flash on enemy hit) ───────────────────────

  showHitCrosshair() {
    const ch = document.getElementById('crosshair');
    if (!ch) return;
    ch.style.filter = 'brightness(0) saturate(100%) invert(20%) sepia(100%) saturate(700%) hue-rotate(320deg)';
    clearTimeout(this._chTimeout);
    this._chTimeout = setTimeout(() => {
      if (ch) ch.style.filter = '';
    }, 120);
  }

  // ── Floating damage numbers (legacy, still used by Player.js) ───

  showDamageNumber(worldPos, damage, camera, renderer, color = '#ff4444', fontSize = 18) {
    const vec = worldPos.clone().project(camera);
    const x = ( vec.x * 0.5 + 0.5) * renderer.domElement.clientWidth;
    const y = (-vec.y * 0.5 + 0.5) * renderer.domElement.clientHeight;

    const el = document.createElement('div');
    el.textContent = `-${damage}`;
    
    const shadowColor = color === '#ff4444' ? 'rgba(255,50,50,0.7)' : 'rgba(255,200,0,0.7)';
    
    el.style.cssText = `
      position: fixed;
      left: ${x}px;
      top:  ${y}px;
      transform: translate(-50%, -50%);
      font-family: var(--font-hud);
      font-size: ${fontSize}px;
      font-weight: 700;
      color: ${color};
      text-shadow: 0 0 8px ${shadowColor};
      pointer-events: none;
      z-index: 20;
      animation: dmgNumAnim 0.7s ease-out forwards;
    `;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 700);
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // MULTIPLAYER UI METHODS
  // ══════════════════════════════════════════════════════════════════════════════

  // ── Matchmaking screen ───────────────────────────────────────────────────────

  showMatchmaking() {
    const el = document.getElementById('matchmaking-screen');
    if (el) el.classList.remove('hidden');
    // Reset state
    this.updateMatchmakingCount(0);
    const cdWrap = document.getElementById('mm-countdown-wrap');
    if (cdWrap) cdWrap.classList.add('hidden');
    const choice = document.getElementById('mm-choice');
    if (choice) choice.classList.add('hidden');
    const offline = document.getElementById('mm-offline-msg');
    if (offline) offline.classList.add('hidden');
    const finding = document.getElementById('mm-finding');
    if (finding) finding.style.display = '';
  }

  hideMatchmaking() {
    const el = document.getElementById('matchmaking-screen');
    if (el) el.classList.add('hidden');
  }

  updateMatchmakingCount(x) {
    const el = document.getElementById('mm-count-val');
    if (el) el.textContent = x;
  }

  /**
   * Show/update the countdown timer in the matchmaking screen.
   * Pass null to hide the countdown.
   * @param {number|null} seconds
   */
  updateMatchmakingCountdown(seconds) {
    const wrap = document.getElementById('mm-countdown-wrap');
    const val  = document.getElementById('mm-countdown-val');
    if (seconds === null || seconds === undefined) {
      if (wrap) wrap.classList.add('hidden');
    } else {
      if (wrap) wrap.classList.remove('hidden');
      if (val)  val.textContent = seconds;
    }
  }

  /**
   * Show the fill/start choice after countdown ends.
   * @param {boolean} isHost — true if this client is the host
   */
  showBotFillChoice(isHost) {
    // Hide countdown, show choice
    const cdWrap = document.getElementById('mm-countdown-wrap');
    if (cdWrap) cdWrap.classList.add('hidden');

    const choice = document.getElementById('mm-choice');
    if (choice) choice.classList.remove('hidden');

    const hostDiv    = document.getElementById('mm-choice-host');
    const nonHostDiv = document.getElementById('mm-choice-nonhost');

    if (isHost) {
      if (hostDiv)    hostDiv.style.display    = '';
      if (nonHostDiv) nonHostDiv.style.display = 'none';
    } else {
      if (hostDiv)    hostDiv.style.display    = 'none';
      if (nonHostDiv) nonHostDiv.style.display = '';
    }
  }

  hideBotFillChoice() {
    const choice = document.getElementById('mm-choice');
    if (choice) choice.classList.add('hidden');
  }

  showOfflineMessage() {
    const finding = document.getElementById('mm-finding');
    if (finding) finding.style.display = 'none';
    const count = document.getElementById('mm-player-count');
    if (count) count.style.display = 'none';
    const offline = document.getElementById('mm-offline-msg');
    if (offline) offline.classList.remove('hidden');
  }

  // ── Match timer ──────────────────────────────────────────────────────────────

  /**
   * Show and update the in-match timer. Turns red when < 30 seconds.
   * @param {number} secondsLeft
   */
  updateMatchTimer(secondsLeft) {
    const el = document.getElementById('mp-match-timer');
    if (!el) return;

    el.classList.remove('hidden');

    const mins = Math.floor(secondsLeft / 60);
    const secs = secondsLeft % 60;
    el.textContent = `${mins}:${String(secs).padStart(2, '0')}`;

    if (secondsLeft <= 30) {
      el.classList.add('danger');
    } else {
      el.classList.remove('danger');
    }
  }

  hideMatchTimer() {
    const el = document.getElementById('mp-match-timer');
    if (el) el.classList.add('hidden');
  }

  // ── FFA mode label ────────────────────────────────────────────────────────────

  showFfaLabel() {
    const el = document.getElementById('mp-ffa-label');
    if (el) el.classList.remove('hidden');
  }

  hideFfaLabel() {
    const el = document.getElementById('mp-ffa-label');
    if (el) el.classList.add('hidden');
  }

  // ── Scoreboard (Tab-toggled) ──────────────────────────────────────────────────

  /**
   * Show or hide the in-match scoreboard overlay.
   * @param {boolean} visible
   * @param {Array<{id, name, score, isBot, isLocal}>} players — sorted by score
   */
  toggleScoreboard(visible, players) {
    const el = document.getElementById('mp-scoreboard');
    if (!el) return;

    if (!visible) {
      el.classList.add('hidden');
      return;
    }

    const list = document.getElementById('mp-scoreboard-list');
    if (list) {
      list.innerHTML = '';
      players.forEach((p, idx) => {
        const row = document.createElement('div');
        row.className = 'mp-sb-row';
        if (p.isLocal)  row.classList.add('mp-sb-local');
        else if (p.isBot) row.classList.add('mp-sb-bot');
        else              row.classList.add('mp-sb-remote');

        const tag = p.isBot ? ' [BOT]' : (p.isLocal ? ' [YOU]' : '');
        row.innerHTML = `
          <span class="mp-sb-rank">#${idx + 1}</span>
          <span class="mp-sb-name">${p.name}${tag}</span>
          <span class="mp-sb-score">${p.score} kills</span>
        `;
        list.appendChild(row);
      });
    }

    el.classList.remove('hidden');
  }

  // ── Match results screen ─────────────────────────────────────────────────────

  /**
   * Show the post-match results screen.
   * @param {{ winner:{name,score}, finalScores:[] }} data
   * @param {Function} onPlayAgain
   * @param {Function} onMainMenu
   */
  showMatchResults(data, onPlayAgain, onMainMenu) {
    const el = document.getElementById('match-results-screen');
    if (!el) return;

    // Fill winner
    const winnerName  = document.getElementById('mr-winner-name');
    const winnerScore = document.getElementById('mr-winner-score');
    if (winnerName)  winnerName.textContent  = data.winner?.name  || '—';
    if (winnerScore) winnerScore.textContent = `${data.winner?.score || 0} KILLS`;

    // Fill scoreboard list
    const list = document.getElementById('mr-scoreboard-list');
    if (list) {
      list.innerHTML = '';
      (data.finalScores || []).forEach((p, idx) => {
        const row = document.createElement('div');
        row.className = 'mr-sb-row';
        if (p.isBot) row.classList.add('mr-sb-bot');
        row.innerHTML = `
          <span class="mr-rank">#${idx + 1}</span>
          <span class="mr-name">${p.name}${p.isBot ? ' [BOT]' : ''}</span>
          <span class="mr-kills">${p.score}</span>
        `;
        list.appendChild(row);
      });
    }

    el.classList.remove('hidden');

    // Wire buttons (clone to remove stale listeners)
    const playAgainBtn = document.getElementById('mp-play-again-btn');
    const mainMenuBtn  = document.getElementById('mp-main-menu-btn');

    if (playAgainBtn) {
      const fresh = playAgainBtn.cloneNode(true);
      playAgainBtn.parentNode.replaceChild(fresh, playAgainBtn);
      fresh.addEventListener('click', (e) => { e.stopPropagation(); onPlayAgain?.(); });
    }
    if (mainMenuBtn) {
      const fresh = mainMenuBtn.cloneNode(true);
      mainMenuBtn.parentNode.replaceChild(fresh, mainMenuBtn);
      fresh.addEventListener('click', (e) => { e.stopPropagation(); onMainMenu?.(); });
    }

    // 15-second auto-close
    let autoCloseRemaining = 15;
    const autoCloseEl = document.getElementById('mr-auto-close-val');
    if (autoCloseEl) autoCloseEl.textContent = autoCloseRemaining;

    this._mrAutoCloseInterval = setInterval(() => {
      autoCloseRemaining--;
      if (autoCloseEl) autoCloseEl.textContent = autoCloseRemaining;
      if (autoCloseRemaining <= 0) {
        clearInterval(this._mrAutoCloseInterval);
        this.hideMatchResults();
        onMainMenu?.();
      }
    }, 1000);
  }

  hideMatchResults() {
    const el = document.getElementById('match-results-screen');
    if (el) el.classList.add('hidden');
    if (this._mrAutoCloseInterval) {
      clearInterval(this._mrAutoCloseInterval);
      this._mrAutoCloseInterval = null;
    }
  }
}
