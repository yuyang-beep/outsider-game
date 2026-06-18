const { randomUUID } = require('crypto');

const sessions = new Map();
const socketMap = new Map(); // socketId → { code, isHost }

const PREFIXES = ['田野', '稻草', '家乡', '麦穗', '秋收'];

function generateCode() {
  const p = PREFIXES[Math.floor(Math.random() * PREFIXES.length)];
  const n = String(Math.floor(Math.random() * 900) + 100);
  return p + '-' + n;
}

function createSession(numActionRooms) {
  let code;
  do { code = generateCode(); } while (sessions.has(code));

  const session = {
    code,
    hostToken: randomUUID(),
    hostSocketId: null,
    state: 'lobby',
    players: new Map(),       // socketId → Player
    currentRound: 0,
    totalEliminated: 0,
    numActionRooms: numActionRooms || 2,
    actionRooms: [],
    votes: [],
    roundHistory: [],
    currentRoundRecord: null,
    winResult: null,
  };

  sessions.set(code, session);
  return { code, hostToken: session.hostToken };
}

function getSession(code) {
  return sessions.get(code) || null;
}

function hostJoin(code, hostToken, socketId) {
  const s = sessions.get(code);
  if (!s) return { error: '房间不存在' };
  if (s.hostToken !== hostToken) return { error: '令牌无效' };
  if (s.hostSocketId) socketMap.delete(s.hostSocketId);
  s.hostSocketId = socketId;
  socketMap.set(socketId, { code, isHost: true });
  return { success: true };
}

function addPlayer(code, socketId) {
  const s = sessions.get(code);
  if (!s) return { error: '房间不存在' };
  if (s.state !== 'lobby') return { error: '游戏已开始，无法加入' };

  let max = 0;
  for (const p of s.players.values()) if (p.number > max) max = p.number;

  const reconnectToken = randomUUID();
  const player = {
    id: socketId,
    number: max + 1,
    role: null,
    isAlive: true,
    eliminatedRound: null,
    reconnectToken,
    isConnected: true,
    currentActionRoomId: null,
  };

  s.players.set(socketId, player);
  socketMap.set(socketId, { code, isHost: false });
  return { player, reconnectToken };
}

function reconnectPlayer(code, reconnectToken, newSocketId) {
  const s = sessions.get(code);
  if (!s) return { error: '房间不存在' };

  for (const [oldId, player] of s.players.entries()) {
    if (player.reconnectToken === reconnectToken) {
      s.players.delete(oldId);
      socketMap.delete(oldId);
      player.id = newSocketId;
      player.isConnected = true;
      s.players.set(newSocketId, player);
      socketMap.set(newSocketId, { code, isHost: false });
      return { player };
    }
  }
  return { error: '重连令牌无效' };
}

function disconnectSocket(socketId) {
  const info = socketMap.get(socketId);
  if (!info) return null;
  socketMap.delete(socketId);

  const s = sessions.get(info.code);
  if (!s) return null;

  if (info.isHost) {
    s.hostSocketId = null;
  } else {
    const p = s.players.get(socketId);
    if (p) p.isConnected = false;
  }

  return { code: info.code, isHost: info.isHost };
}

function getSocketInfo(socketId) {
  return socketMap.get(socketId) || null;
}

module.exports = {
  createSession,
  getSession,
  hostJoin,
  addPlayer,
  reconnectPlayer,
  disconnectSocket,
  getSocketInfo,
};
