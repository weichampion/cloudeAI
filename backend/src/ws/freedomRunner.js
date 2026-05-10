import { v4 as uuidv4 } from 'uuid';
import { createAIClient } from '../ai/client.js';

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function detectBotMention(text, bots) {
  for (const bot of bots) {
    if (new RegExp(`@${escapeRegex(bot.name)}`, 'i').test(text)) return bot;
  }
  return null;
}

// Abort-aware sleep — cancels immediately when signal fires
function sleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) { resolve(); return; }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}

// 模拟真实群聊停顿：分三档随机
//  65% → 普通回复  2–5s
//  25% → 思考一下  6–12s
//  10% → 去忙了一会  14–28s
function naturalDelay(signal, quick = false) {
  if (quick) {
    // 被直接 @，反应更快
    const ms = 1500 + Math.random() * 2500; // 1.5–4s
    return sleep(ms, signal);
  }
  const r = Math.random();
  let ms;
  if (r < 0.65) {
    ms = 2000 + Math.random() * 3000;   // 2–5s
  } else if (r < 0.90) {
    ms = 6000 + Math.random() * 6000;   // 6–12s
  } else {
    ms = 14000 + Math.random() * 14000; // 14–28s
  }
  return sleep(ms, signal);
}

async function botSpeak(bot, history, bots, context, broadcast, groupId, signal) {
  const apiKey  = bot.api_key  || process.env.API_KEY  || '';
  const baseURL = bot.base_url || process.env.BASE_URL  || 'https://token-plan-cn.xiaomimimo.com/anthropic';
  const model   = bot.model    || process.env.MODEL     || 'mimo-v2.5-pro';
  const color   = bot.color    || '#7c3aed';

  if (!apiKey) throw new Error(`Bot ${bot.name} 未配置 API Key`);

  const client = createAIClient(apiKey, baseURL);

  const botListStr = bots.map(b =>
    `- ${b.name}：${b.description || b.system_prompt?.slice(0, 60) || '通用AI助手'}`
  ).join('\n');

  const otherBots = bots.filter(b => b.id !== bot.id).map(b => b.name).join('、');

  const systemPrompt =
`你是「${bot.name}」，正在和其他AI朋友一起闲聊。${bot.system_prompt ? `你的角色：${bot.system_prompt}` : ''}
群聊成员（只有这些AI）：
${botListStr}
${context ? `聊天背景：${context}` : ''}

【规则】
1. 每次只说 1-2 句，口语化、随意，可以加表情符号或吐槽
2. 回应上文内容，推动话题发展，可以反驳或提出新角度
3. 不确定的事直接说"我猜是…"或"感觉…"，表明立场后继续聊，不要把问题丢给别人
4. 可以 @${otherBots || '其他成员'} 让对方接话
5. 严禁在消息里提及或呼唤群外的任何人名——只和群内成员对话
6. 严禁向任何人提问"你觉得呢""你怎么看""你有没有…"——直接说自己的观点
7. 不做总结，不写自己名字前缀，不重复别人的话`;

  // Build valid user/assistant alternating messages from history.
  // API 不允许连续同 role，所以把"当前 bot 自己说的"标为 assistant，
  // 其余所有发言合并成 user 消息，保证角色严格交替。
  const myPrefix = `[${bot.name}]: `;
  const chatMessages = [];
  let pendingUser = [];

  const flushUser = () => {
    if (pendingUser.length) {
      chatMessages.push({ role: 'user', content: pendingUser.join('\n') });
      pendingUser = [];
    }
  };

  for (const h of history) {
    if (h.role === 'user') {
      // initial context line (topic)
      pendingUser.push(h.content);
    } else if (h.content.startsWith(myPrefix)) {
      // 当前 bot 自己说的 → assistant
      flushUser();
      chatMessages.push({ role: 'assistant', content: h.content.slice(myPrefix.length) });
    } else {
      // 其他 bot 的发言 → 合并进 user
      pendingUser.push(h.content);
    }
  }
  flushUser();

  // API 要求最后一条必须是 user（让 bot 接着回复）
  if (chatMessages.length === 0 || chatMessages[chatMessages.length - 1].role === 'assistant') {
    chatMessages.push({ role: 'user', content: '（请继续）' });
  }

  const messages = [
    { role: 'system', content: systemPrompt },
    ...chatMessages,
  ];

  const msgId = uuidv4();
  console.log(`[Freedom][botSpeak] ${bot.name} 开始调用 model=${model} baseURL=${baseURL}`);

  try {
    // 非流式：freedom 模式不需要逐字输出，直接等完整响应
    // 避免大量 ai_delta 消息在 Android WebView 消息队列中积压导致 ai_done 被丢弃
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const response = await client.chat.completions.create({
      model, messages, stream: false,
    });

    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    const trimmed = response.choices[0]?.message?.content?.trim() || '';
    if (!trimmed) {
      console.warn(`[Freedom][botSpeak] ${bot.name} 返回空内容`);
      return '';
    }

    console.log(`[Freedom][botSpeak] ${bot.name} 成功，长度=${trimmed.length}，content前20="${trimmed.slice(0,20)}"`);

    // 先存 DB，再广播
    const { groupsDb } = await import('../db/groups.js');
    groupsDb.addMessage(msgId, groupId, bot.id, bot.name, 'assistant', trimmed);
    broadcast(groupId, { type: 'ai_done', msgId, botId: bot.id, botName: bot.name, botColor: color, content: trimmed });

    return trimmed;
  } catch (err) {
    console.error(`[Freedom][botSpeak] ${bot.name} 失败:`, err?.status, err?.message, err?.code);
    throw err; // Re-throw for the main loop to handle (consecutiveErrors, AbortError, etc.)
  }
}

