import { evaluate } from 'mathjs';
import { readFileSync, writeFileSync, appendFileSync, readdirSync, statSync, existsSync } from 'fs';
import { resolve } from 'path';

// Substitute {{param}} placeholders in a string
function substitute(template, args) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => args[k] !== undefined ? args[k] : '');
}

async function runWebSearch(config, query) {
  const provider = config.provider || 'serper';
  const apiKey = config.api_key;
  if (!apiKey) throw new Error('缺少 API Key');

  if (provider === 'serper') {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, num: 5 }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || '搜索失败');
    const results = (data.organic || []).slice(0, 3);
    return results.map((r, i) => `${i + 1}. ${r.title}\n${r.snippet}\n${r.link}`).join('\n\n');
  }

  if (provider === 'tavily') {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: apiKey, query, max_results: 3 }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || '搜索失败');
    const results = (data.results || []).slice(0, 3);
    return results.map((r, i) => `${i + 1}. ${r.title}\n${r.content?.slice(0, 200)}\n${r.url}`).join('\n\n');
  }

  throw new Error(`不支持的搜索提供商: ${provider}`);
}

async function runHttpSkill(config, args) {
  const url = substitute(config.url || '', args);
  const method = (config.method || 'GET').toUpperCase();

  const headers = {};
  for (const [k, v] of Object.entries(config.headers || {})) {
    headers[substitute(k, args)] = substitute(String(v), args);
  }
  if (!headers['Content-Type'] && method !== 'GET') {
    headers['Content-Type'] = 'application/json';
  }

  const options = { method, headers };
  if (method !== 'GET' && config.body_template) {
    options.body = substitute(config.body_template, args);
  }

  const res = await fetch(url, options);
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);

  // Try to parse JSON for cleaner output
  try {
    const json = JSON.parse(text);
    return JSON.stringify(json, null, 2).slice(0, 2000);
  } catch {
    return text.slice(0, 2000);
  }
}

// ── File Operations ─────────────────────────────────────────────────────────

function safeResolvePath(basePath, userPath) {
  const base = resolve(basePath);
  const full = resolve(base, userPath || '');
  if (!full.startsWith(base)) throw new Error('路径越权，不允许访问 base_path 以外的目录');
  return full;
}

function runFileRead(config, args) {
  const basePath = config.base_path;
  if (!basePath) throw new Error('未配置 base_path');
  const filePath = safeResolvePath(basePath, args.path || '');
  if (!existsSync(filePath)) throw new Error(`文件不存在: ${args.path}`);

  const stat = statSync(filePath);
  if (stat.isDirectory()) throw new Error('路径是目录，请指定文件');

  const raw = readFileSync(filePath, 'utf-8');
  const maxLines = Math.min(Number(args.max_lines) || 100, 500);
  const lines = raw.split('\n');
  const truncated = lines.length > maxLines;
  const content = lines.slice(0, maxLines).join('\n');
  return truncated
    ? `[显示前 ${maxLines} 行，共 ${lines.length} 行]\n${content}`
    : content.slice(0, 8000);
}

function runFileWrite(config, args) {
  const basePath = config.base_path;
  if (!basePath) throw new Error('未配置 base_path');
  const filePath = safeResolvePath(basePath, args.path || '');
  const content = args.content ?? '';
  const mode = config.mode || 'write';
  if (mode === 'append') {
    appendFileSync(filePath, content, 'utf-8');
  } else {
    writeFileSync(filePath, content, 'utf-8');
  }
  return `✅ 已${mode === 'append' ? '追加' : '写入'}: ${args.path}（${content.length} 字符）`;
}

function runFileList(config, args) {
  const basePath = config.base_path;
  if (!basePath) throw new Error('未配置 base_path');
  const dirPath = safeResolvePath(basePath, args.path || '');
  if (!existsSync(dirPath)) throw new Error(`路径不存在: ${args.path || basePath}`);

  const stat = statSync(dirPath);
  if (!stat.isFile && !stat.isDirectory()) throw new Error('路径无效');

  const entries = readdirSync(dirPath, { withFileTypes: true });
  const lines = entries.slice(0, 100).map(e => {
    const type = e.isDirectory() ? '📁' : '📄';
    return `${type} ${e.name}`;
  });
  const extra = entries.length > 100 ? `\n...共 ${entries.length} 项` : '';
  return lines.join('\n') + extra;
}

