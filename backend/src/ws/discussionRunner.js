import { v4 as uuidv4 } from 'uuid';
import { discussionDb } from '../db/discussion.js';
import { skillsDb } from '../db/skills.js';
import { createAIClient } from '../ai/client.js';

// Abort-aware sleep
function sleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) { resolve(); return; }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}

// 轮次间随机停顿：模拟真实阅读/思考节奏
//  70% → 1.5–3s（正常接话）
//  30% → 4–8s（思考一下再说）
function roundDelay(signal) {
  const ms = Math.random() < 0.7
    ? 1500 + Math.random() * 1500   // 1.5–3s
    : 4000 + Math.random() * 4000;  // 4–8s
  return sleep(ms, signal);
}

// 从 Bot 回复中解析结构化指令
function parseDirective(content) {
  const jsonMatch = content.match(/```json\s*(\{[\s\S]*?\})\s*```/i)
    || content.match(/(\{"action"[\s\S]*?\})/);
  if (jsonMatch) {
    try {
      const d = JSON.parse(jsonMatch[1]);
      return {
        action: d.action || 'continue',
        next_bot_id: d.next_bot_id || d.nextBotId || null,
        conclusion: d.conclusion || null,
        clean_content: content.replace(jsonMatch[0], '').trim(),
      };
    } catch {}
  }
  return { action: 'continue', next_bot_id: null, conclusion: null, clean_content: content };
}

// 单个 Bot 发言（支持 AbortSignal）
async function discussionTurn(session, bot, history, round, signal) {
  const apiKey  = bot.api_key  || process.env.API_KEY  || '';
  const baseURL = bot.base_url || process.env.BASE_URL  || 'https://token-plan-cn.xiaomimimo.com/anthropic';
  const model   = bot.model    || process.env.MODEL    || 'mimo-v2.5-pro';
  if (!apiKey) throw new Error(`Bot ${bot.name} 未配置 API Key`);

  const client = createAIClient(apiKey, baseURL);

  const sysPrompt = `${bot.system_prompt || `你是 ${bot.name}，一位专业的讨论参与者。`}

## 你正在参与一场无限制多智能体讨论
讨论主题：${session.topic}
当前轮次：${round + 1}
你的角色：${bot.name}

## 讨论规则
1. 仔细阅读之前的发言，补充你的专业观点，像人类一样自然地参与群聊
2. 避免简单重复他人观点，提供新的角度、反问或深化分析
3. 如果你认为讨论已充分可以得出结论，在回复末尾附加：
\`\`\`json
{"action": "conclude", "conclusion": "一句话总结结论"}
\`\`\`
4. 如果你希望某个特定 Bot 继续（按 botId 指定），附加：
\`\`\`json
{"action": "pass_to", "next_bot_id": "BOT_ID"}
\`\`\`
5. 否则不需要附加任何 JSON，正常发言即可（系统会轮转到下一位）`;

  const historyMsgs = history.map(r => ({
    role: 'user',
    content: `【${r.bot_name}】：${r.content}`,
  }));

  const messages = [
    { role: 'system', content: sysPrompt },
    ...historyMsgs,
    { role: 'user', content: `请发表你的观点（你是 ${bot.name}）：` },
  ];

  const skills = skillsDb.getAgentSkills(bot.id);
  const tools = skills.length > 0 ? skills.map(s => ({
    type: 'function',
    function: {
      name: s.key,
      description: s.description,
      parameters: JSON.parse(s.parameters || '{"type":"object","properties":{}}'),
    },
  })) : undefined;

  const stream = await client.chat.completions.create({
    model, messages, stream: true,
    ...(tools ? { tools, tool_choice: 'auto' } : {}),
    ...(signal ? { signal } : {}),
  });

  let fullContent = '';
  const chunks = [];
  for await (const chunk of stream) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const delta = chunk.choices[0]?.delta?.content || '';
    if (delta) {
      fullContent += delta;
      chunks.push(delta);
    }
  }

  return { content: fullContent, chunks };
}