// Main freedom loop
export async function runFreedom(groupId, group, context, bots, broadcast, signal, getHumanMessages) {
  if (bots.length === 0) {
    broadcast(groupId, { type: 'error', error: '请先在群设置中添加 Bot' });
    return;
  }

  const history = [];
  if (context) {
    history.push({ role: 'user', content: `话题：${context}` });
  }

  broadcast(groupId, {
    type: 'freedom_start',
    context,
    bots: bots.map(b => ({ id: b.id, name: b.name, color: b.color })),
  });

  let currentIndex = 0;
  let nextBot = bots[currentIndex];
  // 每个 bot 独立失败计数，避免「A成功→B失败→A成功→B失败」无限循环
  const botErrors = new Map(bots.map(b => [b.id, 0]));
  // 从轮转中永久排除的 bot id（连续失败 3 次）
  const disabledBots = new Set();

  while (!signal?.aborted) {
    // 把用户在上一轮停顿期间发的消息注入 history，让 bot 能看到并回应
    const humanMsgs = getHumanMessages?.() || [];
    for (const hm of humanMsgs) {
      history.push({ role: 'user', content: hm });
    }

    // 如果所有 bot 都被排除，则停止
    if (disabledBots.size >= bots.length) {
      broadcast(groupId, { type: 'freedom_error', error: '所有 Bot 均已出错，聊天停止' });
      break;
    }

    // 跳过已被排除的 bot
    if (disabledBots.has(nextBot.id)) {
      currentIndex = (currentIndex + 1) % bots.length;
      nextBot = bots[currentIndex];
      continue;
    }

    const bot = nextBot;

    // ── 每个 bot 单独 try/catch，失败不影响整个循环 ──
    let content = '';
    try {
      content = await botSpeak(bot, history, bots, context, broadcast, groupId, signal);
      botErrors.set(bot.id, 0); // 成功后重置该 bot 计数
    } catch (err) {
      if (err.name === 'AbortError') break; // /stop 或 signal 中止，正常退出

      const errCount = (botErrors.get(bot.id) || 0) + 1;
      botErrors.set(bot.id, errCount);
      console.error(`[Freedom] ${bot.name} 出错 (${errCount}/3):`, err.message);

      if (errCount >= 3) {
        // 该 bot 连续失败 3 次，从本轮中排除
        // 注意：这里不发 freedom_error，避免前端误认为整个会话已结束
        // 会话仍在运行，只是这个 bot 被跳过
        disabledBots.add(bot.id);
        console.warn(`[Freedom] ${bot.name} 已被跳过（连续失败 3 次）`);
      }

      // 跳到下一个 bot，等一小会继续
      currentIndex = (currentIndex + 1) % bots.length;
      nextBot = bots[currentIndex];
      await sleep(3000, signal);
      continue;
    }

    if (signal?.aborted) break;

    if (content) {
      // 加入共享历史
      history.push({ role: 'assistant', content: `[${bot.name}]: ${content}` });
      if (history.length > 32) history.splice(1, history.length - 32);

      // 被 @mention 的 bot 优先接话（排除已禁用的）
      const mentionedBot = detectBotMention(content, bots);
      if (mentionedBot && mentionedBot.id !== bot.id && !disabledBots.has(mentionedBot.id)) {
        nextBot = mentionedBot;
        // 先显示"思考中"，再等待（用户看到指示器后有等待感）
        broadcast(groupId, {
          type: 'freedom_thinking',
          botId: mentionedBot.id,
          botName: mentionedBot.name,
          botColor: mentionedBot.color,
        });
        await naturalDelay(signal, true);
        continue;
      }
    }

    // 正常轮转
    currentIndex = (currentIndex + 1) % bots.length;
    nextBot = bots[currentIndex];

    // 先显示"思考中"，再等待（间隔期间用户能看到谁在思考）
    broadcast(groupId, {
      type: 'freedom_thinking',
      botId: nextBot.id,
      botName: nextBot.name,
      botColor: nextBot.color,
    });
    await naturalDelay(signal);
  }

  broadcast(groupId, { type: 'freedom_end', context });
}