// ── Database Operations ──────────────────────────────────────────────────────

const BLOCKED_SQL = /^\s*(DROP|TRUNCATE|ALTER|CREATE|GRANT|REVOKE)\b/i;

async function runDatabaseQuery(config, args) {
  const sql = (args.sql || '').trim();
  if (!sql) throw new Error('SQL 不能为空');
  // Only allow read-only queries
  if (!/^\s*(SELECT|WITH|SHOW|DESCRIBE|EXPLAIN|PRAGMA)\b/i.test(sql)) {
    throw new Error('query 技能只允许 SELECT/SHOW/DESCRIBE 查询，写操作请使用 database_write 技能');
  }
  return runSql(config, sql);
}

async function runDatabaseWrite(config, args) {
  const sql = (args.sql || '').trim();
  if (!sql) throw new Error('SQL 不能为空');
  if (BLOCKED_SQL.test(sql)) throw new Error('不允许 DROP/TRUNCATE/ALTER/CREATE 等破坏性操作');
  return runSql(config, sql);
}

async function runSql(config, sql) {
  const dbType = (config.type || 'sqlite').toLowerCase();

  if (dbType === 'sqlite') {
    const { default: Database } = await import('better-sqlite3');
    const db = new Database(config.path || ':memory:', { readonly: sql.trim().toUpperCase().startsWith('SELECT') });
    try {
      const stmt = db.prepare(sql);
      if (stmt.reader) {
        const rows = stmt.all().slice(0, 50);
        if (rows.length === 0) return '查询结果为空';
        return JSON.stringify(rows, null, 2).slice(0, 4000);
      } else {
        const info = stmt.run();
        return `影响行数: ${info.changes}，最后插入 ID: ${info.lastInsertRowid}`;
      }
    } finally {
      db.close();
    }
  }

  if (dbType === 'mysql') {
    const { createConnection } = await import('mysql2/promise');
    const conn = await createConnection(config.connection || {});
    try {
      const [rows] = await conn.execute(sql);
      if (Array.isArray(rows)) {
        if (rows.length === 0) return '查询结果为空';
        return JSON.stringify(rows.slice(0, 50), null, 2).slice(0, 4000);
      }
      return `影响行数: ${rows.affectedRows}`;
    } finally {
      await conn.end();
    }
  }

  if (dbType === 'pg' || dbType === 'postgresql') {
    const { Client } = await import('pg');
    const client = new Client(config.connection || {});
    await client.connect();
    try {
      const result = await client.query(sql);
      if (result.rows?.length === 0) return '查询结果为空';
      if (result.rows) return JSON.stringify(result.rows.slice(0, 50), null, 2).slice(0, 4000);
      return `影响行数: ${result.rowCount}`;
    } finally {
      await client.end();
    }
  }

  throw new Error(`不支持的数据库类型: ${dbType}，支持 sqlite / mysql / pg`);
}

// ── Moderation Actions ───────────────────────────────────────────────────────
// ctx = { groupId, botId, botName, groupsDb, broadcast, uuidv4 }

async function runModeration(action, args, ctx) {
  if (!ctx?.groupId) throw new Error('仲裁技能需要群上下文，无法在测试模式中执行');
  const { groupId, botId, botName, groupsDb, broadcast, uuidv4 } = ctx;
  const targetUserId = args.target_user_id || args.user_id;
  const reason = args.reason || '违反群规';
  if (!targetUserId) throw new Error('缺少 target_user_id 参数');

  const members = groupsDb.getMembers(groupId);
  const target = members.find(m => m.user_id === targetUserId);
  if (!target) throw new Error(`用户 ${targetUserId} 不在本群`);

  // 不允许仲裁群主
  if (groupsDb.getMemberRole(groupId, targetUserId) === 'owner') {
    throw new Error('无法对群主执行仲裁操作');
  }

  const logId = uuidv4();
  groupsDb.addAuditLog(logId, groupId, botId, 'bot', action, targetUserId, target.nickname, reason);

  if (action === 'kick') {
    groupsDb.removeMember(groupId, targetUserId);
    broadcast(groupId, {
      type: 'member_kicked',
      userId: targetUserId,
      nickname: target.nickname,
      reason,
      operatorName: botName,
    });
    return `已将 ${target.nickname} 移出群聊。原因：${reason}`;
  }

  if (action === 'warn') {
    broadcast(groupId, {
      type: 'member_warned',
      userId: targetUserId,
      nickname: target.nickname,
      reason,
      operatorName: botName,
    });
    return `已警告 ${target.nickname}。原因：${reason}`;
  }

  if (action === 'mute') {
    groupsDb.setMemberRole(groupId, targetUserId, 'muted');
    broadcast(groupId, {
      type: 'member_muted',
      userId: targetUserId,
      nickname: target.nickname,
      reason,
      operatorName: botName,
    });
    return `已禁言 ${target.nickname}。原因：${reason}`;
  }

  if (action === 'unmute') {
    groupsDb.setMemberRole(groupId, targetUserId, 'member');
    broadcast(groupId, {
      type: 'member_unmuted',
      userId: targetUserId,
      nickname: target.nickname,
      operatorName: botName,
    });
    return `已解除 ${target.nickname} 的禁言`;
  }

  throw new Error(`未知仲裁动作: ${action}`);
}

