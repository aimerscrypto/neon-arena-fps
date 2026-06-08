import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass }     from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

import { SceneManager }   from './SceneManager.js';
import { Player }         from './Player.js';
import { BotManager }     from './BotManager.js';
import { PowerupManager } from './PowerupManager.js';
import { UI }             from './UI.js';
import { Effects }        from './Effects.js';
import { AudioManager }   from './AudioManager.js';
import { SettingsManager } from './SettingsManager.js';
import { ProjectileManager } from './ProjectileManager.js';
import LeaderboardManager from './LeaderboardManager.js';
import { NetworkManager }     from './NetworkManager.js';
import { MultiplayerManager } from './MultiplayerManager.js';

let camera, renderer, composer, bloomPass;
let sceneManager, player, botManager, powerupManager, ui, effects, audioManager, settingsManager, projectileManager;
let lastTime   = performance.now();
let gameActive = false;
let hasGameStarted = false;
let timeScale  = 1.0;
let slowMoTimer = 0;

// ── Multiplayer state ──
let networkManager    = null;
let multiplayerManager = null;
let isMultiplayerMode  = false;
let mpRoomData         = null;

// ── Loading Screen ──
document.addEventListener("DOMContentLoaded", () => {
  const fill = document.getElementById("loading-fill");
  const prompt = document.getElementById("loading-prompt");
  const screen = document.getElementById("loading-screen");
  
  if (fill && prompt && screen) {
    fill.addEventListener("animationend", () => {
      prompt.classList.remove("hidden");
    });
    screen.addEventListener("click", () => {
      if (!prompt.classList.contains("hidden")) {
        screen.style.display = "none";
      }
    });
  }
});

init();
animate();

