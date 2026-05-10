import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { groupsDb } from '../db/groups.js';
import { usersDb } from '../db/users.js';
import { skillsDb } from '../db/skills.js';
import { verifyToken } from '../middleware/auth.js';
import { executeSkill } from './skillExecutor.js';
import { runDiscussion } from './discussionRunner.js';
import { runResearch } from './researchRunner.js';
import { runFreedom } from './freedomRunner.js';
import { createAIClient } from '../ai/client.js';

// groupId -> Set<ws客户端>
const rooms = new Map();

// groupId -> AbortController（当前运行中的操作）
const activeControllers = new Map();

// groupId -> { resolve } — freedom 模式等待人类回复
const humanMessageResolvers = new Map();

// 正在运行 freedom 模式的群组
const freedomGroups = new Set();

// groupId -> string[] — 人类在 freedom 模式中发的消息队列，供 runner 注入 history
const freedomHumanQueues = new Map();

// 自然语言停止意图检测
const STOP_INTENT_PATTERNS = [
  /就到这(里|儿)?/, /不聊了/, /停[下止]?[吧了]?/, /结束[吧了]?/,
  /够了/, /散了?/, /到此为止/, /先这样/, /就这样吧?/, /行了行了/,
  /好了好了/, /别聊了/, /暂停/, /先停/, /可以停/, /停一下/,
];

function isStopIntent(text) {
  return STOP_INTENT_PATTERNS.some(p => p.test(text));
}

function waitForHumanMessage(groupId, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) { resolve(null); return; }

    const timeout = setTimeout(() => {
      if (humanMessageResolvers.get(groupId)?.resolve === resolve) {
        humanMessageResolvers.delete(groupId);
      }
      resolve(null); // 60s 超时，继续聊
    }, 60_000);

    humanMessageResolvers.set(groupId, {
      resolve: (msg) => { clearTimeout(timeout); resolve(msg); },
    });

    signal?.addEventListener('abort', () => {
      clearTimeout(timeout);
      humanMessageResolvers.delete(groupId);
      resolve(null);
    }, { once: true });
  });
}

function cancelGroupOperation(groupId) {
  const ctrl = activeControllers.get(groupId);
  if (ctrl) {
    ctrl.abort();
    activeControllers.delete(groupId);
    return true;
  }
  return false;
}

function createGroupController(groupId) {
  cancelGroupOperation(groupId);
  const ctrl = new AbortController();
  activeControllers.set(groupId, ctrl);
  // 不做固定时长自动清理：
  // 长会话（尤其 /freedom）可能超过 5 分钟，若提前删掉 controller，
  // 后续 /stop 或自然语言停止将无法 abort 正在运行的任务。
  // controller 由 cancelGroupOperation() 和各 runner finally 负责释放。
  return ctrl;
}

// 发送给房间内所有客户端
function broadcast(groupId, payload, excludeWs = null) {
  const clients = rooms.get(groupId);
  if (!clients) return;
  const msg = JSON.stringify(payload);
  for (const client of clients) {
    if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  }
}

// 累积 tool_calls（streaming 时分多个 chunk 传来）
function accumulateToolCalls(acc, deltas) {
  for (const delta of deltas) {
    const idx = delta.index ?? 0;
    if (!acc[idx]) {
      acc[idx] = { id: delta.id || '', type: 'function', function: { name: '', arguments: '' } };
    }
    if (delta.id) acc[idx].id = delta.id;
    if (delta.function?.name) acc[idx].function.name += delta.function.name;
    if (delta.function?.arguments) acc[idx].function.arguments += delta.function.arguments;
  }
}

