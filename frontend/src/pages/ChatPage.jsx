import { useEffect, useRef, useState } from 'react';
import MessageBubble from '../components/MessageBubble.jsx';
import InputBar from '../components/InputBar.jsx';
import { useChat } from '../hooks/useChat.js';
import { botsApi } from '../services/groupApi.js';

// Tool call status chip (reused from group chat concept)
function ToolCallChip({ tc }) {
  const { toolName, status, result, error } = tc;
  return (
    <div className="flex justify-start mb-1 pl-10">
      <span className="text-xs bg-slate-700/70 text-slate-300 rounded-lg px-3 py-1.5 max-w-[80%] truncate">
        {status === 'running' && `⚙️ 正在调用 ${toolName}...`}
        {status === 'done'    && `✅ ${toolName} → ${String(result || '').slice(0, 60)}${(result || '').length > 60 ? '…' : ''}`}
        {status === 'error'   && `❌ ${toolName} 失败: ${error}`}
      </span>
    </div>
  );
}

export default function ChatPage({ sessionId, onSessionUpdate, onMenuClick, onOpenSettings }) {
  const { messages, loading, streamingContent, toolCalls, loadMessages, sendMessage, stopGeneration } = useChat(sessionId);
  const bottomRef = useRef(null);
  const [bots, setBots] = useState([]);
  const [selectedBotId, setSelectedBotId] = useState(() => localStorage.getItem('chat_bot_id') || '');
  const [showBotPicker, setShowBotPicker] = useState(false);

  useEffect(() => {
    if (sessionId) loadMessages();
  }, [sessionId, loadMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent, toolCalls]);

  // Load bots for selector
  useEffect(() => {
    botsApi.list().then(res => setBots(res.data || [])).catch(() => {});
  }, []);

  const handleSend = async (text) => {
    await sendMessage(text, selectedBotId || undefined);
    onSessionUpdate?.();
  };

  const handleSelectBot = (botId) => {
    setSelectedBotId(botId);
    localStorage.setItem('chat_bot_id', botId);
    setShowBotPicker(false);
  };

  const selectedBot = bots.find(b => b.id === selectedBotId) ?? null;
  const toolCallList = [...toolCalls.values()];

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-slate-800">
      {/* 顶部导航 */}
      <header className="flex items-center gap-3 px-4 py-3 bg-slate-800 border-b border-slate-700"
        style={{ paddingTop: 'max(0.75rem, var(--safe-top))' }}>
        <button onClick={onMenuClick}
          className="md:hidden text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-700 transition-colors">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
          </svg>
        </button>
        <span className="text-white font-medium text-sm truncate flex-1">OpenClaw</span>

        {/* Bot 选择器 */}
        {bots.length > 0 && (
          <div className="relative">
            <button onClick={() => setShowBotPicker(v => !v)}
              className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs transition-colors
                ${selectedBot ? 'bg-purple-900/60 border border-purple-700/50 text-purple-200' : 'text-slate-400 hover:text-white hover:bg-slate-700'}`}>
              <span>🤖</span>
              <span>{selectedBot ? selectedBot.name : '无Bot'}</span>
            </button>
            {showBotPicker && (
              <div className="absolute right-0 top-full mt-1 bg-slate-900 border border-slate-700 rounded-xl shadow-xl z-50 min-w-[140px] py-1"
                onMouseLeave={() => setShowBotPicker(false)}>
                <button onClick={() => handleSelectBot('')}
                  className="w-full text-left px-3 py-1.5 text-xs text-slate-400 hover:bg-slate-700 hover:text-white">
                  不使用 Bot
                </button>
                {bots.map(bot => (
                  <button key={bot.id} onClick={() => handleSelectBot(bot.id)}
                    className={`w-full text-left px-3 py-1.5 text-xs hover:bg-slate-700 flex items-center gap-2
                      ${bot.id === selectedBotId ? 'text-white' : 'text-slate-300'}`}>
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: bot.color }} />
                    {bot.name}
                    {bot.id === selectedBotId && <span className="ml-auto text-purple-400">✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 连接状态 */}
        <div className="flex items-center gap-1.5">
          <div className={`w-2 h-2 rounded-full ${sessionId ? 'bg-green-400' : 'bg-red-400 animate-pulse'}`} />
          <span className="text-xs text-slate-400">{sessionId ? '已连接' : '未连接'}</span>
        </div>

        {loading && (
          <div className="flex items-center gap-1 ml-1">
            <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-bounce [animation-delay:0ms]" />
            <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-bounce [animation-delay:150ms]" />
            <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-bounce [animation-delay:300ms]" />
          </div>
        )}
      </header>

      {/* 未连接提示 */}
      {!sessionId && (
        <div className="bg-red-900/50 border-b border-red-700 px-4 py-2.5 flex items-center justify-between">
          <p className="text-red-300 text-xs">未连接到后端服务，请配置服务器地址</p>
          <button onClick={onOpenSettings}
            className="text-xs text-white bg-red-600 hover:bg-red-500 px-3 py-1 rounded-full transition-colors">
            去设置
          </button>
        </div>
      )}

      {/* 消息区 */}
      <div className="flex-1 overflow-y-auto scrollbar-thin px-4 py-4">
        {messages.length === 0 && !streamingContent ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-500">
            <div className="text-5xl mb-4">🤖</div>
            <p className="text-lg font-medium text-slate-400">OpenClaw</p>
            <p className="text-sm mt-1">{sessionId ? (selectedBot ? `使用 ${selectedBot.name} 的技能` : '有什么可以帮您的？') : '请先连接后端服务'}</p>
          </div>
        ) : (
          <>
            {messages.map(msg => (
              <MessageBubble key={msg.id} role={msg.role} content={msg.content} />
            ))}
          </>
        )}

        {/* Tool calls */}
        {toolCallList.map((tc, i) => <ToolCallChip key={i} tc={tc} />)}

        {/* Streaming */}
        {streamingContent && (
          <MessageBubble role="assistant" content={streamingContent} isStreaming />
        )}

        <div ref={bottomRef} />
      </div>

      <InputBar onSend={handleSend} onStop={stopGeneration} loading={loading} disabled={!sessionId} />
    </div>
  );
}
