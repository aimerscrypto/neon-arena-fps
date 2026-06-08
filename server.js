/**
 * Neon Arena FPS — Multiplayer Server
 * Node.js + Socket.io — CommonJS (no "type":"module" in server-package.json)
 *
 * Run:  node server.js   (from project root)
 * Env:  PORT (defaults 3000)
 */

'use strict';

import express from 'express';
import { Server } from 'socket.io';
import http from 'http';
import { v4 as uuidv4 } from 'uuid';

// ── Server bootstrap ──────────────────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

const PORT = process.env.PORT || 3000;

// ── Constants ────────────────────────────────────────────────────────────────
const MAX_PLAYERS        = 10;
const MATCH_DURATION     = 180; // seconds
const COUNTDOWN_DURATION = 30;  // seconds before host is asked fill/start
const ROOM_DELETE_DELAY  = 10;  // seconds after match_ended before room purge

const BOT_NAMES = [
  'BOT_Viper', 'BOT_Ghost', 'BOT_Nova',  'BOT_Raze',
  'BOT_Jinx',  'BOT_Zero',  'BOT_Kira',  'BOT_Slate',
  'BOT_Flux',  'BOT_Apex',
];

// 8 spawn positions spread across the arena (x, y, z)
const SPAWN_POSITIONS = [
  { x:  0,  y: 2, z:  30 },
  { x:  0,  y: 2, z: -30 },
  { x:  30, y: 2, z:   0 },
  { x: -30, y: 2, z:   0 },
  { x:  20, y: 2, z:  20 },
  { x: -20, y: 2, z:  20 },
  { x:  20, y: 2, z: -20 },
  { x: -20, y: 2, z: -20 },
];

function randomSpawn() {
  return SPAWN_POSITIONS[Math.floor(Math.random() * SPAWN_POSITIONS.length)];
}

// ── Room registry ─────────────────────────────────────────────────────────────
// Map<roomId, RoomData>
const rooms = new Map();

/**
 * RoomData shape:
 * {
 *   id:            string,
 *   players:       Map<socketId, PlayerData>,
 *   state:         'lobby' | 'countdown' | 'playing' | 'ended',
 *   hostSocketId:  string,          // socket of first player who joined
 *   readySet:      Set<socketId>,   // real players who emitted player_ready
 *   matchTimer:    number,          // seconds left (only during 'playing')
 *   countdownLeft: number,
 *   _matchInterval:  NodeJS.Timer | null,
 *   _cdInterval:     NodeJS.Timer | null,
 *   _deleteTimeout:  NodeJS.Timer | null,
 * }
 *
 * PlayerData shape:
 * {
 *   id:         string (uuid),
 *   socketId:   string,
 *   name:       string,
 *   cgUsername: string,
 *   health:     number,
 *   score:      number,
 *   isBot:      boolean,
 * }
 */

// ── Helpers ───────────────────────────────────────────────────────────────────

function playerList(room) {
  return Array.from(room.players.values());
}

function realPlayerCount(room) {
  return playerList(room).filter(p => !p.isBot).length;
}

function realPlayerSockets(room) {
  return playerList(room).filter(p => !p.isBot).map(p => p.socketId);
}

function buildScores(room) {
  return playerList(room)
    .sort((a, b) => b.score - a.score)
    .map(p => ({ id: p.id, name: p.name, score: p.score, isBot: p.isBot }));
}

/** Find a lobby room with space, or create one. */
function findOrCreateRoom() {
  for (const room of rooms.values()) {
    if ((room.state === 'lobby' || room.state === 'countdown') && room.players.size < MAX_PLAYERS) {
      return room;
    }
  }
  // Create new room
  const room = {
    id:             uuidv4(),
    players:        new Map(),
    state:          'lobby',
    hostSocketId:   null,
    readySet:       new Set(),
    matchTimer:     MATCH_DURATION,
    countdownLeft:  COUNTDOWN_DURATION,
    _matchInterval:  null,
    _cdInterval:     null,
    _deleteTimeout:  null,
  };
  rooms.set(room.id, room);
  return room;
}

/** Reassign host to the next oldest real player (insertion order). */
function reassignHost(room) {
  for (const [socketId, player] of room.players) {
    if (!player.isBot) {
      room.hostSocketId = socketId;
      io.to(socketId).emit('you_are_now_host');
      console.log(`[Room ${room.id.slice(0,8)}] Host reassigned to ${player.name}`);
      return;
    }
  }
  // No real players left — handled by caller
}

/** Clear all timers on a room. */
function clearRoomTimers(room) {
  if (room._matchInterval)  { clearInterval(room._matchInterval);  room._matchInterval  = null; }
  if (room._cdInterval)     { clearInterval(room._cdInterval);     room._cdInterval     = null; }
  if (room._deleteTimeout)  { clearTimeout(room._deleteTimeout);   room._deleteTimeout  = null; }
}