// AI 回复（流式广播），支持 Function Calling
async function aiReply(groupId, group, triggerNickname, bot = null) {
  const apiKey  = bot?.api_key  || process.env.API_KEY || '';
  const baseURL = bot?.base_url || process.env.BASE_URL || 'https://token-plan-cn.xiaomimimo.com/anthropic';
  const model   = bot?.model    || process.env.MODEL   || 'mimo-v2.5-pro';
  const botId   = bot?.id   || 'ai';
  const botName = bot?.name || 'AI';
  const botColor= bot?.color|| '#7c3aed';

  if (!apiKey) return;

  const client = createAIClient(apiKey, baseURL);
  const history = groupsDb.getRecentMessages(groupId, 20);

  const defaultPrompt = `你是群聊助手"${botName}"，正在参与名为"${group.name}"的群聊。请用简洁友好的方式回复。`;
  const sysPrompt = bot?.system_prompt || group.system_prompt || defaultPrompt;

  // 获取 Agent 绑定的技能，构建 tools[]
  const skills = bot ? skillsDb.getAgentSkills(bot.id) : [];
  const tools = skills.length > 0 ? skills.map(s => ({
    type: 'function',
    function: {
      name: s.key,
      description: s.description,
      parameters: JSON.parse(s.parameters || '{"type":"object","properties":{}}'),
    },
  })) : undefined;

  // 将技能能力注入 system prompt，生成强制调用规则
  let finalSysPrompt = sysPrompt;
  if (skills?.length) {
    const TYPE_TRIGGER = {
      file_list:        '当用户要求列出目录、查看文件列表、显示目录结构时',
      file_read:        '当用户要求读取、查看、显示文件内容时',
      file_write:       '当用户要求写入、创建、追加、修改文件时',
      database_query:   '当用户要求查询数据库、查看数据、SELECT 时',
      database_write:   '当用户要求写入、插入、更新、删除数据库数据时',
      websearch:        '当用户要求搜索、查询实时信息、最新资讯、网络内容时',
      http:             '当用户需要调用外部接口、获取第三方数据时',
      builtin_datetime: '当用户询问当前时间、日期、星期时',
      builtin_calculator: '当用户要求计算数学表达式时',
      builtin_random:   '当用户要求生成随机数、随机选择时',
    };
    const rules = skills.map(s => {
      const trigger = TYPE_TRIGGER[s.type] || `当请求符合以下描述时：${s.description}`;
      return `- 调用 \`${s.key}\`：${trigger}`;
    }).join('\n');
    finalSysPrompt += `\n\n## 工具调用规则（必须严格遵守）\n以下场景你必须调用对应工具，禁止凭空编造或用训练知识替代：\n${rules}\n\n⚠️ 凡涉及文件操作、数据库操作、实时数据，即使你"认为知道答案"，也必须先调用工具再回答。`;
  }

  const messages = [{ role: 'system', content: finalSysPrompt }];
  history.forEach(m => {
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    messages.push({
      role,
      content: role === 'user' ? `${m.nickname}: ${m.content}` : m.content,
    });
  });

  const msgId = uuidv4();
  let fullContent = '';

  broadcast(groupId, { type: 'ai_start', msgId, botId, botName, botColor });

  try {
    // 第一次流式调用
    const stream1 = await client.chat.completions.create({
      model, messages, stream: true, ...(tools ? { tools, tool_choice: 'auto' } : {}),
    });

    const toolCallsAcc = [];
    for await (const chunk of stream1) {
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;
      if (delta.tool_calls?.length) {
        accumulateToolCalls(toolCallsAcc, delta.tool_calls);
      } else if (delta.content) {
        fullContent += delta.content;
        broadcast(groupId, { type: 'ai_delta', msgId, botId, delta: delta.content });
      }
    }

    // 执行 tool_calls（若有）
    if (toolCallsAcc.length > 0) {
      const toolResults = [];
      for (const tc of toolCallsAcc) {
        const toolCallId = tc.id || uuidv4();
        const toolName = tc.function.name;
        broadcast(groupId, { type: 'tool_call_start', botId, botName, toolName, toolCallId });
        try {
          let args = {};
          try { args = JSON.parse(tc.function.arguments || '{}'); } catch {}
          const skill = skillsDb.getByKey(toolName);
          if (!skill) throw new Error(`技能 "${toolName}" 不存在`);
          const moderationCtx = skill.type?.startsWith('moderation_')
            ? { groupId, botId, botName, groupsDb, broadcast, uuidv4 }
            : null;
          const result = await executeSkill(skill, args, moderationCtx);
          const truncated = String(result).slice(0, 1000);
          broadcast(groupId, { type: 'tool_call_done', botId, toolName, toolCallId, result: truncated });
          toolResults.push({ role: 'tool', tool_call_id: toolCallId, content: truncated });
        } catch (err) {
          broadcast(groupId, { type: 'tool_call_error', botId, toolName, toolCallId, error: err.message });
          toolResults.push({ role: 'tool', tool_call_id: toolCallId, content: `错误: ${err.message}` });
        }
      }

      // 第二次流式调用（携带工具结果）
      const messages2 = [
        ...messages,
        { role: 'assistant', tool_calls: toolCallsAcc },
        ...toolResults,
      ];
      const stream2 = await client.chat.completions.create({
        model, messages: messages2, stream: true,
      });
      for await (const chunk of stream2) {
        const delta = chunk.choices[0]?.delta?.content || '';
        if (delta) {
          fullContent += delta;
          broadcast(groupId, { type: 'ai_delta', msgId, botId, delta });
        }
      }
    }

    const trimmed = fullContent.trim();
    if (trimmed) {
      groupsDb.addMessage(msgId, groupId, botId, botName, 'assistant', trimmed);
      broadcast(groupId, { type: 'ai_done', msgId, botId, botName, botColor, content: trimmed });
    } else {
      broadcast(groupId, { type: 'ai_error', msgId, botId });
    }
  } catch (err) {
    broadcast(groupId, { type: 'ai_error', msgId, botId, error: err.message });
  }
}

