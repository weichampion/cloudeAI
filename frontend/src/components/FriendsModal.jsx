import { useState, useEffect } from 'react';
import { getBaseURL } from '../services/api.js';

function authFetch(path, options = {}) {
  const token = localStorage.getItem('auth_token');
  return fetch(`${getBaseURL()}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...options,
  }).then(r => r.json());
}

const friendsApi = {
  list: () => authFetch('/friends'),
  requests: () => authFetch('/friends/requests'),
  search: (q) => authFetch(`/friends/search?q=${encodeURIComponent(q)}`),
  sendRequest: (friendId) => authFetch('/friends/request', { method: 'POST', body: JSON.stringify({ friendId }) }),
  accept: (userId) => authFetch('/friends/accept', { method: 'POST', body: JSON.stringify({ userId }) }),
  reject: (userId) => authFetch('/friends/reject', { method: 'POST', body: JSON.stringify({ userId }) }),
  openChat: (friendId) => authFetch(`/friends/${friendId}/chat`, { method: 'POST' }),
};

function Avatar({ name, color = '#2563eb', size = 9 }) {
  return (
    <div className={`w-${size} h-${size} rounded-full flex items-center justify-center text-white font-bold flex-shrink-0 text-sm`}
      style={{ backgroundColor: color }}>
      {name?.[0]?.toUpperCase() || '?'}
    </div>
  );
}

export default function FriendsModal({ visible, onClose, onOpenChat }) {
  const [tab, setTab] = useState('friends');
  const [friends, setFriends] = useState([]);
  const [requests, setRequests] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [loading, setLoading] = useState(false);

  const loadData = async () => {
    const [f, r] = await Promise.all([
      friendsApi.list().catch(() => ({ data: [] })),
      friendsApi.requests().catch(() => ({ data: [] })),
    ]);
    setFriends(f.data || []);
    setRequests(r.data || []);
  };

  useEffect(() => { if (visible) { loadData(); setTab('friends'); setSearchQuery(''); setSearchResults([]); } }, [visible]);

  if (!visible) return null;

  const handleSearch = async () => {
    if (searchQuery.trim().length < 2) return;
    setSearching(true);
    const res = await friendsApi.search(searchQuery.trim()).catch(() => ({ data: [] }));
    setSearchResults(res.data || []);
    setSearching(false);
  };

  const handleSendRequest = async (friendId) => {
    setLoading(true);
    await friendsApi.sendRequest(friendId).catch(() => {});
    setSearchResults(prev => prev.map(u => u.id === friendId ? { ...u, friendStatus: 'pending' } : u));
    setLoading(false);
  };

  const handleAccept = async (userId) => {
    await friendsApi.accept(userId);
    setRequests(prev => prev.filter(u => u.id !== userId));
    await loadData();
  };

  const handleReject = async (userId) => {
    await friendsApi.reject(userId);
    setRequests(prev => prev.filter(u => u.id !== userId));
  };

  const handleOpenChat = async (friendId) => {
    setLoading(true);
    const res = await friendsApi.openChat(friendId).catch(() => null);
    setLoading(false);
    if (res?.data) onOpenChat?.(res.data);
  };

  const TABS = [['friends', `好友 ${friends.length}`], ['requests', `申请 ${requests.length}`], ['search', '搜索']];

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-slate-800 w-full max-w-sm rounded-t-2xl md:rounded-2xl p-5 max-h-[80vh] flex flex-col"
        style={{ paddingBottom: 'max(1.25rem, var(--safe-bottom))' }}>

        <div className="flex items-center justify-between mb-4 flex-shrink-0">
          <h2 className="text-white font-semibold">好友</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex bg-slate-700 rounded-xl p-1 mb-4 flex-shrink-0">
          {TABS.map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)}
              className={`flex-1 py-1.5 text-xs rounded-lg transition-colors font-medium
                ${tab === key ? 'bg-slate-500 text-white' : 'text-slate-400 hover:text-white'}`}>
              {label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* 好友列表 */}
          {tab === 'friends' && (
            friends.length === 0
              ? <p className="text-slate-500 text-sm text-center mt-6">暂无好友，去搜索添加吧</p>
              : <div className="space-y-2">
                  {friends.map(u => (
                    <div key={u.id} className="flex items-center gap-3 bg-slate-700 rounded-xl px-3 py-2.5">
                      <Avatar name={u.nickname || u.username} />
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-sm font-medium">{u.nickname || u.username}</p>
                        <p className="text-slate-400 text-xs">@{u.username}</p>
                      </div>
                      <button onClick={() => handleOpenChat(u.id)} disabled={loading}
                        className="px-2.5 py-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs rounded-lg transition-colors flex-shrink-0">
                        私聊
                      </button>
                    </div>
                  ))}
                </div>
          )}

          {/* 好友申请 */}
          {tab === 'requests' && (
            requests.length === 0
              ? <p className="text-slate-500 text-sm text-center mt-6">暂无待处理申请</p>
              : <div className="space-y-2">
                  {requests.map(u => (
                    <div key={u.id} className="flex items-center gap-3 bg-slate-700 rounded-xl px-3 py-2.5">
                      <Avatar name={u.nickname || u.username} color="#7c3aed" />
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-sm font-medium">{u.nickname || u.username}</p>
                        <p className="text-slate-400 text-xs">@{u.username}</p>
                      </div>
                      <div className="flex gap-1.5">
                        <button onClick={() => handleAccept(u.id)}
                          className="px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded-lg transition-colors">
                          同意
                        </button>
                        <button onClick={() => handleReject(u.id)}
                          className="px-2.5 py-1 bg-slate-600 hover:bg-slate-500 text-slate-300 text-xs rounded-lg transition-colors">
                          拒绝
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
          )}

          {/* 搜索 */}
          {tab === 'search' && (
            <div>
              <div className="flex gap-2 mb-3">
                <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSearch()}
                  placeholder="输入用户名搜索..."
                  className="flex-1 bg-slate-700 text-white text-sm rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500 placeholder-slate-500" />
                <button onClick={handleSearch} disabled={searching || searchQuery.trim().length < 2}
                  className="px-3 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded-xl transition-colors">
                  搜索
                </button>
              </div>

              {searchResults.length === 0 && searchQuery && !searching && (
                <p className="text-slate-500 text-sm text-center mt-4">没有找到用户</p>
              )}

              <div className="space-y-2">
                {searchResults.map(u => (
                  <div key={u.id} className="flex items-center gap-3 bg-slate-700 rounded-xl px-3 py-2.5">
                    <Avatar name={u.nickname || u.username} color="#059669" />
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-medium">{u.nickname || u.username}</p>
                      <p className="text-slate-400 text-xs">@{u.username}</p>
                    </div>
                    {u.friendStatus === 'accepted' ? (
                      <span className="text-green-400 text-xs">已是好友</span>
                    ) : u.friendStatus === 'pending' ? (
                      <span className="text-slate-400 text-xs">已申请</span>
                    ) : u.friendStatus === 'incoming' ? (
                      <span className="text-blue-400 text-xs">对方已申请</span>
                    ) : (
                      <button onClick={() => handleSendRequest(u.id)} disabled={loading}
                        className="px-2.5 py-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs rounded-lg transition-colors">
                        + 添加
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
