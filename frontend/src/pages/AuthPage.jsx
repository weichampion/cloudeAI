import { useState } from 'react';

function getServerURL() {
  try { return JSON.parse(localStorage.getItem('ai_config') || '{}').serverURL || ''; } catch { return ''; }
}
function saveServerURL(url) {
  const cfg = JSON.parse(localStorage.getItem('ai_config') || '{}');
  cfg.serverURL = url.trim();
  localStorage.setItem('ai_config', JSON.stringify(cfg));
}

export default function AuthPage({ onLogin, onRegister }) {
  const [tab, setTab] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showServer, setShowServer] = useState(false);
  const [serverURL, setServerURL] = useState(getServerURL);

  const handleSubmit = async () => {
    if (!username.trim() || !password.trim()) { setError('请填写用户名和密码'); return; }
    setLoading(true); setError('');
    const res = tab === 'login'
      ? await onLogin(username.trim(), password)
      : await onRegister(username.trim(), password, nickname.trim());
    setLoading(false);
    if (!res.ok) setError(res.error);
  };

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) handleSubmit();
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-3">
            <svg className="w-9 h-9 text-white" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"/>
            </svg>
          </div>
          <h1 className="text-white text-2xl font-bold">OpenClaw</h1>
          <p className="text-slate-400 text-sm mt-1">AI 智能助手平台</p>
        </div>

        {/* 服务器地址配置 */}
        <div className="mb-3">
          <button onClick={() => setShowServer(v => !v)}
            className="w-full flex items-center justify-between px-3 py-2 bg-slate-800 rounded-xl text-slate-400 hover:text-white text-xs transition-colors">
            <span className="flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 14.25h13.5m-13.5 0a3 3 0 01-3-3m3 3a3 3 0 100 6h13.5a3 3 0 100-6m-16.5-3a3 3 0 013-3h13.5a3 3 0 013 3m-19.5 0a4.5 4.5 0 01.9-2.7L5.737 5.1a3.375 3.375 0 012.7-1.35h7.126c1.062 0 2.062.5 2.7 1.35l2.587 3.45a4.5 4.5 0 01.9 2.7m0 0a3 3 0 01-3 3m0 3h.008v.008h-.008v-.008z"/>
              </svg>
              服务器地址
            </span>
            <span className="truncate max-w-[160px] text-right">{serverURL || '未配置'}</span>
          </button>
          {showServer && (
            <div className="mt-1.5 flex gap-2">
              <input value={serverURL} onChange={e => setServerURL(e.target.value)}
                placeholder="http://your-server:3000"
                className="flex-1 bg-slate-700 text-white text-xs rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500 placeholder-slate-500" />
              <button onClick={() => { saveServerURL(serverURL); setShowServer(false); }}
                className="px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded-xl transition-colors">
                保存
              </button>
            </div>
          )}
        </div>

        <div className="bg-slate-800 rounded-2xl p-6">
          {/* Tab */}
          <div className="flex bg-slate-700 rounded-xl p-1 mb-5">
            {[['login', '登录'], ['register', '注册']].map(([key, label]) => (
              <button key={key} onClick={() => { setTab(key); setError(''); }}
                className={`flex-1 py-2 text-sm rounded-lg transition-colors font-medium
                  ${tab === key ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}>
                {label}
              </button>
            ))}
          </div>

          <div className="space-y-3">
            <div>
              <label className="text-slate-400 text-xs mb-1.5 block">用户名</label>
              <input value={username} onChange={e => setUsername(e.target.value)} onKeyDown={handleKey}
                placeholder="字母、数字、下划线（3-20位）"
                autoCapitalize="none" autoCorrect="off"
                className="w-full bg-slate-700 text-white text-sm rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500 placeholder-slate-500" />
            </div>

            <div>
              <label className="text-slate-400 text-xs mb-1.5 block">密码</label>
              <input value={password} onChange={e => setPassword(e.target.value)} onKeyDown={handleKey}
                type="password" placeholder="至少6位"
                className="w-full bg-slate-700 text-white text-sm rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500 placeholder-slate-500" />
            </div>

            {tab === 'register' && (
              <div>
                <label className="text-slate-400 text-xs mb-1.5 block">昵称（可选，默认同用户名）</label>
                <input value={nickname} onChange={e => setNickname(e.target.value)} onKeyDown={handleKey}
                  placeholder="显示在聊天中的名字"
                  className="w-full bg-slate-700 text-white text-sm rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500 placeholder-slate-500" />
              </div>
            )}

            {error && <p className="text-red-400 text-xs">{error}</p>}

            <button onClick={handleSubmit} disabled={loading}
              className="w-full py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition-colors mt-1">
              {loading ? '处理中...' : (tab === 'login' ? '登录' : '注册')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