// 多智能体流水线：各 Bot 依次处理任务
async function runMultiAgentPipeline(groupId, group, taskDesc, bots, signal) {
  if (bots.length === 0) {
    broadcast(groupId, { type: 'task_error', error: '该群尚未配置 Bot，请先在群设置中添加 Bot' });
    return;
  }
  broadcast(groupId, { type: 'task_start', taskDesc, botCount: bots.length });

  for (const bot of bots) {
    if (signal?.aborted) break;
    await aiReply(groupId, group, 'system', bot);
    await new Promise(r => setTimeout(r, 600));
  }

  broadcast(groupId, { type: 'task_done' });
}

// 技能匹配：分析消息内容 vs 各 Bot 技能描述，返回最匹配的 Bot
function skillMatchBot(content, groupBots) {
  const lower = content.toLowerCase();
  let bestBot = null, bestScore = 0;
  for (const bot of groupBots) {
    const skills = skillsDb.getAgentSkills(bot.id);
    if (!skills.length) continue;
    let score = 0;
    for (const skill of skills) {
      if (lower.includes(skill.name.toLowerCase())) score += 3;
      const words = skill.description.replace(/[，。！？,!?、]/g, ' ').split(/\s+/).filter(w => w.length >= 2);
      for (const w of words) { if (lower.includes(w.toLowerCase())) score += 1; }
    }
    if (score > bestScore) { bestScore = score; bestBot = bot; }
  }
  return bestScore >= 2 ? bestBot : null;
}

// AI 自动回复防抖（60秒无人发言触发）
const autoReplyTimers = new Map();

function scheduleAutoReply(groupId, group) {
  if (!group.ai_auto_reply) return;
  clearTimeout(autoReplyTimers.get(groupId));
  const timer = setTimeout(() => {
    const clients = rooms.get(groupId);
    if (clients && clients.size > 0) {
      // 自动回复用默认 AI
      aiReply(groupId, group, null, null);
    }
  }, 60_000);
  autoReplyTimers.set(groupId, timer);
}

