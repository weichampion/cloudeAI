import { useState, useEffect } from 'react';
import { configApi } from '../services/api.js';

export default function SettingsModal({ visible, onClose }) {
  const [config, setConfig] = useState({ apiKey: '', baseURL: '', model: '', serverURL: '' });
  const [systemPrompt, setSystemPrompt] = useState('');
  const [presets, setPresets] = useState([]);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!visible) return;
    // 从 localStorage 加载
    const saved = JSON.parse(localStorage.getItem('ai_config') || '{}');
    setConfig({
      apiKey: saved.apiKey || '',
      baseURL: saved.baseURL || '',
      model: saved.model || '',
      serverURL: saved.serverURL || '',
    });
    setSystemPrompt(localStorage.getItem('system_prompt') || '');
    // 加载服务端预设
    configApi.get().then(res => {
      setPresets(res.data?.presets || []);
      // 若无本地配置，用服务端默认值填充
      if (!saved.baseURL) {
        setConfig(prev => ({
          ...prev,
          baseURL: prev.baseURL || res.data.baseURL || '',
          model: prev.model || res.data.model || '',
        }));
      }
    }).catch(() => {});
  }, [visible]);

  const applyPreset = (preset) => {
    setConfig(prev => ({ ...prev, baseURL: preset.baseURL, model: preset.model }));
  };

  const handleSave = () => {
    localStorage.setItem('ai_config', JSON.stringify(config));
    localStorage.setItem('system_prompt', systemPrompt);
    setSaved(true);
    setTimeout(() => { setSaved(false); onClose(); }, 800);
  };

  const handleClear = () => {
    if (!confirm('确认清除所有本地配置？将恢复为服务端默认值。')) return;
    localStorage.removeItem('ai_config');
    localStorage.removeItem('system_prompt');
    onClose();
  };

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-slate-800 w-full max-w-lg rounded-t-2xl md:rounded-2xl p-5 max-h-[90vh] overflow-y-auto scrollbar-thin"
        style={{ paddingBottom: 'max(1.25rem, var(--safe-bottom))' }}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-white font-semibold text-lg">设置</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1 rounded">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 预设快选 */}
        {presets.length > 0 && (
          <div className="mb-5">
            <label className="text-slate-400 text-xs mb-2 block">快速切换</label>
            <div className="flex flex-wrap gap-2">
              {presets.map(p => (
                <button key={p.model}
                  onClick={() => applyPreset(p)}
                  className="text-xs px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300
                    hover:text-white rounded-full transition-colors"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 后端服务地址（移动端必填） */}
        <div className="mb-4">
          <label className="text-slate-400 text-xs mb-1.5 block">
            后端服务地址
            <span className="ml-1 text-slate-500">（移动端 App 必须填写）</span>
          </label>
          <input
            type="text"
            value={config.serverURL}
            onChange={e => setConfig(p => ({ ...p, serverURL: e.target.value }))}
            placeholder="http://your-server-ip:3000"
            className="w-full bg-slate-700 text-white text-sm rounded-lg px-3 py-2.5
              outline-none focus:ring-2 focus:ring-blue-500 placeholder-slate-500"
          />
        </div>

        {/* API Key */}
        <div className="mb-4">
          <label className="text-slate-400 text-xs mb-1.5 block">API Key</label>
          <input
            type="password"
            value={config.apiKey}
            onChange={e => setConfig(p => ({ ...p, apiKey: e.target.value }))}
            placeholder="留空则使用服务端配置"
            className="w-full bg-slate-700 text-white text-sm rounded-lg px-3 py-2.5
              outline-none focus:ring-2 focus:ring-blue-500 placeholder-slate-500"
          />
        </div>

        {/* Base URL */}
        <div className="mb-4">
          <label className="text-slate-400 text-xs mb-1.5 block">Base URL</label>
          <input
            type="text"
            value={config.baseURL}
            onChange={e => setConfig(p => ({ ...p, baseURL: e.target.value }))}
            placeholder="https://token-plan-cn.xiaomimimo.com/anthropic"
            className="w-full bg-slate-700 text-white text-sm rounded-lg px-3 py-2.5
              outline-none focus:ring-2 focus:ring-blue-500 placeholder-slate-500"
          />
        </div>

        {/* Model */}
        <div className="mb-4">
          <label className="text-slate-400 text-xs mb-1.5 block">Model</label>
          <input
            type="text"
            value={config.model}
            onChange={e => setConfig(p => ({ ...p, model: e.target.value }))}
            placeholder="mimo-v2.5-pro"
            className="w-full bg-slate-700 text-white text-sm rounded-lg px-3 py-2.5
              outline-none focus:ring-2 focus:ring-blue-500 placeholder-slate-500"
          />
        </div>

        {/* System Prompt */}
        <div className="mb-5">
          <label className="text-slate-400 text-xs mb-1.5 block">系统提示词（可选）</label>
          <textarea
            value={systemPrompt}
            onChange={e => setSystemPrompt(e.target.value)}
            placeholder="例如：你是一个专业的代码助手..."
            rows={3}
            className="w-full bg-slate-700 text-white text-sm rounded-lg px-3 py-2.5
              outline-none focus:ring-2 focus:ring-blue-500 placeholder-slate-500 resize-none"
          />
        </div>

        <div className="flex gap-3">
          <button
            onClick={handleClear}
            className="flex-1 py-2.5 rounded-xl border border-slate-600 text-slate-400
              hover:text-white hover:border-slate-500 text-sm transition-colors"
          >
            恢复默认
          </button>
          <button
            onClick={handleSave}
            className={`flex-1 py-2.5 rounded-xl text-white text-sm font-medium transition-colors
              ${saved ? 'bg-green-600' : 'bg-blue-600 hover:bg-blue-500'}`}
          >
            {saved ? '✓ 已保存' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
