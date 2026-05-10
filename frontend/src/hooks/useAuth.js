import { useState, useEffect, useCallback } from 'react';
import { getBaseURL } from '../services/api.js';

function getToken() { return localStorage.getItem('auth_token'); }
function setToken(t) { localStorage.setItem('auth_token', t); }
function clearToken() { localStorage.removeItem('auth_token'); localStorage.removeItem('auth_user'); }

export function getStoredUser() {
  try { return JSON.parse(localStorage.getItem('auth_user') || 'null'); } catch { return null; }
}

async function apiFetch(path, options = {}) {
  const token = getToken();
  const res = await fetch(`${getBaseURL()}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...options,
  });
  return res.json();
}

export function useAuth() {
  const [user, setUser] = useState(getStoredUser);
  const [loading, setLoading] = useState(!getStoredUser());

  // 启动时验证 token
  useEffect(() => {
    if (!getToken()) { setLoading(false); return; }
    apiFetch('/auth/me').then(res => {
      if (res.data) {
        setUser(res.data);
        localStorage.setItem('auth_user', JSON.stringify(res.data));
      } else {
        clearToken();
        setUser(null);
      }
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (username, password) => {
    const res = await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    if (res.data) {
      setToken(res.data.token);
      setUser(res.data.user);
      localStorage.setItem('auth_user', JSON.stringify(res.data.user));
      return { ok: true };
    }
    return { ok: false, error: res.error || '登录失败' };
  }, []);

  const register = useCallback(async (username, password, nickname) => {
    const res = await apiFetch('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password, nickname }),
    });
    if (res.data) {
      setToken(res.data.token);
      setUser(res.data.user);
      localStorage.setItem('auth_user', JSON.stringify(res.data.user));
      return { ok: true };
    }
    return { ok: false, error: res.error || '注册失败' };
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setUser(null);
  }, []);

  return { user, loading, login, register, logout };
}
