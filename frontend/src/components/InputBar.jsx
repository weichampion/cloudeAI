import { useState, useRef, useEffect } from 'react';
import { getBaseURL } from '../services/api.js';

function getAuthHeader() {
  const token = localStorage.getItem('auth_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// mentions: [{ name, color, type }]  type = 'bot' | 'user'
export default function InputBar({ onSend, onStop, loading, disabled, placeholder, mentions = [] }) {
  const [text, setText] = useState('');
  const [uploading, setUploading] = useState(false);
  const [pendingFile, setPendingFile] = useState(null);
  // @ mention picker state
  const [mentionQuery, setMentionQuery] = useState(null); // null = closed
  const [mentionIndex, setMentionIndex] = useState(0);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);

  // filtered list based on query
  const filteredMentions = mentionQuery === null ? [] : mentions.filter(m =>
    m.name.toLowerCase().includes(mentionQuery.toLowerCase())
  );

  // auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  }, [text]);

  // clamp mentionIndex when filtered list changes
  useEffect(() => {
    setMentionIndex(i => Math.min(i, Math.max(filteredMentions.length - 1, 0)));
  }, [filteredMentions.length]);

  // detect @ trigger from cursor position
  const detectMention = (val, cursor) => {
    const before = val.slice(0, cursor);
    const match = before.match(/@([^\s@]*)$/);
    if (match) {
      setMentionQuery(match[1]);
      setMentionIndex(0);
    } else {
      setMentionQuery(null);
    }
  };

  const handleChange = (e) => {
    const val = e.target.value;
    setText(val);
    detectMention(val, e.target.selectionStart);
  };

  const selectMention = (name) => {
    const el = textareaRef.current;
    const cursor = el?.selectionStart ?? text.length;
    const before = text.slice(0, cursor);
    const after = text.slice(cursor);
    const match = before.match(/@([^\s@]*)$/);
    if (!match) return;
    const inserted = `@${name} `;
    const newBefore = before.slice(0, match.index) + inserted;
    const newText = newBefore + after;
    setText(newText);
    setMentionQuery(null);
    setTimeout(() => {
      if (el) {
        el.focus();
        el.selectionStart = el.selectionEnd = newBefore.length;
      }
    }, 0);
  };

  const handleKeyDown = (e) => {
    // @ picker navigation
    if (mentionQuery !== null && filteredMentions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionIndex(i => (i + 1) % filteredMentions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionIndex(i => (i - 1 + filteredMentions.length) % filteredMentions.length);
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        selectMention(filteredMentions[mentionIndex].name);
        return;
      }
      if (e.key === 'Escape') {
        setMentionQuery(null);
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        selectMention(filteredMentions[mentionIndex].name);
        return;
      }
    }

    // normal send (desktop)
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      if (window.innerWidth >= 768) {
        e.preventDefault();
        handleSend();
      }
    }
  };

  const handleSend = () => {
    if (loading || disabled) return;
    if (!text.trim() && !pendingFile) return;
    let content = text.trim();
    if (pendingFile) {
      const tag = pendingFile.isImage
        ? `![${pendingFile.name}](${pendingFile.url})`
        : `[📎 ${pendingFile.name}](${pendingFile.url})`;
      content = content ? `${tag}\n${content}` : tag;
      setPendingFile(null);
    }
    if (!content) return;
    onSend(content);
    setText('');
    setMentionQuery(null);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`${getBaseURL()}/upload`, {
        method: 'POST',
        headers: getAuthHeader(),
        body: formData,
      });
      if (!res.ok) throw new Error('上传失败');
      const data = await res.json();
      setPendingFile({ url: data.url, name: data.name, isImage: data.isImage, type: data.type });
    } catch (err) {
      console.error('[Upload]', err);
      alert('文件上传失败：' + err.message);
    } finally {
      setUploading(false);
    }
  };

  const isReady = (text.trim() || pendingFile) && !disabled;

  return (
    <div className="bg-slate-800 border-t border-slate-700 relative"
      style={{ paddingBottom: 'max(0.75rem, var(--safe-bottom))' }}>

      {/* @ 提及选择器 */}
      {mentionQuery !== null && filteredMentions.length > 0 && (
        <div className="absolute bottom-full left-0 right-0 mb-1 mx-3">
          <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden max-h-48 overflow-y-auto">
            {filteredMentions.map((m, i) => (
              <button
                key={m.name}
                onMouseDown={e => { e.preventDefault(); selectMention(m.name); }}
                onTouchStart={e => { e.preventDefault(); selectMention(m.name); }}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors
                  ${i === mentionIndex ? 'bg-slate-700' : 'hover:bg-slate-800'}`}>
                <div className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white"
                  style={{ backgroundColor: m.color || (m.type === 'bot' ? '#7c3aed' : '#2563eb') }}>
                  {m.type === 'bot' ? '🤖' : m.name[0]?.toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-sm text-slate-100">{m.name}</span>
                  <span className="ml-1.5 text-xs text-slate-500">{m.type === 'bot' ? 'Bot' : '成员'}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 待发送文件预览 */}
      {pendingFile && (
        <div className="flex items-center gap-2 px-3 pt-2">
          {pendingFile.isImage ? (
            <img src={pendingFile.url} alt={pendingFile.name}
              className="h-16 w-16 object-cover rounded-lg border border-slate-600" />
          ) : (
            <div className="flex items-center gap-2 bg-slate-700 rounded-lg px-3 py-2">
              <span className="text-lg">📎</span>
              <span className="text-xs text-slate-300 max-w-[160px] truncate">{pendingFile.name}</span>
            </div>
          )}
          <button onClick={() => setPendingFile(null)}
            className="text-slate-500 hover:text-slate-300 text-sm ml-1">✕</button>
        </div>
      )}

      <div className="flex items-end gap-2 p-3 pt-2">
        {/* 文件上传按钮 */}
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || uploading}
          className="flex-shrink-0 w-9 h-9 rounded-xl bg-slate-700 hover:bg-slate-600
            disabled:opacity-40 flex items-center justify-center transition-colors text-slate-400 hover:text-slate-200">
          {uploading ? (
            <span className="w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13"/>
            </svg>
          )}
        </button>
        <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileChange}
          accept="image/*,.pdf,.txt,.md,.csv,.json,.docx,.xlsx" />

        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={disabled ? '请先在设置中配置后端地址...' : (placeholder || '输入消息...')}
          rows={1}
          className="flex-1 bg-slate-700 text-slate-100 placeholder-slate-400 rounded-xl px-4 py-2.5
            text-sm resize-none outline-none focus:ring-2 focus:ring-blue-500 scrollbar-thin"
          style={{ maxHeight: '160px' }}
        />

        {loading ? (
          <button onClick={onStop}
            className="flex-shrink-0 w-10 h-10 rounded-full bg-red-500 hover:bg-red-600
              flex items-center justify-center transition-colors active:scale-95">
            <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          </button>
        ) : (
          <button onClick={handleSend} disabled={!isReady}
            className="flex-shrink-0 w-10 h-10 rounded-full bg-blue-600 hover:bg-blue-500
              disabled:bg-slate-600 disabled:opacity-50 flex items-center justify-center
              transition-colors active:scale-95">
            <svg className="w-5 h-5 text-white rotate-90" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5m0 0l-7 7m7-7l7 7" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
