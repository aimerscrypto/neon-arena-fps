/**
 * AudioManager – Web Audio API sound effects with a master gain node
 * for real-time volume control.
 */
export class AudioManager {
  constructor() {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();

    // Master gain – all sounds route through here
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 1.0;
    this.masterGain.connect(this.ctx.destination);
    
    this.buffers = {};
    this.loadRealSounds();
  }

  async loadRealSounds() {
    const load = async (name, url) => {
      try {
        const response = await fetch(url);
        if (!response.ok) return;
        const arrayBuffer = await response.arrayBuffer();
        this.buffers[name] = await this.ctx.decodeAudioData(arrayBuffer);
      } catch (e) {
        console.warn('Could not load real sound:', url, e);
      }
    };
    
    // The game will attempt to load these real sound files from the public/sounds folder
    await load('rifle_reload', '/sounds/rifle_reload.mp3');
    await load('rifle_shoot', '/sounds/rifle_bullet.mp3');
    await load('shotgun_shoot', '/sounds/shotgun_bullet.mp3');
    await load('sniper_shoot', '/sounds/sniper_bullet.mp3');
    await load('sniper_shotgun_reload', '/sounds/sniper_shotgun_reload.mp3');
    await load('rocket_fire', '/sounds/rocket_fire.mp3');
    await load('rocket_impact', '/sounds/rocket_impact.mp3');
  }

