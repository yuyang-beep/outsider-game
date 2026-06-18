function getAlivePlayers(session) {
  return Array.from(session.players.values()).filter(p => p.isAlive);
}

function getOutsider(session) {
  return Array.from(session.players.values()).find(p => p.role === 'outsider') || null;
}

function getOutsiderWeight(session) {
  return session.totalEliminated + 1;
}

// Auto-distribute roles: (N-1)/2 red, (N-1)/2 blue, 1 outsider. N must be odd.
function autoAssignRoles(session) {
  const all = Array.from(session.players.values());
  const n = all.length;
  if (n < 3) return { error: '至少需要3名玩家' };
  if (n % 2 === 0) return { error: `玩家数量必须为奇数（当前${n}人）` };

  const shuffled = [...all].sort(() => Math.random() - 0.5);
  const half = (n - 1) / 2;
  shuffled[0].role = 'outsider';
  for (let i = 1; i <= half; i++) shuffled[i].role = 'red';
  for (let i = half + 1; i < n; i++) shuffled[i].role = 'blue';
  return { success: true };
}

function setPlayerRole(session, playerNumber, role) {
  const player = Array.from(session.players.values()).find(p => p.number === playerNumber);
  if (!player) return { error: '玩家不存在' };
  player.role = role;
  return { success: true };
}

// Initialize action rooms for a new round
function initActionRooms(session) {
  session.actionRooms = Array.from({ length: session.numActionRooms }, (_, i) => ({
    id: i + 1,
    playerIds: [],
    redCount: null,
    blueCount: null,
  }));
  for (const p of session.players.values()) {
    if (p.isAlive) p.currentActionRoomId = null;
  }
}

function playerChooseRoom(session, playerId, roomId) {
  const player = session.players.get(playerId);
  if (!player || !player.isAlive) return { error: '玩家不存在或已淘汰' };
  if (session.state !== 'action_phase') return { error: '当前不是行动阶段' };

  const room = session.actionRooms.find(r => r.id === roomId);
  if (!room) return { error: '房间不存在' };

  // Remove from old room
  if (player.currentActionRoomId !== null) {
    const old = session.actionRooms.find(r => r.id === player.currentActionRoomId);
    if (old) old.playerIds = old.playerIds.filter(id => id !== playerId);
  }

  room.playerIds.push(playerId);
  player.currentActionRoomId = roomId;
  return { success: true };
}

// End action phase: eliminate no-room players, compute eye counts
function endActionPhase(session) {
  const eliminated = [];

  for (const player of getAlivePlayers(session)) {
    if (player.currentActionRoomId === null) {
      player.isAlive = false;
      player.eliminatedRound = session.currentRound;
      session.totalEliminated++;
      eliminated.push({ number: player.number, role: player.role, reason: 'no_room' });
    }
  }

  for (const room of session.actionRooms) {
    let red = 0, blue = 0;
    for (const pid of room.playerIds) {
      const p = session.players.get(pid);
      if (!p) continue;
      if (p.role === 'red') red++;
      else if (p.role === 'blue') blue++;
      else if (p.role === 'outsider') { red++; blue++; }
    }
    room.redCount = red;
    room.blueCount = blue;
  }

  const winResult = checkWinConditions(session, eliminated);
  return { eliminated, winResult };
}

function castVote(session, voterId, targetNumber) {
  const voter = session.players.get(voterId);
  if (!voter || !voter.isAlive) return { error: '无效投票者' };
  if (session.state !== 'discussion_phase') return { error: '当前不是投票阶段' };

  const target = Array.from(session.players.values())
    .find(p => p.number === targetNumber && p.isAlive);
  if (!target) return { error: '目标玩家不存在或已淘汰' };
  if (target.id === voterId) return { error: '不能投票给自己' };

  session.votes = session.votes.filter(v => v.voterId !== voterId);

  const weight = voter.role === 'outsider' ? getOutsiderWeight(session) : 1;
  session.votes.push({
    voterId,
    voterNumber: voter.number,
    targetId: target.id,
    targetNumber: target.number,
    weight,
  });
  return { success: true };
}

// Eliminate top 2 vote tiers. Returns { eliminated, winResult }.
// Does NOT push to roundHistory — caller handles that.
function resolveRound(session) {
  const totals = new Map();
  for (const v of session.votes) {
    totals.set(v.targetId, (totals.get(v.targetId) || 0) + v.weight);
  }

  const alive = getAlivePlayers(session);
  const ranked = alive
    .map(p => ({ player: p, votes: totals.get(p.id) || 0 }))
    .filter(x => x.votes > 0)
    .sort((a, b) => b.votes - a.votes);

  const tiers = [...new Set(ranked.map(x => x.votes))].slice(0, 2);
  const eliminated = [];

  for (const { player, votes } of ranked) {
    if (tiers.includes(votes)) {
      player.isAlive = false;
      player.eliminatedRound = session.currentRound;
      session.totalEliminated++;
      eliminated.push({ number: player.number, role: player.role, votes });
    }
  }

  const winResult = checkWinConditions(session, eliminated);
  session.votes = [];
  return { eliminated, winResult };
}

function checkWinConditions(session, justEliminated) {
  // Priority 1: outsider eliminated → compare red vs blue survivors
  if (justEliminated.some(e => e.role === 'outsider')) {
    const survivors = getAlivePlayers(session);
    const reds = survivors.filter(p => p.role === 'red').length;
    const blues = survivors.filter(p => p.role === 'blue').length;
    if (reds > blues) return { type: 'red_wins', reds, blues };
    if (blues > reds) return { type: 'blue_wins', reds, blues };
    return { type: 'no_winner', reds, blues };
  }

  // Priority 2: outsider weight > survivor count
  const outsider = getOutsider(session);
  if (outsider && outsider.isAlive) {
    const weight = getOutsiderWeight(session);
    const count = getAlivePlayers(session).length;
    if (weight > count) return { type: 'outsider_wins', weight, count };
  }

  return null;
}

module.exports = {
  autoAssignRoles,
  setPlayerRole,
  initActionRooms,
  playerChooseRoom,
  endActionPhase,
  castVote,
  resolveRound,
  getOutsiderWeight,
  getAlivePlayers,
};
