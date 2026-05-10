// 优先级：用户在设置中配置的地址 > 构建时注入的地址 > 开发代理
function _getBaseURL() {
  const saved = JSON.parse(localStorage.getItem('ai_config') || '{}');
  if (saved.serverURL) return saved.serverURL.replace(/\/$/, '') + '/api';
  // VITE_API_URL 在构建时通过 .env 注入（移动端打包时设为正式服务器地址）
  if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL;
  if (import.meta.env.DEV) return '/api';
  return `${location.origin}/api`;
}

// 每次请求动态获取，确保用户在设置里改完地址后立即生效
export function getBaseURL() { return _getBaseURL(); }

export function getWsURL() {
  const base = _getBaseURL();
  // http -> ws, https -> wss
  return base.replace(/^http/, 'ws').replace(/\/api$/, '');
}

// 从 localStorage 读取运行时 AI 配置
function getAIHeaders() {
  const cfg = JSON.parse(localStorage.getItem('ai_config') || '{}');
  const headers = {};
  if (cfg.apiKey)  headers['x-ai-api-key']  = cfg.apiKey;
  if (cfg.baseURL) headers['x-ai-base-url'] = cfg.baseURL;
  if (cfg.model)   headers['x-ai-model']    = cfg.model;
  return headers;
}

function getAuthHeader() {
  const token = localStorage.getItem('auth_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request(path, options = {}) {
  const res = await fetch(`${_getBaseURL()}${path}`, {
    headers: { 'Content-Type': 'application/json', ...getAuthHeader(), ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || '请求失败');
  }
  return res.json();
}

// ---- Sessions ----
export const sessionsApi = {
  list: () => request('/sessions'),
  create: (title) => request('/sessions', { method: 'POST', body: JSON.stringify({ title }) }),
  get: (id) => request(`/sessions/${id}`),
  updateTitle: (id, title) => request(`/sessions/${id}`, { method: 'PATCH', body: JSON.stringify({ title }) }),
  delete: (id) => request(`/sessions/${id}`, { method: 'DELETE' }),
  clearMessages: (id) => request(`/sessions/${id}/messages`, { method: 'DELETE' }),
};

// ---- Chat (SSE 流式) ----
export function streamChat({ sessionId, message, systemPrompt, botId, onDelta, onDone, onError, onToolCallStart, onToolCallDone, onToolCallError }) {
  const controller = new AbortController();

  fetch(`${_getBaseURL()}/chat/${sessionId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeader(),
      ...getAIHeaders(),
    },
    body: JSON.stringify({ message, systemPrompt, botId }),
    signal: controller.signal,
  }).then(async (res) => {
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      onError?.(err.error || '请求失败');
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      let currentEvent = '';
      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.slice(7).trim();
        } else if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            if (currentEvent === 'delta')          onDelta?.(data.content);
            else if (currentEvent === 'done')       onDone?.(data);
            else if (currentEvent === 'error')      onError?.(data.message);
            else if (currentEvent === 'tool_call_start') onToolCallStart?.(data);
            else if (currentEvent === 'tool_call_done')  onToolCallDone?.(data);
            else if (currentEvent === 'tool_call_error') onToolCallError?.(data);
          } catch {}
        }
      }
    }
  }).catch((err) => {
    if (err.name !== 'AbortError') onError?.(err.message);
  });

  return () => controller.abort();
}

// ---- Config ----
export const configApi = {
  get: () => request('/config'),
};