  /** Must be called on first user interaction to un-suspend the context. */
  resume() {
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  /** Set master volume (0–1). */
  setVolume(value) {
    if (this.masterGain) {
      this.masterGain.gain.setTargetAtTime(
        Math.max(0, Math.min(1, value)),
        this.ctx.currentTime,
        0.05
      );
    }
  }

  playRocketFire() {
    if (this.ctx.state !== 'running') return;
    if (this.buffers['rocket_fire']) {
      const source = this.ctx.createBufferSource();
      source.buffer = this.buffers['rocket_fire'];
      const volNode = this.ctx.createGain();
      volNode.gain.value = 0.5;
      source.connect(volNode).connect(this.masterGain);
      source.start();
      return;
    }
    // Fallback synth
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(100, t);
    osc.frequency.exponentialRampToValueAtTime(10, t + 0.4);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.3, t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.4);
    osc.connect(gain).connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.4);
  }

  playRocketImpact() {
    if (this.ctx.state !== 'running') return;
    if (this.buffers['rocket_impact']) {
      const source = this.ctx.createBufferSource();
      source.buffer = this.buffers['rocket_impact'];
      const volNode = this.ctx.createGain();
      volNode.gain.value = 0.8;
      source.connect(volNode).connect(this.masterGain);
      source.start();
      return;
    }
    // Fallback synth
    const t = this.ctx.currentTime;
    const bufSize = this.ctx.sampleRate * 0.8;
    const buffer = this.ctx.createBuffer(1, bufSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1);
    
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(400, t);
    filter.frequency.exponentialRampToValueAtTime(40, t + 0.8);
    
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.5, t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.8);
    noise.connect(filter).connect(gain).connect(this.masterGain);
    noise.start(t);
  }

  playShotgunBlast() {
    if (this.ctx.state !== 'running') return;
    
    if (this.buffers['shotgun_shoot']) {
      const source = this.ctx.createBufferSource();
      source.buffer = this.buffers['shotgun_shoot'];
      
      const volNode = this.ctx.createGain();
      volNode.gain.value = 0.125; // Lower volume by another 50%
      
      source.connect(volNode);
      volNode.connect(this.masterGain);
      
      source.start();
      return;
    }

    const t = this.ctx.currentTime;
    
    const bufSize = this.ctx.sampleRate * 0.4;
    const buffer = this.ctx.createBuffer(1, bufSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1);
    
    // Boom noise
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1500;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.1875, t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.4);
    noise.connect(filter).connect(gain).connect(this.masterGain);
    
    // Chest punch
    const punch = this.ctx.createOscillator();
    punch.type = 'sine';
    punch.frequency.setValueAtTime(120, t);
    punch.frequency.exponentialRampToValueAtTime(30, t + 0.2);
    const punchGain = this.ctx.createGain();
    punchGain.gain.setValueAtTime(0.25, t);
    punchGain.gain.exponentialRampToValueAtTime(0.01, t + 0.2);
    punch.connect(punchGain).connect(this.masterGain);
    
    noise.start(t);
    punch.start(t);
    noise.stop(t + 0.4);
    punch.stop(t + 0.4);
  }

  playSniperShot() {
    if (this.ctx.state !== 'running') return;
    
    if (this.buffers['sniper_shoot']) {
      const source = this.ctx.createBufferSource();
      source.buffer = this.buffers['sniper_shoot'];
      source.connect(this.masterGain);
      source.start();
      return;
    }

    const t = this.ctx.currentTime;
    
    const bufSize = this.ctx.sampleRate * 0.6;
    const buffer = this.ctx.createBuffer(1, bufSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1);
    
    // Crack
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1800;
    filter.Q.value = 1.0;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(2.0, t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.6);
    noise.connect(filter).connect(gain).connect(this.masterGain);
    
    // Sub punch
    const punch = this.ctx.createOscillator();
    punch.type = 'triangle';
    punch.frequency.setValueAtTime(180, t);
    punch.frequency.exponentialRampToValueAtTime(40, t + 0.3);
    const punchGain = this.ctx.createGain();
    punchGain.gain.setValueAtTime(2.5, t);
    punchGain.gain.exponentialRampToValueAtTime(0.01, t + 0.3);
    punch.connect(punchGain).connect(this.masterGain);
    
    // Metallic Ring
    const ring = this.ctx.createOscillator();
    ring.type = 'sine';
    ring.frequency.setValueAtTime(2000, t);
    ring.frequency.exponentialRampToValueAtTime(1000, t + 0.5);
    const ringGain = this.ctx.createGain();
    ringGain.gain.setValueAtTime(0.3, t);
    ringGain.gain.exponentialRampToValueAtTime(0.01, t + 0.5);
    ring.connect(ringGain).connect(this.masterGain);
    
    noise.start(t);
    punch.start(t);
    ring.start(t);
    noise.stop(t + 0.6);
    punch.stop(t + 0.3);
    ring.stop(t + 0.5);
  }

  playShoot() {
    if (this.ctx.state !== 'running') return;
    
    if (this.buffers['rifle_shoot']) {
      const source = this.ctx.createBufferSource();
      source.buffer = this.buffers['rifle_shoot'];
      
      const volNode = this.ctx.createGain();
      volNode.gain.value = 0.5; // Lower volume by 50%
      
      source.connect(volNode);
      volNode.connect(this.masterGain);
      
      source.start();
      return;
    }

    const t = this.ctx.currentTime;
    
    // 1. Noise Burst (Gunpowder explosion)
    const bufSize = this.ctx.sampleRate * 0.15;
    const buffer = this.ctx.createBuffer(1, bufSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1);
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 2500;
    filter.Q.value = 0.5;
    
    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0.5, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.01, t + 0.15);
    noise.connect(filter).connect(noiseGain).connect(this.masterGain);
    
    // 2. Low Punch (Chest thump)
    const punch = this.ctx.createOscillator();
    punch.type = 'sine';
    punch.frequency.setValueAtTime(150, t);
    punch.frequency.exponentialRampToValueAtTime(40, t + 0.1);
    const punchGain = this.ctx.createGain();
    punchGain.gain.setValueAtTime(0.6, t);
    punchGain.gain.exponentialRampToValueAtTime(0.01, t + 0.1);
    punch.connect(punchGain).connect(this.masterGain);
    
    // 3. Metallic Clack (Action cycling)
    const clack = this.ctx.createOscillator();
    clack.type = 'square';
    clack.frequency.setValueAtTime(800, t);
    clack.frequency.exponentialRampToValueAtTime(200, t + 0.05);
    const clackGain = this.ctx.createGain();
    clackGain.gain.setValueAtTime(0.15, t);
    clackGain.gain.exponentialRampToValueAtTime(0.01, t + 0.05);
    clack.connect(clackGain).connect(this.masterGain);
    
    noise.start(t);
    punch.start(t);
    clack.start(t);
    noise.stop(t + 0.15);
    punch.stop(t + 0.15);
    clack.stop(t + 0.15);
  }

  playEnemyShoot() {
    if (this.ctx.state !== 'running') return;
    const osc  = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'square';
    osc.frequency.setValueAtTime(600, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(50, this.ctx.currentTime + 0.15);

    gain.gain.setValueAtTime(0.05, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.15);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start();
    osc.stop(this.ctx.currentTime + 0.15);
  }

  playHit() {
    if (this.ctx.state !== 'running') return;
    const osc  = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(1200, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(800, this.ctx.currentTime + 0.06);

    gain.gain.setValueAtTime(0.22, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.06);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start();
    osc.stop(this.ctx.currentTime + 0.06);
  }

  playExplosion() {
    if (this.ctx.state !== 'running') return;

    const bufferSize = this.ctx.sampleRate * 0.5;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data   = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise  = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type  = 'lowpass';
    filter.frequency.setValueAtTime(1200, this.ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(100, this.ctx.currentTime + 0.5);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.35, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.5);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    noise.start();
  }

  playKill() {
    if (this.ctx.state !== 'running') return;
    // Short satisfying "ting"
    const osc  = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(1600, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(400, this.ctx.currentTime + 0.2);

    gain.gain.setValueAtTime(0.15, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.2);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start();
    osc.stop(this.ctx.currentTime + 0.2);
  }

  playRifleReload() {
    if (this.ctx.state !== 'running') return;
    
    if (this.buffers['rifle_reload']) {
      const source = this.ctx.createBufferSource();
      source.buffer = this.buffers['rifle_reload'];
      
      const volNode = this.ctx.createGain();
      volNode.gain.value = 0.8; // Reduce volume by 20%
      
      source.connect(volNode);
      volNode.connect(this.masterGain);
      
      source.start();
      return;
    }
    
    const t = this.ctx.currentTime;
    
    const click = (time, freq, dur, vol) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(freq, time);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.5, time + dur);
      gain.gain.setValueAtTime(vol * 0.8, time);
      gain.gain.exponentialRampToValueAtTime(0.01, time + dur);
      osc.connect(gain).connect(this.masterGain);
      osc.start(time);
      osc.stop(time + dur);
    };
    
    // Mag out
    click(t + 0.1, 400, 0.1, 0.2);
    click(t + 0.15, 300, 0.1, 0.2);
    
    // Mag in
    click(t + 1.0, 300, 0.1, 0.3);
    click(t + 1.1, 200, 0.15, 0.4);
    
    // Bolt release
    click(t + 1.5, 800, 0.05, 0.3);
    click(t + 1.55, 600, 0.1, 0.4);
  }

  playShotgunReload() {
    if (this.ctx.state !== 'running') return;
    
    if (this.buffers['sniper_shotgun_reload']) {
      const source = this.ctx.createBufferSource();
      source.buffer = this.buffers['sniper_shotgun_reload'];
      source.connect(this.masterGain);
      source.start();
      return;
    }
    
    const t = this.ctx.currentTime;
    
    const click = (time, freq, dur, vol) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(freq, time);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.8, time + dur);
      gain.gain.setValueAtTime(vol, time);
      gain.gain.exponentialRampToValueAtTime(0.01, time + dur);
      osc.connect(gain).connect(this.masterGain);
      osc.start(time);
      osc.stop(time + dur);
    };

    // Inserting shells
    for(let i=0; i<3; i++) {
      let st = t + 0.2 + (i * 0.5);
      click(st, 500, 0.05, 0.2);
      click(st + 0.1, 300, 0.1, 0.3);
    }
    
    // Pump action
    click(t + 2.0, 600, 0.1, 0.4);
    click(t + 2.05, 400, 0.1, 0.4);
    click(t + 2.2, 700, 0.1, 0.5);
    click(t + 2.25, 400, 0.15, 0.5);
  }

  playSniperReload() {
    if (this.ctx.state !== 'running') return;
    
    if (this.buffers['sniper_shotgun_reload']) {
      const source = this.ctx.createBufferSource();
      source.buffer = this.buffers['sniper_shotgun_reload'];
      source.connect(this.masterGain);
      source.start();
      return;
    }
    
    const t = this.ctx.currentTime;
    
    const click = (time, freq, dur, vol) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(freq, time);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.8, time + dur);
      gain.gain.setValueAtTime(vol, time);
      gain.gain.exponentialRampToValueAtTime(0.01, time + dur);
      osc.connect(gain).connect(this.masterGain);
      osc.start(time);
      osc.stop(time + dur);
    };

    // Bolt up
    click(t + 0.2, 800, 0.1, 0.3);
    // Bolt back
    click(t + 0.4, 500, 0.15, 0.4);
    
    // Mag out
    click(t + 1.0, 300, 0.1, 0.2);
    // Mag in
    click(t + 1.8, 250, 0.15, 0.4);
    click(t + 1.9, 150, 0.15, 0.4);
    
    // Bolt forward
    click(t + 2.5, 600, 0.1, 0.4);
    // Bolt down
    click(t + 2.7, 900, 0.1, 0.5);
    click(t + 2.75, 400, 0.15, 0.5);
  }

  playWaveClear() {
    if (this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    const freqs = [523.25, 659.25, 783.99]; // C5, E5, G5

    freqs.forEach((freq, i) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'square';
      osc.frequency.value = freq;

      const startTime = t + i * 0.15;
      const duration = i === 2 ? 0.3 : 0.15;

      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(0.12, startTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

      osc.connect(gain);
      gain.connect(this.masterGain);

      osc.start(startTime);
      osc.stop(startTime + duration);
    });
  }

  // ── Dynamic Music System ────────────────────────────────────────────────

  startMusic(intensity) {
    if (this.ctx.state !== 'running') return;
    if (!this._musicNodes) {
      this._musicNodes = {
        droneGain: this.ctx.createGain(),
        percGain: this.ctx.createGain(),
        bassGain: this.ctx.createGain(),
        leadGain: this.ctx.createGain(),
        oscs: []
      };

      this._musicNodes.droneGain.connect(this.masterGain);
      this._musicNodes.percGain.connect(this.masterGain);
      this._musicNodes.bassGain.connect(this.masterGain);
      this._musicNodes.leadGain.connect(this.masterGain);
      
      this._musicNodes.droneGain.gain.value = 0;
      this._musicNodes.percGain.gain.value = 0;
      this._musicNodes.bassGain.gain.value = 0;
      this._musicNodes.leadGain.gain.value = 0;

      // Layer 0: Drone (55Hz, 110Hz)
      const freqs = [55, 110];
      freqs.forEach((f, i) => {
        const osc = this.ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = f;
        const lfo = this.ctx.createOscillator();
        const lfoGain = this.ctx.createGain();
        lfo.type = 'sine';
        lfo.frequency.value = 0.15 + i * 0.05;
        lfoGain.gain.value = 0.02;
        lfo.connect(lfoGain).connect(osc.frequency);
        lfo.start();
        osc.connect(this._musicNodes.droneGain);
        osc.start();
        this._musicNodes.oscs.push({osc, lfo});
      });

      this._nextNoteTime = this.ctx.currentTime + 0.1;
      this._beatIndex = 0;
      this._musicInterval = setInterval(() => this._scheduleMusic(), 50);
    }

    this._targetIntensity = intensity;
    this._applyIntensity(intensity);
  }

  _scheduleMusic() {
    if (!this._musicNodes || this.ctx.state !== 'running') return;
    while (this._nextNoteTime < this.ctx.currentTime + 0.15) {
      this._playBeat(this._nextNoteTime, this._beatIndex);
      this._nextNoteTime += 0.125; // 8th note at 120bpm = 0.25s / 2
      this._beatIndex = (this._beatIndex + 1) % 16;
    }
  }

  _playBeat(time, beatIndex) {
    if (this._targetIntensity >= 1) {
      // Kick drum every 0.5s (beatIndex % 4 === 0)
      if (beatIndex % 4 === 0) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(150, time);
        osc.frequency.exponentialRampToValueAtTime(60, time + 0.1);
        gain.gain.setValueAtTime(1.0, time);
        gain.gain.exponentialRampToValueAtTime(0.01, time + 0.1);
        osc.connect(gain).connect(this._musicNodes.percGain);
        osc.start(time);
        osc.stop(time + 0.1);
      }
      // Hi-hat every 0.25s on offbeats (beatIndex % 2 === 0, beatIndex % 4 !== 0)
      if (beatIndex % 2 === 0 && beatIndex % 4 !== 0) {
        const bufferSize = this.ctx.sampleRate * 0.05;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i=0; i<bufferSize; i++) data[i] = Math.random() * 2 - 1;
        const noise = this.ctx.createBufferSource();
        noise.buffer = buffer;
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.value = 5000;
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.3, time);
        gain.gain.exponentialRampToValueAtTime(0.01, time + 0.05);
        noise.connect(filter).connect(gain).connect(this._musicNodes.percGain);
        noise.start(time);
      }
    }

    if (this._targetIntensity >= 2) {
      // Synth bassline: A2(110), A2, C3(130.8), E3(164.8) every 0.25s (beatIndex % 2 === 0)
      if (beatIndex % 2 === 0) {
        const step = (beatIndex / 2) % 4;
        const freqs = [110, 110, 130.81, 164.81];
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.value = freqs[step];
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = this._targetIntensity >= 3 ? 800 : 400;
        gain.gain.setValueAtTime(0.6, time);
        gain.gain.exponentialRampToValueAtTime(0.01, time + 0.2);
        osc.connect(filter).connect(gain).connect(this._musicNodes.bassGain);
        osc.start(time);
        osc.stop(time + 0.2);
      }
    }

    if (this._targetIntensity >= 3) {
      // High tension lead synth: A3(220), C4(261.6), E4(329.6), G4(392) at 0.125s
      const step = beatIndex % 4;
      const freqs = [220, 261.63, 329.63, 392.00];
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = freqs[step];
      gain.gain.setValueAtTime(0.2, time);
      gain.gain.exponentialRampToValueAtTime(0.01, time + 0.1);
      osc.connect(gain).connect(this._musicNodes.leadGain);
      osc.start(time);
      osc.stop(time + 0.1);
    }
  }

  _applyIntensity(intensity) {
    const t = this.ctx.currentTime;
    const masterTarget = intensity >= 3 ? 0.15 : (intensity === 0 ? 0.08 : 0.12);
    
    const droneVol = 1.0;
    const percVol = intensity >= 1 ? 1.0 : 0;
    const bassVol = intensity >= 2 ? 1.0 : 0;
    const leadVol = intensity >= 3 ? 1.0 : 0;

    this._musicNodes.droneGain.gain.setTargetAtTime(droneVol * masterTarget, t, 0.5);
    this._musicNodes.percGain.gain.setTargetAtTime(percVol * masterTarget, t, 0.5);
    this._musicNodes.bassGain.gain.setTargetAtTime(bassVol * masterTarget, t, 0.5);
    this._musicNodes.leadGain.gain.setTargetAtTime(leadVol * masterTarget, t, 0.5);
  }

  updateMusicIntensity(wave, isBossWave) {
    if (isBossWave || wave >= 8) {
      this.startMusic(3);
    } else if (wave >= 4) {
      this.startMusic(2);
    } else if (wave >= 1) {
      this.startMusic(1);
    } else {
      this.startMusic(0);
    }
  }

  // ── Footstep ─────────────────────────────────────────────────────

  playFootstep() {
    if (this.ctx.state !== 'running') return;
    const bufSize = this.ctx.sampleRate * 0.06;
    const buffer  = this.ctx.createBuffer(1, bufSize, this.ctx.sampleRate);
    const data    = buffer.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1);
    const noise  = this.ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type  = 'lowpass';
    filter.frequency.setValueAtTime(180, this.ctx.currentTime);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.055, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.06);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    noise.start();
  }

  // ── Player death ──────────────────────────────────────────────────

  playDeath() {
    if (this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;

    // Fade out music over 2 seconds
    if (this._musicNodes) {
      this._musicNodes.droneGain.gain.linearRampToValueAtTime(0, t + 2.0);
      this._musicNodes.percGain.gain.linearRampToValueAtTime(0, t + 2.0);
      this._musicNodes.bassGain.gain.linearRampToValueAtTime(0, t + 2.0);
      this._musicNodes.leadGain.gain.linearRampToValueAtTime(0, t + 2.0);
      setTimeout(() => {
        clearInterval(this._musicInterval);
        this._musicNodes?.oscs.forEach(o => { try{ o.osc.stop(); o.lfo.stop(); }catch(e){} });
        this._musicNodes = null;
      }, 2100);
    }

    // Low drone – fades in then out
    const drone     = this.ctx.createOscillator();
    const droneGain = this.ctx.createGain();
    drone.type = 'sine';
    drone.frequency.setValueAtTime(60, t);
    drone.frequency.linearRampToValueAtTime(30, t + 0.8);
    droneGain.gain.setValueAtTime(0, t);
    droneGain.gain.linearRampToValueAtTime(0.28, t + 0.15);
    droneGain.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
    drone.connect(droneGain);
    droneGain.connect(this.masterGain);
    drone.start(t);
    drone.stop(t + 0.8);

    // Rapid descending tone
    const hit     = this.ctx.createOscillator();
    const hitGain = this.ctx.createGain();
    hit.type = 'triangle';
    hit.frequency.setValueAtTime(400, t);
    hit.frequency.exponentialRampToValueAtTime(40, t + 0.45);
    hitGain.gain.setValueAtTime(0.18, t);
    hitGain.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    hit.connect(hitGain);
    hitGain.connect(this.masterGain);
    hit.start(t);
    hit.stop(t + 0.45);

    // Body-impact noise burst
    const bufSize = this.ctx.sampleRate * 0.18;
    const buffer  = this.ctx.createBuffer(1, bufSize, this.ctx.sampleRate);
    const data    = buffer.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1);
    const noise  = this.ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type  = 'lowpass';
    filter.frequency.setValueAtTime(300, t);
    filter.frequency.exponentialRampToValueAtTime(60, t + 0.18);
    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0.22, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(this.masterGain);
    noise.start(t);
  }

  // ── New Sounds ───────────────────────────────────────────────────

  playLowHealthWarning() {
    if (this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(600, t);
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.setValueAtTime(0, t + 0.05); // 0.05s on
    osc.connect(gain).connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.05);
  }

  playEnemyHitFlesh() {
    if (this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    const bufferSize = this.ctx.sampleRate * 0.03;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    
    // Low pass filter for a deeper thud
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 400;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.5, t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.04);
    
    noise.connect(filter).connect(gain).connect(this.masterGain);
    noise.start(t);
  }

  playHeadshotSound() {
    if (this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1200, t);
    gain.gain.setValueAtTime(0.4, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    osc.connect(gain).connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.08);
  }

  playBossAppear() {
    if (this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    
    // Low rumble
    const rumble = this.ctx.createOscillator();
    const rumbleGain = this.ctx.createGain();
    rumble.type = 'sine';
    rumble.frequency.setValueAtTime(40, t);
    rumble.frequency.linearRampToValueAtTime(80, t + 0.5);
    rumbleGain.gain.setValueAtTime(0.5, t);
    rumbleGain.gain.exponentialRampToValueAtTime(0.01, t + 0.5);
    rumble.connect(rumbleGain).connect(this.masterGain);
    rumble.start(t);
    rumble.stop(t + 0.5);

    // High sting
    const sting = this.ctx.createOscillator();
    const stingGain = this.ctx.createGain();
    sting.type = 'sine';
    sting.frequency.setValueAtTime(1800, t);
    stingGain.gain.setValueAtTime(0.3, t);
    stingGain.gain.exponentialRampToValueAtTime(0.01, t + 0.1);
    sting.connect(stingGain).connect(this.masterGain);
    sting.start(t);
    sting.stop(t + 0.1);
  }

  playWaveStart() {
    if (this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    const freqs = [329.63, 392.00, 493.88]; // E4, G4, B4
    freqs.forEach((freq, i) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t + i * 0.1);
      gain.gain.setValueAtTime(0.15, t + i * 0.1);
      gain.gain.exponentialRampToValueAtTime(0.01, t + (i * 0.1) + 0.1);
      osc.connect(gain).connect(this.masterGain);
      osc.start(t + i * 0.1);
      osc.stop(t + (i * 0.1) + 0.1);
    });
  }
}

