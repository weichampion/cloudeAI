import { getBaseURL, getWsURL } from './api.js';

function jsonFetch(url, options = {}) {
  return fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  }).then(r => r.json());
}

function getAuthHeader() {
  const token = localStorage.getItem('auth_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function authFetch(url, options = {}) {
  return fetch(url, {
    headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
    ...options,
  }).then(r => r.json());
}

export const groupsApi = {
  list: () => authFetch(`${getBaseURL()}/groups`),
  listPrivate: () => authFetch(`${getBaseURL()}/groups/private`),
  create: (data) => authFetch(`${getBaseURL()}/groups`, {
    method: 'POST', body: JSON.stringify(data),
  }),
  join: (data) => authFetch(`${getBaseURL()}/groups/join`, {
    method: 'POST', body: JSON.stringify(data),
  }),
  get: (id) => authFetch(`${getBaseURL()}/groups/${id}`),
  inviteMember: (groupId, friendId) => authFetch(`${getBaseURL()}/groups/${groupId}/members`, {
    method: 'POST', body: JSON.stringify({ friendId }),
  }),
  openPrivateChat: (friendId) => authFetch(`${getBaseURL()}/friends/${friendId}/chat`, {
    method: 'POST',
  }),
  setActiveBot: (groupId, botId) => authFetch(`${getBaseURL()}/groups/${groupId}/active-bot`, {
    method: 'PATCH', body: JSON.stringify({ botId: botId ?? null }),
  }),
};

export const skillsApi = {
  list: () => authFetch(`${getBaseURL()}/skills`),
  create: (data) => authFetch(`${getBaseURL()}/skills`, { method: 'POST', body: JSON.stringify(data) }),
  update: (id, data) => authFetch(`${getBaseURL()}/skills/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  delete: (id) => authFetch(`${getBaseURL()}/skills/${id}`, { method: 'DELETE' }),
  test: (id, params) => authFetch(`${getBaseURL()}/skills/${id}/test`, { method: 'POST', body: JSON.stringify({ params }) }),
  getBotSkills: (botId) => authFetch(`${getBaseURL()}/bots/${botId}/skills`),
  addBotSkill: (botId, skillId) => authFetch(`${getBaseURL()}/bots/${botId}/skills`, { method: 'POST', body: JSON.stringify({ skillId }) }),
  removeBotSkill: (botId, skillId) => authFetch(`${getBaseURL()}/bots/${botId}/skills/${skillId}`, { method: 'DELETE' }),
};

export const botsApi = {
  list: () => authFetch(`${getBaseURL()}/bots`),
  create: (data) => authFetch(`${getBaseURL()}/bots`, {
    method: 'POST', body: JSON.stringify(data),
  }),
  update: (id, data) => authFetch(`${getBaseURL()}/bots/${id}`, {
    method: 'PATCH', body: JSON.stringify(data),
  }),
  delete: (id) => authFetch(`${getBaseURL()}/bots/${id}`, { method: 'DELETE' }),
  listGroupBots: (groupId) => authFetch(`${getBaseURL()}/bots/group/${groupId}`),
  addToGroup: (groupId, botId, position) => authFetch(`${getBaseURL()}/bots/group/${groupId}`, {
    method: 'POST', body: JSON.stringify({ botId, position }),
  }),
  removeFromGroup: (groupId, botId) => authFetch(`${getBaseURL()}/bots/group/${groupId}/${botId}`, {
    method: 'DELETE',
  }),
};

export class GroupSocket {
  constructor({ groupId, userId, nickname, onMessage, onMemberJoin, onMemberLeave,
    onAiStart, onAiDelta, onAiDone, onAiError, onJoined, onTaskStart, onTaskDone,
    onToolCallStart, onToolCallDone, onToolCallError, onError, onActiveBotChanged,
    onMemberKicked, onMemberWarned, onMemberMuted, onMemberUnmuted,
    onDiscussStart, onDiscussRoundStart, onDiscussDeltaStart, onDiscussDelta, onDiscussDeltaEnd,
    onDiscussRoundDone, onDiscussEnd, onDiscussError,
    onResearchStart, onResearchStep, onResearchEnd, onResearchError, onTaskStopped,
    onFreedomStart, onFreedomWaitingHuman, onFreedomHumanReplied, onFreedomEnd,
    onFreedomThinking, onFreedomError }) {
    this.groupId = groupId;
    this.userId = userId;
    this.nickname = nickname;
    this.handlers = { onMessage, onMemberJoin, onMemberLeave,
      onAiStart, onAiDelta, onAiDone, onAiError, onJoined, onTaskStart, onTaskDone,
      onToolCallStart, onToolCallDone, onToolCallError, onError, onActiveBotChanged,
      onMemberKicked, onMemberWarned, onMemberMuted, onMemberUnmuted,
      onDiscussStart, onDiscussRoundStart, onDiscussDeltaStart, onDiscussDelta, onDiscussDeltaEnd,
      onDiscussRoundDone, onDiscussEnd, onDiscussError,
      onResearchStart, onResearchStep, onResearchEnd, onResearchError, onTaskStopped,
      onFreedomStart, onFreedomWaitingHuman, onFreedomHumanReplied, onFreedomEnd,
      onFreedomThinking, onFreedomError };
    this.ws = null;
    this.pingTimer = null;
    this.reconnectTimer = null;
    this.shouldReconnect = true; // set false only on intentional close()
    this.reconnectDelay = 1500;
    // 页面可见时检查连接是否存活（Android 回到前台时尤其重要）
    this._onVisible = () => {
      if (document.visibilityState === 'visible' && this.shouldReconnect) {
        if (!this.ws || this.ws.readyState === WebSocket.CLOSED || this.ws.readyState === WebSocket.CLOSING) {
          clearTimeout(this.reconnectTimer);
          this.reconnectDelay = 1500;
          this.connect();
        }
      }
    };
    document.addEventListener('visibilitychange', this._onVisible);
    this.connect();
  }

  connect() {
    const wsUrl = getWsURL();
    this.ws = new WebSocket(`${wsUrl}/ws/group`);

    this.ws.onopen = () => {
      this.reconnectDelay = 1500; // reset backoff on successful connect
      this.ws.send(JSON.stringify({
        type: 'join',
        groupId: this.groupId,
        token: localStorage.getItem('auth_token') || '',
      }));
      // 心跳保活
      clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => {
        if (this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, 25_000);
    };

    this.ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      const h = this.handlers;
      switch (msg.type) {
        case 'joined':      h.onJoined?.(msg); break;
        case 'message':     h.onMessage?.(msg); break;
        case 'member_join': h.onMemberJoin?.(msg); break;
        case 'member_leave':h.onMemberLeave?.(msg); break;
        case 'ai_start':    h.onAiStart?.(msg); break;
        case 'ai_delta':    h.onAiDelta?.(msg); break;
        case 'ai_done':     h.onAiDone?.(msg); break;
        case 'ai_error':    h.onAiError?.(msg); break;
        case 'task_start':      h.onTaskStart?.(msg); break;
        case 'task_done':       h.onTaskDone?.(msg); break;
        case 'tool_call_start': h.onToolCallStart?.(msg); break;
        case 'tool_call_done':  h.onToolCallDone?.(msg); break;
        case 'tool_call_error': h.onToolCallError?.(msg); break;
        case 'error':               h.onError?.(msg.error); break;
        case 'active_bot_changed':  h.onActiveBotChanged?.(msg); break;
        case 'member_kicked':       h.onMemberKicked?.(msg); break;
        case 'member_warned':       h.onMemberWarned?.(msg); break;
        case 'member_muted':        h.onMemberMuted?.(msg); break;
        case 'member_unmuted':      h.onMemberUnmuted?.(msg); break;
        case 'discuss_start':       h.onDiscussStart?.(msg); break;
        case 'discuss_round_start': h.onDiscussRoundStart?.(msg); break;
        case 'discuss_delta_start': h.onDiscussDeltaStart?.(msg); break;
        case 'discuss_delta':       h.onDiscussDelta?.(msg); break;
        case 'discuss_delta_end':   h.onDiscussDeltaEnd?.(msg); break;
        case 'discuss_round_done':  h.onDiscussRoundDone?.(msg); break;
        case 'discuss_end':         h.onDiscussEnd?.(msg); break;
        case 'discuss_error':       h.onDiscussError?.(msg); break;
        case 'research_start':      h.onResearchStart?.(msg); break;
        case 'research_step':       h.onResearchStep?.(msg); break;
        case 'research_end':        h.onResearchEnd?.(msg); break;
        case 'research_error':      h.onResearchError?.(msg); break;
        case 'task_stopped':        h.onTaskStopped?.(msg); break;
        case 'freedom_start':         h.onFreedomStart?.(msg); break;
        case 'freedom_waiting_human': h.onFreedomWaitingHuman?.(msg); break;
        case 'freedom_human_replied': h.onFreedomHumanReplied?.(msg); break;
        case 'freedom_end':           h.onFreedomEnd?.(msg); break;
        case 'freedom_thinking':      h.onFreedomThinking?.(msg); break;
        case 'freedom_error':         h.onFreedomError?.(msg); break;
      }
    };

    this.ws.onerror = () => this.handlers.onError?.('连接异常');
    this.ws.onclose = () => {
      clearInterval(this.pingTimer);
      if (this.shouldReconnect) {
        // 指数退避重连：1.5s → 3s → 6s → 最大 15s
        this.reconnectTimer = setTimeout(() => {
          this.reconnectDelay = Math.min(this.reconnectDelay * 2, 15000);
          this.connect();
        }, this.reconnectDelay);
      }
    };
  }

  send(content) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'message', content }));
    }
  }

  close() {
    this.shouldReconnect = false;
    clearInterval(this.pingTimer);
    clearTimeout(this.reconnectTimer);
    document.removeEventListener('visibilitychange', this._onVisible);
    this.ws?.close();
  }
}
