import { useState, useEffect } from 'react';
import { skillsApi } from '../services/groupApi.js';

const TYPE_OPTIONS = [
  { value: 'builtin_datetime', label: '获取时间', icon: '🕐', desc: '内置', fixed: true },
  { value: 'builtin_calculator', label: '数学计算', icon: '🔢', desc: '内置', fixed: true },
  { value: 'builtin_random', label: '随机数', icon: '🎲', desc: '内置', fixed: true },
  { value: 'websearch', label: '联网搜索', icon: '🔍', desc: '自定义' },
  { value: 'http', label: 'HTTP 请求', icon: '🌐', desc: '自定义' },
  { value: 'mcp_http', label: 'MCP 工具', icon: '🔌', desc: 'StreamableHTTP' },
];

const TYPE_BADGES = {
  builtin_datetime: { label: '内置', color: 'bg-green-900/40 text-green-400' },
  builtin_calculator: { label: '内置', color: 'bg-green-900/40 text-green-400' },
  builtin_random: { label: '内置', color: 'bg-green-900/40 text-green-400' },
  websearch: { label: '搜索', color: 'bg-blue-900/40 text-blue-400' },
  http: { label: 'HTTP', color: 'bg-purple-900/40 text-purple-400' },
  file_read: { label: '文件', color: 'bg-yellow-900/40 text-yellow-400' },
  file_write: { label: '文件', color: 'bg-yellow-900/40 text-yellow-400' },
  file_list: { label: '文件', color: 'bg-yellow-900/40 text-yellow-400' },
  database_query:    { label: '数据库', color: 'bg-orange-900/40 text-orange-400' },
  database_write:    { label: '数据库', color: 'bg-orange-900/40 text-orange-400' },
  moderation_kick:   { label: '仲裁', color: 'bg-red-900/40 text-red-400' },
  moderation_warn:   { label: '仲裁', color: 'bg-red-900/40 text-red-400' },
  moderation_mute:   { label: '仲裁', color: 'bg-red-900/40 text-red-400' },
  moderation_unmute: { label: '仲裁', color: 'bg-red-900/40 text-red-400' },
  mcp_http: { label: 'MCP', color: 'bg-teal-900/40 text-teal-400' },
};

function toSnakeCase(str) {
  return str.trim().toLowerCase().replace(/[\s\-]/g, '_').replace(/[^a-z0-9_]/g, '');
}