// ─────────────────────────────────────────────────────────────────
function init() {
  ui             = new UI();
  const leaderboardManager = new LeaderboardManager();

  const originalShowDeathScreen = ui.showDeathScreen.bind(ui);
  ui.showDeathScreen = (wave, kills) => {
    leaderboardManager.submitScore(ui.score);
    originalShowDeathScreen(wave, kills);
  };

  settingsManager = new SettingsManager();
  audioManager   = new AudioManager();

  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(window.innerWidth, window.innerHeight);
  // Cap pixel ratio at 1.0 — a ratio of 2 quadruples rendered pixels for minimal visual gain
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.0));
  renderer.toneMapping = THREE.ReinhardToneMapping;
  renderer.toneMappingExposure = 1.0;
  // Canvas sits behind all HTML UI
  renderer.domElement.style.position = 'fixed';
  renderer.domElement.style.top      = '0';
  renderer.domElement.style.left     = '0';
  renderer.domElement.style.zIndex   = '0';
  document.body.appendChild(renderer.domElement);

  sceneManager   = new SceneManager();
  effects        = new Effects(sceneManager.getScene(), camera);
  player         = new Player(camera, document.body, sceneManager, ui, effects, audioManager, renderer);
  botManager     = new BotManager(sceneManager.getScene(), player, ui, effects, triggerSlowMo, audioManager, camera, renderer);
  powerupManager = new PowerupManager(sceneManager.getScene(), player);
  projectileManager = new ProjectileManager(sceneManager.getScene(), botManager, effects, audioManager, sceneManager);

  player.botManager          = botManager;
  botManager.powerupManager  = powerupManager;
  player.projectileManager   = projectileManager;

  // Apply saved settings to live objects
  settingsManager.onSensitivityChange = (v) => { player.controls.pointerSpeed = v; };
  settingsManager.onVolumeChange      = (v) => { audioManager.setVolume(v); };
  settingsManager.onAdsModeChange     = (v) => { if (player) player.adsMode = v; };
  settingsManager.apply(player, audioManager);

  try {
    window.CrazyGames?.SDK?.init();
  } catch (e) {
    console.warn('CrazyGames SDK init failed:', e);
  }
  ui.initData();

  // ── Multiplayer init ─────────────────────────────────────────────────────────
  networkManager = new NetworkManager();
  networkManager.onOffline = () => {
    // Server unreachable — handled gracefully in startMultiplayer()
  };

  multiplayerManager = new MultiplayerManager({
    scene:          sceneManager.getScene(),
    camera,
    renderer,
    ui,
    networkManager,
    effects,
    player,
    sceneManager,   // needed by HumanoidBot via mpBotTarget
    audioManager,   // needed by HumanoidBot via mpBotTarget
  });

  // Post-processing
  // Bloom uses a half-resolution internal buffer — saves ~40% GPU cost.
  // Threshold 0.50 means only genuinely bright emissive objects bloom.
  const renderScene = new RenderPass(sceneManager.getScene(), camera);
  const bloomRes = new THREE.Vector2(
    Math.round(window.innerWidth  * 0.5),
    Math.round(window.innerHeight * 0.5)
  );
  bloomPass = new UnrealBloomPass(bloomRes, 0.8, 0.4, 0.85);
  bloomPass.threshold = 0.85;
  bloomPass.strength  = 0.80;
  bloomPass.radius    = 0.40;

  composer = new EffectComposer(renderer);
  composer.addPass(renderScene);
  composer.addPass(bloomPass);

  // ── Mobile notice ──────────────────────────────────────────────
  initMobileNotice();

  // ── Main menu subtitle cycling ────────────────────────────────
  initSubtitleCycling();

  // ── Controls / How-to-play overlays ──────────────────────────
  document.getElementById('controls-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('controls-overlay')?.classList.remove('hidden');
  });
  document.getElementById('controls-close-btn')?.addEventListener('click', () => {
    document.getElementById('controls-overlay')?.classList.add('hidden');
  });

  document.getElementById('how-to-play-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('how-to-play-overlay')?.classList.remove('hidden');
  });
  document.getElementById('htp-close-btn')?.addEventListener('click', () => {
    document.getElementById('how-to-play-overlay')?.classList.add('hidden');
  });

  // Close overlays on backdrop click
  document.getElementById('controls-overlay')?.addEventListener('click', (e) => {
    if (e.target.id === 'controls-overlay') {
      e.target.classList.add('hidden');
    }
  });
  document.getElementById('how-to-play-overlay')?.addEventListener('click', (e) => {
    if (e.target.id === 'how-to-play-overlay') {
      e.target.classList.add('hidden');
    }
  });

  // ── Input wiring ──────────────────────────────────────────────

  // Play button → fullscreen then pointer lock (SOLO mode — untouched)
  document.getElementById('play-btn')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    await startGame();
  });

  // ── Multiplayer button ───────────────────────────────────────────────────────
  document.getElementById('multiplayer-btn')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    await startMultiplayer();
  });

  // Matchmaking cancel
  document.getElementById('mm-cancel-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    cancelMatchmaking();
  });

  // Host fill/start buttons
  document.getElementById('mm-fill-bots-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    networkManager.fillWithBots();
    ui.hideBotFillChoice();
  });
  document.getElementById('mm-start-now-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    networkManager.startNow();
    ui.hideBotFillChoice();
  });

  // Match-ended custom event (fired from MultiplayerManager)
  window.addEventListener('mp_match_ended', (e) => {
    const data = e.detail;
    ui.hideMatchTimer();
    ui.hideFfaLabel();

    // Release pointer first so the results screen is clickable (Bug 3)
    if (player.controls.isLocked) player.controls.unlock();
    gameActive = false;
    isMultiplayerMode = false;

    // Defer one frame so the unlock event doesn't re-trigger the menu (Bug 3)
    requestAnimationFrame(() => {
      ui.showMatchResults(
        data,
        // Play again
        async () => {
          ui.hideMatchResults();
          player.reset();
          endMultiplayerMatch();
          await startMultiplayer();
        },
        // Main menu
        () => {
          ui.hideMatchResults();
          player.reset();
          endMultiplayerMatch();
          returnToMainMenu();
        },
      );
    });
  });

  const handleLeaderboardClick = async (e) => {
    e.stopPropagation();
    ui.showLeaderboard(null, null);
    const scores = await leaderboardManager.getTopScores();
    const userBest = await leaderboardManager.getUserBestScore();
    ui.showLeaderboard(scores, userBest);
  };

  document.getElementById('leaderboard-btn')?.addEventListener('click', handleLeaderboardClick);
  document.getElementById('death-leaderboard-btn')?.addEventListener('click', handleLeaderboardClick);

  // Legacy: clicking blocker backdrop also starts game
  document.getElementById('blocker')?.addEventListener('click', async (e) => {
    const ids = ['settings-open-btn', 'fullscreen-notice', 'fullscreen-request-btn',
                 'controls-btn', 'how-to-play-btn'];
    if (ids.some(id => e.target.closest?.('#' + id))) return;
    if (e.target.id === 'blocker' && !gameActive && player.health > 0) {
      await startGame();
    }
  });

  // Death screen buttons
  document.getElementById('play-again-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    restartGame();
  });
  document.getElementById('main-menu-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    returnToMainMenu();
  });

  // HUD settings button – unlocks pointer, opens settings
  document.getElementById('hud-settings-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    player.controls.unlock(); // pause game
    document.getElementById('settings-overlay')?.classList.remove('hidden');
  });

  // Pause menu buttons
  document.getElementById('resume-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    player.controls.lock();
  });
  document.getElementById('restart-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('pause-screen')?.classList.add('hidden');
    restartGame();
  });
  document.getElementById('pause-main-menu-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('pause-screen')?.classList.add('hidden');
    returnToMainMenu();
  });

  // Pointer lock events
  player.controls.addEventListener('lock', () => {
    gameActive = true;
    if (!isMultiplayerMode) {
      ui.hideMenu(); // Bug 4: don't try to hide menu in MP — it's already gone
    }
    document.getElementById('pause-screen')?.classList.add('hidden');
    // Close overlays if open
    document.getElementById('settings-overlay')?.classList.add('hidden');
    document.getElementById('controls-overlay')?.classList.add('hidden');
    document.getElementById('how-to-play-overlay')?.classList.add('hidden');
  });

  player.controls.addEventListener('unlock', () => {
    audioManager.startMusic?.(0);

    if (isMultiplayerMode) {
      // Bug 1 & 5: In multiplayer ESC just releases the pointer — match keeps running.
      // gameActive must stay true so the game loop continues.
      gameActive = true;
      return;
    }

    gameActive = false;

    if (player.health > 0) {
      if (hasGameStarted) {
        const upgradeScreen = document.getElementById('upgrade-screen');
        if (!upgradeScreen || upgradeScreen.classList.contains('hidden')) {
          document.getElementById('pause-wave-val').textContent = botManager.wave;
          document.getElementById('pause-score-val').textContent = document.getElementById('score-val')?.textContent || '0';
          document.getElementById('pause-screen')?.classList.remove('hidden');
        }
      } else {
        ui.showMenu();
      }
    }
  });

  // Fullscreen change – update button icon if desired
  document.addEventListener('fullscreenchange', onFullscreenChange);
  document.addEventListener('webkitfullscreenchange', onFullscreenChange);

  window.addEventListener('resize', onWindowResize);
}

