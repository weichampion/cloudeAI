import { useState, useEffect } from 'react';
import { botsApi, groupsApi } from '../services/groupApi.js';
import { getBaseURL } from '../services/api.js';

function authFetch(path, options = {}) {
  const token = localStorage.getItem('auth_token');
  return fetch(`${getBaseURL()}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...options,
  }).then(r => r.json());
}

export default function GroupBotsPanel({ groupId, visible, onClose }) {
  const [panelTab, setPanelTab] = useState('bots'); // 'bots' | 'members'
  const [allBots, setAllBots] = useState([]);
  const [groupBots, setGroupBots] = useState([]);
  const [members, setMembers] = useState([]);
  const [friends, setFriends] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    const [all, grp] = await Promise.all([
      botsApi.list().catch(() => ({ data: [] })),
      botsApi.listGroupBots(groupId).catch(() => ({ data: [] })),
    ]);
    setAllBots(all.data || []);
    setGroupBots(grp.data || []);
  };

  const loadMembers = async () => {
    const [grpRes, friendsRes] = await Promise.all([
      groupsApi.get(groupId).catch(() => ({ data: {} })),
      authFetch('/friends').catch(() => ({ data: [] })),
    ]);
    setMembers(grpRes.data?.members || []);
    setFriends(friendsRes.data || []);
  };

  useEffect(() => {
    if (visible && groupId) { load(); loadMembers(); }
  }, [visible, groupId]);

  if (!visible) return null;

  const groupBotIds = new Set(groupBots.map(b => b.id));
  const memberUserIds = new Set(members.map(m => m.user_id));
  const invitableFriends = friends.filter(f => !memberUserIds.has(f.id));

  const handleAdd = async (bot) => {
    setLoading(true);
    const res = await botsApi.addToGroup(groupId, bot.id, groupBots.length).catch(() => null);
    if (res?.data) setGroupBots(res.data);
    setLoading(false);
  };

  const handleRemove = async (botId) => {
    setLoading(true);
    await botsApi.removeFromGroup(groupId, botId).catch(() => {});
    setGroupBots(prev => prev.filter(b => b.id !== botId));
    setLoading(false);
  };

  const handleMove = async (idx, dir) => {
    const next = [...groupBots];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    setGroupBots(next);
    await Promise.all(next.map((b, i) =>
      botsApi.addToGroup(groupId, b.id, i).catch(() => {})
    ));
  };

  const handleInvite = async (friendId) => {
    setLoading(true);
    const res = await groupsApi.inviteMember(groupId, friendId).catch(() => null);
    if (res?.data) {
      setMembers(res.data);
      window.dispatchEvent(new Event('refresh-groups'));
    }
    setLoading(false);
  };

  const availableBots = allBots.filter(b => !groupBotIds.has(b.id));

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-slate-800 w-full max-w-sm rounded-t-2xl md:rounded-2xl p-5 max-h-[80vh] flex flex-col"
        style={{ paddingBottom: 'max(1.25rem, var(--safe-bottom))' }}>

        <div className="flex items-center justify-between mb-4 flex-shrink-0">
          <h2 className="text-white font-semibold">群设置</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>

        {/* Tab */}
        <div className="flex bg-slate-700 rounded-xl p-1 mb-4 flex-shrink-0">
          {[['bots', 'Bot 配置'], ['members', '成员管理']].map(([key, label]) => (
            <button key={key} onClick={() => setPanelTab(key)}
              className={`flex-1 py-1.5 text-xs rounded-lg transition-colors font-medium
                ${panelTab === key ? 'bg-slate-500 text-white' : 'text-slate-400 hover:text-white'}`}>
              {label}
            </button>
          ))}
        </div>

        <div className="overflow-y-auto flex-1 space-y-4">
          {panelTab === 'bots' ? (
            <>
              {/* 已加入的 Bot */}
              <div>
                <p className="text-slate-400 text-xs mb-2">已加入（/task 按此顺序依次回复）</p>
                {groupBots.length === 0 ? (
                  <p className="text-slate-500 text-xs text-center py-3">暂无 Bot，从下方添加</p>
                ) : (
                  <div className="space-y-1.5">
                    {groupBots.map((bot, idx) => (
                      <div key={bot.id} className="flex items-center gap-2 bg-slate-700 rounded-xl px-3 py-2">
                        <span className="text-slate-500 text-xs w-4 text-center">{idx + 1}</span>
                        <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                          style={{ backgroundColor: bot.color }}>
                          {bot.name[0]}
                        </div>
                        <p className="text-white text-sm flex-1">{bot.name}</p>
                        <div className="flex gap-0.5">
                          <button onClick={() => handleMove(idx, -1)} disabled={idx === 0 || loading}
                            className="p-1 rounded text-slate-400 hover:text-white disabled:opacity-30 transition-colors">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7"/>
                            </svg>
                          </button>
                          <button onClick={() => handleMove(idx, 1)} disabled={idx === groupBots.length - 1 || loading}
                            className="p-1 rounded text-slate-400 hover:text-white disabled:opacity-30 transition-colors">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7"/>
                            </svg>
                          </button>
                          <button onClick={() => handleRemove(bot.id)} disabled={loading}
                            className="p-1 rounded text-slate-400 hover:text-red-400 transition-colors">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
                            </svg>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 可添加的 Bot */}
              {availableBots.length > 0 && (
                <div>
                  <p className="text-slate-400 text-xs mb-2">可添加</p>
                  <div className="space-y-1.5">
                    {availableBots.map(bot => (
                      <div key={bot.id} className="flex items-center gap-2 bg-slate-750 border border-slate-700 rounded-xl px-3 py-2">
                        <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                          style={{ backgroundColor: bot.color }}>
                          {bot.name[0]}
                        </div>
                        <p className="text-slate-300 text-sm flex-1">{bot.name}</p>
                        <button onClick={() => handleAdd(bot)} disabled={loading}
                          className="text-blue-400 hover:text-blue-300 text-xs disabled:opacity-50 transition-colors">
                          + 添加
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {allBots.length === 0 && (
                <p className="text-slate-500 text-xs text-center py-4">
                  还没有 Bot，请先在侧边栏「机器人」中创建
                </p>
              )}
            </>
          ) : (
            <>
              {/* 当前成员 */}
              <div>
                <p className="text-slate-400 text-xs mb-2">当前成员 ({members.length})</p>
                {members.length === 0 ? (
                  <p className="text-slate-500 text-xs text-center py-3">暂无成员</p>
                ) : (
                  <div className="space-y-1.5">
                    {members.map(m => (
                      <div key={m.user_id} className="flex items-center gap-2 bg-slate-700 rounded-xl px-3 py-2">
                        <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                          {m.nickname?.[0]?.toUpperCase() || '?'}
                        </div>
                        <p className="text-white text-sm">{m.nickname}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 可邀请的好友 */}
              <div>
                <p className="text-slate-400 text-xs mb-2">邀请好友加入</p>
                {invitableFriends.length === 0 ? (
                  <p className="text-slate-500 text-xs text-center py-3">
                    {friends.length === 0 ? '暂无好友' : '好友都已在群中'}
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {invitableFriends.map(f => (
                      <div key={f.id} className="flex items-center gap-2 border border-slate-700 rounded-xl px-3 py-2">
                        <div className="w-7 h-7 rounded-full bg-purple-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                          {(f.nickname || f.username)?.[0]?.toUpperCase() || '?'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-slate-300 text-sm truncate">{f.nickname || f.username}</p>
                          <p className="text-slate-500 text-xs">@{f.username}</p>
                        </div>
                        <button onClick={() => handleInvite(f.id)} disabled={loading}
                          className="text-blue-400 hover:text-blue-300 text-xs disabled:opacity-50 transition-colors flex-shrink-0">
                          邀请
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