function SkillForm({ initial, onSave, onCancel }) {
  const isBuiltin = initial?.type?.startsWith('builtin_');
  const [name, setName] = useState(initial?.name || '');
  const [key, setKey] = useState(initial?.key || '');
  const [description, setDescription] = useState(initial?.description || '');
  const [type, setType] = useState(initial?.type || 'http');
  const [icon, setIcon] = useState(initial?.icon || '🔧');
  const [config, setConfig] = useState(
    initial?.config ? (typeof initial.config === 'string' ? initial.config : JSON.stringify(JSON.parse(initial.config || '{}'), null, 2)) : '{}'
  );
  const [parameters, setParameters] = useState(
    initial?.parameters ? (typeof initial.parameters === 'string'
      ? JSON.stringify(JSON.parse(initial.parameters || '{}'), null, 2)
      : JSON.stringify(initial.parameters, null, 2)) : '{\n  "type": "object",\n  "properties": {}\n}'
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [testParams, setTestParams] = useState('{}');
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);
  const [keyEdited, setKeyEdited] = useState(!!initial);

  const handleNameChange = (val) => {
    setName(val);
    if (!keyEdited) {
      const generated = toSnakeCase(val);
      setKey(generated);
    }
  };

  const handleSave = async () => {
    if (!name.trim()) { setError('请输入技能名称'); return; }
    if (!description.trim()) { setError('请输入描述'); return; }
    setLoading(true); setError('');

    let parsedConfig, parsedParams;
    try { parsedConfig = JSON.parse(config); } catch { setError('Config JSON 格式错误'); setLoading(false); return; }
    try { parsedParams = JSON.parse(parameters); } catch { setError('Parameters JSON 格式错误'); setLoading(false); return; }

    const data = {
      name: name.trim(),
      key: key || toSnakeCase(name),
      description: description.trim(),
      type,
      icon,
      config: JSON.stringify(parsedConfig),
      parameters: JSON.stringify(parsedParams),
    };

    const res = await (initial
      ? skillsApi.update(initial.id, data)
      : skillsApi.create(data)
    ).catch(e => ({ error: e.message }));

    setLoading(false);
    if (res?.data) onSave(res.data);
    else setError(res?.error || '操作失败');
  };

  const handleTest = async () => {
    if (!initial?.id) return;
    setTesting(true); setTestResult(null);
    let params = {};
    try { params = JSON.parse(testParams); } catch { setTestResult({ error: 'JSON 格式错误' }); setTesting(false); return; }
    const res = await skillsApi.test(initial.id, params).catch(e => ({ error: e.message }));
    setTestResult(res?.data || { error: res?.error || '执行失败' });
    setTesting(false);
  };

  const configTemplates = {
    websearch: JSON.stringify({ provider: 'serper', api_key: '' }, null, 2),
    http: JSON.stringify({ url: 'https://api.example.com/endpoint', method: 'GET', headers: {}, body_template: '' }, null, 2),
    file_read: JSON.stringify({ base_path: '/data' }, null, 2),
    file_write: JSON.stringify({ base_path: '/data', mode: 'write' }, null, 2),
    file_list: JSON.stringify({ base_path: '/data' }, null, 2),
    database_query: JSON.stringify({ type: 'sqlite', path: '/data/mydb.db' }, null, 2),
    database_write: JSON.stringify({ type: 'sqlite', path: '/data/mydb.db' }, null, 2),
    mcp_http: JSON.stringify({ url: 'http://your-mcp-server/mcp', headers: { 'Authorization': 'Bearer YOUR_TOKEN' } }, null, 2),
  };

  const paramTemplates = {
    websearch: JSON.stringify({ type: 'object', properties: { query: { type: 'string', description: '搜索关键词' } }, required: ['query'] }, null, 2),
    http: JSON.stringify({ type: 'object', properties: { input: { type: 'string', description: '输入内容' } }, required: ['input'] }, null, 2),
    file_read: JSON.stringify({ type: 'object', properties: { path: { type: 'string', description: '相对于 base_path 的文件路径' }, max_lines: { type: 'number', description: '最大读取行数（默认100）' } }, required: ['path'] }, null, 2),
    file_write: JSON.stringify({ type: 'object', properties: { path: { type: 'string', description: '相对于 base_path 的文件路径' }, content: { type: 'string', description: '写入的内容' } }, required: ['path', 'content'] }, null, 2),
    file_list: JSON.stringify({ type: 'object', properties: { path: { type: 'string', description: '相对于 base_path 的目录路径，留空则列根目录' } } }, null, 2),
    database_query: JSON.stringify({ type: 'object', properties: { sql: { type: 'string', description: 'SQL SELECT 查询语句' } }, required: ['sql'] }, null, 2),
    database_write: JSON.stringify({ type: 'object', properties: { sql: { type: 'string', description: 'SQL INSERT / UPDATE / DELETE 语句' } }, required: ['sql'] }, null, 2),
    mcp_http: JSON.stringify({ type: 'object', properties: { input: { type: 'string', description: '工具输入参数' } } }, null, 2),
  };

  const handleTypeChange = (t) => {
    setType(t);
    if (configTemplates[t]) setConfig(configTemplates[t]);
    if (paramTemplates[t]) setParameters(paramTemplates[t]);
  };

  if (isBuiltin) {
    return (
      <div className="space-y-3">
        <div className="bg-slate-700 rounded-xl p-3 text-sm text-slate-300">
          <p className="text-white font-medium mb-1">{initial.icon} {initial.name}</p>
          <p className="text-slate-400 text-xs">{initial.description}</p>
        </div>
        <p className="text-slate-500 text-xs">内置技能不支持编辑</p>
        <button onClick={onCancel}
          className="w-full py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-xl text-sm transition-colors">
          返回
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-slate-400 text-xs mb-1 block">技能名称</label>
          <input value={name} onChange={e => handleNameChange(e.target.value)}
            placeholder="如：联网搜索"
            className="w-full bg-slate-700 text-white text-sm rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500 placeholder-slate-500" />
        </div>
        <div>
          <label className="text-slate-400 text-xs mb-1 block">图标（emoji）</label>
          <input value={icon} onChange={e => setIcon(e.target.value)}
            placeholder="🔧"
            className="w-full bg-slate-700 text-white text-sm rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500 placeholder-slate-500" />
        </div>
      </div>

      <div>
        <label className="text-slate-400 text-xs mb-1 block">Function Key（自动生成）</label>
        <input value={key}
          onChange={e => { setKey(e.target.value); setKeyEdited(true); }}
          placeholder="snake_case，如 web_search"
          className="w-full bg-slate-700 text-white text-sm rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500 placeholder-slate-500 font-mono" />
      </div>

      <div>
        <label className="text-slate-400 text-xs mb-1 block">描述（告知 AI 何时调用）</label>
        <textarea value={description} onChange={e => setDescription(e.target.value)}
          placeholder="例如：当用户需要搜索实时信息时使用此技能..."
          rows={2}
          className="w-full bg-slate-700 text-white text-sm rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500 placeholder-slate-500 resize-none" />
      </div>

      <div>
        <label className="text-slate-400 text-xs mb-2 block">类型</label>
        <div className="grid grid-cols-2 gap-1.5">
          {[
            { value: 'websearch', label: '🔍 联网搜索' },
            { value: 'http', label: '🌐 HTTP 请求' },
            { value: 'file_read', label: '📖 读取文件' },
            { value: 'file_write', label: '✏️ 写入文件' },
            { value: 'file_list', label: '📂 列出目录' },
            { value: 'database_query', label: '🔎 SQL 查询' },
            { value: 'database_write', label: '💾 SQL 写入' },
          ].map(t => (
            <button key={t.value} onClick={() => handleTypeChange(t.value)}
              className={`py-2 text-xs rounded-xl border transition-colors text-left px-2
                ${type === t.value ? 'bg-blue-600 border-blue-500 text-white' : 'border-slate-600 text-slate-400 hover:text-white'}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* 联网搜索 */}
      {type === 'websearch' && (
        <div className="space-y-2">
          <label className="text-slate-400 text-xs block">配置（JSON）</label>
          <textarea value={config} onChange={e => setConfig(e.target.value)}
            rows={4} spellCheck={false}
            placeholder='{"provider":"serper","api_key":"your-key"}'
            className="w-full bg-slate-700 text-white text-xs rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500 font-mono resize-none" />
          <p className="text-slate-500 text-xs">provider: serper 或 tavily，填入对应 API Key</p>
        </div>
      )}

      {/* HTTP 请求 */}
      {type === 'http' && (
        <div className="space-y-2">
          <label className="text-slate-400 text-xs block">配置（JSON）— 支持 {'{{param}}'} 变量替换</label>
          <textarea value={config} onChange={e => setConfig(e.target.value)}
            rows={6} spellCheck={false}
            className="w-full bg-slate-700 text-white text-xs rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500 font-mono resize-none" />
        </div>
      )}

      {/* 文件操作 */}
      {(type === 'file_read' || type === 'file_list' || type === 'file_write') && (
        <div className="space-y-2">
          <label className="text-slate-400 text-xs block">配置</label>
          <textarea value={config} onChange={e => setConfig(e.target.value)}
            rows={type === 'file_write' ? 4 : 3} spellCheck={false}
            className="w-full bg-slate-700 text-white text-xs rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500 font-mono resize-none" />
          <div className="text-slate-500 text-xs space-y-0.5">
            <p>• <code className="text-slate-400">base_path</code>：允许访问的根目录（服务器绝对路径）</p>
            {type === 'file_write' && <p>• <code className="text-slate-400">mode</code>：<code>write</code>（覆盖）或 <code>append</code>（追加）</p>}
            <p className="text-orange-400">⚠️ Agent 只能访问 base_path 内的文件，防止路径越权</p>
          </div>
        </div>
      )}

      {/* 数据库 */}
      {(type === 'database_query' || type === 'database_write') && (
        <div className="space-y-2">
          <label className="text-slate-400 text-xs block">配置（JSON）</label>
          <textarea value={config} onChange={e => setConfig(e.target.value)}
            rows={6} spellCheck={false}
            className="w-full bg-slate-700 text-white text-xs rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500 font-mono resize-none" />
          <div className="text-slate-500 text-xs space-y-0.5">
            <p>• <code className="text-slate-400">type</code>：<code>sqlite</code> / <code>mysql</code> / <code>pg</code></p>
            <p>• SQLite：<code>{"{ \"type\": \"sqlite\", \"path\": \"/data/db.sqlite\" }"}</code></p>
            <p>• MySQL/PG：<code>{"{ \"type\": \"mysql\", \"connection\": { \"host\": \"...\", \"database\": \"...\", \"user\": \"...\", \"password\": \"...\" } }"}</code></p>
            {type === 'database_query' && <p className="text-green-400">✅ 只允许 SELECT / SHOW / DESCRIBE</p>}
            {type === 'database_write' && <p className="text-orange-400">⚠️ 允许 INSERT/UPDATE/DELETE，禁止 DROP/TRUNCATE/ALTER</p>}
          </div>
        </div>
      )}

      <details className="text-xs">
        <summary className="text-slate-400 cursor-pointer hover:text-slate-300">参数 Schema（高级）</summary>
        <div className="mt-2">
          <textarea value={parameters} onChange={e => setParameters(e.target.value)}
            rows={5} spellCheck={false}
            className="w-full bg-slate-700 text-white text-xs rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500 font-mono resize-none" />
          <p className="text-slate-500 text-xs mt-1">JSON Schema 格式，定义 AI 调用时可传入的参数</p>
        </div>
      </details>

      {initial?.id && (
        <details className="text-xs border-t border-slate-700 pt-3">
          <summary className="text-slate-400 cursor-pointer hover:text-slate-300">🧪 测试执行</summary>
          <div className="mt-2 space-y-2">
            <textarea value={testParams} onChange={e => setTestParams(e.target.value)}
              rows={2} spellCheck={false} placeholder='{"query": "test"}'
              className="w-full bg-slate-700 text-white text-xs rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500 font-mono resize-none" />
            <button onClick={handleTest} disabled={testing}
              className="w-full py-1.5 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-xs rounded-lg transition-colors">
              {testing ? '执行中...' : '执行测试'}
            </button>
            {testResult && (
              <div className={`rounded-lg px-3 py-2 text-xs font-mono whitespace-pre-wrap break-words max-h-32 overflow-y-auto
                ${testResult.error ? 'bg-red-900/30 text-red-300' : 'bg-slate-700 text-green-300'}`}>
                {testResult.error ? `❌ ${testResult.error}` : `✅ ${testResult.result}`}
              </div>
            )}
          </div>
        </details>
      )}

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
    </div>
  );
}

export default function SkillManagerModal({ visible, onClose }) {
  const [skills, setSkills] = useState([]);
  const [mode, setMode] = useState('list'); // list | create | edit
  const [editing, setEditing] = useState(null);

  const load = async () => {
    const res = await skillsApi.list().catch(() => ({ data: [] }));
    setSkills(res.data || []);
  };

  useEffect(() => { if (visible) { load(); setMode('list'); } }, [visible]);

  if (!visible) return null;

  const handleDelete = async (skill) => {
    if (!confirm(`确认删除技能 "${skill.name}"？`)) return;
    const res = await skillsApi.delete(skill.id).catch(() => null);
    if (res?.data) setSkills(prev => prev.filter(s => s.id !== skill.id));
    else alert(res?.error || '删除失败');
  };

  const handleSaved = (skill) => {
    setSkills(prev => {
      const idx = prev.findIndex(s => s.id === skill.id);
      if (idx >= 0) { const next = [...prev]; next[idx] = skill; return next; }
      return [...prev, skill];
    });
    setMode('list');
  };

  const isBuiltin = (s) => s.type?.startsWith('builtin_');

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-slate-800 w-full max-w-sm rounded-t-2xl md:rounded-2xl p-5 max-h-[85vh] flex flex-col"
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
              {mode === 'list' ? '技能库' : mode === 'create' ? '创建技能' : `编辑：${editing?.name}`}
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
              {skills.length === 0 ? (
                <p className="text-slate-500 text-sm text-center mt-4">暂无技能</p>
              ) : (
                <div className="space-y-2 mb-3">
                  {skills.map(skill => {
                    const badge = TYPE_BADGES[skill.type] || { label: skill.type, color: 'bg-slate-700 text-slate-400' };
                    return (
                      <div key={skill.id} className="flex items-center gap-3 bg-slate-700 rounded-xl px-3 py-2.5">
                        <div className="w-9 h-9 rounded-full bg-slate-600 flex items-center justify-center text-xl flex-shrink-0">
                          {skill.icon || '🔧'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className="text-white text-sm font-medium truncate">{skill.name}</p>
                            <span className={`text-xs px-1.5 py-0.5 rounded ${badge.color} flex-shrink-0`}>{badge.label}</span>
                          </div>
                          <p className="text-slate-400 text-xs truncate">{skill.description}</p>
                        </div>
                        <div className="flex gap-1 flex-shrink-0">
                          <button onClick={() => { setEditing(skill); setMode('edit'); }}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-600 transition-colors">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/>
                            </svg>
                          </button>
                          {!isBuiltin(skill) && (
                            <button onClick={() => handleDelete(skill)}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-slate-600 transition-colors">
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
                              </svg>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <button onClick={() => { setEditing(null); setMode('create'); }}
                className="w-full py-2.5 border border-dashed border-slate-600 hover:border-blue-500 text-slate-400 hover:text-blue-400 rounded-xl text-sm transition-colors">
                + 创建新技能
              </button>
            </>
          ) : (
            <SkillForm
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