export function setupGroupWebSocket(server) {
  const wss = new WebSocketServer({ server, path: '/ws/group' });

  wss.on('connection', (ws) => {
    let currentGroupId = null;
    let currentUser = null;

    ws.on('message', async (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      switch (msg.type) {
        case 'join': {
          const { groupId, token } = msg;

          // 验证 token
          let userId, nickname;
          try {
            const payload = verifyToken(token);
            userId = payload.userId;
            const user = usersDb.getById(userId);
            if (!user) throw new Error('用户不存在');
            nickname = user.nickname || user.username;
          } catch {
            ws.send(JSON.stringify({ type: 'error', error: '未登录或 Token 无效' })); return;
          }

          const group = groupsDb.get(groupId);
          if (!group) { ws.send(JSON.stringify({ type: 'error', error: '群不存在' })); return; }
          if (!groupsDb.isMember(groupId, userId)) {
            ws.send(JSON.stringify({ type: 'error', error: '您不是该群成员' })); return;
          }

          currentGroupId = groupId;
          currentUser = { userId, nickname };

          if (!rooms.has(groupId)) rooms.set(groupId, new Set());
          rooms.get(groupId).add(ws);

          broadcast(groupId, { type: 'member_join', userId, nickname }, ws);

          const onlineUsers = [...rooms.get(groupId)]
            .filter(c => c.readyState === WebSocket.OPEN && c._user)
            .map(c => c._user);
          ws._user = currentUser;

          ws.send(JSON.stringify({
            type: 'joined',
            group,
            messages: groupsDb.getMessages(groupId, 100),
            onlineUsers: [...onlineUsers, currentUser],
          }));
          break;
        }

        case 'message': {
          if (!currentGroupId || !currentUser) return;
          const { content } = msg;
          if (!content?.trim()) return;

          // 禁言检查
          const senderRole = groupsDb.getMemberRole(currentGroupId, currentUser.userId);
          if (senderRole === 'muted') {
            ws.send(JSON.stringify({ type: 'error', error: '你已被禁言，无法发送消息' }));
            return;
          }

          const group = groupsDb.get(currentGroupId);
          const msgId = uuidv4();

          groupsDb.addMessage(msgId, currentGroupId, currentUser.userId,
            currentUser.nickname, 'user', content);
          broadcast(currentGroupId, {
            type: 'message',
            id: msgId,
            userId: currentUser.userId,
            nickname: currentUser.nickname,
            content,
            created_at: Date.now(),
          });

          // 0a. /stop 命令（最高优先级，任何情况下都响应）
          if (content.trim() === '/stop') {
            const resolver = humanMessageResolvers.get(currentGroupId);
            if (resolver) { humanMessageResolvers.delete(currentGroupId); resolver.resolve(null); }
            const stopped = cancelGroupOperation(currentGroupId);
            // 立刻从 freedomGroups 移除，不等待异步 finally，保证用户可以立即重开
            freedomGroups.delete(currentGroupId);
            freedomHumanQueues.delete(currentGroupId);
            broadcast(currentGroupId, {
              type: 'task_stopped',
              message: stopped ? '✋ 操作已被停止' : '当前没有运行中的操作',
              operatorNickname: currentUser.nickname,
            });
            break;
          }

          // 0a.1 自然语言停止（对所有运行中的操作生效，不仅限 freedom）
          if (activeControllers.has(currentGroupId) && isStopIntent(content)) {
            const resolver = humanMessageResolvers.get(currentGroupId);
            if (resolver) { humanMessageResolvers.delete(currentGroupId); resolver.resolve(null); }
            const stopped = cancelGroupOperation(currentGroupId);
            freedomGroups.delete(currentGroupId);
            freedomHumanQueues.delete(currentGroupId);
            broadcast(currentGroupId, {
              type: 'task_stopped',
              message: stopped ? '✋ 操作已被停止' : '当前没有运行中的操作',
              operatorNickname: currentUser.nickname,
            });
            break;
          }

          // 0b. Freedom 模式：拦截所有消息（自然语言停止 / 注入人类回复 / 不触发普通路由）
          if (freedomGroups.has(currentGroupId)) {
            if (isStopIntent(content)) {
              // 自然语言停止 — 同样立刻解除 freedom 拦截
              cancelGroupOperation(currentGroupId);
              freedomGroups.delete(currentGroupId);
              freedomHumanQueues.delete(currentGroupId);
              broadcast(currentGroupId, {
                type: 'task_stopped',
                message: '✋ 聊天已停止',
                operatorNickname: currentUser.nickname,
              });
            } else {
              // 把用户消息注入队列，下一个 bot 说话前会读取并放入 history
              if (!freedomHumanQueues.has(currentGroupId)) {
                freedomHumanQueues.set(currentGroupId, []);
              }
              freedomHumanQueues.get(currentGroupId).push(
                `[${currentUser.nickname}（用户）]: ${content}`
              );
            }
            // 无论如何，freedom 模式下都不走普通 Bot 路由
            break;
          }

          // 1a. /research 命令：深度研究
          if (content.startsWith('/research ')) {
            const topic = content.slice(10).trim();
            if (topic) {
              clearTimeout(autoReplyTimers.get(currentGroupId));
              const groupBots = groupsDb.getGroupBots(currentGroupId);
              const ctrl = createGroupController(currentGroupId);
              // 构建服务器 base URL（用于生成 MD 文件下载链接）
              const serverBaseUrl = process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`;
              runResearch(currentGroupId, group, topic, groupBots, broadcast, ctrl.signal, serverBaseUrl)
                .catch(console.error)
                .finally(() => {
                  if (activeControllers.get(currentGroupId) === ctrl) activeControllers.delete(currentGroupId);
                });
            }
            break;
          }

          // 1b. /discuss 命令：多智能体自主讨论（无限制，直到 /stop 或 conclude）
          if (content.startsWith('/discuss ')) {
            const topic = content.slice(9).trim();
            if (topic) {
              clearTimeout(autoReplyTimers.get(currentGroupId));
              const groupBots = groupsDb.getGroupBots(currentGroupId);
              const ctrl = createGroupController(currentGroupId);
              runDiscussion(currentGroupId, group, topic, groupBots, broadcast, ctrl.signal)
                .catch(console.error)
                .finally(() => {
                  if (activeControllers.get(currentGroupId) === ctrl) activeControllers.delete(currentGroupId);
                });
            }
            break;
          }

          // 1c. /freedom [context] 命令：自由群聊模式
          if (content.startsWith('/freedom')) {
            const context = content.slice('/freedom'.length).trim();
            clearTimeout(autoReplyTimers.get(currentGroupId));
            const groupBots = groupsDb.getGroupBots(currentGroupId);
            if (groupBots.length === 0) {
              broadcast(currentGroupId, { type: 'error', error: '请先在群设置中添加 Bot' });
              break;
            }
            const ctrl = createGroupController(currentGroupId);
            freedomGroups.add(currentGroupId);
            freedomHumanQueues.set(currentGroupId, []);
            runFreedom(
              currentGroupId, group, context, groupBots, broadcast,
              ctrl.signal,
              () => {
                const q = freedomHumanQueues.get(currentGroupId) || [];
                freedomHumanQueues.set(currentGroupId, []);
                return q;
              }
            ).catch(console.error)
              .finally(() => {
                freedomGroups.delete(currentGroupId);
                freedomHumanQueues.delete(currentGroupId);
                humanMessageResolvers.delete(currentGroupId);
                if (activeControllers.get(currentGroupId) === ctrl) activeControllers.delete(currentGroupId);
              });
            break;
          }

          // 1d. /task 命令：多智能体流水线
          if (content.startsWith('/task ')) {
            const taskDesc = content.slice(6).trim();
            if (taskDesc) {
              clearTimeout(autoReplyTimers.get(currentGroupId));
              const groupBots = groupsDb.getGroupBots(currentGroupId);
              const ctrl = createGroupController(currentGroupId);
              runMultiAgentPipeline(currentGroupId, group, taskDesc, groupBots, ctrl.signal)
                .catch(console.error)
                .finally(() => {
                  if (activeControllers.get(currentGroupId) === ctrl) activeControllers.delete(currentGroupId);
                });
            }
            break;
          }

          const groupBots = groupsDb.getGroupBots(currentGroupId);

          // 2. 显式 @BotName → 激活并路由
          const mentionedBot = groupBots.find(b =>
            content.includes(`@${b.name}`) ||
            content.toLowerCase().includes(`@${b.name.toLowerCase()}`)
          );
          if (mentionedBot) {
            clearTimeout(autoReplyTimers.get(currentGroupId));
            groupsDb.setActiveBot(currentGroupId, mentionedBot.id);
            broadcast(currentGroupId, {
              type: 'active_bot_changed',
              botId: mentionedBot.id,
              botName: mentionedBot.name,
              botColor: mentionedBot.color,
            });
            await aiReply(currentGroupId, group, currentUser.nickname, mentionedBot);
            break;
          }

          // 读取最新 group（含 active_bot_id）
          const freshGroup = groupsDb.get(currentGroupId);

          // 3. 群激活 Bot → 直接路由（无需 @）
          if (freshGroup.active_bot_id) {
            const activeBot = groupBots.find(b => b.id === freshGroup.active_bot_id);
            if (activeBot) {
              clearTimeout(autoReplyTimers.get(currentGroupId));
              await aiReply(currentGroupId, freshGroup, currentUser.nickname, activeBot);
              break;
            }
          }

          // 4. 技能包动态匹配兜底
          const matchedBot = skillMatchBot(content, groupBots);
          if (matchedBot) {
            clearTimeout(autoReplyTimers.get(currentGroupId));
            await aiReply(currentGroupId, freshGroup, currentUser.nickname, matchedBot);
            break;
          }

          // 5. @AI 全局兜底
          if (content.includes('@AI') || content.includes('@ai')) {
            clearTimeout(autoReplyTimers.get(currentGroupId));
            await aiReply(currentGroupId, freshGroup, currentUser.nickname, null);
            break;
          }

          // 6. 定时自动回复
          scheduleAutoReply(currentGroupId, freshGroup);
          break;
        }

        case 'ping':
          ws.send(JSON.stringify({ type: 'pong' }));
          break;
      }
    });

    ws.on('close', () => {
      if (!currentGroupId || !currentUser) return;
      const clients = rooms.get(currentGroupId);
      if (clients) {
        clients.delete(ws);
        if (clients.size === 0) rooms.delete(currentGroupId);
      }
      broadcast(currentGroupId, {
        type: 'member_leave',
        userId: currentUser.userId,
        nickname: currentUser.nickname,
      });
    });

    ws.on('error', () => ws.terminate());
  });

  return wss;
}
