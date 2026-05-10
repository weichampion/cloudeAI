import { useEffect, useState } from 'react';
import { sessionsApi } from '../services/api.js';
import { groupsApi } from '../services/groupApi.js';
import BotManagerModal from './BotManagerModal.jsx';
import FriendsModal from './FriendsModal.jsx';
import SkillManagerModal from './SkillManagerModal.jsx';

// 未读管理：localStorage 存储每个 group 的最后已读时间戳
const getSeenAt = (groupId) => parseInt(localStorage.getItem(`seen_${groupId}`) || '0');
const markSeen = (groupId) => localStorage.setItem(`seen_${groupId}`, String(Date.now()));
const hasUnread = (group, currentGroupId) =>
  group.id !== currentGroupId && (group.last_message_at || 0) > getSeenAt(group.id);

export default function Sidebar({
  currentId, currentGroupId, onSelect, onNew,
  onOpenGroup, onNewGroup, onClose, visible, user, onLogout
}) {
  const [showBotManager, setShowBotManager] = useState(false);
  const [showFriends, setShowFriends] = useState(false);
  const [showSkills, setShowSkills] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [groups, setGroups] = useState([]);
  const [privateChats, setPrivateChats] = useState([]);
  const [tab, setTab] = useState('chat'); // chat | private | group
  const [, forceUpdate] = useState(0); // 触发重渲染以刷新未读角标

  const loadSessions = async () => {
    const res = await sessionsApi.list().catch(() => ({ data: [] }));
    setSessions(res.data || []);
  };

  const loadGroups = async () => {
    const res = await groupsApi.list().catch(() => ({ data: [] }));
    setGroups(res.data || []);
  };

  const loadPrivateChats = async () => {
    const res = await groupsApi.listPrivate().catch(() => ({ data: [] }));
    setPrivateChats(res.data || []);
  };

  useEffect(() => { loadSessions(); loadGroups(); loadPrivateChats(); }, [currentId, currentGroupId]);

  // 切换到某个群时自动标为已读，并刷新角标
  useEffect(() => {
    if (currentGroupId) { markSeen(currentGroupId); forceUpdate(n => n + 1); }
  }, [currentGroupId]);

  // 收到新消息事件（由 useGroupChat 广播）→ 刷新角标
  useEffect(() => {
    const handler = () => forceUpdate(n => n + 1);
    window.addEventListener('group-new-message', handler);
    return () => window.removeEventListener('group-new-message', handler);
  }, []);

  // 定时刷新群/私聊列表（感知被邀请入群）
  useEffect(() => {
    const refresh = () => { loadGroups(); loadPrivateChats(); };
    const handleVisibility = () => { if (!document.hidden) refresh(); };
    const handleRefreshGroups = () => refresh();
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('refresh-groups', handleRefreshGroups);
    const timer = setInterval(refresh, 15000);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('refresh-groups', handleRefreshGroups);
      clearInterval(timer);
    };
  }, []);

  const handleDeleteSession = async (e, id) => {
    e.stopPropagation();
    if (!confirm('确认删除该对话？')) return;
    await sessionsApi.delete(id).catch(() => {});
    setSessions(prev => prev.filter(s => s.id !== id));
    if (id === currentId) onNew();
  };

  const formatTime = (ts) => {
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString())
      return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
  };

  return (
    <>
      {visible && <div className="fixed inset-0 bg-black/50 z-20 md:hidden" onClick={onClose} />}
      <aside className={`fixed inset-y-0 left-0 z-30 w-72 bg-slate-900 flex flex-col
        transition-transform duration-300
        ${visible ? 'translate-x-0' : '-translate-x-full'}
        md:relative md:translate-x-0 md:z-auto`}
        style={{ paddingTop: 'var(--safe-top)' }}>

        {/* 头部：用户信息 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
              {(user?.nickname || user?.username)?.[0]?.toUpperCase() || 'U'}
            </div>
            <div className="min-w-0">
              <p className="text-white text-sm font-semibold truncate">{user?.nickname || user?.username}</p>
              <p className="text-slate-500 text-xs truncate">@{user?.username}</p>
            </div>
          </div>
          <button onClick={tab === 'chat' ? onNew : onNewGroup}
            className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-700">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"/>
            </svg>
          </button>
        </div>

        {/* Tab 切换 */}
        <div className="flex bg-slate-800 mx-3 my-2 rounded-lg p-1">
          {[['chat', '单聊'], ['private', '私聊'], ['group', '群聊']].map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)}
              className={`flex-1 text-xs py-1.5 rounded-md transition-colors
                ${tab === key ? 'bg-slate-600 text-white' : 'text-slate-400 hover:text-white'}`}>
              {label}
            </button>
          ))}
        </div>

        {/* 列表 */}
        <div className="flex-1 overflow-y-auto scrollbar-thin py-1">
          {tab === 'chat' ? (
            sessions.length === 0
              ? <p className="text-slate-500 text-sm text-center mt-8">暂无对话</p>
              : sessions.map(s => (
                <div key={s.id} onClick={() => { onSelect(s.id); onClose(); }}
                  className={`group flex items-center gap-2 mx-2 px-3 py-2.5 rounded-lg cursor-pointer transition-colors
                    ${s.id === currentId ? 'bg-slate-700 text-white' : 'text-slate-300 hover:bg-slate-800'}`}>
                  <svg className="w-4 h-4 flex-shrink-0 text-slate-400" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z"/>
                  </svg>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{s.title}</p>
                    <p className="text-xs text-slate-500">{formatTime(s.updated_at)}</p>
                  </div>
                  <button onClick={(e) => handleDeleteSession(e, s.id)}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-slate-600 text-slate-400 hover:text-red-400 transition-all">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
                    </svg>
                  </button>
                </div>
              ))
          ) : tab === 'private' ? (
            privateChats.length === 0
              ? (
                <div className="text-center mt-8">
                  <p className="text-slate-500 text-sm">暂无私聊</p>
                  <button onClick={() => setShowFriends(true)}
                    className="mt-3 text-blue-400 text-sm hover:text-blue-300">
                    + 从好友列表发起
                  </button>
                </div>
              )
              : privateChats.map(g => {
                const unread = hasUnread(g, currentGroupId);
                return (
                <div key={g.id} onClick={() => { markSeen(g.id); forceUpdate(n => n + 1); onOpenGroup(g); onClose(); }}
                  className={`flex items-center gap-2 mx-2 px-3 py-2.5 rounded-lg cursor-pointer transition-colors
                    ${g.id === currentGroupId ? 'bg-slate-700 text-white' : 'text-slate-300 hover:bg-slate-800'}`}>
                  <div className="relative w-8 h-8 flex-shrink-0">
                    <div className="w-8 h-8 rounded-full bg-blue-700 flex items-center justify-center text-sm font-bold text-white">
                      {(g.peer_nickname || g.peer_username || '?')[0].toUpperCase()}
                    </div>
                    {unread && <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-slate-900" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm truncate ${unread ? 'text-white font-medium' : ''}`}>{g.peer_nickname || g.peer_username}</p>
                    <p className="text-xs text-slate-500">@{g.peer_username}</p>
                  </div>
                </div>
                );
              })
          ) : (
            groups.length === 0
              ? (
                <div className="text-center mt-8">
                  <p className="text-slate-500 text-sm">暂无群聊</p>
                  <button onClick={onNewGroup}
                    className="mt-3 text-blue-400 text-sm hover:text-blue-300">
                    + 创建或加入群
                  </button>
                </div>
              )
              : groups.map(g => {
                const unread = hasUnread(g, currentGroupId);
                return (
                <div key={g.id} onClick={() => { markSeen(g.id); forceUpdate(n => n + 1); onOpenGroup(g); onClose(); }}
                  className={`flex items-center gap-2 mx-2 px-3 py-2.5 rounded-lg cursor-pointer transition-colors
                    ${g.id === currentGroupId ? 'bg-slate-700 text-white' : 'text-slate-300 hover:bg-slate-800'}`}>
                  <div className="relative w-8 h-8 flex-shrink-0">
                    <div className="w-8 h-8 rounded-full bg-purple-700 flex items-center justify-center text-sm text-white">
                      {g.name[0]}
                    </div>
                    {unread && <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-slate-900" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm truncate ${unread ? 'text-white font-medium' : ''}`}>{g.name}</p>
                    <p className="text-xs text-slate-500 font-mono">{g.invite_code}</p>
                  </div>
                </div>
                );
              })
          )}
        </div>

        {/* 底部按钮 */}
        <div className="border-t border-slate-700 p-3 space-y-1"
          style={{ paddingBottom: 'max(0.75rem, var(--safe-bottom))' }}>
          <button onClick={() => setShowFriends(true)}
            className="w-full flex items-center gap-2 px-3 py-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg text-sm transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z"/>
            </svg>
            好友
          </button>
          <button onClick={() => setShowBotManager(true)}
            className="w-full flex items-center gap-2 px-3 py-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg text-sm transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"/>
            </svg>
            机器人
          </button>
          <button onClick={() => setShowSkills(true)}
            className="w-full flex items-center gap-2 px-3 py-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg text-sm transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437l1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008z"/>
            </svg>
            技能库
          </button>
          <button onClick={() => { onClose(); window.dispatchEvent(new Event('open-settings')); }}
            className="w-full flex items-center gap-2 px-3 py-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg text-sm transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z"/>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
            </svg>
            设置
          </button>
          <button onClick={() => { if (confirm('确认退出登录？')) { onLogout?.(); onClose(); } }}
            className="w-full flex items-center gap-2 px-3 py-2 text-slate-500 hover:text-red-400 hover:bg-slate-800 rounded-lg text-sm transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75"/>
            </svg>
            退出登录
          </button>
        </div>
      </aside>

      <BotManagerModal visible={showBotManager} onClose={() => setShowBotManager(false)} />
      <SkillManagerModal visible={showSkills} onClose={() => setShowSkills(false)} />
      <FriendsModal visible={showFriends} onClose={() => setShowFriends(false)}
        onOpenChat={(g) => { onOpenGroup(g); setShowFriends(false); setTab('private'); onClose(); loadPrivateChats(); }} />
    </>
  );
}