// ── Main Dispatcher ──────────────────────────────────────────────────────────

export async function executeSkill(skill, args, ctx = null) {
  const config = typeof skill.config === 'string' ? JSON.parse(skill.config) : (skill.config || {});

  switch (skill.type) {
    case 'builtin_datetime':
      return new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

    case 'builtin_calculator': {
      const expr = args.expression;
      if (!expr) throw new Error('缺少 expression 参数');
      try {
        const result = evaluate(String(expr));
        return String(result);
      } catch (e) {
        throw new Error(`计算错误: ${e.message}`);
      }
    }

    case 'builtin_random': {
      const min = Number(args.min ?? 1);
      const max = Number(args.max ?? 100);
      if (isNaN(min) || isNaN(max) || min > max) throw new Error('参数无效');
      return String(Math.floor(Math.random() * (max - min + 1)) + min);
    }

    case 'websearch':
      return await runWebSearch(config, args.query || '');

    case 'http':
      return await runHttpSkill(config, args);

    case 'file_read':
      return runFileRead(config, args);

    case 'file_write':
      return runFileWrite(config, args);

    case 'file_list':
      return runFileList(config, args);

    case 'database_query':
      return await runDatabaseQuery(config, args);

    case 'database_write':
      return await runDatabaseWrite(config, args);

    case 'moderation_kick':
      return await runModeration('kick', args, ctx);
    case 'moderation_warn':
      return await runModeration('warn', args, ctx);
    case 'moderation_mute':
      return await runModeration('mute', args, ctx);
    case 'moderation_unmute':
      return await runModeration('unmute', args, ctx);

    // MCP StreamableHTTP 技能
    case 'mcp_http':
      return await runMcpHttp(skill, config, args);

    default:
      throw new Error(`未知技能类型: ${skill.type}`);
  }
}

// ── MCP StreamableHTTP ───────────────────────────────────────────────────────
// config: { url: "http://...", headers: {} }
// 协议：JSON-RPC 2.0，调用 tools/call
async function runMcpHttp(skill, config, args) {
  const url = config.url;
  if (!url) throw new Error('MCP 技能未配置 url');

  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
    ...(config.headers || {}),
  };

  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: Date.now(),
    method: 'tools/call',
    params: {
      name: skill.key,
      arguments: args,
    },
  });

  const res = await fetch(url, { method: 'POST', headers, body });
  const contentType = res.headers.get('content-type') || '';

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`MCP 服务返回 ${res.status}: ${errText.slice(0, 200)}`);
  }

  // 处理 SSE 流式响应（StreamableHTTP transport）
  if (contentType.includes('text/event-stream')) {
    const text = await res.text();
    const results = [];
    for (const line of text.split('\n')) {
      if (line.startsWith('data: ')) {
        try {
          const data = JSON.parse(line.slice(6));
          if (data.result?.content) {
            for (const item of data.result.content) {
              if (item.type === 'text') results.push(item.text);
            }
          }
        } catch {}
      }
    }
    return results.join('\n') || '（MCP 返回为空）';
  }

  // 普通 JSON 响应
  const data = await res.json();
  if (data.error) throw new Error(`MCP 错误: ${data.error.message || JSON.stringify(data.error)}`);
  if (data.result?.content) {
    const texts = data.result.content
      .filter(c => c.type === 'text')
      .map(c => c.text);
    return texts.join('\n') || '（MCP 返回为空）';
  }
  return JSON.stringify(data.result || data, null, 2).slice(0, 2000);
}