// ─────────────────────────────────────────────────────────────────
function initMobileNotice() {
  const isMobile = navigator.maxTouchPoints > 0 || window.innerWidth < 768;
  const notice   = document.getElementById('mobile-notice');
  if (!notice) return;

  if (isMobile) {
    notice.classList.remove('hidden');

    document.getElementById('play-anyway-btn')?.addEventListener('click', () => {
      notice.classList.add('hidden');
    });

    document.getElementById('come-back-btn')?.addEventListener('click', () => {
      // Grey out the notice to indicate "dismissed"
      notice.style.opacity = '0';
      notice.style.transition = 'opacity 0.5s ease';
      setTimeout(() => notice.classList.add('hidden'), 500);
    });
  }
  // If NOT mobile, leave the notice hidden (already has class="hidden")
}

// ─────────────────────────────────────────────────────────────────
function initSubtitleCycling() {
  const subtitles = [
    'SURVIVE THE WAVES',
    'HOW LONG CAN YOU LAST?',
    'ENDLESS CYBERPUNK COMBAT',
  ];
  let idx = 0;
  const el = document.getElementById('menu-subtitle');
  if (!el) return;

  el.textContent = subtitles[0];

  setInterval(() => {
    el.classList.add('fading');
    setTimeout(() => {
      idx = (idx + 1) % subtitles.length;
      el.textContent = subtitles[idx];
      el.classList.remove('fading');
    }, 500); // matches transition duration
  }, 3000);
}

// ─────────────────────────────────────────────────────────────────
async function startGame() {
  audioManager.resume();
  try { window.CrazyGames?.SDK?.game?.gameplayStart(); } catch(e){}
  hasGameStarted = true;

  // Lock pointer immediately to preserve user gesture
  player.controls.lock();

  // Try to enter fullscreen; if denied, show notice and continue
  if (!document.fullscreenElement && !document.webkitFullscreenElement) {
    settingsManager.requestFullscreen().catch(() => {
      document.getElementById('fullscreen-notice')?.classList.remove('hidden');
    });
  }
}

