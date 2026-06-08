/**
 * SettingsManager
 * Handles all user-configurable settings, persists them to localStorage,
 * and wires the settings UI controls.
 */
export class SettingsManager {
  constructor() {
    this.defaults = {
      sensitivity: 1.0,
      volume: 1.0,
      adsMode: 'hold',     // 'hold' | 'toggle'
      crosshair: 'cross',  // 'cross' | 'dot' | 'circle'
      bloom: false,
    };
    this.settings = { ...this.defaults };

    // Callbacks – set these after construction
    this.onSensitivityChange = null;
    this.onVolumeChange = null;
    this.onAdsModeChange = null;

    this._load();
    this._wireUI();
  }

  // ─── Public API ────────────────────────────────────────────────

  get(key) {
    return this.settings[key] ?? this.defaults[key];
  }

  set(key, value) {
    this.settings[key] = value;
    this._save();
  }

  /** Apply current settings to live game objects. */
  apply(player, audioManager) {
    if (player?.controls) {
      player.controls.pointerSpeed = this.settings.sensitivity;
    }
    if (player) {
      player.adsMode = this.settings.adsMode;
    }
    if (audioManager) {
      audioManager.setVolume(this.settings.volume);
    }
    this._applyCrosshair();
  }

  // ─── Fullscreen helpers ────────────────────────────────────────

  requestFullscreen() {
    const el = document.documentElement;
    const req = el.requestFullscreen
      || el.webkitRequestFullscreen
      || el.mozRequestFullScreen
      || el.msRequestFullscreen;
    if (req) return req.call(el);
    return Promise.resolve();
  }

  exitFullscreen() {
    if (document.exitFullscreen) document.exitFullscreen();
    else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
  }

  toggleFullscreen() {
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      this.exitFullscreen();
    } else {
      this.requestFullscreen().catch(() => {});
    }
  }

  // ─── Private ───────────────────────────────────────────────────

  _load() {
    try {
      const saved = JSON.parse(localStorage.getItem('neonArenaSettings') || '{}');
      this.settings = { ...this.defaults, ...saved };
    } catch {
      this.settings = { ...this.defaults };
    }
  }

  _save() {
    const jsonStr = JSON.stringify(this.settings);
    localStorage.setItem('neonArenaSettings', jsonStr);
    try {
      if (window.CrazyGames?.SDK?.data) {
        window.CrazyGames.SDK.data.setItem('neonArenaSettings', jsonStr);
      }
    } catch (e) { console.warn('Failed to save settings to CrazyGames cloud', e); }
  }

  _wireUI() {
    // ── Sensitivity ──
    const sensitivitySlider = document.getElementById('sensitivity-slider');
    const sensitivityVal    = document.getElementById('sensitivity-val');
    if (sensitivitySlider) {
      sensitivitySlider.value = this.settings.sensitivity;
      if (sensitivityVal) sensitivityVal.textContent = Number(this.settings.sensitivity).toFixed(2);

      sensitivitySlider.addEventListener('input', (e) => {
        const v = parseFloat(e.target.value);
        this.settings.sensitivity = v;
        if (sensitivityVal) sensitivityVal.textContent = v.toFixed(2);
        this._save();
        this.onSensitivityChange?.(v);
      });
    }

    // ── Volume ──
    const volumeSlider = document.getElementById('volume-slider');
    const volumeVal    = document.getElementById('volume-val');
    if (volumeSlider) {
      volumeSlider.value = this.settings.volume;
      if (volumeVal) volumeVal.textContent = Math.round(this.settings.volume * 100) + '%';

      volumeSlider.addEventListener('input', (e) => {
        const v = parseFloat(e.target.value);
        this.settings.volume = v;
        if (volumeVal) volumeVal.textContent = Math.round(v * 100) + '%';
        this._save();
        this.onVolumeChange?.(v);
      });
    }

    // ── ADS mode ──
    const adsHoldBtn   = document.getElementById('ads-hold-btn');
    const adsToggleBtn = document.getElementById('ads-toggle-btn');
    if (adsHoldBtn && adsToggleBtn) {
      adsHoldBtn.classList.toggle('active', this.settings.adsMode === 'hold');
      adsToggleBtn.classList.toggle('active', this.settings.adsMode === 'toggle');

      adsHoldBtn.addEventListener('click', () => {
        this.settings.adsMode = 'hold';
        adsHoldBtn.classList.add('active');
        adsToggleBtn.classList.remove('active');
        this._save();
        this.onAdsModeChange?.(this.settings.adsMode);
      });
      adsToggleBtn.addEventListener('click', () => {
        this.settings.adsMode = 'toggle';
        adsToggleBtn.classList.add('active');
        adsHoldBtn.classList.remove('active');
        this._save();
        this.onAdsModeChange?.(this.settings.adsMode);
      });
    }

    // ── Crosshair ──
    document.querySelectorAll('[data-crosshair]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.crosshair === this.settings.crosshair);
      btn.addEventListener('click', () => {
        this.settings.crosshair = btn.dataset.crosshair;
        this._save();
        document.querySelectorAll('[data-crosshair]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._applyCrosshair();
      });
    });
    this._applyCrosshair();

    // ── Bloom ──
    const bloomCb = document.getElementById('bloom-checkbox');
    if (bloomCb) {
      bloomCb.checked = this.settings.bloom;
      bloomCb.addEventListener('change', (e) => {
        this.settings.bloom = e.target.checked;
        this._save();
      });
    }

    // ── Settings panel open / close ──
    const overlay   = document.getElementById('settings-overlay');
    const closeBtn  = document.getElementById('settings-close-btn');
    const openBtns  = [
      document.getElementById('settings-open-btn'),
      document.getElementById('hud-settings-btn'),
    ];

    openBtns.forEach(btn => {
      btn?.addEventListener('click', (e) => {
        e.stopPropagation();
        overlay?.classList.remove('hidden');
      });
    });

    closeBtn?.addEventListener('click', () => {
      overlay?.classList.add('hidden');
    });

    // Close on overlay backdrop click
    overlay?.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.add('hidden');
    });

    // ── Fullscreen buttons ──
    document.getElementById('fullscreen-toggle-btn')
      ?.addEventListener('click', () => this.toggleFullscreen());

    document.getElementById('fullscreen-request-btn')
      ?.addEventListener('click', () => {
        this.requestFullscreen().catch(() => {});
        document.getElementById('fullscreen-notice')?.classList.add('hidden');
      });

    document.getElementById('fullscreen-btn')
      ?.addEventListener('click', () => this.toggleFullscreen());
  }

  _applyCrosshair() {
    const ch = document.getElementById('crosshair');
    if (!ch) return;
    ch.className = 'crosshair-' + this.settings.crosshair;
  }
}
