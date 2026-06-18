import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import socket from '../socket.js';

const ROLE_LABELS = { red: '🔴 红眼', blue: '🔵 蓝眼', outsider: '👁 异乡人', null: '未分配' };

function RoleTag({ role }) {
  const cls = role === 'red' ? 'role-red' : role === 'blue' ? 'role-blue' : role === 'outsider' ? 'role-outsider' : 'role-unknown';
  return <span className={`role-tag ${cls}`}>{ROLE_LABELS[role] ?? '未分配'}</span>;
}

function VoteTally({ votes, players }) {
  if (!votes?.length) return <div className="text-dim" style={{ fontSize: 13 }}>暂无投票</div>;
  const totals = {};
  votes.forEach(v => { totals[v.targetNumber] = (totals[v.targetNumber] || 0) + v.weight; });
  const maxVote = Math.max(...Object.values(totals), 1);
  const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  return (
    <div>
      {sorted.map(([num, total]) => (
        <div key={num} className="vote-row" style={{ cursor: 'default' }}>
          <div style={{ minWidth: 32, fontSize: 13 }}>#{num}</div>
          <div className="vote-bar-wrap">
            <div className="vote-bar" style={{ width: `${(total / maxVote) * 100}%` }} />
          </div>
          <div className="vote-count">{total}票</div>
        </div>
      ))}
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
        已投票 {votes.length} 人 / 存活 {players?.filter(p => p.isAlive).length ?? 0} 人
      </div>
    </div>
  );
}

