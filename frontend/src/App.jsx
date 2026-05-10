import { useState, useEffect, useRef } from 'react';
import Sidebar from './components/Sidebar.jsx';
import ChatPage from './pages/ChatPage.jsx';
import GroupChatPage from './pages/GroupChatPage.jsx';
import SettingsModal from './components/SettingsModal.jsx';
import GroupModal from './components/GroupModal.jsx';
import AuthPage from './pages/AuthPage.jsx';
import { sessionsApi } from './services/api.js';
import { useAuth } from './hooks/useAuth.js';

export default function App() {
  const { user, loading: authLoading, login, register, logout } = useAuth();
  const [sessionId, setSessionId] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [sessionTick, setSessionTick] = useState(0);
  const [view, setView] = useState({ type: 'chat' });
  const settingsWasOpen = useRef(false);

  useEffect(() => {
    const handler = () => setSettingsOpen(true);
    window.addEventListener('open-settings', handler);
    return () => window.removeEventListener('open-settings', handler);
  }, []);

  const tryConnect = async () => {
    const res = await sessionsApi.list().catch(() => null);
    if (res?.data) {
      const list = res.data;
      if (list.length > 0) setSessionId(list[0].id);
      else {
        const created = await sessionsApi.create().catch(() => null);
        if (created?.data) { setSessionId(created.data.id); setSessionTick(t => t + 1); }
      }
      return true;
    }
    return false;
  };

  useEffect(() => {
    if (!user) return;
    tryConnect().then(ok => { if (!ok) setSettingsOpen(true); });
  }, [user]);

  useEffect(() => {
    if (settingsWasOpen.current && !settingsOpen && !sessionId) tryConnect();
    settingsWasOpen.current = settingsOpen;
  }, [settingsOpen]);

  const handleNew = async () => {
    const res = await sessionsApi.create().catch(() => null);
    if (res?.data) { setSessionId(res.data.id); setSessionTick(t => t + 1); setView({ type: 'chat' }); }
  };

  // 加载中
  if (authLoading) {
    return (
      <div className="flex h-full bg-slate-900 items-center justify-center">
        <div className="text-slate-400 text-sm">加载中...</div>
      </div>
    );
  }

  // 未登录 → 显示登录/注册页
  if (!user) {
    return <AuthPage onLogin={login} onRegister={register} />;
  }

  return (
    <div className="flex h-full bg-slate-900 text-white overflow-hidden">
      <Sidebar
        currentId={view.type === 'chat' ? sessionId : null}
        currentGroupId={view.type === 'group' ? view.group?.id : null}
        onSelect={(id) => { setSessionId(id); setView({ type: 'chat' }); }}
        onNew={handleNew}
        onOpenGroup={(g) => setView({ type: 'group', group: g })}
        onNewGroup={() => setGroupModalOpen(true)}
        onClose={() => setSidebarOpen(false)}
        visible={sidebarOpen}
        user={user}
        onLogout={logout}
        key={sessionTick}
      />

      {view.type === 'group' ? (
        <GroupChatPage
          group={view.group}
          onMenuClick={() => setSidebarOpen(true)}
          onBack={() => setView({ type: 'chat' })}
        />
      ) : (
        <ChatPage
          sessionId={sessionId}
          onSessionUpdate={() => setSessionTick(t => t + 1)}
          onMenuClick={() => setSidebarOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      )}

      <SettingsModal visible={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <GroupModal
        visible={groupModalOpen}
        onClose={() => setGroupModalOpen(false)}
        onGroupJoined={(g) => { setView({ type: 'group', group: g }); setSessionTick(t => t + 1); }}
      />
    </div>
  );
}