// 主讨论循环（无轮次上限，直到 conclude 或外部 abort）
export async function runDiscussion(groupId, group, topic, bots, broadcast, signal) {
  if (bots.length === 0) {
    broadcast(groupId, { type: 'discuss_error', error: '请先在群设置中添加 Bot' });
    return;
  }

  const sessionId = uuidv4();
  // 无上限：每 Bot 最多发言 99 次（实际由 /stop 控制）
  const session = discussionDb.createSession(sessionId, groupId, topic, 999);

  broadcast(groupId, {
    type: 'discuss_start',
    sessionId,
    topic,
    maxRounds: null, // 无上限
    participants: bots.map(b => ({ id: b.id, name: b.name, color: b.color })),
  });

  let round = 0;
  let currentBotIdx = 0;
  const history = [];
  let concluded = false;
  let finalConclusion = '';

  try {
    while (!concluded) {
      if (signal?.aborted) break;

      const bot = bots[currentBotIdx];
      discussionDb.updateSession(sessionId, { round });

      broadcast(groupId, {
        type: 'discuss_round_start',
        sessionId, round, botId: bot.id, botName: bot.name, botColor: bot.color,
      });

      try {
        const { content, chunks } = await discussionTurn(session, bot, history, round, signal);
        if (signal?.aborted) break;

        const directive = parseDirective(content);
        const cleanContent = directive.clean_content;

        const msgId = uuidv4();
        broadcast(groupId, { type: 'discuss_delta_start', sessionId, round, msgId, botId: bot.id, botName: bot.name, botColor: bot.color });
        for (const chunk of chunks) {
          if (signal?.aborted) break;
          broadcast(groupId, { type: 'discuss_delta', sessionId, msgId, botId: bot.id, delta: chunk });
          await sleep(30, signal); // 模拟流式逐字出现
        }
        broadcast(groupId, { type: 'discuss_delta_end', sessionId, msgId, botId: bot.id });

        discussionDb.addRound(uuidv4(), sessionId, round, bot.id, bot.name,
          cleanContent, directive.action, directive.next_bot_id);

        history.push({ bot_id: bot.id, bot_name: bot.name, content: cleanContent });

        broadcast(groupId, {
          type: 'discuss_round_done',
          sessionId, round, botId: bot.id, botName: bot.name, botColor: bot.color,
          content: cleanContent, action: directive.action,
        });

        if (directive.action === 'conclude') {
          concluded = true;
          finalConclusion = directive.conclusion || cleanContent;
          break;
        }

        if (directive.action === 'pass_to' && directive.next_bot_id) {
          const idx = bots.findIndex(b => b.id === directive.next_bot_id);
          currentBotIdx = idx >= 0 ? idx : (currentBotIdx + 1) % bots.length;
        } else {
          currentBotIdx = (currentBotIdx + 1) % bots.length;
        }
      } catch (err) {
        if (err.name === 'AbortError') break;
        broadcast(groupId, { type: 'discuss_error', sessionId, round, botId: bot.id, error: err.message });
        currentBotIdx = (currentBotIdx + 1) % bots.length;
      }

      round++;
      // 轮次间随机停顿（模拟真实阅读节奏）
      await roundDelay(signal);
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      broadcast(groupId, { type: 'discuss_error', error: err.message });
    }
  }

  // 被 stop 中止
  if (signal?.aborted) {
    if (history.length > 0) {
      // 最后生成一个简短总结
      try {
        finalConclusion = await generateConclusion(session, bots[0], history, topic);
      } catch {}
    }
    discussionDb.updateSession(sessionId, { status: 'stopped', conclusion: finalConclusion });
    broadcast(groupId, {
      type: 'discuss_end',
      sessionId, topic,
      rounds: round,
      conclusion: finalConclusion,
      status: 'stopped',
    });
    return;
  }

  // 自然结束
  if (!concluded && history.length > 0) {
    try {
      finalConclusion = await generateConclusion(session, bots[0], history, topic);
    } catch {}
  }

  discussionDb.updateSession(sessionId, {
    status: concluded ? 'concluded' : 'timeout',
    conclusion: finalConclusion,
  });

  broadcast(groupId, {
    type: 'discuss_end',
    sessionId, topic,
    rounds: round,
    conclusion: finalConclusion,
    status: concluded ? 'concluded' : 'timeout',
  });
}

// 最终总结
async function generateConclusion(session, bot, history, topic) {
  const apiKey  = bot.api_key || process.env.API_KEY || '';
  const baseURL = bot.base_url || process.env.BASE_URL || 'https://token-plan-cn.xiaomimimo.com/anthropic';
  const model   = bot.model || process.env.MODEL || 'mimo-v2.5-pro';
  if (!apiKey) return '讨论已结束。';

  const client = createAIClient(apiKey, baseURL);
  const discussion = history.map(r => `【${r.bot_name}】：${r.content}`).join('\n\n');

  const res = await client.chat.completions.create({
    model, stream: false,
    messages: [
      { role: 'system', content: '你是一位专业的讨论总结者，请用2-3句话提炼多方观点的核心共识和结论。' },
      { role: 'user', content: `讨论主题：${topic}\n\n讨论内容：\n${discussion}\n\n请给出简洁的讨论总结：` },
    ],
  });

  return res.choices[0]?.message?.content || '讨论已结束。';
}
