/**
 * NetworkManager — Client-side Socket.io wrapper for Neon Arena multiplayer.
 *
 * Usage:
 *   const nm = new NetworkManager();
 *   nm.onOffline = () => showOfflineError();
 *   const roomData = await nm.findMatch('PlayerName', 'cgUsername');
 *   nm.onMatchStart = (data) => startGame(data);
 */

import { io } from 'socket.io-client';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3000';

export class NetworkManager {
  constructor() {
    /** Whether this client is currently the room host (first to join, or reassigned). */
    this.isHost = false;

    /** Set to true if the server could not be reached. */
    this.offline = false;

    /** The local player's UUID assigned by the server. */
    this.localPlayerId = null;

    /** The current roomId. */
    this.roomId = null;

    // ── Throttle state for sendMove ─────────────────────────────────────────
    this._lastMoveTime = 0;
    this._MOVE_INTERVAL_MS = 1000 / 20; // max 20 sends/sec

    // ── Settable callbacks ──────────────────────────────────────────────────
    /** Called when the room player list changes. @type {(data:{players:[]}) => void} */
    this.onRoomUpdate        = null;
    /** Called when the match starts. @type {(data:{players:[]}) => void} */
    this.onMatchStart        = null;
    /** Called every second during the match. @type {(data:{secondsLeft:number}) => void} */
    this.onTimerUpdate       = null;
    /** Called when a remote player moves. */
    this.onRemotePlayerMoved = null;
    /** Called when a remote player shoots. */
    this.onRemotePlayerShot  = null;
    /** Called when a player takes damage (non-lethal). */
    this.onRemotePlayerDamaged = null;
    /** Called on a kill. @type {(data:{killerName,killedName,scores}) => void} */
    this.onKillEvent         = null;
    /** Called when a player disconnects mid-match. */
    this.onPlayerLeft        = null;
    /** Called when the match timer hits 0. */
    this.onMatchEnded        = null;
    /** Called every second during countdown. @type {(data:{secondsLeft:number}) => void} */
    this.onCountdownTick     = null;
    /** Called when countdown begins (all players ready). */
    this.onCountdownStart    = null;
    /** Called when host is required to make a choice. */
    this.onHostChoiceRequired = null;
    /** Called for non-hosts after countdown hits 0. */
    this.onWaitingForHost    = null;
    /** Called when a remote player respawns. */
    this.onRemotePlayerRespawned = null;
    /** Called if the server is unreachable. */
    this.onOffline           = null;

    // ── Connect ─────────────────────────────────────────────────────────────
    this._socket = null;
    this._connect();
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  _connect() {
    try {
      this._socket = io(SERVER_URL, {
        transports:       ['websocket', 'polling'],
        reconnection:     true,
        reconnectionDelay: 1000,
        timeout:          5000,
      });

      this._socket.on('connect', () => {
        console.log('[NetworkManager] Connected to server:', SERVER_URL);
        this.offline = false;
      });

      this._socket.on('connect_error', (err) => {
        console.warn('[NetworkManager] Connection error:', err.message);
        this.offline = true;
        this.onOffline?.();
      });

      this._socket.on('disconnect', (reason) => {
        console.warn('[NetworkManager] Disconnected:', reason);
      });

      // ── Server-pushed events ───────────────────────────────────────────────

      this._socket.on('room_update', (data) => {
        this.onRoomUpdate?.(data);
      });

      this._socket.on('match_found', (data) => {
        // Handled via findMatch() Promise — stored in _matchFoundResolve
        this.localPlayerId = data.playerId;
        this.roomId        = data.roomId;
        this.isHost        = data.isHost || false;
        if (this._matchFoundResolve) {
          this._matchFoundResolve(data);
          this._matchFoundResolve = null;
        }
      });

      this._socket.on('match_start', (data) => {
        this.onMatchStart?.(data);
      });

      this._socket.on('timer_update', (data) => {
        this.onTimerUpdate?.(data);
      });

      this._socket.on('remote_player_moved', (data) => {
        this.onRemotePlayerMoved?.(data);
      });

      this._socket.on('remote_player_shot', (data) => {
        this.onRemotePlayerShot?.(data);
      });

      this._socket.on('remote_player_damaged', (data) => {
        this.onRemotePlayerDamaged?.(data);
      });

      this._socket.on('kill_event', (data) => {
        this.onKillEvent?.(data);
      });

      this._socket.on('player_left', (data) => {
        this.onPlayerLeft?.(data);
      });

      this._socket.on('match_ended', (data) => {
        this.onMatchEnded?.(data);
      });

      this._socket.on('countdown_start', (data) => {
        this.onCountdownStart?.(data);
      });

      this._socket.on('countdown_tick', (data) => {
        this.onCountdownTick?.(data);
      });

      this._socket.on('host_choice_required', () => {
        this.isHost = true; // confirm host status
        this.onHostChoiceRequired?.();
      });

      this._socket.on('waiting_for_host', () => {
        this.onWaitingForHost?.();
      });

      this._socket.on('remote_player_respawned', (data) => {
        this.onRemotePlayerRespawned?.(data);
      });

      /**
       * Server tells this client it is now the host
       * (previous host disconnected — bot authority transfers here).
       */
      this._socket.on('you_are_now_host', () => {
        this.isHost = true;
        console.log('[NetworkManager] You are now the host — bot authority transferred.');
      });

    } catch (err) {
      console.error('[NetworkManager] Fatal init error:', err);
      this.offline = true;
      this.onOffline?.();
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Find or create a multiplayer room.
   * @param {string} playerName
   * @param {string} cgUsername
   * @returns {Promise<{roomId, playerId, isHost, players}>}
   */
  findMatch(playerName, cgUsername) {
    return new Promise((resolve, reject) => {
      if (this.offline || !this._socket?.connected) {
        reject(new Error('Server offline'));
        return;
      }

      // Store resolve so the match_found handler can call it
      this._matchFoundResolve = resolve;

      // Safety timeout — reject after 10 seconds if no response
      const timeout = setTimeout(() => {
        this._matchFoundResolve = null;
        reject(new Error('Matchmaking timeout'));
      }, 10000);

      // Clear timeout on first resolve
      const origResolve = resolve;
      this._matchFoundResolve = (data) => {
        clearTimeout(timeout);
        origResolve(data);
      };

      this._socket.emit('find_match', { playerName, cgUsername });
    });
  }

  /**
   * Signal that this client is fully loaded and ready to play.
   */
  signalReady() {
    this._socket?.emit('player_ready');
  }

  /**
   * Send local player position/rotation — throttled to ≤20 per second.
   * @param {{ x, y, z }} position
   * @param {number} rotationY
   */
  sendMove(position, rotationY) {
    const now = performance.now();
    if (now - this._lastMoveTime < this._MOVE_INTERVAL_MS) return;
    this._lastMoveTime = now;
    this._socket?.emit('player_move', { position, rotationY });
  }

  /**
   * Broadcast that the local player fired a shot.
   * @param {{ x, y, z }} origin
   * @param {{ x, y, z }} direction
   */
  sendShoot(origin, direction) {
    this._socket?.emit('player_shoot', { origin, direction });
  }

  /**
   * Tell the server a player was hit.
   * @param {string} targetId  — UUID of the target player
   * @param {number} damage
   */
  sendHit(targetId, damage) {
    this._socket?.emit('player_hit', { targetId, damage });
  }

  /**
   * Host: fill remaining slots with bots and start match.
   */
  fillWithBots() {
    this._socket?.emit('fill_with_bots');
  }

  /**
   * Host: start match immediately with current real players.
   */
  startNow() {
    this._socket?.emit('start_now');
  }

  /**
   * Disconnect the socket (call on leaving multiplayer mode).
   */
  disconnect() {
    if (this._socket) {
      this._socket.disconnect();
    }
    this.isHost        = false;
    this.localPlayerId = null;
    this.roomId        = null;
    this.offline       = false;
  }

  /**
   * Reconnect after a disconnect (e.g., play again).
   */
  reconnect() {
    if (this._socket && !this._socket.connected) {
      this._socket.connect();
    }
  }
}
