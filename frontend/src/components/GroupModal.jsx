import { useState } from 'react';
import { groupsApi } from '../services/groupApi.js';
import { getStoredUser } from '../hooks/useAuth.js';

export default function GroupModal({ visible, onClose, onGroupJoined }) {
  const [tab, setTab] = useState('create');
  const [groupName, setGroupName] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!visible) return null;

  const user = getStoredUser();

  const handleCreate = async () => {
    if (!groupName.trim()) { setError('请输入群名称'); return; }
    setLoading(true); setError('');
    const res = await groupsApi.create({ name: groupName.trim(), systemPrompt }).catch(() => null);
    setLoading(false);
    if (res?.data) { onGroupJoined(res.data); onClose(); }
    else setError(res?.error || '创建失败，请检查网络');
  };

  const handleJoin = async () => {
    if (!inviteCode.trim()) { setError('请输入邀请码'); return; }
    setLoading(true); setError('');
    const res = await groupsApi.join({ inviteCode: inviteCode.trim().toUpperCase() }).catch(() => null);
    setLoading(false);
    if (res?.data) { onGroupJoined(res.data); onClose(); }
    else setError(res?.error || '邀请码无效或网络错误');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-slate-800 w-full max-w-sm rounded-t-2xl md:rounded-2xl p-5"
        style={{ paddingBottom: 'max(1.25rem, var(--safe-bottom))' }}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-white font-semibold">群聊</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>

        {user && (
          <div className="flex items-center gap-2 bg-slate-700 rounded-xl px-3 py-2 mb-4">
            <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-bold">
              {(user.nickname || user.username)?.[0]?.toUpperCase()}
            </div>
            <div>
              <p className="text-white text-xs font-medium">{user.nickname || user.username}</p>
              <p className="text-slate-400 text-xs">@{user.username}</p>
            </div>
          </div>
        )}

        <div className="flex bg-slate-700 rounded-lg p-1 mb-4">
          {['create', 'join'].map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex-1 text-sm py-1.5 rounded-md transition-colors
                ${tab === t ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}>
              {t === 'create' ? '创建群' : '加入群'}
            </button>
          ))}
        </div>

        {tab === 'create' ? (
          <>
            <div className="mb-3">
              <label className="text-slate-400 text-xs mb-1.5 block">群名称</label>
              <input value={groupName} onChange={e => setGroupName(e.target.value)}
                placeholder="给群起个名字"
                className="w-full bg-slate-700 text-white text-sm rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-blue-500 placeholder-slate-500" />
            </div>
            <div className="mb-4">
              <label className="text-slate-400 text-xs mb-1.5 block">AI 人设（可选）</label>
              <textarea value={systemPrompt} onChange={e => setSystemPrompt(e.target.value)}
                placeholder="例如：你是一个幽默风趣的群聊助手..."
                rows={2}
                className="w-full bg-slate-700 text-white text-sm rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-blue-500 placeholder-slate-500 resize-none" />
            </div>
          </>
        ) : (
          <div className="mb-4">
            <label className="text-slate-400 text-xs mb-1.5 block">邀请码</label>
            <input value={inviteCode} onChange={e => setInviteCode(e.target.value)}
              placeholder="输入6位邀请码"
              className="w-full bg-slate-700 text-white text-sm rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-blue-500 placeholder-slate-500 uppercase tracking-widest" />
          </div>
        )}

        {error && <p className="text-red-400 text-xs mb-3">{error}</p>}

        <button onClick={tab === 'create' ? handleCreate : handleJoin} disabled={loading}
          className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl text-sm font-medium transition-colors">
          {loading ? '处理中...' : (tab === 'create' ? '创建群' : '加入群')}
        </button>
      </div>
    </div>
  );
}
