import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import socket from '../socket.js';

export default function Landing() {
  const nav = useNavigate();
  const [tab, setTab] = useState('join'); // 'join' | 'host'
  const [code, setCode] = useState('');
  const [rooms, setRooms] = useState(3);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  function handleJoin() {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return setErr('请输入房间码');
    setLoading(true);
    setErr('');

    const stored = sessionStorage.getItem(`reconnect_${trimmed}`);

    socket.emit('player_join', { code: trimmed, reconnectToken: stored || null }, (res) => {
      setLoading(false);
      if (res.error) return setErr(res.error);
      sessionStorage.setItem(`reconnect_${trimmed}`, res.reconnectToken);
      nav(`/game/${trimmed}`);
    });
  }

  function handleCreate() {
    setLoading(true);
    setErr('');
    socket.emit('create_room', { numActionRooms: rooms }, (res) => {
      setLoading(false);
      if (res.error) return setErr(res.error);
      sessionStorage.setItem(`host_${res.code}`, res.hostToken);
      nav(`/host/${res.code}`);
    });
  }

  return (
    <div className="page">
      <header className="site-header">
        <div className="site-title">异 乡 人</div>
        <div className="site-sub">身份隐藏 · 权重投票 · 阵营博弈</div>
        <div className="wheat mt-8">· · · · ·</div>
      </header>

      {/* Tab switcher */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button
          className={`btn ${tab === 'join' ? 'btn-action' : 'btn-ghost'}`}
          style={{ flex: 1 }}
          onClick={() => setTab('join')}
        >加入游戏</button>
        <button
          className={`btn ${tab === 'host' ? 'btn-action' : 'btn-ghost'}`}
          style={{ flex: 1 }}
          onClick={() => setTab('host')}
        >创建房间</button>
      </div>

      {tab === 'join' && (
        <div className="card fadein">
          <div className="card-title">▸ 加入已有房间</div>
          <div className="field">
            <label>房间码</label>
            <input
              type="text"
              placeholder="例：田野-042"
              value={code}
              onChange={e => { setCode(e.target.value.toUpperCase()); setErr(''); }}
              onKeyDown={e => e.key === 'Enter' && handleJoin()}
              autoCapitalize="characters"
            />
          </div>
          {err && <div style={{ color: '#E74C3C', fontSize: 13, marginBottom: 10 }}>{err}</div>}
          <button className="btn btn-primary" onClick={handleJoin} disabled={loading}>
            {loading ? '连接中…' : '进入房间'}
          </button>
        </div>
      )}

      {tab === 'host' && (
        <div className="card fadein">
          <div className="card-title">▸ 主持人创建房间</div>
          <div className="field">
            <label>行动房间数量（2–8）</label>
            <input
              type="number"
              min={2}
              max={8}
              value={rooms}
              onChange={e => setRooms(Number(e.target.value))}
            />
          </div>
          <div className="info-box" style={{ marginBottom: 12 }}>
            每轮行动阶段，玩家将从 <strong className="text-gold">{rooms}</strong> 个房间中选择一个进入。
            行动结束后公布各房间的眼睛统计。
          </div>
          {err && <div style={{ color: '#E74C3C', fontSize: 13, marginBottom: 10 }}>{err}</div>}
          <button className="btn btn-primary" onClick={handleCreate} disabled={loading}>
            {loading ? '创建中…' : '创建房间'}
          </button>
        </div>
      )}

      <div className="card" style={{ marginTop: 'auto' }}>
        <div className="card-title">游戏规则简介</div>
        <div style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.9 }}>
          <div>🔴 红眼 · 🔵 蓝眼 · 👁 异乡人（同时拥有双眼）</div>
          <div>每轮选择行动房间，获取眼睛情报，投票淘汰玩家</div>
          <div>异乡人投票权重随淘汰人数增长</div>
          <div>权重 &gt; 存活人数 → 异乡人单独获胜</div>
        </div>
      </div>
    </div>
  );
}