/** Delete room entirely. */
function deleteRoom(roomId) {
  const room = rooms.get(roomId);
  if (room) clearRoomTimers(room);
  rooms.delete(roomId);
  console.log(`[Room ${roomId.slice(0,8)}] Deleted`);
}

// ── Match flow helpers ────────────────────────────────────────────────────────

function startMatch(room) {
  clearRoomTimers(room);
  room.state      = 'playing';
  room.matchTimer = MATCH_DURATION;

  io.to(room.id).emit('match_start', {
    players: playerList(room),
  });

  console.log(`[Room ${room.id.slice(0,8)}] Match started — ${room.players.size} players`);

  room._matchInterval = setInterval(() => {
    room.matchTimer--;
    io.to(room.id).emit('timer_update', { secondsLeft: room.matchTimer });

    if (room.matchTimer <= 0) {
      endMatch(room);
    }
  }, 1000);
}

function endMatch(room) {
  clearRoomTimers(room);
  room.state = 'ended';

  const sorted = buildScores(room);
  const winner = sorted[0] || { name: 'Nobody', score: 0 };

  io.to(room.id).emit('match_ended', {
    winner:      { name: winner.name, score: winner.score },
    finalScores: sorted,
  });

  console.log(`[Room ${room.id.slice(0,8)}] Match ended — winner: ${winner.name} (${winner.score})`);

  room._deleteTimeout = setTimeout(() => deleteRoom(room.id), ROOM_DELETE_DELAY * 1000);
}

function startCountdown(room) {
  clearRoomTimers(room);
  room.state         = 'countdown';
  room.countdownLeft = COUNTDOWN_DURATION;

  io.to(room.id).emit('countdown_start', { secondsLeft: room.countdownLeft });

  room._cdInterval = setInterval(() => {
    room.countdownLeft--;
    io.to(room.id).emit('countdown_tick', { secondsLeft: room.countdownLeft });

    if (room.countdownLeft <= 0) {
      clearInterval(room._cdInterval);
      room._cdInterval = null;
      // Notify host to choose fill/start
      io.to(room.hostSocketId).emit('host_choice_required');
      // Tell non-hosts to show "waiting for host" message
      io.to(room.id).except(room.hostSocketId).emit('waiting_for_host');
    }
  }, 1000);
}

function fillWithBots(room) {
  const botNamesShuffled = [...BOT_NAMES].sort(() => Math.random() - 0.5);
  let botIdx = 0;
  while (room.players.size < MAX_PLAYERS && botIdx < botNamesShuffled.length) {
    const botId = uuidv4();
    const bot = {
      id:         botId,
      socketId:   `bot_${botId}`,
      name:       botNamesShuffled[botIdx],
      cgUsername: botNamesShuffled[botIdx],
      health:     100,
      score:      0,
      isBot:      true,
    };
    room.players.set(bot.socketId, bot);
    botIdx++;
  }
}