function restartGame() {
  // Bug 2: clean up any active multiplayer session before restarting
  if (isMultiplayerMode) {
    endMultiplayerMatch();
  }
  ui.hideDeathScreen();
  try { window.CrazyGames?.SDK?.game?.gameplayStart(); } catch(e){}
  hasGameStarted = true;
  player.reset();
  botManager.reset();
  powerupManager.reset();
  ui.reset();
  timeScale   = 1.0;
  slowMoTimer = 0;
  // Re-apply settings (sensitivity etc.)
  settingsManager.apply(player, audioManager);
  startGame();
}

function returnToMainMenu() {
  // Bug 2: clean up any active multiplayer session before returning to menu
  if (isMultiplayerMode) {
    endMultiplayerMatch();
  }
  ui.hideDeathScreen();
  hasGameStarted = false;
  player.reset();
  botManager.reset();
  powerupManager.reset();
  ui.reset();
  timeScale   = 1.0;
  slowMoTimer = 0;
  settingsManager.apply(player, audioManager);
  // Show menu without locking pointer
  ui.showMenu();
}

function onFullscreenChange() {
  // Nothing critical needed; could update a button icon here
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
}

function triggerSlowMo() {
  timeScale    = 0.3;
  slowMoTimer  = 1.5;
}

// ── Multiplayer flow ──────────────────────────────────────────────────────────────

/**
 * Begin matchmaking flow: get CG username, call findMatch, show matchmaking screen.
 * If server is offline, show error and bail.
 */
async function startMultiplayer() {
  // Hide the main menu
  ui.hideMenu();
  ui.showMatchmaking();

  // Check offline status early
  if (networkManager.offline) {
    ui.showOfflineMessage();
    return;
  }

  // Reconnect socket if needed (e.g. "play again" flow)
  networkManager.reconnect();

  // Get CrazyGames username
  let cgUsername = 'Guest';
  try {
    const user = await window.CrazyGames?.SDK?.user?.getUser();
    if (user?.username) cgUsername = user.username;
  } catch { /* not logged in */ }

  // Wire lobby events BEFORE findMatch so we don't miss room_update
  networkManager.onRoomUpdate = ({ players }) => {
    const realCount = players.filter(p => !p.isBot).length;
    ui.updateMatchmakingCount(realCount);
  };

  networkManager.onCountdownStart = ({ secondsLeft }) => {
    ui.updateMatchmakingCountdown(secondsLeft);
  };

  networkManager.onCountdownTick = ({ secondsLeft }) => {
    ui.updateMatchmakingCountdown(secondsLeft);
  };

  networkManager.onHostChoiceRequired = () => {
    ui.updateMatchmakingCountdown(null);
    ui.showBotFillChoice(true);
  };

  networkManager.onWaitingForHost = () => {
    ui.updateMatchmakingCountdown(null);
    ui.showBotFillChoice(false);
  };

  networkManager.onMatchStart = (data) => {
    mpRoomData = data;
    startMultiplayerMatch(data);
  };

  // Find or create a room
  try {
    const roomData = await networkManager.findMatch(cgUsername, cgUsername);
    mpRoomData = roomData;
    ui.updateMatchmakingCount(
      roomData.players.filter(p => !p.isBot).length
    );

    // ── FIX: Signal ready immediately after joining the lobby.
    // The server needs player_ready from all real players before it can
    // start the countdown. Previously this was called inside
    // MultiplayerManager.start() which only runs AFTER match_start —
    // creating a deadlock where the match could never begin.
    networkManager.signalReady();

    // ── If we are the host, show fill/start buttons right away so
    // solo testers don't have to wait for the 30-second countdown.
    if (roomData.isHost) {
      ui.showBotFillChoice(true);
    } else {
      // Non-host: tell them we're waiting for others / the host
      ui.showBotFillChoice(false);
    }
  } catch (err) {
    console.error('[startMultiplayer] findMatch failed:', err);
    ui.showOfflineMessage();
  }
}

/** Cancel matchmaking and return to main menu. */
function cancelMatchmaking() {
  networkManager.disconnect();
  ui.hideMatchmaking();
  ui.showMenu();
}

/**
 * Called when server fires match_start.
 * Hides matchmaking UI, hides single-player HUD elements, starts game loop.
 */
