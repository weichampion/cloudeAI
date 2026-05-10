import { useState, useEffect } from 'react';
import { botsApi, skillsApi } from '../services/groupApi.js';

const COLORS = [
  '#7c3aed', '#2563eb', '#059669', '#dc2626',
  '#d97706', '#db2777', '#0891b2', '#65a30d',
];

function BotSkillsSection({ botId }) {
  const [allSkills, setAllSkills] = useState([]);
  const [botSkills, setBotSkills] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    Promise.all([
      skillsApi.list().catch(() => ({ data: [] })),
      skillsApi.getBotSkills(botId).catch(() => ({ data: [] })),
    ]).then(([all, bound]) => {
      setAllSkills(all.data || []);
      setBotSkills(bound.data || []);
    });
  }, [botId]);

  const boundIds = new Set(botSkills.map(s => s.id));
  const available = allSkills.filter(s => !boundIds.has(s.id));

  const handleAdd = async (skillId) => {
    setLoading(true);
    const res = await skillsApi.addBotSkill(botId, skillId).catch(() => null);
    if (res?.data) setBotSkills(res.data);
    setLoading(false);
  };

  const handleRemove = async (skillId) => {
    setLoading(true);
    await skillsApi.removeBotSkill(botId, skillId).catch(() => {});
    setBotSkills(prev => prev.filter(s => s.id !== skillId));
    setLoading(false);
  };

  return (
    <div className="border-t border-slate-700 pt-3 mt-1">
      <p className="text-slate-400 text-xs mb-2">已绑定技能</p>
      {botSkills.length === 0 ? (
        <p className="text-slate-500 text-xs mb-2">暂未绑定技能</p>
      ) : (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {botSkills.map(s => (
            <span key={s.id} className="flex items-center gap-1 bg-slate-600 text-slate-200 text-xs px-2 py-1 rounded-lg">
              <span>{s.icon}</span>
              <span>{s.name}</span>
              <button onClick={() => handleRemove(s.id)} disabled={loading}
                className="text-slate-400 hover:text-red-400 transition-colors ml-0.5">×</button>
            </span>
          ))}
        </div>
      )}
      {available.length > 0 && (
        <div>
          <p className="text-slate-500 text-xs mb-1">可添加</p>
          <div className="flex flex-wrap gap-1.5">
            {available.map(s => (
              <button key={s.id} onClick={() => handleAdd(s.id)} disabled={loading}
                className="flex items-center gap-1 border border-slate-600 hover:border-blue-500 text-slate-400 hover:text-blue-400 text-xs px-2 py-1 rounded-lg transition-colors disabled:opacity-50">
                <span>{s.icon}</span>
                <span>+ {s.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function BotForm({ initial, onSave, onCancel }) {
  const [name, setName] = useState(initial?.name || '');
  const [color, setColor] = useState(initial?.color || COLORS[0]);
  const [systemPrompt, setSystemPrompt] = useState(initial?.system_prompt || '');
  const [model, setModel] = useState(initial?.model || '');
  const [apiKey, setApiKey] = useState(initial?.api_key || '');
  const [baseUrl, setBaseUrl] = useState(initial?.base_url || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    if (!name.trim()) { setError('请输入 Bot 名称'); return; }
    setLoading(true); setError('');
    const data = { name: name.trim(), color, systemPrompt, model, apiKey, baseUrl };
    const res = await (initial ? botsApi.update(initial.id, data) : botsApi.create(data)).catch(() => null);
    setLoading(false);
    if (res?.data) onSave(res.data);
    else setError(res?.error || '操作失败');
  };

  return (
    <div className="space-y-3">
      <div>
        <label className="text-slate-400 text-xs mb-1 block">Bot 名称（用于 @提及）</label>
        <input value={name} onChange={e => setName(e.target.value)}
          placeholder="例如：研究员"
          className="w-full bg-slate-700 text-white text-sm rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500 placeholder-slate-500" />
      </div>

      <div>
        <label className="text-slate-400 text-xs mb-1 block">头像颜色</label>
        <div className="flex gap-2 flex-wrap">
          {COLORS.map(c => (
            <button key={c} onClick={() => setColor(c)}
              className={`w-7 h-7 rounded-full border-2 transition-all ${color === c ? 'border-white scale-110' : 'border-transparent'}`}
              style={{ backgroundColor: c }} />
          ))}
        </div>
      </div>

      <div>
        <label className="text-slate-400 text-xs mb-1 block">人设 Prompt</label>
        <textarea value={systemPrompt} onChange={e => setSystemPrompt(e.target.value)}
          placeholder="例如：你是一位专业的数据分析师，擅长用数据说话..."
          rows={3}
          className="w-full bg-slate-700 text-white text-sm rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500 placeholder-slate-500 resize-none" />
      </div>

      <details className="text-xs">
        <summary className="text-slate-400 cursor-pointer hover:text-slate-300">自定义模型配置（可选，不填则用全局配置）</summary>
        <div className="mt-2 space-y-2">
          <input value={model} onChange={e => setModel(e.target.value)}
            placeholder="模型名称，如 glm-4-flash"
            className="w-full bg-slate-700 text-white text-sm rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500 placeholder-slate-500" />
          <input value={apiKey} onChange={e => setApiKey(e.target.value)}
            placeholder="API Key（留空用全局）"
            className="w-full bg-slate-700 text-white text-sm rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500 placeholder-slate-500" />
          <input value={baseUrl} onChange={e => setBaseUrl(e.target.value)}
            placeholder="Base URL（留空用全局）"
            className="w-full bg-slate-700 text-white text-sm rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500 placeholder-slate-500" />
        </div>
      </details>

      {error && <p className="text-red-400 text-xs">{error}</p>}

      <div className="flex gap-2 pt-1">
        <button onClick={onCancel}
          className="flex-1 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-xl text-sm transition-colors">
          取消
        </button>
        <button onClick={handleSave} disabled={loading}
          className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl text-sm font-medium transition-colors">
          {loading ? '保存中...' : '保存'}
        </button>
      </div>

      {initial?.id && <BotSkillsSection botId={initial.id} />}
    </div>
  );
}

export default function BotManagerModal({ visible, onClose }) {
  const [bots, setBots] = useState([]);
  const [mode, setMode] = useState('list'); // list | create | edit
  const [editing, setEditing] = useState(null);

  const load = async () => {
    const res = await botsApi.list().catch(() => ({ data: [] }));
    setBots(res.data || []);
  };

  useEffect(() => { if (visible) { load(); setMode('list'); } }, [visible]);

  if (!visible) return null;

  const handleDelete = async (bot) => {
    if (!confirm(`确认删除 Bot "${bot.name}"？`)) return;
    await botsApi.delete(bot.id).catch(() => {});
    setBots(prev => prev.filter(b => b.id !== bot.id));
  };

  const handleSaved = (bot) => {
    setBots(prev => {
      const idx = prev.findIndex(b => b.id === bot.id);
      if (idx >= 0) { const next = [...prev]; next[idx] = bot; return next; }
      return [...prev, bot];
    });
    setMode('list');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-slate-800 w-full max-w-sm rounded-t-2xl md:rounded-2xl p-5 max-h-[80vh] flex flex-col"
        style={{ paddingBottom: 'max(1.25rem, var(--safe-bottom))' }}>

        <div className="flex items-center justify-between mb-4 flex-shrink-0">
          <div className="flex items-center gap-2">
            {mode !== 'list' && (
              <button onClick={() => setMode('list')} className="text-slate-400 hover:text-white">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7"/>
                </svg>
              </button>
            )}
            <h2 className="text-white font-semibold">
              {mode === 'list' ? 'AI 机器人' : mode === 'create' ? '创建 Bot' : `编辑 ${editing?.name}`}
            </h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto flex-1">
          {mode === 'list' ? (
            <>
              {bots.length === 0 ? (
                <p className="text-slate-500 text-sm text-center mt-4">暂无 Bot，点击下方按钮创建</p>
              ) : (
                <div className="space-y-2 mb-3">
                  {bots.map(bot => (
                    <div key={bot.id} className="flex items-center gap-3 bg-slate-700 rounded-xl px-3 py-2.5">
                      <div className="w-9 h-9 rounded-full flex items-center justify-center text-white font-bold flex-shrink-0"
                        style={{ backgroundColor: bot.color }}>
                        {bot.name[0]}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-sm font-medium">{bot.name}</p>
                        <p className="text-slate-400 text-xs truncate">{bot.system_prompt || '无人设'}</p>
                      </div>
                      <div className="flex gap-1">
                        <button onClick={() => { setEditing(bot); setMode('edit'); }}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-600 transition-colors">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/>
                          </svg>
                        </button>
                        <button onClick={() => handleDelete(bot)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-slate-600 transition-colors">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
                          </svg>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <button onClick={() => setMode('create')}
                className="w-full py-2.5 border border-dashed border-slate-600 hover:border-blue-500 text-slate-400 hover:text-blue-400 rounded-xl text-sm transition-colors">
                + 创建新 Bot
              </button>
            </>
          ) : (
            <BotForm
              initial={mode === 'edit' ? editing : null}
              onSave={handleSaved}
              onCancel={() => setMode('list')}
            />
          )}
        </div>
      </div>
    </div>
  );
}