// ── Socket.io connection handler ──────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[Socket] Connected: ${socket.id}`);

  // ── find_match ─────────────────────────────────────────────────────────────
  socket.on('find_match', ({ playerName, cgUsername } = {}) => {
    try {
      const name = (playerName || 'Player').slice(0, 24);
      const cg   = (cgUsername  || 'Guest').slice(0, 32);

      const room = findOrCreateRoom();
      socket.join(room.id);

      const playerId = uuidv4();
      const isFirstPlayer = room.players.size === 0;

      if (isFirstPlayer) {
        room.hostSocketId = socket.id;
      }

      const playerData = {
        id:         playerId,
        socketId:   socket.id,
        name,
        cgUsername: cg,
        health:     100,
        score:      0,
        isBot:      false,
      };

      room.players.set(socket.id, playerData);

      // Store room reference on socket for quick lookup
      socket._roomId    = room.id;
      socket._playerId  = playerId;
      socket._isHost    = isFirstPlayer;

      socket.emit('match_found', {
        roomId:   room.id,
        playerId,
        isHost:   isFirstPlayer,
        players:  playerList(room),
      });

      io.to(room.id).emit('room_update', { players: playerList(room) });

      console.log(`[Room ${room.id.slice(0,8)}] ${name} joined (${room.players.size}/${MAX_PLAYERS})`);

      // Immediately start if room is full
      if (room.players.size >= MAX_PLAYERS && (room.state === 'lobby' || room.state === 'countdown')) {
        room.readySet = new Set(realPlayerSockets(room)); // skip ready check
        startMatch(room);
      }
    } catch (err) {
      console.error('[find_match] Error:', err);
    }
  });

  // ── player_ready ───────────────────────────────────────────────────────────
  socket.on('player_ready', () => {
    try {
      const room = socket._roomId ? rooms.get(socket._roomId) : null;
      if (!room || room.state !== 'lobby') return;

      room.readySet.add(socket.id);

      const realSockets = realPlayerSockets(room);
      const allReady    = realSockets.every(sid => room.readySet.has(sid));

      if (allReady && realSockets.length > 0) {
        if (room.players.size >= MAX_PLAYERS) {
          startMatch(room);
        } else {
          startCountdown(room);
        }
      }
    } catch (err) {
      console.error('[player_ready] Error:', err);
    }
  });

  // ── fill_with_bots ─────────────────────────────────────────────────────────
  socket.on('fill_with_bots', () => {
    try {
      const room = socket._roomId ? rooms.get(socket._roomId) : null;
      if (!room || socket.id !== room.hostSocketId) return;
      if (room.state !== 'countdown') return;

      fillWithBots(room);
      io.to(room.id).emit('room_update', { players: playerList(room) });
      startMatch(room);
    } catch (err) {
      console.error('[fill_with_bots] Error:', err);
    }
  });

  // ── start_now ──────────────────────────────────────────────────────────────
  socket.on('start_now', () => {
    try {
      const room = socket._roomId ? rooms.get(socket._roomId) : null;
      if (!room || socket.id !== room.hostSocketId) return;
      if (room.state !== 'countdown') return;

      startMatch(room);
    } catch (err) {
      console.error('[start_now] Error:', err);
    }
  });

  // ── player_move ────────────────────────────────────────────────────────────
  socket.on('player_move', ({ position, rotationY } = {}) => {
    try {
      const room = socket._roomId ? rooms.get(socket._roomId) : null;
      if (!room || room.state !== 'playing') return;

      const player = room.players.get(socket.id);
      if (!player || player.isBot) return;

      socket.to(room.id).emit('remote_player_moved', {
        playerId: player.id,
        position,
        rotationY,
      });
    } catch (err) {
      // Suppress — high frequency, log only in debug mode
    }
  });

  // ── player_shoot ───────────────────────────────────────────────────────────
  socket.on('player_shoot', ({ origin, direction } = {}) => {
    try {
      const room = socket._roomId ? rooms.get(socket._roomId) : null;
      if (!room || room.state !== 'playing') return;

      const player = room.players.get(socket.id);
      if (!player || player.isBot) return;

      socket.to(room.id).emit('remote_player_shot', {
        playerId: player.id,
        origin,
        direction,
      });
    } catch (err) {
      console.error('[player_shoot] Error:', err);
    }
  });

  // ── player_hit ─────────────────────────────────────────────────────────────
  socket.on('player_hit', ({ targetId, damage } = {}) => {
    try {
      const room = socket._roomId ? rooms.get(socket._roomId) : null;
      if (!room || room.state !== 'playing') return;

      const attacker = room.players.get(socket.id);
      if (!attacker) return;

      // Find target by player UUID (not socket id)
      let target = null;
      for (const p of room.players.values()) {
        if (p.id === targetId) { target = p; break; }
      }
      if (!target) return;

      const dmg = Math.min(Math.max(Number(damage) || 0, 0), 200);
      target.health -= dmg;

      if (target.health <= 0) {
        // ── Kill ──────────────────────────────────────────────────────────────
        target.health = 100;
        attacker.score++;

        const spawnPos = randomSpawn();

        io.to(room.id).emit('kill_event', {
          killerId:   attacker.id,
          killerName: attacker.name,
          killedId:   target.id,
          killedName: target.name,
          scores:     buildScores(room),
        });

        io.to(room.id).emit('remote_player_respawned', {
          playerId: target.id,
          position: spawnPos,
        });
      } else {
        // ── Damage only ───────────────────────────────────────────────────────
        io.to(room.id).emit('remote_player_damaged', {
          targetId:  target.id,
          newHealth: target.health,
        });
      }
    } catch (err) {
      console.error('[player_hit] Error:', err);
    }
  });

  // ── disconnect ─────────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    try {
      const room = socket._roomId ? rooms.get(socket._roomId) : null;
      if (!room) return;

      const player = room.players.get(socket.id);
      if (!player) return;

      room.players.delete(socket.id);
      room.readySet.delete(socket.id);

      console.log(`[Room ${room.id.slice(0,8)}] ${player.name} disconnected`);

      // Notify others
      io.to(room.id).emit('player_left', {
        playerId:   player.id,
        playerName: player.name,
      });

      // If no real players remain, delete room
      if (realPlayerCount(room) === 0) {
        deleteRoom(room.id);
        return;
      }

      // Reassign host if necessary
      if (socket.id === room.hostSocketId) {
        reassignHost(room);
      }

      // Broadcast updated player list
      io.to(room.id).emit('room_update', { players: playerList(room) });
    } catch (err) {
      console.error('[disconnect] Error:', err);
    }
  });
});

// ── Health check endpoint ────────────────────────────────────────────────────
app.get('/', (req, res) => res.send('Neon Arena Multiplayer Server — OK'));

// ── Start ─────────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`Neon Arena server listening on port ${PORT}`);
});
