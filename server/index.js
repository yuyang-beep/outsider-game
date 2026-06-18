const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const gm = require('./gameManager');
const gl = require('./gameLogic');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingTimeout: 60000,
});

// Serve React build in production
const clientDist = path.join(__dirname, '../client/dist');
app.use(express.static(clientDist));
app.get('*', (req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

// ─── State Builders ──────────────────────────────────────────────────────────

function playerSnapshot(p, revealRole) {
  return {
    number: p.number,
    isAlive: p.isAlive,
    eliminatedRound: p.eliminatedRound,
    isConnected: p.isConnected,
    currentActionRoomId: p.currentActionRoomId,
    role: revealRole ? p.role : null,
  };
}

function buildHostState(session) {
  return {
    view: 'host',
    code: session.code,
    state: session.state,
    currentRound: session.currentRound,
    numActionRooms: session.numActionRooms,
    totalEliminated: session.totalEliminated,
    outsiderWeight: gl.getOutsiderWeight(session),
    players: Array.from(session.players.values()).map(p => ({
      ...playerSnapshot(p, true),
      id: p.id,
    })),
    actionRooms: session.actionRooms.map(r => ({
      id: r.id,
      playerNumbers: r.playerIds.map(pid => {
        const p = session.players.get(pid);
        return p ? p.number : null;
      }).filter(Boolean),
      redCount: r.redCount,
      blueCount: r.blueCount,
    })),
    votes: session.votes.map(v => ({
      voterNumber: v.voterNumber,
      targetNumber: v.targetNumber,
      weight: v.weight,
    })),
    roundHistory: session.roundHistory,
    winResult: session.winResult,
  };
}

function buildPlayerState(session, me) {
  const gameOver = session.state === 'game_over';

  // My room: show members during action phase; show eye counts after
  const myRoom = me.currentActionRoomId
    ? session.actionRooms.find(r => r.id === me.currentActionRoomId)
    : null;

  const myRoomDuringAction = (session.state === 'action_phase' && myRoom)
    ? {
        id: myRoom.id,
        memberNumbers: myRoom.playerIds
          .map(pid => session.players.get(pid)?.number)
          .filter(Boolean),
      }
    : null;

  // Room reveal: only shown after action phase ends (redCount !== null)
  const myRoomReveal = (myRoom && myRoom.redCount !== null)
    ? {
        id: myRoom.id,
        memberNumbers: myRoom.playerIds
          .map(pid => session.players.get(pid)?.number)
          .filter(Boolean),
        redCount: myRoom.redCount,
        blueCount: myRoom.blueCount,
      }
    : null;

  return {
    view: 'player',
    code: session.code,
    state: session.state,
    currentRound: session.currentRound,
    numActionRooms: session.numActionRooms,
    totalEliminated: session.totalEliminated,
    outsiderWeight: gl.getOutsiderWeight(session),
    // My info
    myNumber: me.number,
    myRole: me.role,          // own role always visible
    myIsAlive: me.isAlive,
    myEliminatedRound: me.eliminatedRound,
    myActionRoomId: me.currentActionRoomId,
    myRoomDuringAction,       // live room members during action phase (no eye counts)
    myRoomReveal,             // eye counts + members after action phase ends
    // Action room buttons (count only, no eye info)
    actionRoomCounts: session.actionRooms.map(r => ({
      id: r.id,
      count: r.playerIds.length,
    })),
    // All players (roles hidden unless eliminated or game over)
    allPlayers: Array.from(session.players.values())
      .map(p => playerSnapshot(p, gameOver || !p.isAlive)),
    // Open ballot
    votes: session.votes.map(v => ({
      voterNumber: v.voterNumber,
      targetNumber: v.targetNumber,
      weight: v.weight,
    })),
    roundHistory: session.roundHistory,
    winResult: session.winResult,
  };
}

function broadcast(code) {
  const session = gm.getSession(code);
  if (!session) return;

  if (session.hostSocketId) {
    io.to(session.hostSocketId).emit('state', buildHostState(session));
  }

  for (const player of session.players.values()) {
    if (player.isConnected) {
      io.to(player.id).emit('state', buildPlayerState(session, player));
    }
  }
}

// ─── Socket Events ────────────────────────────────────────────────────────────

io.on('connection', (socket) => {

  // Host creates a new room
  socket.on('create_room', ({ numActionRooms }, cb) => {
    const { code, hostToken } = gm.createSession(numActionRooms);
    gm.hostJoin(code, hostToken, socket.id);
    socket.join(code);
    cb?.({ code, hostToken });
    broadcast(code);
  });

  // Host reconnects to existing room
  socket.on('host_join', ({ code, hostToken }, cb) => {
    const r = gm.hostJoin(code, hostToken, socket.id);
    if (r.error) return cb?.({ error: r.error });
    socket.join(code);
    cb?.({ success: true });
    broadcast(code);
  });

  // Player joins or reconnects
  socket.on('player_join', ({ code, reconnectToken }, cb) => {
    if (reconnectToken) {
      const r = gm.reconnectPlayer(code, reconnectToken, socket.id);
      if (!r.error) {
        socket.join(code);
        cb?.({ success: true, playerNumber: r.player.number, reconnectToken });
        broadcast(code);
        return;
      }
    }
    const r = gm.addPlayer(code, socket.id);
    if (r.error) return cb?.({ error: r.error });
    socket.join(code);
    cb?.({ success: true, playerNumber: r.player.number, reconnectToken: r.reconnectToken });
    broadcast(code);
  });

  // ── Host controls ──────────────────────────────────────────────────────────

  function hostGuard(cb) {
    const info = gm.getSocketInfo(socket.id);
    if (!info || !info.isHost) { cb?.({ error: '无主持人权限' }); return null; }
    const session = gm.getSession(info.code);
    if (!session) { cb?.({ error: '房间不存在' }); return null; }
    return { info, session };
  }

  socket.on('host_set_room_count', ({ count }, cb) => {
    const g = hostGuard(cb); if (!g) return;
    const { info, session } = g;
    if (session.state !== 'lobby') return cb?.({ error: '游戏已开始' });
    session.numActionRooms = Math.max(2, Math.min(8, count));
    broadcast(info.code);
    cb?.({ success: true });
  });

  socket.on('host_auto_assign', (_, cb) => {
    const g = hostGuard(cb); if (!g) return;
    const { info, session } = g;
    if (session.state !== 'lobby') return cb?.({ error: '游戏已开始' });
    const r = gl.autoAssignRoles(session);
    if (r.error) return cb?.({ error: r.error });
    broadcast(info.code);
    cb?.({ success: true });
  });

  socket.on('host_set_role', ({ playerNumber, role }, cb) => {
    const g = hostGuard(cb); if (!g) return;
    const { info, session } = g;
    if (session.state !== 'lobby') return cb?.({ error: '游戏已开始' });
    const r = gl.setPlayerRole(session, playerNumber, role);
    if (r.error) return cb?.({ error: r.error });
    broadcast(info.code);
    cb?.({ success: true });
  });

  // lobby → free_phase (round 1)
  socket.on('host_start_game', (_, cb) => {
    const g = hostGuard(cb); if (!g) return;
    const { info, session } = g;
    if (session.state !== 'lobby') return cb?.({ error: '状态错误' });

    for (const p of session.players.values()) {
      if (!p.role) return cb?.({ error: '请先为所有玩家分配身份' });
    }
    const outsiders = Array.from(session.players.values()).filter(p => p.role === 'outsider');
    if (outsiders.length !== 1) return cb?.({ error: '必须恰好有1名异乡人' });

    session.state = 'free_phase';
    session.currentRound = 1;
    broadcast(info.code);
    cb?.({ success: true });
  });

  // free_phase → action_phase
  socket.on('host_end_free_phase', (_, cb) => {
    const g = hostGuard(cb); if (!g) return;
    const { info, session } = g;
    if (session.state !== 'free_phase') return cb?.({ error: '当前不是自由阶段' });
    session.state = 'action_phase';
    gl.initActionRooms(session);
    broadcast(info.code);
    cb?.({ success: true });
  });

  // action_phase → discussion_phase (or game_over)
  socket.on('host_end_action_phase', (_, cb) => {
    const g = hostGuard(cb); if (!g) return;
    const { info, session } = g;
    if (session.state !== 'action_phase') return cb?.({ error: '当前不是行动阶段' });

    const { eliminated, winResult } = gl.endActionPhase(session);

    // Save partial round record
    session.currentRoundRecord = {
      round: session.currentRound,
      actionRooms: session.actionRooms.map(r => ({
        id: r.id,
        playerNumbers: r.playerIds
          .map(pid => session.players.get(pid)?.number)
          .filter(Boolean),
        redCount: r.redCount,
        blueCount: r.blueCount,
      })),
      noRoomEliminated: eliminated,
    };

    if (winResult) {
      session.currentRoundRecord.votes = [];
      session.currentRoundRecord.voteEliminated = [];
      session.currentRoundRecord.winResult = winResult;
      session.roundHistory.push(session.currentRoundRecord);
      session.currentRoundRecord = null;
      session.winResult = winResult;
      session.state = 'game_over';
    } else {
      session.state = 'discussion_phase';
    }

    broadcast(info.code);
    cb?.({ success: true, eliminated, winResult });
  });

  // discussion_phase → resolution_phase
  socket.on('host_end_discussion', (_, cb) => {
    const g = hostGuard(cb); if (!g) return;
    const { info, session } = g;
    if (session.state !== 'discussion_phase') return cb?.({ error: '当前不是讨论阶段' });
    session.state = 'resolution_phase';
    broadcast(info.code);
    cb?.({ success: true });
  });

  // resolution_phase → execute elimination → action_phase | game_over
  socket.on('host_resolve_round', (_, cb) => {
    const g = hostGuard(cb); if (!g) return;
    const { info, session } = g;
    if (session.state !== 'resolution_phase') return cb?.({ error: '当前不是结算阶段' });

    // Save vote snapshot before resolveRound clears them
    const savedVotes = session.votes.map(v => ({
      voterNumber: v.voterNumber,
      targetNumber: v.targetNumber,
      weight: v.weight,
    }));

    const { eliminated, winResult } = gl.resolveRound(session);

    // Complete round record
    const record = session.currentRoundRecord || { round: session.currentRound };
    record.votes = savedVotes;
    record.voteEliminated = eliminated;
    record.outsiderWeightEnd = gl.getOutsiderWeight(session);
    record.survivorsEnd = gl.getAlivePlayers(session).length;
    record.winResult = winResult;
    session.roundHistory.push(record);
    session.currentRoundRecord = null;

    if (winResult) {
      session.winResult = winResult;
      session.state = 'game_over';
    } else {
      session.currentRound++;
      session.state = 'action_phase';
      gl.initActionRooms(session);
    }

    broadcast(info.code);
    cb?.({ success: true, eliminated, winResult });
  });

  // ── Player actions ─────────────────────────────────────────────────────────

  function playerGuard(cb) {
    const info = gm.getSocketInfo(socket.id);
    if (!info || info.isHost) { cb?.({ error: '无效操作' }); return null; }
    const session = gm.getSession(info.code);
    if (!session) { cb?.({ error: '房间不存在' }); return null; }
    return { info, session };
  }

  socket.on('player_choose_room', ({ roomId }, cb) => {
    const g = playerGuard(cb); if (!g) return;
    const { info, session } = g;
    const r = gl.playerChooseRoom(session, socket.id, roomId);
    if (r.error) return cb?.({ error: r.error });
    broadcast(info.code);
    cb?.({ success: true });
  });

  socket.on('player_vote', ({ targetNumber }, cb) => {
    const g = playerGuard(cb); if (!g) return;
    const { info, session } = g;
    const r = gl.castVote(session, socket.id, targetNumber);
    if (r.error) return cb?.({ error: r.error });
    broadcast(info.code);
    cb?.({ success: true });
  });

  socket.on('player_retract_vote', (_, cb) => {
    const g = playerGuard(cb); if (!g) return;
    const { info, session } = g;
    if (session.state !== 'discussion_phase') return cb?.({ error: '当前不是投票阶段' });
    session.votes = session.votes.filter(v => v.voterId !== socket.id);
    broadcast(info.code);
    cb?.({ success: true });
  });

  // ── Disconnect ─────────────────────────────────────────────────────────────

  socket.on('disconnect', () => {
    const result = gm.disconnectSocket(socket.id);
    if (result) broadcast(result.code);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`异乡人游戏服务器运行于端口 ${PORT}`));
