import { useState, useEffect, useRef, useCallback } from 'react';
import { GroupSocket } from '../services/groupApi.js';
import { getStoredUser } from './useAuth.js';

export function useGroupChat(group) {
  const [messages, setMessages] = useState([]);
  const [onlineUsers, setOnlineUsers] = useState([]);
  // Map<botId, { active, msgId, content, botName, botColor }>
  const [botStreaming, setBotStreaming] = useState(new Map());
  // Map<toolCallId, { botId, botName, toolName, status, result }>
  const [toolCalls, setToolCalls] = useState(new Map());
  const [taskState, setTaskState] = useState(null); // { taskDesc, botCount } | null
  const [connected, setConnected] = useState(false);
  const [activeBotId, setActiveBotId] = useState(null);
  // { type:'kicked'|'warned'|'muted'|'unmuted', userId, nickname, reason, operatorName }
  const [moderationEvent, setModerationEvent] = useState(null);
  // Discussion state: { sessionId, topic, maxRounds, participants, status } | null
  const [discussionState, setDiscussionState] = useState(null);
  // Map<msgId, { sessionId, round, botId, botName, botColor, content, streaming }>
  const [discussionRounds, setDiscussionRounds] = useState(new Map());
  // Research state: { topic, botName, botColor, steps, status, sources, fileUrl } | null
  const [researchState, setResearchState] = useState(null);
  // Freedom state: { context, bots, status, waitingForHuman, waitingBotName, waitingBotColor } | null
  const [freedomState, setFreedomState] = useState(null);
  // { message, operatorNickname } | null — cleared after 4 s
  const [taskStopped, setTaskStopped] = useState(null);
  const socketRef = useRef(null);
  const nickname = localStorage.getItem('nickname') || '匿名用户';

  // 向后兼容：返回第一个正在流式的 bot 状态（单 AI 场景）
  const aiStreaming = (() => {
    for (const s of botStreaming.values()) {
      if (s.active) return s;
    }
    return { active: false, msgId: null, content: '' };
  })();

  // 用 ref 实时追踪当前群组 id，供 localStorage 操作使用（不触发重渲）
  const groupIdRef = useRef(group?.id ?? null);
  groupIdRef.current = group?.id ?? null;

  // 直接写入 localStorage（不依赖 useEffect 调度，避免 race condition）
  const saveToStorage = useCallback((msgs) => {
    const gid = groupIdRef.current;
    if (!gid || msgs.length === 0) return;
    try { localStorage.setItem(`gc_msgs_${gid}`, JSON.stringify(msgs.slice(-300))); } catch {}
  }, []);

  // 清空聊天记录（本地视图 + 缓存，不删除服务端）
  const clearMessages = useCallback(() => {
    const gid = groupIdRef.current;
    if (!gid) return;
    localStorage.setItem(`gc_cleared_${gid}`, String(Date.now()));
    localStorage.removeItem(`gc_msgs_${gid}`);
    setMessages([]);
  }, []);

  const appendMessage = useCallback((msg) => {
    setMessages(prev => {
      if (prev.find(m => m.id === msg.id)) return prev;
      const next = [...prev, msg];
      saveToStorage(next);
      return next;
    });
  }, [saveToStorage]);

  useEffect(() => {
    if (!group?.id) return;

    // 先从本地缓存加载（避免白屏等待）
    const clearedAt = parseInt(localStorage.getItem(`gc_cleared_${group.id}`) || '0');
    const cached = localStorage.getItem(`gc_msgs_${group.id}`);
    if (cached) {
      try {
        const msgs = JSON.parse(cached);
        setMessages(clearedAt ? msgs.filter(m => m.created_at > clearedAt) : msgs);
      } catch { setMessages([]); }
    } else {
      setMessages([]);
    }

    setOnlineUsers([]);
    setBotStreaming(new Map());
    setToolCalls(new Map());
    setTaskState(null);
    setActiveBotId(null);
    setDiscussionState(null);
    setDiscussionRounds(new Map());
    setResearchState(null);
    setFreedomState(null);
    setTaskStopped(null);

    const authUser = getStoredUser();
    const userId = authUser?.id || 'anonymous';
    socketRef.current = new GroupSocket({
      groupId: group.id,
      userId,
      nickname: authUser?.nickname || authUser?.username || 'unknown',
      onJoined: (data) => {
        setConnected(true);
        setOnlineUsers(data.onlineUsers || []);
        // 重连时清空 streaming 状态，防止卡死气泡
        setBotStreaming(new Map());
        setToolCalls(new Map());
        if (data.messages?.length) {
          const clearedAt = parseInt(localStorage.getItem(`gc_cleared_${group.id}`) || '0');
          const serverMsgs = clearedAt
            ? data.messages.filter(m => m.created_at > clearedAt)
            : data.messages;
          // 合并：保留本地已有但尚未入库的消息（避免 ai_done 之后重连导致消息消失）
          setMessages(prev => {
            const serverIds = new Set(serverMsgs.map(m => m.id));
            const localOnly = prev.filter(m => !serverIds.has(m.id));
            const merged = [...serverMsgs, ...localOnly].sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
            saveToStorage(merged);
            return merged;
          });
        }
        setActiveBotId(data.group?.active_bot_id ?? null);
      },
      onMessage: (msg) => {
        appendMessage(msg);
        window.dispatchEvent(new CustomEvent('group-new-message', { detail: { groupId: group.id } }));
      },
      onMemberJoin: ({ userId: uid, nickname: nick }) => {
        setOnlineUsers(prev => prev.find(u => u.userId === uid)
          ? prev : [...prev, { userId: uid, nickname: nick }]);
      },
      onMemberLeave: ({ userId: uid }) => {
        setOnlineUsers(prev => prev.filter(u => u.userId !== uid));
      },
      onAiStart: ({ msgId, botId = 'ai', botName = 'AI', botColor = '#7c3aed' }) => {
        setBotStreaming(prev => new Map(prev).set(botId, {
          active: true, msgId, content: '', botName, botColor,
        }));
        // Bot started speaking — clear thinking indicator
        setFreedomState(prev => prev?.thinkingBot ? { ...prev, thinkingBot: null } : prev);
      },
      onAiDelta: ({ msgId, botId = 'ai', delta }) => {
        setBotStreaming(prev => {
          const next = new Map(prev);
          const cur = next.get(botId);
          if (cur) next.set(botId, { ...cur, content: cur.content + delta });
          return next;
        });
      },
      onAiDone: ({ msgId, botId = 'ai', botName = 'AI', botColor = '#7c3aed', content }) => {
        setBotStreaming(prev => {
          const next = new Map(prev);
          next.delete(botId);
          return next;
        });
        if (content?.trim()) {
          appendMessage({
            id: msgId, userId: botId, nickname: botName, botColor,
            role: 'assistant', content: content.trim(), created_at: Date.now(),
          });
        }
      },
      onAiError: ({ botId = 'ai' }) => {
        setBotStreaming(prev => {
          const next = new Map(prev);
          next.delete(botId);
          return next;
        });
      },
      onTaskStart: ({ taskDesc, botCount }) => { setTaskState({ taskDesc, botCount }); },
      onTaskDone: () => { setTaskState(null); },
      onToolCallStart: ({ botId, botName, toolName, toolCallId }) => {
        setToolCalls(prev => new Map(prev).set(toolCallId, { botId, botName, toolName, status: 'running' }));
      },
      onToolCallDone: ({ toolCallId, toolName, result }) => {
        setToolCalls(prev => {
          const next = new Map(prev);
          const cur = next.get(toolCallId) || { toolName };
          next.set(toolCallId, { ...cur, status: 'done', result });
          return next;
        });
      },
      onToolCallError: ({ toolCallId, toolName, error }) => {
        setToolCalls(prev => {
          const next = new Map(prev);
          const cur = next.get(toolCallId) || { toolName };
          next.set(toolCallId, { ...cur, status: 'error', error });
          return next;
        });
      },
      onActiveBotChanged: ({ botId }) => setActiveBotId(botId ?? null),
      onMemberKicked: (e) => {
        setOnlineUsers(prev => prev.filter(u => u.userId !== e.userId));
        setModerationEvent({ type: 'kicked', ...e });
      },
      onMemberWarned: (e) => setModerationEvent({ type: 'warned', ...e }),
      onMemberMuted:  (e) => setModerationEvent({ type: 'muted',  ...e }),
      onMemberUnmuted:(e) => setModerationEvent({ type: 'unmuted',...e }),
      onDiscussStart: ({ sessionId, topic, maxRounds, participants }) => {
        setDiscussionState({ sessionId, topic, maxRounds, participants, status: 'running' });
        setDiscussionRounds(new Map());
      },
      onDiscussRoundStart: ({ sessionId, round, botId, botName, botColor }) => {
        // round about to speak — no-op, delta_start creates the entry
      },
      onDiscussDeltaStart: ({ sessionId, round, msgId, botId, botName, botColor }) => {
        setDiscussionRounds(prev => new Map(prev).set(msgId, {
          sessionId, round, botId, botName, botColor, content: '', streaming: true,
        }));
      },
      onDiscussDelta: ({ msgId, delta }) => {
        setDiscussionRounds(prev => {
          const next = new Map(prev);
          const cur = next.get(msgId);
          if (cur) next.set(msgId, { ...cur, content: cur.content + delta });
          return next;
        });
      },
      onDiscussDeltaEnd: ({ msgId }) => {
        setDiscussionRounds(prev => {
          const next = new Map(prev);
          const cur = next.get(msgId);
          if (cur) next.set(msgId, { ...cur, streaming: false });
          return next;
        });
      },
      onDiscussRoundDone: ({ sessionId, round, botId, botName, botColor, content, action }) => {
        // content already accumulated via delta; action is for reference
      },
      onDiscussEnd: ({ sessionId, topic, rounds, conclusion, status }) => {
        setDiscussionState(prev => prev ? { ...prev, status, conclusion, rounds } : null);
      },
      onDiscussError: ({ error }) => {
        setDiscussionState(prev => prev ? { ...prev, status: 'error', error } : null);
      },
      onResearchStart: ({ topic, botName, botColor, hasSearch }) => {
        setResearchState({ topic, botName, botColor, hasSearch, steps: [], status: 'running', sources: [] });
      },
      onResearchStep: ({ step, message, queries, count, fileUrl }) => {
        setResearchState(prev => {
          if (!prev) return null;
          const update = { steps: [...prev.steps, { step, message, queries, count }] };
          if (fileUrl) update.fileUrl = fileUrl;
          return { ...prev, ...update };
        });
      },
      onResearchEnd: ({ topic, sources, fileUrl }) => {
        setResearchState(prev => prev ? { ...prev, status: 'done', sources, fileUrl } : null);
      },
      onResearchError: ({ error }) => {
        setResearchState(prev => prev ? { ...prev, status: 'error', error } : null);
      },
      onFreedomStart: ({ context, bots }) => {
        setFreedomState({ context, bots, status: 'running', waitingForHuman: false, thinkingBot: null });
      },
      onFreedomThinking: ({ botId, botName, botColor }) => {
        setFreedomState(prev => prev ? { ...prev, thinkingBot: { botId, botName, botColor } } : null);
      },
      onFreedomWaitingHuman: ({ botName, botColor }) => {
        setFreedomState(prev => prev ? { ...prev, waitingForHuman: true, waitingBotName: botName, waitingBotColor: botColor, thinkingBot: null } : null);
      },
      onFreedomHumanReplied: () => {
        setFreedomState(prev => prev ? { ...prev, waitingForHuman: false } : null);
      },
      onFreedomEnd: () => {
        setFreedomState(prev => prev ? { ...prev, status: 'ended', waitingForHuman: false, thinkingBot: null } : null);
      },
      onFreedomError: ({ error }) => {
        setFreedomState(prev => prev ? { ...prev, status: 'error', error, thinkingBot: null } : null);
      },
      onTaskStopped: ({ message, operatorNickname }) => {
        setTaskStopped({ message, operatorNickname });
        setDiscussionState(prev => prev?.status === 'running' ? { ...prev, status: 'stopped' } : prev);
        setResearchState(prev => prev?.status === 'running' ? { ...prev, status: 'stopped' } : prev);
        setFreedomState(prev => prev?.status === 'running' ? { ...prev, status: 'stopped', waitingForHuman: false, thinkingBot: null } : prev);
        setTaskState(null);
        setTimeout(() => setTaskStopped(null), 5000);
      },
      onError: (err) => console.error('[GroupWS]', err),
    });

    return () => {
      socketRef.current?.close();
      setConnected(false);
    };
  }, [group?.id]);

  const sendMessage = useCallback((content) => {
    socketRef.current?.send(content);
  }, []);

  return { messages, onlineUsers, aiStreaming, botStreaming, toolCalls, taskState, connected, sendMessage, activeBotId, setActiveBotId, moderationEvent, discussionState, discussionRounds, researchState, freedomState, taskStopped, clearMessages };
}
