import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import socket from '../socket.js';

const ROLE_LABELS = { red: '红眼睛', blue: '蓝眼睛', outsider: '异乡人' };
const ROLE_ICON   = { red: '🔴', blue: '🔵', outsider: '👁' };

function RoleTag({ role }) {
  if (!role) return <span className="role-tag role-unknown">身份未知</span>;
  const cls = role === 'red' ? 'role-red' : role === 'blue' ? 'role-blue' : 'role-outsider';
  return <span className={`role-tag ${cls}`}>{ROLE_ICON[role]} {ROLE_LABELS[role]}</span>;
}

function RoundHistory({ history, myNumber }) {
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
              {open === r.round ? '▲' : '▼'}
            </span>
          </div>
          {open === r.round && (
            <div className="history-body">
              {r.actionRooms?.map(room => (
                <div key={room.id}>
                  房间{room.id}：成员[{room.playerNumbers.map(n => `#${n}${n === myNumber ? '(你)' : ''}`).join(',')}]
                  {room.redCount !== null && ` 🔴${room.redCount} 🔵${room.blueCount}`}
                </div>
              ))}
              {r.noRoomEliminated?.length > 0 && (
                <div>未选房间淘汰：{r.noRoomEliminated.map(e => `#${e.number}`).join('、')}</div>
              )}
              {r.votes?.length > 0 && (
                <div>我的投票：
                  {r.votes.filter(v => v.voterNumber === myNumber).map(v => `→ #${v.targetNumber}`).join('') || '未投票'}
                </div>
              )}
              {r.voteEliminated?.length > 0 && (
                <div>淘汰：{r.voteEliminated.map(e => `#${e.number}`).join('、')}</div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export default function GamePage() {
  const { code } = useParams();
  const nav = useNavigate();
  const [gs, setGs] = useState(null);
  const [err, setErr] = useState('');
  const [myVote, setMyVote] = useState(null);

  useEffect(() => {
    const stored = sessionStorage.getItem(`reconnect_${code}`);
    socket.emit('player_join', { code, reconnectToken: stored || null }, (res) => {
      if (res?.error) { alert(res.error); nav('/'); return; }
      if (res?.reconnectToken) sessionStorage.setItem(`reconnect_${code}`, res.reconnectToken);
    });

    socket.on('state', (state) => {
      setGs(state);
      // Sync my current vote from state
      if (state.votes && state.myNumber) {
        const myV = state.votes.find(v => v.voterNumber === state.myNumber);
        setMyVote(myV ? myV.targetNumber : null);
      }
    });

    return () => socket.off('state');
  }, [code]);

  function emit(event, payload, cb) {
    setErr('');
    socket.emit(event, payload, (res) => {
      if (res?.error) setErr(res.error);
      cb?.(res);
    });
  }

  if (!gs) return <div className="waiting"><div className="icon">🌾</div>连接中…</div>;

  const {
    state, myNumber, myRole, myIsAlive, myEliminatedRound,
    myActionRoomId, myRoomDuringAction, myRoomReveal,
    allPlayers = [], actionRoomCounts = [], votes = [],
    roundHistory = [], winResult, currentRound, numActionRooms,
    totalEliminated, outsiderWeight,
  } = gs;

  const alive = allPlayers.filter(p => p.isAlive);

  // Compute vote totals for display
  const voteTotals = {};
  votes.forEach(v => { voteTotals[v.targetNumber] = (voteTotals[v.targetNumber] || 0) + v.weight; });
  const maxVote = Math.max(...Object.values(voteTotals), 1);

  if (!myIsAlive) {
    return (
      <div className="page">
        <header className="site-header">
          <div className="site-title">异乡人</div>
          <div className="code-display">{code}</div>
        </header>
        <div className="elim-notice fadein">
          <div className="big">💀</div>
          <div>你已在第 {myEliminatedRound} 轮被淘汰</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 8 }}>静待游戏结束</div>
        </div>
        {state === 'game_over' && winResult && (
          <div className="card fadein"><WinDisplay result={winResult} myRole={myRole} /></div>
        )}
        <RoundHistory history={roundHistory} myNumber={myNumber} />
      </div>
    );
  }

  return (
    <div className="page">
      <header className="site-header">
        <div className="site-title">异乡人</div>
        <div className="code-display">{code}</div>
        <div className="stat-row" style={{ justifyContent: 'center', flexWrap: 'wrap' }}>
          <div className="stat-chip">第 <strong>{currentRound}</strong> 轮</div>
          <div className="stat-chip">存活 <strong>{alive.length}</strong> 人</div>
          <div className="stat-chip">异乡人权重 <strong>{outsiderWeight}</strong></div>
        </div>
      </header>

      {/* My identity */}
      {myRole && (
        <div className={`identity-card fadein`}>
          <div className="identity-label">你的身份</div>
          <div className={`identity-role ${myRole}`}>{ROLE_ICON[myRole]} {ROLE_LABELS[myRole]}</div>
          {myRole === 'outsider' && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
              当前投票权重：<strong className="text-gold">{outsiderWeight}</strong>（已淘汰 {totalEliminated} 人+1）
            </div>
          )}
        </div>
      )}

      {err && <div style={{ color: 'var(--red-light)', fontSize: 13, marginBottom: 10, textAlign: 'center' }}>{err}</div>}

      {/* ── Phase views ── */}

      {state === 'lobby' && (
        <div className="card fadein">
          <div className="waiting" style={{ padding: '20px 0' }}>
            <div className="icon pulsing">🌾</div>
            <div>等待主持人开始游戏</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
              在场 {allPlayers.length} 人
            </div>
          </div>
        </div>
      )}

      {state === 'free_phase' && (
        <div className="card fadein">
          <div className="card-title"><span className="phase-badge">自由阶段</span></div>
          <div className="info-box">
            第一轮开始，自由交流时间。利用这段时间观察其他玩家，但要注意——异乡人就在你们中间。
          </div>
          <PlayerList allPlayers={allPlayers} myNumber={myNumber} />
        </div>
      )}

      {state === 'action_phase' && (
        <div className="fadein">
          <div className="card">
            <div className="card-title"><span className="phase-badge">行动阶段</span></div>
            <div className="info-box">选择一个房间进入。行动结束后，你将看到你所在房间的眼睛统计。</div>
            <div className="room-grid">
              {actionRoomCounts.map(r => (
                <button
                  key={r.id}
                  className={`room-btn${myActionRoomId === r.id ? ' chosen' : ''}`}
                  onClick={() => emit('player_choose_room', { roomId: r.id })}
                >
                  房间 {r.id}
                  <span>{r.count} 人</span>
                </button>
              ))}
            </div>
          </div>

          {myRoomDuringAction && (
            <div className="card">
              <div className="card-title">📍 已进入房间 {myRoomDuringAction.id}</div>
              <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>
                同室成员：{myRoomDuringAction.memberNumbers.map(n =>
                  <span key={n} style={{ marginRight: 6 }}>#{n}{n === myNumber ? '(你)' : ''}</span>
                )}
              </div>
            </div>
          )}

          <PlayerList allPlayers={allPlayers} myNumber={myNumber} />
        </div>
      )}

      {(state === 'discussion_phase' || state === 'resolution_phase') && (
        <div className="fadein">
          {/* Room reveal */}
          {myRoomReveal && (
            <div className="card">
              <div className="card-title">🏠 房间 {myRoomReveal.id} 情报揭示</div>
              <div className="info-box reveal">
                <div>同室成员：{myRoomReveal.memberNumbers.map(n =>
                  <span key={n} style={{ marginRight: 8 }}>#{n}{n === myNumber ? '（你）' : ''}</span>
                )}</div>
                <div style={{ marginTop: 6, fontSize: 15 }}>
                  <span className="eye-red" style={{ marginRight: 14 }}>🔴 红眼 {myRoomReveal.redCount}</span>
                  <span className="eye-blue">🔵 蓝眼 {myRoomReveal.blueCount}</span>
                </div>
              </div>
            </div>
          )}

          {/* Voting */}
          {state === 'discussion_phase' && (
            <div className="card">
              <div className="card-title">
                <span className="phase-badge">讨论与投票</span>
                {myVote && (
                  <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-dim)' }}>
                    已投 #{myVote}
                    <button
                      style={{ marginLeft: 6, fontSize: 11, color: 'var(--text-muted)',
                        background: 'none', border: 'none', cursor: 'pointer' }}
                      onClick={() => { emit('player_retract_vote', {}); setMyVote(null); }}
                    >撤回</button>
                  </span>
                )}
              </div>
              <div className="info-box">选择你想淘汰的玩家。所有人的投票公开可见。</div>
              <div className="vote-list">
                {alive.filter(p => p.number !== myNumber).map(p => {
                  const total = voteTotals[p.number] || 0;
                  const isMyVote = myVote === p.number;
                  return (
                    <div
                      key={p.number}
                      className={`vote-row${isMyVote ? ' active' : ''}`}
                      onClick={() => {
                        emit('player_vote', { targetNumber: p.number });
                        setMyVote(p.number);
                      }}
                    >
                      <div className="player-num" style={{ width: 28, height: 28 }}>{p.number}</div>
                      <div className="vote-bar-wrap">
                        <div className="vote-bar" style={{ width: `${(total / maxVote) * 100}%` }} />
                      </div>
                      <div className="vote-count">{total > 0 ? `${total}票` : '—'}</div>
                      {isMyVote && <div style={{ fontSize: 11, color: 'var(--gold)' }}>✓</div>}
                    </div>
                  );
                })}
              </div>
              {/* Who voted for whom */}
              {votes.length > 0 && (
                <details style={{ marginTop: 12 }}>
                  <summary style={{ fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer' }}>查看所有投票</summary>
                  <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 2, marginTop: 6 }}>
                    {votes.map((v, i) => (
                      <div key={i}>
                        #{v.voterNumber}{v.voterNumber === myNumber ? '（你）' : ''} → #{v.targetNumber}
                        {v.weight > 1 && <span className="text-gold">  ×{v.weight}</span>}
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}

          {state === 'resolution_phase' && (
            <div className="card">
              <div className="card-title"><span className="phase-badge">结算中</span></div>
              <div className="waiting" style={{ padding: '16px 0' }}>
                <div className="pulsing" style={{ fontSize: 32, marginBottom: 8 }}>⚖</div>
                <div>等待主持人执行结算…</div>
              </div>
            </div>
          )}

          <PlayerList allPlayers={allPlayers} myNumber={myNumber} />
        </div>
      )}

      {state === 'game_over' && (
        <div className="card fadein">
          <WinDisplay result={winResult} myRole={myRole} />
        </div>
      )}

      <RoundHistory history={roundHistory} myNumber={myNumber} />
    </div>
  );
}

function PlayerList({ allPlayers, myNumber }) {
  const alive = allPlayers.filter(p => p.isAlive);
  const dead  = allPlayers.filter(p => !p.isAlive);
  return (
    <div className="card" style={{ marginTop: 0 }}>
      <div className="card-title">👥 存活玩家 ({alive.length})</div>
      {alive.sort((a, b) => a.number - b.number).map(p => (
        <div key={p.number} className="player-row">
          <div className={`player-num${p.number === myNumber ? '' : ''}`}
            style={p.number === myNumber ? { borderColor: 'var(--gold)', color: 'var(--gold)' } : {}}>
            {p.number}
          </div>
          <div className="player-label">
            {p.number === myNumber && <span style={{ fontSize: 11, color: 'var(--gold)', marginRight: 6 }}>你</span>}
            <RoleTag role={p.role} />
          </div>
          <div className={`dot${p.isConnected ? '' : ' off'}`} />
        </div>
      ))}
      {dead.length > 0 && (
        <>
          <hr style={{ margin: '10px 0' }} />
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>已淘汰</div>
          {dead.sort((a, b) => a.number - b.number).map(p => (
            <div key={p.number} className="player-row" style={{ opacity: .5 }}>
              <div className="player-num dead">{p.number}</div>
              <div className="player-label">
                <RoleTag role={p.role} />
                <span className="badge" style={{ marginLeft: 6 }}>第{p.eliminatedRound}轮</span>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function WinDisplay({ result, myRole }) {
  if (!result) return null;
  const map = {
    red_wins:       { icon: '🔴', title: '红眼阵营胜利', cls: 'win-red' },
    blue_wins:      { icon: '🔵', title: '蓝眼阵营胜利', cls: 'win-blue' },
    outsider_wins:  { icon: '👁', title: '异乡人单独获胜', cls: 'win-outsider' },
    no_winner:      { icon: '💀', title: '全员出局，无人获胜', cls: 'win-none' },
  };
  const { icon, title, cls } = map[result.type] ?? { icon: '?', title: '游戏结束', cls: '' };

  const iWin = myRole && (
    (result.type === 'red_wins' && myRole === 'red') ||
    (result.type === 'blue_wins' && myRole === 'blue') ||
    (result.type === 'outsider_wins' && myRole === 'outsider')
  );

  return (
    <div className="win-screen">
      <div className="win-icon">{icon}</div>
      <div className={`win-title ${cls}`}>{title}</div>
      {myRole && (
        <div style={{ marginTop: 12, fontSize: 16, fontWeight: 700,
          color: iWin ? 'var(--gold)' : 'var(--text-muted)' }}>
          {iWin ? '🎉 你获胜了' : '你落败了'}
        </div>
      )}
      {result.type === 'outsider_wins' && (
        <div style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 6 }}>
          权重 {result.weight} &gt; 存活 {result.count} 人
        </div>
      )}
    </div>
  );
}