async function startMultiplayerMatch(data) {
  ui.hideMatchmaking();
  isMultiplayerMode = true;
  hasGameStarted    = true;

  // Show HUD but hide solo-only wave/score panels
  if (ui.hud) ui.hud.style.display = 'block';
  const waveDisplay    = document.getElementById('wave-display');
  const scoreDisplay   = document.getElementById('score-display');
  const highScoreDisplay = document.getElementById('high-score-display');
  const enemyCounter   = document.getElementById('enemy-counter');
  if (waveDisplay)      waveDisplay.style.display      = 'none';
  if (scoreDisplay)     scoreDisplay.style.display     = 'none';
  if (highScoreDisplay) highScoreDisplay.style.display = 'none';
  if (enemyCounter)     enemyCounter.style.display     = 'none';

  // Show multiplayer-specific HUD elements
  ui.showFfaLabel();
  ui.updateMatchTimer(180);

  // Notify CrazyGames
  audioManager.resume();
  try { window.CrazyGames?.SDK?.game?.gameplayStart(); } catch(e){}

  // Start multiplayer session (spawns remote meshes, wires callbacks)
  multiplayerManager.start(data);

  // Inject multiplayerManager so local player can hit remote hitboxes
  // and so rockets can splash damage them
  player.multiplayerManager = multiplayerManager;
  if (projectileManager) {
    projectileManager.multiplayerManager = multiplayerManager;
  }

  // Lock pointer synchronously to preserve user gesture
  player.controls.lock();

  // Attempt fullscreen
  if (!document.fullscreenElement && !document.webkitFullscreenElement) {
    settingsManager.requestFullscreen().catch(() => {});
  }
}

/** Clean up after match ends or player leaves. */
function endMultiplayerMatch() {
  // Bug 6: idempotency guard — prevent double-cleanup crashes
  if (!isMultiplayerMode && !hasGameStarted) return;

  isMultiplayerMode = false;
  hasGameStarted    = false;

  // FIX 7: Restore solo HUD elements hidden during MP
  const waveDisplay      = document.getElementById('wave-display');
  const scoreDisplay     = document.getElementById('score-display');
  const highScoreDisplay = document.getElementById('high-score-display');
  const enemyCounter     = document.getElementById('enemy-counter');
  if (waveDisplay)      waveDisplay.style.display      = '';
  if (scoreDisplay)     scoreDisplay.style.display     = '';
  if (highScoreDisplay) highScoreDisplay.style.display = '';
  if (enemyCounter)     enemyCounter.style.display     = '';

  ui.hideMatchTimer();
  ui.hideFfaLabel();
  ui.toggleScoreboard(false, []);
  ui.reset();

  multiplayerManager.cleanup();
  networkManager.disconnect();
  try { window.CrazyGames?.SDK?.game?.gameplayStop(); } catch(e){}
  // NOTE: player.reset() is called by results screen callbacks, not here
}

// ─────────────────────────────────────────────────────────────────

function animate() {
  requestAnimationFrame(animate);

  const now = performance.now();
  lastTime  = lastTime || now;
  const rawDelta = Math.min((now - lastTime) / 1000, 0.1);
  lastTime  = now;

  if (slowMoTimer > 0) {
    slowMoTimer -= rawDelta;
    if (slowMoTimer <= 0) timeScale = 1.0;
  }

  const delta = rawDelta * timeScale;

  if (gameActive) {
    if (isMultiplayerMode) {
      // ── Multiplayer game loop ────────────────────────────────────────────
      player.update(delta);
      effects.update(delta);
      multiplayerManager.update(rawDelta); // use rawDelta — no slow-mo in MP
      
      if (projectileManager) projectileManager.update(delta);

      // Dynamic bloom driven by local kill streak / score in MP
      bloomPass.strength = 0.80 + Math.min(multiplayerManager.localScore / 100, 10) * 0.025;
      sceneManager.updateFog(1);

      // Update HUD minimap for remote players
      if (multiplayerManager.active) {
        const rpArray = Array.from(multiplayerManager.remotePlayers.values()).map(rp => ({ mesh: rp.mesh, isDead: false }));
        ui.updateMinimap(player.camera, rpArray, []);
      }
    } else {
      // ── Single-player game loop ───────────────────────────────────────
      player.update(delta);
      botManager.update(delta, now / 1000);
      powerupManager.update(delta);
      effects.update(delta);
      projectileManager.update(delta);

      // Dynamic bloom driven by combo
      bloomPass.strength = 0.80 + Math.min(botManager.combo - 1, 10) * 0.025;
      sceneManager.updateFog(botManager.wave);

      // Update HUD minimap
      ui.updateMinimap(player.camera, botManager.bots, powerupManager.powerups);
    }
  }

  if (settingsManager.get('bloom') === false) {
    renderer.render(sceneManager.getScene(), camera);
  } else {
    composer.render();
  }
}
