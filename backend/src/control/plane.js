import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';

const STARTED_AT = Date.now();
const EXTENSIONS_DIR = path.resolve(process.cwd(), 'backend/extensions');

function nowIso() {
  return new Date().toISOString();
}

function uid(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

function normalizeIncomingMessage(payload = {}) {
  const ts = Date.now();
  const channel = String(payload.channel || 'webchat').toLowerCase();
  const mode = ['main', 'group', 'isolated'].includes(payload.mode) ? payload.mode : 'main';
  const conversationId = String(payload.conversationId || payload.groupId || payload.sessionId || 'default');
  const userId = String(payload.userId || 'unknown');
  const nickname = String(payload.nickname || payload.username || 'unknown');
  const content = String(payload.content || '').trim();
  const metadata = payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {};

  return {
    id: payload.id ? String(payload.id) : uid('msg'),
    ts,
    tsIso: new Date(ts).toISOString(),
    channel,
    mode,
    conversationId,
    userId,
    nickname,
    content,
    metadata,
  };
}

function resolveSessionKey(msg) {
  if (msg.mode === 'group') return `group:${msg.conversationId}`;
  if (msg.mode === 'isolated') return `isolated:${msg.channel}:${msg.userId}:${msg.conversationId}`;
  return `main:${msg.channel}:${msg.userId}`;
}

function safeReadJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

class ControlPlane {
  constructor() {
    this.sessions = new Map(); // sessionKey -> { ... }
    this.lanes = new Map(); // laneKey -> laneState
    this.jobs = new Map(); // jobId -> job
    this.stats = {
      acceptedMessages: 0,
      normalizedMessages: 0,
      queuedJobs: 0,
      completedJobs: 0,
      failedJobs: 0,
      canceledJobs: 0,
    };
    this.plugins = [];
    this.reloadPlugins();
  }

  ensureLane(laneKey) {
    if (!this.lanes.has(laneKey)) {
      this.lanes.set(laneKey, {
        laneKey,
        queue: [],
        runningJobId: null,
        processed: 0,
        failed: 0,
        canceled: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
    return this.lanes.get(laneKey);
  }

  ensureSession(sessionKey, seed) {
    if (!this.sessions.has(sessionKey)) {
      this.sessions.set(sessionKey, {
        sessionKey,
        mode: seed.mode,
        channel: seed.channel,
        conversationId: seed.conversationId,
        userId: seed.userId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messageCount: 0,
        lastMessagePreview: '',
      });
    }
    return this.sessions.get(sessionKey);
  }

  acceptIncomingMessage(payload) {
    this.stats.acceptedMessages += 1;
    const msg = normalizeIncomingMessage(payload);
    if (!msg.content) throw new Error('消息内容不能为空');
    this.stats.normalizedMessages += 1;

    const sessionKey = resolveSessionKey(msg);
    const laneKey = `${msg.channel}:${msg.mode}:${msg.conversationId}`;
    const session = this.ensureSession(sessionKey, msg);
    session.updatedAt = Date.now();
    session.messageCount += 1;
    session.lastMessagePreview = msg.content.slice(0, 120);

    const job = {
      id: uid('job'),
      type: 'message',
      sessionKey,
      laneKey,
      message: msg,
      status: 'queued',
      enqueuedAt: Date.now(),
      startedAt: null,
      completedAt: null,
      result: null,
      error: null,
    };

    const lane = this.ensureLane(laneKey);
    lane.queue.push(job.id);
    lane.updatedAt = Date.now();
    this.jobs.set(job.id, job);
    this.stats.queuedJobs += 1;

    this.processLane(laneKey).catch(() => {});
    return { job, session };
  }

  async processLane(laneKey) {
    const lane = this.ensureLane(laneKey);
    if (lane.runningJobId) return;

    const nextJobId = lane.queue[0];
    if (!nextJobId) return;

    const job = this.jobs.get(nextJobId);
    if (!job || job.status !== 'queued') {
      lane.queue.shift();
      lane.updatedAt = Date.now();
      return this.processLane(laneKey);
    }

    lane.runningJobId = job.id;
    lane.updatedAt = Date.now();
    job.status = 'running';
    job.startedAt = Date.now();

    try {
      // MVP runner: 控制平面阶段先做可观测的调度闭环，后续可挂真实 Agent Runtime。
      await new Promise((resolve) => setTimeout(resolve, 450));
      job.status = 'done';
      job.completedAt = Date.now();
      job.result = {
        status: 'accepted',
        route: {
          sessionKey: job.sessionKey,
          laneKey: job.laneKey,
        },
        echo: {
          channel: job.message.channel,
          nickname: job.message.nickname,
          content: job.message.content,
        },
      };
      this.stats.completedJobs += 1;
      lane.processed += 1;
    } catch (err) {
      job.status = 'failed';
      job.completedAt = Date.now();
      job.error = err?.message || 'unknown error';
      this.stats.failedJobs += 1;
      lane.failed += 1;
    } finally {
      lane.queue.shift();
      lane.runningJobId = null;
      lane.updatedAt = Date.now();
      this.processLane(laneKey).catch(() => {});
    }
  }

  cancelJob(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) return { ok: false, error: '任务不存在' };
    if (job.status === 'done' || job.status === 'failed' || job.status === 'canceled') {
      return { ok: false, error: `任务当前状态为 ${job.status}，无法取消` };
    }

    if (job.status === 'queued') {
      const lane = this.ensureLane(job.laneKey);
      lane.queue = lane.queue.filter((id) => id !== job.id);
      lane.canceled += 1;
      lane.updatedAt = Date.now();
      job.status = 'canceled';
      job.completedAt = Date.now();
      this.stats.canceledJobs += 1;
      return { ok: true, job };
    }

    return { ok: false, error: '运行中任务暂不支持强制中断（将由后续版本接入 AbortController）' };
  }

  reloadPlugins() {
    const next = [];
    if (existsSync(EXTENSIONS_DIR)) {
      const names = readdirSync(EXTENSIONS_DIR);
      for (const name of names) {
        const full = path.join(EXTENSIONS_DIR, name);
        let st;
        try { st = statSync(full); } catch { continue; }
        if (!st.isDirectory()) continue;

        const manifestPath = path.join(full, 'plugin.json');
        const manifest = existsSync(manifestPath) ? safeReadJson(manifestPath) : null;
        next.push({
          id: manifest?.id || name,
          name: manifest?.name || name,
          version: manifest?.version || '0.0.0',
          description: manifest?.description || '',
          entry: manifest?.entry || 'index.js',
          enabled: manifest?.enabled !== false,
          path: full,
          loadedAt: nowIso(),
        });
      }
    }
    this.plugins = next;
    return this.plugins;
  }

  getOverview() {
    const laneEntries = [...this.lanes.values()];
    const running = laneEntries.filter((l) => !!l.runningJobId).length;
    const queued = laneEntries.reduce((acc, l) => acc + l.queue.length, 0);
    return {
      controlPlane: {
        startedAt: STARTED_AT,
        uptimeMs: Date.now() - STARTED_AT,
        wsEndpoint: 'ws://127.0.0.1:18789',
        uiPort: 18789,
        canvasPort: 18793,
      },
      health: {
        status: 'ok',
        runningLanes: running,
        queuedJobs: queued,
        sessionCount: this.sessions.size,
        pluginCount: this.plugins.length,
      },
      stats: this.stats,
      adapters: {
        supportedChannels: ['webchat', 'telegram', 'discord', 'slack', 'whatsapp', 'matrix'],
      },
      sessions: {
        total: this.sessions.size,
        recent: [...this.sessions.values()]
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .slice(0, 10),
      },
      lanes: laneEntries
        .map((l) => ({
          laneKey: l.laneKey,
          queueDepth: l.queue.length,
          runningJobId: l.runningJobId,
          processed: l.processed,
          failed: l.failed,
          canceled: l.canceled,
          updatedAt: l.updatedAt,
        }))
        .sort((a, b) => b.updatedAt - a.updatedAt),
      jobs: [...this.jobs.values()]
        .sort((a, b) => (b.enqueuedAt || 0) - (a.enqueuedAt || 0))
        .slice(0, 30),
      plugins: this.plugins,
    };
  }

  listLanes() {
    return [...this.lanes.values()].map((l) => ({
      laneKey: l.laneKey,
      queue: [...l.queue],
      runningJobId: l.runningJobId,
      processed: l.processed,
      failed: l.failed,
      canceled: l.canceled,
      updatedAt: l.updatedAt,
    }));
  }

  listPlugins() {
    return this.plugins;
  }
}

export const controlPlane = new ControlPlane();

