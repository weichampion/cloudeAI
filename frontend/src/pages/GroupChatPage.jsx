import { useRef, useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { useGroupChat } from '../hooks/useGroupChat.js';
import InputBar from '../components/InputBar.jsx';
import GroupBotsPanel from '../components/GroupBotsPanel.jsx';
import { getStoredUser } from '../hooks/useAuth.js';
import { botsApi, groupsApi } from '../services/groupApi.js';

function MarkdownContent({ content }) {
  // Escape markdown reference-style definitions like "[name]: ..."
  // otherwise lines can be swallowed by markdown parser and look like empty bubbles.
  const safeContent = String(content ?? '').replace(
    /^\[([^\]\n]{1,40})\]:(\s*)/gm,
    '\\[$1\\]:$2'
  );

  return (
    <div className="prose-chat">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          code({ node, inline, className, children, ...props }) {
            if (inline) return <code className={className} {...props}>{children}</code>;
            const code = String(children).replace(/\n$/, '');
            return (
              <div className="relative group">
                <pre className="!mt-1 !mb-1">
                  <code className={className} {...props}>{children}</code>
                </pre>
                <button
                  onClick={() => navigator.clipboard.writeText(code).catch(() => {})}
                  className="absolute top-2 right-2 text-xs text-slate-400 hover:text-white bg-slate-700 hover:bg-slate-600 px-2 py-0.5 rounded transition-colors opacity-0 group-hover:opacity-100">
                  复制
                </button>
              </div>
            );
          },
          img({ src, alt }) {
            return (
              <img src={src} alt={alt}
                className="max-w-full max-h-64 rounded-lg mt-1 cursor-pointer"
                onClick={() => window.open(src, '_blank')} />
            );
          },
          a({ href, children }) {
            return <a href={href} target="_blank" rel="noopener noreferrer"
              className="text-blue-400 underline">{children}</a>;
          },
        }}
      >
        {safeContent}
      </ReactMarkdown>
    </div>
  );
}

function formatMsgTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function GroupMessageBubble({ msg, myUserId }) {
  const isMe = msg.userId === myUserId;
  const isAI = msg.role === 'assistant';
  const botColor = msg.botColor || '#7c3aed';

  return (
    <div className={`flex gap-2 mb-4 ${isMe ? 'flex-row-reverse' : 'flex-row'} items-start`}>
      <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold
        ${isMe ? 'bg-blue-600' : isAI ? '' : 'bg-slate-600'} text-white`}
        style={isAI ? { backgroundColor: botColor } : {}}>
        {isAI ? (msg.nickname?.[0]?.toUpperCase() || '🤖') : (isMe ? (msg.nickname?.[0]?.toUpperCase() || '我') : (msg.nickname?.[0]?.toUpperCase() || '?'))}
      </div>
      <div className="max-w-[80%]">
        <div className="flex items-baseline gap-2 mb-1 px-1">
          {!isMe && (
            <span className="text-xs text-slate-400">
              {isAI ? msg.nickname || 'AI' : msg.nickname}
            </span>
          )}
          <span className="text-xs text-slate-600 ml-auto">{formatMsgTime(msg.created_at)}</span>
        </div>
        <div className={`rounded-2xl px-4 py-2.5 text-sm
          ${isMe ? 'bg-blue-600 text-white rounded-tr-sm'
            : isAI ? 'bg-purple-900/60 text-slate-100 rounded-tl-sm border border-purple-700/50'
            : 'bg-slate-700 text-slate-100 rounded-tl-sm'}`}
          style={isAI ? { borderColor: `${botColor}40`, backgroundColor: `${botColor}20` } : {}}>
          {isAI
            ? <MarkdownContent content={msg.content} color={botColor} />
            : <p className="whitespace-pre-wrap break-words">{msg.content}</p>}
        </div>
      </div>
    </div>
  );
}

function StreamingBubble({ state }) {
  const { botName, botColor, content } = state;
  const color = botColor || '#7c3aed';
  return (
    <div className="flex gap-2 mb-4 items-start">
      <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white"
        style={{ backgroundColor: color }}>
        {botName?.[0]?.toUpperCase() || '🤖'}
      </div>
      <div className="max-w-[80%]">
        <p className="text-xs text-slate-400 mb-1 px-1">{botName || 'AI'}</p>
        <div className="rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm text-slate-100 border"
          style={{ borderColor: `${color}40`, backgroundColor: `${color}20` }}>
          <MarkdownContent content={content} color={color} />
          <span className="inline-block w-1.5 h-4 ml-0.5 animate-pulse align-middle rounded-sm"
            style={{ backgroundColor: color }} />
        </div>
      </div>
    </div>
  );
}

// DiscussionRoundBubble: single bot turn in a discussion
function DiscussionRoundBubble({ round, idx }) {
  const { botName, botColor, content, streaming, round: roundNum } = round;
  const color = botColor || '#7c3aed';
  return (
    <div className="flex gap-2 mb-3 items-start pl-2 border-l-2" style={{ borderColor: `${color}60` }}>
      <div className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white"
        style={{ backgroundColor: color }}>
        {botName?.[0]?.toUpperCase() || '🤖'}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1 mb-1">
          <span className="text-xs" style={{ color }}>{botName}</span>
          {roundNum !== undefined && <span className="text-xs text-slate-600">第{roundNum + 1}轮</span>}
        </div>
        <div className="text-sm text-slate-200 leading-relaxed">
          <MarkdownContent content={content} color={color} />
          {streaming && (
            <span className="inline-block w-1 h-4 ml-0.5 animate-pulse align-middle rounded-sm"
              style={{ backgroundColor: color }} />
          )}
        </div>
      </div>
    </div>
  );
}

// Discussion panel — shows the ongoing/completed multi-agent discussion
function DiscussionPanel({ state, rounds }) {
  const isRunning = state.status === 'running';
  const roundList = [...rounds.values()];
  return (
    <div className="mx-4 my-3 rounded-2xl border border-slate-600/60 bg-slate-900/80 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-800/80 border-b border-slate-700/60">
        <span className="text-base">🧠</span>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-slate-200 truncate">多智能体讨论</p>
          <p className="text-xs text-slate-400 truncate">{state.topic}</p>
        </div>
        <div className="flex items-center gap-1.5">
          {isRunning && (
            <span className="flex items-center gap-1 text-xs text-blue-400">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
              进行中
            </span>
          )}
          {state.status === 'concluded' && <span className="text-xs text-green-400">✅ 已结论</span>}
          {state.status === 'timeout' && <span className="text-xs text-yellow-400">⏱ 轮次结束</span>}
          {state.status === 'stopped' && <span className="text-xs text-yellow-400">✋ 已停止</span>}
          {state.status === 'error' && <span className="text-xs text-red-400">❌ 错误</span>}
          <span className="text-xs text-slate-500">{state.participants?.length || 0}位参与</span>
        </div>
      </div>

      {/* Rounds */}
      {roundList.length > 0 && (
        <div className="px-4 py-3 space-y-0.5 max-h-64 overflow-y-auto">
          {roundList.map((r, i) => <DiscussionRoundBubble key={i} round={r} idx={i} />)}
        </div>
      )}

      {/* Conclusion */}
      {state.conclusion && (
        <div className="px-4 py-3 border-t border-slate-700/60 bg-slate-800/40">
          <p className="text-xs text-slate-400 mb-1">📌 结论</p>
          <p className="text-sm text-slate-200 whitespace-pre-wrap">{state.conclusion}</p>
        </div>
      )}
    </div>
  );
}

// Research progress panel
function ResearchPanel({ state }) {
  const { topic, botName, botColor, steps, status, sources, error, fileUrl } = state;
  const color = botColor || '#0ea5e9';
  const isRunning = status === 'running';
  return (
    <div className="mx-4 my-3 rounded-2xl border border-slate-600/60 bg-slate-900/80 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-800/80 border-b border-slate-700/60">
        <span className="text-base">🔬</span>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-slate-200 truncate">深度研究</p>
          <p className="text-xs text-slate-400 truncate">{topic}</p>
        </div>
        <div className="flex items-center gap-1.5">
          {isRunning && (
            <span className="flex items-center gap-1 text-xs text-cyan-400">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
              研究中
            </span>
          )}
          {status === 'done' && <span className="text-xs text-green-400">✅ 完成</span>}
          {status === 'stopped' && <span className="text-xs text-yellow-400">✋ 已停止</span>}
          {status === 'error' && <span className="text-xs text-red-400">❌ 失败</span>}
          <span className="text-xs text-slate-500" style={{ color }}>{botName}</span>
        </div>
      </div>

      {/* Steps */}
      {steps.length > 0 && (
        <div className="px-4 py-2 space-y-1">
          {steps.map((s, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className="text-xs text-slate-400 leading-relaxed">{s.message}</span>
              {s.queries && (
                <div className="flex flex-wrap gap-1 ml-1">
                  {s.queries.map((q, j) => (
                    <span key={j} className="text-xs bg-cyan-900/40 text-cyan-300 rounded px-1.5 py-0.5">{q}</span>
                  ))}
                </div>
              )}
            </div>
          ))}
          {isRunning && (
            <div className="flex items-center gap-1.5 pt-1">
              <span className="w-1 h-1 rounded-full animate-bounce bg-cyan-400" style={{ animationDelay: '0ms' }} />
              <span className="w-1 h-1 rounded-full animate-bounce bg-cyan-400" style={{ animationDelay: '150ms' }} />
              <span className="w-1 h-1 rounded-full animate-bounce bg-cyan-400" style={{ animationDelay: '300ms' }} />
            </div>
          )}
        </div>
      )}

      {/* Sources */}
      {sources?.length > 0 && (
        <div className="px-4 py-2 border-t border-slate-700/60">
          <p className="text-xs text-slate-400 mb-1">📎 参考来源</p>
          <div className="space-y-0.5">
            {sources.slice(0, 5).map((s, i) => (
              <a key={i} href={s.url} target="_blank" rel="noopener noreferrer"
                className="block text-xs text-blue-400 hover:text-blue-300 truncate">
                [{i + 1}] {s.title}
              </a>
            ))}
          </div>
        </div>
      )}

      {/* MD 文件下载 */}
      {fileUrl && (
        <div className="px-4 py-2 border-t border-slate-700/60 flex items-center gap-2">
          <span className="text-xs text-slate-400">📄 报告文件：</span>
          <a href={fileUrl} target="_blank" rel="noopener noreferrer" download
            className="text-xs text-cyan-400 hover:text-cyan-300 underline truncate">
            下载 Markdown 报告
          </a>
        </div>
      )}

      {error && (
        <div className="px-4 py-2 border-t border-slate-700/60">
          <p className="text-xs text-red-400">{error}</p>
        </div>
      )}
    </div>
  );
}

function ToolCallBubble({ toolCall }) {
  const { toolName, status, result, error } = toolCall;
  return (
    <div className="flex gap-2 mb-1 ml-10 items-center">
      <span className="text-xs bg-slate-700/70 text-slate-300 rounded-lg px-3 py-1.5 max-w-[80%] truncate">
        {status === 'running' && `⚙️ 正在调用 ${toolName}...`}
        {status === 'done' && `✅ ${toolName} → ${String(result || '').slice(0, 60)}${(result || '').length > 60 ? '…' : ''}`}
        {status === 'error' && `❌ ${toolName} 失败: ${error}`}
      </span>
    </div>
  );
}

export default function GroupChatPage({ group, onMenuClick }) {
  const myUserId = getStoredUser()?.id;
  const isPrivate = group?.type === 'private';
  const { messages, onlineUsers, botStreaming, toolCalls, taskState, connected, sendMessage, activeBotId, setActiveBotId, moderationEvent, discussionState, discussionRounds, researchState, freedomState, taskStopped, clearMessages } = useGroupChat(group);
  const [dismissedDiscussion, setDismissedDiscussion] = useState(false);
  const [dismissedResearch, setDismissedResearch] = useState(false);
  const bottomRef = useRef(null);
  const [showMembers, setShowMembers] = useState(false);
  const [showBotPanel, setShowBotPanel] = useState(false);
  const [groupBots, setGroupBots] = useState([]);
  const [showBotSelector, setShowBotSelector] = useState(false);

  const activeBot = groupBots.find(b => b.id === activeBotId) ?? null;

  // @ 提及列表：群内 Bot + 在线成员（排除自己）
  const mentions = [
    ...groupBots.map(b => ({ name: b.name, color: b.color, type: 'bot' })),
    ...onlineUsers
      .filter(u => u.userId !== myUserId)
      .map(u => ({ name: u.nickname, color: null, type: 'user' })),
  ];

  useEffect(() => {
    if (!group?.id || isPrivate) return;
    botsApi.listGroupBots(group.id).then(res => setGroupBots(res.data || []));
  }, [group?.id, isPrivate]);

  const handleSetActiveBot = async (botId) => {
    await groupsApi.setActiveBot(group.id, botId);
    setActiveBotId(botId);
    setShowBotSelector(false);
  };

  const isAnyStreaming = [...botStreaming.values()].some(s => s.active);

  // Reset dismiss state when new discussion/research starts
  useEffect(() => { if (discussionState?.status === 'running') setDismissedDiscussion(false); }, [discussionState?.status]);
  useEffect(() => { if (researchState?.status === 'running') setDismissedResearch(false); }, [researchState?.status]);
  const myUserId2 = myUserId; // alias for clarity in moderation check

  // 被踢出或被禁言时的提示文字
  const moderationBanner = (() => {
    if (!moderationEvent) return null;
    const { type, userId, nickname, reason, operatorName } = moderationEvent;
    const isMe = userId === myUserId2;
    if (type === 'kicked')  return isMe ? `你已被 ${operatorName} 移出群聊：${reason}` : `${nickname} 已被 ${operatorName} 移出群聊`;
    if (type === 'warned')  return isMe ? `⚠️ ${operatorName} 警告你：${reason}` : `${nickname} 收到警告：${reason}`;
    if (type === 'muted')   return isMe ? `🔇 你已被 ${operatorName} 禁言：${reason}` : `${nickname} 已被禁言`;
    if (type === 'unmuted') return isMe ? `🔔 你的禁言已解除` : `${nickname} 禁言已解除`;
    return null;
  })();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isAnyStreaming, botStreaming, discussionRounds, researchState?.steps?.length]);

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-slate-800">
      {/* 顶部 */}
      <header className="flex items-center gap-2 px-3 py-3 bg-slate-800 border-b border-slate-700"
        style={{ paddingTop: 'max(0.75rem, var(--safe-top))' }}>
        <button onClick={onMenuClick}
          className="md:hidden text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-700">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"/>
          </svg>
        </button>

        <div className="flex-1 min-w-0">
          <p className="text-white font-medium text-sm truncate">
            {isPrivate ? (group.peer_nickname || group.peer_username || '私聊') : group?.name}
          </p>
          <p className="text-slate-400 text-xs">{onlineUsers.length} 人在线</p>
        </div>

        {!isPrivate && (
          <div className="flex items-center gap-1 bg-slate-700 rounded-lg px-2 py-1">
            <span className="text-slate-400 text-xs">码：</span>
            <span className="text-yellow-400 text-xs font-mono font-bold tracking-widest">
              {group?.invite_code}
            </span>
          </div>
        )}

        {/* Bot 选择器 */}
        {!isPrivate && (
          <div className="relative">
            <button onClick={() => setShowBotSelector(v => !v)}
              className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs transition-colors
                ${activeBot ? 'bg-purple-900/60 border border-purple-700/50 text-purple-200' : 'text-slate-400 hover:text-white hover:bg-slate-700'}`}>
              <span>{activeBot ? '🤖' : '🤖'}</span>
              <span>{activeBot ? activeBot.name : '选择Bot'}</span>
              {activeBot && (
                <span onClick={e => { e.stopPropagation(); handleSetActiveBot(null); }}
                  className="ml-0.5 text-slate-400 hover:text-white">×</span>
              )}
            </button>
            {showBotSelector && (
              <div className="absolute right-0 top-full mt-1 bg-slate-900 border border-slate-700 rounded-xl shadow-xl z-50 min-w-[140px] py-1"
                onMouseLeave={() => setShowBotSelector(false)}>
                <button onClick={() => handleSetActiveBot(null)}
                  className="w-full text-left px-3 py-1.5 text-xs text-slate-400 hover:bg-slate-700 hover:text-white">
                  不指定（手动 @）
                </button>
                {groupBots.length === 0 && (
                  <p className="px-3 py-1.5 text-xs text-slate-600">暂无 Bot（请先在群设置添加）</p>
                )}
                {groupBots.map(bot => (
                  <button key={bot.id} onClick={() => handleSetActiveBot(bot.id)}
                    className={`w-full text-left px-3 py-1.5 text-xs hover:bg-slate-700 flex items-center gap-2
                      ${bot.id === activeBotId ? 'text-white' : 'text-slate-300'}`}>
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: bot.color }} />
                    {bot.name}
                    {bot.id === activeBotId && <span className="ml-auto text-purple-400 text-xs">✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Bot 配置（私聊不显示） */}
        {!isPrivate && (
          <button onClick={() => setShowBotPanel(true)}
            title="群 Bot 配置"
            className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-700">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"/>
            </svg>
          </button>
        )}

        {/* 清空聊天记录 */}
        <button
          onClick={() => { if (window.confirm('清空本地聊天记录？（不影响服务端，重新进入群聊后仍可加载历史）')) clearMessages(); }}
          title="清空本地记录"
          className="text-slate-400 hover:text-red-400 p-1.5 rounded-lg hover:bg-slate-700">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"/>
          </svg>
        </button>

        {/* 成员列表 */}
        <button onClick={() => setShowMembers(v => !v)}
          className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-700">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z"/>
          </svg>
        </button>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 flex flex-col overflow-hidden">
          {!connected && (
            <div className="bg-yellow-900/40 border-b border-yellow-700/50 px-4 py-2 text-yellow-300 text-xs text-center">
              正在连接群聊...
            </div>
          )}

          {/* 仲裁事件横幅 */}
          {moderationBanner && (
            <div className={`border-b px-4 py-2 text-xs text-center
              ${moderationEvent?.userId === myUserId
                ? 'bg-red-900/40 border-red-700/50 text-red-300'
                : 'bg-yellow-900/40 border-yellow-700/50 text-yellow-300'}`}>
              {moderationBanner}
            </div>
          )}

          {/* 操作被停止横幅 */}
          {!isPrivate && taskStopped && (
            <div className="bg-yellow-900/40 border-b border-yellow-700/50 px-4 py-2 flex items-center gap-2">
              <span className="text-yellow-200 text-xs flex-1">{taskStopped.message}</span>
              {taskStopped.operatorNickname && (
                <span className="text-yellow-500 text-xs">by {taskStopped.operatorNickname}</span>
              )}
            </div>
          )}

          {/* 任务执行横幅（私聊不显示） */}
          {!isPrivate && taskState && (
            <div className="bg-blue-900/40 border-b border-blue-700/50 px-4 py-2 flex items-center gap-2">
              <span className="text-blue-300 text-xs animate-pulse">●</span>
              <span className="text-blue-200 text-xs flex-1 truncate">
                正在执行：{taskState.taskDesc}
              </span>
              <span className="text-blue-400 text-xs">{taskState.botCount} 个智能体</span>
              <button onClick={() => sendMessage('/stop')}
                className="text-xs text-blue-300 hover:text-white border border-blue-600 hover:border-blue-400 rounded px-1.5 py-0.5 transition-colors">
                停止
              </button>
            </div>
          )}

          {/* 研究进行中横幅 */}
          {!isPrivate && researchState?.status === 'running' && (
            <div className="bg-cyan-900/40 border-b border-cyan-700/50 px-4 py-2 flex items-center gap-2">
              <span className="text-cyan-300 text-xs animate-pulse">●</span>
              <span className="text-cyan-200 text-xs flex-1 truncate">
                深度研究：{researchState.topic}
              </span>
              <span className="text-cyan-400 text-xs">{researchState.botName}</span>
              <button onClick={() => sendMessage('/stop')}
                className="text-xs text-cyan-300 hover:text-white border border-cyan-600 hover:border-cyan-400 rounded px-1.5 py-0.5 transition-colors">
                停止
              </button>
            </div>
          )}

          {/* 讨论进行中横幅 */}
          {!isPrivate && discussionState?.status === 'running' && (
            <div className="bg-indigo-900/40 border-b border-indigo-700/50 px-4 py-2 flex items-center gap-2">
              <span className="text-indigo-300 text-xs animate-pulse">●</span>
              <span className="text-indigo-200 text-xs flex-1 truncate">
                多智能体讨论中：{discussionState.topic}
              </span>
              <span className="text-indigo-400 text-xs">
                {discussionState.participants?.map(p => p.name).join(' · ')}
              </span>
              <button onClick={() => sendMessage('/stop')}
                className="text-xs text-indigo-300 hover:text-white border border-indigo-600 hover:border-indigo-400 rounded px-1.5 py-0.5 transition-colors">
                停止
              </button>
            </div>
          )}

          {/* 自由聊天横幅 */}
          {!isPrivate && freedomState?.status === 'running' && (
            <div className={`border-b px-4 py-2 flex items-center gap-2 transition-colors
              ${freedomState.waitingForHuman
                ? 'bg-orange-900/40 border-orange-700/50'
                : 'bg-teal-900/40 border-teal-700/50'}`}>
              {freedomState.waitingForHuman ? (
                <>
                  <span className="text-orange-300 text-xs animate-bounce">💬</span>
                  <span className="text-orange-200 text-xs flex-1">
                    <span className="font-medium">{freedomState.waitingBotName}</span> @了你，等你回复...
                  </span>
                  <span className="text-orange-400 text-xs animate-pulse">↩ 发消息回复</span>
                </>
              ) : freedomState.thinkingBot ? (
                <>
                  <span className="text-teal-300 text-xs">💭</span>
                  <span className="text-teal-200 text-xs flex-1">
                    <span className="font-medium">{freedomState.thinkingBot.botName}</span>
                    <span className="animate-pulse ml-1">正在思考</span>
                    <span className="ml-0.5 animate-bounce inline-block">...</span>
                  </span>
                </>
              ) : (
                <>
                  <span className="text-teal-300 text-xs animate-pulse">●</span>
                  <span className="text-teal-200 text-xs flex-1 truncate">
                    自由聊天{freedomState.context ? `：${freedomState.context}` : ''}
                  </span>
                  <span className="text-teal-400 text-xs">
                    {freedomState.bots?.map(b => b.name).join(' · ')}
                  </span>
                </>
              )}
              <button onClick={() => sendMessage('/stop')}
                className={`text-xs hover:text-white border rounded px-1.5 py-0.5 transition-colors
                  ${freedomState.waitingForHuman
                    ? 'text-orange-300 border-orange-600 hover:border-orange-400'
                    : 'text-teal-300 border-teal-600 hover:border-teal-400'}`}>
                停止
              </button>
            </div>
          )}

          <div className="flex-1 overflow-y-auto scrollbar-thin px-4 py-4">
            {messages.length === 0 && !isAnyStreaming ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-500">
                {isPrivate ? (
                  <>
                    <p className="text-4xl mb-3">💬</p>
                    <p className="text-sm">和 {group?.peer_nickname || group?.peer_username} 开始聊天吧</p>
                  </>
                ) : (
                  <>
                    <p className="text-4xl mb-3">👥</p>
                    <p className="text-sm">
                      {activeBot ? `当前 Bot：${activeBot.name}，直接发消息即可` : '选择 Bot 或 @BotName 触发'}
                    </p>
                    <div className="mt-3 text-left bg-slate-700/50 rounded-xl p-3 text-xs text-slate-400 space-y-1.5 max-w-xs">
                      <p className="text-slate-300 font-medium mb-1">可用命令</p>
                      <p>🤖 <span className="text-slate-300">@BotName</span> — 触发指定Bot</p>
                      <p>🔀 <span className="text-slate-300">/task [描述]</span> — 多Bot协作</p>
                      <p>💬 <span className="text-slate-300">/discuss [话题]</span> — 结构化讨论</p>
                      <p>🎭 <span className="text-slate-300">/freedom [话题]</span> — 自由群聊</p>
                      <p>🔬 <span className="text-slate-300">/research [主题]</span> — 深度研究</p>
                      <p>✋ <span className="text-slate-300">/stop</span> — 停止当前操作</p>
                    </div>
                    <p className="text-xs mt-3 text-slate-600">邀请码：{group?.invite_code}</p>
                  </>
                )}
              </div>
            ) : (
              messages
                .filter(msg => msg.role !== 'assistant' || msg.content?.trim())
                .map(msg => (
                  <GroupMessageBubble key={msg.id} msg={msg} myUserId={myUserId} />
                ))
            )}

            {/* Tool Call 状态气泡 */}
            {[...toolCalls.values()].map((tc, i) =>
              <ToolCallBubble key={i} toolCall={tc} />
            )}

            {/* 深度研究面板 */}
            {!isPrivate && researchState && !dismissedResearch && (
              <div className="relative">
                <button onClick={() => setDismissedResearch(true)}
                  className="absolute top-2 right-2 z-10 text-slate-500 hover:text-slate-300 p-1 rounded">✕</button>
                <ResearchPanel state={researchState} />
              </div>
            )}

            {/* 多智能体讨论面板 */}
            {!isPrivate && discussionState && !dismissedDiscussion && (
              <div className="relative">
                <button onClick={() => setDismissedDiscussion(true)}
                  className="absolute top-2 right-2 z-10 text-slate-500 hover:text-slate-300 p-1 rounded">✕</button>
                <DiscussionPanel state={discussionState} rounds={discussionRounds} />
              </div>
            )}

            {/* 多 Bot 流式输出 */}
            {[...botStreaming.entries()].map(([botId, state]) =>
              state.active ? <StreamingBubble key={botId} state={state} /> : null
            )}

            <div ref={bottomRef} />
          </div>

          <InputBar onSend={sendMessage} loading={isAnyStreaming} disabled={!connected}
            mentions={isPrivate ? [] : mentions}
            placeholder="发消息 · @BotName · /freedom · /discuss · /task · /research · /stop" />
        </div>

        {/* 成员面板 */}
        {showMembers && (
          <div className="w-44 bg-slate-900 border-l border-slate-700 flex flex-col">
            <p className="text-slate-400 text-xs px-3 py-2 border-b border-slate-700">
              在线成员 ({onlineUsers.length})
            </p>
            <div className="flex-1 overflow-y-auto py-2">
              {onlineUsers.map(u => (
                <div key={u.userId} className="flex items-center gap-2 px-3 py-1.5">
                  <div className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0"/>
                  <span className={`text-xs truncate ${u.userId === myUserId ? 'text-blue-400' : 'text-slate-300'}`}>
                    {u.nickname}{u.userId === myUserId ? ' (我)' : ''}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <GroupBotsPanel groupId={group?.id} visible={showBotPanel} onClose={() => setShowBotPanel(false)} />
    </div>
  );
}