function RoundHistory({ history }) {
  const [open, setOpen] = useState(null);
  if (!history?.length) return null;
  return (
    <div className="card">
      <div className="card-title">📜 历史记录</div>
      {[...history].reverse().map((r) => (
        <div key={r.round} className="history-round">
          <div className="history-header" onClick={() => setOpen(open === r.round ? null : r.round)}>
            <span>第 {r.round} 轮</span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              淘汰 {(r.noRoomEliminated?.length || 0) + (r.voteEliminated?.length || 0)} 人
              {open === r.round ? ' ▲' : ' ▼'}
            </span>
          </div>
          {open === r.round && (
            <div className="history-body">
              {r.noRoomEliminated?.length > 0 && (
                <div>未选房间淘汰：{r.noRoomEliminated.map(e => `#${e.number}(${ROLE_LABELS[e.role]})`).join('、')}</div>
              )}
              {r.actionRooms?.map(room => (
                <div key={room.id}>
                  房间{room.id}：成员[{room.playerNumbers.map(n => `#${n}`).join(',')}]
                  {room.redCount !== null && ` 🔴${room.redCount} 🔵${room.blueCount}`}
                </div>
              ))}
              {r.votes?.length > 0 && (
                <div>投票：{r.votes.map(v => `#${v.voterNumber}→#${v.targetNumber}(权重${v.weight})`).join(' ')}</div>
              )}
              {r.voteEliminated?.length > 0 && (
                <div>结算淘汰：{r.voteEliminated.map(e => `#${e.number}(${ROLE_LABELS[e.role]})`).join('、')}</div>
              )}
              {r.winResult && <div style={{ color: 'var(--gold)', marginTop: 4 }}>→ 游戏结束</div>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export default function HostDashboard() {
  const { code } = useParams();
  const nav = useNavigate();
  const [gs, setGs] = useState(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    const token = sessionStorage.getItem(`host_${code}`);
    if (!token) { nav('/'); return; }

    socket.emit('host_join', { code, hostToken: token }, (res) => {
      if (res?.error) { setErr(res.error); nav('/'); }
    });

    socket.on('state', setGs);
    return () => socket.off('state', setGs);
  }, [code]);

  function emit(event, payload, successMsg) {
    setErr('');
    socket.emit(event, payload ?? {}, (res) => {
      if (res?.error) setErr(res.error);
      else if (successMsg) { setMsg(successMsg); setTimeout(() => setMsg(''), 2000); }
    });
  }

  if (!gs) return <div className="waiting"><div className="icon">🌾</div>连接中…</div>;

  const { state, players = [], votes = [], actionRooms = [], roundHistory = [], winResult,
    currentRound, numActionRooms, totalEliminated, outsiderWeight } = gs;

  const alive = players.filter(p => p.isAlive);
  const allAssigned = players.length > 0 && players.every(p => p.role);
  const outsiderCount = players.filter(p => p.role === 'outsider').length;

  // Compute vote preview for resolution
  function computeElimPreview() {
    if (!votes.length) return [];
    const totals = {};
    votes.forEach(v => { totals[v.targetNumber] = (totals[v.targetNumber] || 0) + v.weight; });
    const vals = [...new Set(Object.values(totals))].sort((a, b) => b - a);
    const top2 = vals.slice(0, 2);
    return Object.entries(totals)
      .filter(([, v]) => top2.includes(v))
      .map(([n, v]) => ({ number: Number(n), votes: v }))
      .sort((a, b) => b.votes - a.votes);
  }

  const elimPreview = state === 'resolution_phase' ? computeElimPreview() : [];

  return (
    <div className="page">
      {/* Header */}
      <header className="site-header">
        <div className="site-title">主持人台</div>
        <div className="code-display">{code}</div>
        <div className="stat-row" style={{ justifyContent: 'center' }}>
          <div className="stat-chip">第 <strong>{currentRound}</strong> 轮</div>
          <div className="stat-chip">存活 <strong>{alive.length}</strong> 人</div>
          <div className="stat-chip">已淘汰 <strong>{totalEliminated}</strong></div>
          <div className="stat-chip">异乡人权重 <strong>{outsiderWeight}</strong></div>
        </div>
      </header>

      {err && <div style={{ color: 'var(--red-light)', fontSize: 13, marginBottom: 10, textAlign: 'center' }}>{err}</div>}
      {msg && <div style={{ color: 'var(--gold)', fontSize: 13, marginBottom: 10, textAlign: 'center' }}>{msg}</div>}

      {/* Phase controls */}
      <div className="card">
        <div className="card-title">
          <span className="phase-badge">{stateLabel(state)}</span>
          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>阶段控制</span>
        </div>

        <div className="host-controls">
          {state === 'lobby' && <>
            <button className="btn btn-primary" onClick={() => emit('host_start_game', {}, '游戏开始')}
              disabled={!allAssigned || outsiderCount !== 1}>
              开始游戏
            </button>
            {!allAssigned && <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>请先为所有玩家分配身份</div>}
            {outsiderCount > 1 && <div style={{ fontSize: 12, color: 'var(--red-light)', textAlign: 'center' }}>只能有1名异乡人</div>}
          </>}

          {state === 'free_phase' && (
            <button className="btn btn-action" onClick={() => emit('host_end_free_phase', {}, '进入行动阶段')}>
              结束自由阶段 → 行动阶段
            </button>
          )}

          {state === 'action_phase' && (
            <button className="btn btn-action" onClick={() => emit('host_end_action_phase', {}, '行动阶段结束')}>
              结束行动阶段 → 公布房间信息
            </button>
          )}

          {state === 'discussion_phase' && (
            <button className="btn btn-action" onClick={() => emit('host_end_discussion', {}, '进入结算阶段')}>
              结束投票 → 结算阶段
            </button>
          )}

          {state === 'resolution_phase' && (
            <button className="btn btn-danger" onClick={() => emit('host_resolve_round', {}, '结算完成')}>
              执行结算（淘汰玩家）
            </button>
          )}

          {state === 'game_over' && (
            <button className="btn btn-ghost" onClick={() => nav('/')}>返回首页</button>
          )}
        </div>
      </div>

      {/* Resolution preview */}
      {state === 'resolution_phase' && (
        <div className="card">
          <div className="card-title">⚖ 结算预览</div>
          {elimPreview.length === 0
            ? <div className="text-dim" style={{ fontSize: 13 }}>暂无有效票数，无人被淘汰</div>
            : <>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>以下玩家将被淘汰（前两票档）：</div>
                {elimPreview.map(e => {
                  const p = players.find(x => x.number === e.number);
                  return (
                    <div key={e.number} className="player-row" style={{ borderColor: 'var(--red)', marginBottom: 6 }}>
                      <div className="player-num">{e.number}</div>
                      <div className="player-label">{p ? <RoleTag role={p.role} /> : null}</div>
                      <div style={{ fontSize: 13, color: 'var(--red-light)' }}>{e.votes}票</div>
                    </div>
                  );
                })}
              </>}
        </div>
      )}

      {/* Win screen */}
      {state === 'game_over' && winResult && (
        <div className="card">
          <WinDisplay result={winResult} />
        </div>
      )}

      {/* Vote monitor */}
      {(state === 'discussion_phase' || state === 'resolution_phase') && (
        <div className="card">
          <div className="card-title">🗳 实时投票</div>
          <VoteTally votes={votes} players={players} />
        </div>
      )}

      {/* Action rooms monitor */}
      {(state === 'action_phase' || state === 'discussion_phase' || state === 'resolution_phase') && (
        <div className="card">
          <div className="card-title">🏠 行动房间</div>
          <div className="room-info-grid">
            {actionRooms.map(room => (
              <div key={room.id} className="room-info-row">
                <span>房间 {room.id}</span>
                <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                  {room.playerNumbers.length > 0
                    ? room.playerNumbers.map(n => `#${n}`).join(' ')
                    : '无人'}
                </span>
                {room.redCount !== null && (
                  <span className="eye-counts">
                    <span className="eye-red">🔴{room.redCount}</span>
                    <span className="eye-blue">🔵{room.blueCount}</span>
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Players */}
      <div className="card">
        <div className="card-title">
          👥 玩家列表
          {state === 'lobby' && players.length > 0 && (
            <button className="btn btn-sm btn-ghost btn-inline" style={{ marginLeft: 'auto' }}
              onClick={() => emit('host_auto_assign', {}, '自动分配完成')}>
              自动分配
            </button>
          )}
        </div>

        {players.length === 0
          ? <div className="text-dim" style={{ fontSize: 13 }}>等待玩家加入…</div>
          : players.sort((a, b) => a.number - b.number).map(p => (
              <div key={p.number} className="player-row">
                <div className={`player-num${p.isAlive ? '' : ' dead'}`}>{p.number}</div>
                <div className="player-label">
                  <div className="flex gap-8">
                    <RoleTag role={p.role} />
                    {!p.isAlive && <span className="badge">已淘汰</span>}
                  </div>
                </div>
                <div className={`dot${p.isConnected ? '' : ' off'}`} title={p.isConnected ? '在线' : '离线'} />
                {state === 'lobby' && (
                  <select
                    style={{ width: 'auto', fontSize: 12, padding: '4px 8px', marginLeft: 6 }}
                    value={p.role ?? ''}
                    onChange={e => emit('host_set_role', { playerNumber: p.number, role: e.target.value || null })}
                  >
                    <option value="">未分配</option>
                    <option value="red">红眼</option>
                    <option value="blue">蓝眼</option>
                    <option value="outsider">异乡人</option>
                  </select>
                )}
              </div>
            ))}
      </div>

      <RoundHistory history={roundHistory} />
    </div>
  );
}

function stateLabel(s) {
  return { lobby: '等待中', free_phase: '自由阶段', action_phase: '行动阶段',
    discussion_phase: '讨论投票', resolution_phase: '结算阶段', game_over: '游戏结束' }[s] ?? s;
}

function WinDisplay({ result }) {
  if (!result) return null;
  const map = {
    red_wins:       { icon: '🔴', title: '红眼阵营胜利', cls: 'win-red' },
    blue_wins:      { icon: '🔵', title: '蓝眼阵营胜利', cls: 'win-blue' },
    outsider_wins:  { icon: '👁', title: '异乡人单独获胜', cls: 'win-outsider' },
    no_winner:      { icon: '💀', title: '全员出局，无人获胜', cls: 'win-none' },
  };
  const { icon, title, cls } = map[result.type] ?? { icon: '?', title: '游戏结束', cls: '' };
  return (
    <div className="win-screen">
      <div className="win-icon">{icon}</div>
      <div className={`win-title ${cls}`}>{title}</div>
      {result.type === 'outsider_wins' && (
        <div style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 8 }}>
          权重 {result.weight} &gt; 存活 {result.count} 人
        </div>
      )}
      {(result.type === 'red_wins' || result.type === 'blue_wins') && (
        <div style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 8 }}>
          红眼 {result.reds} 人 · 蓝眼 {result.blues} 人
        </div>
      )}
    </div>
  );
}
