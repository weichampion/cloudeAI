import { Router } from 'express';
import OpenAI from 'openai';
import { v4 as uuidv4 } from 'uuid';
import { sessionsDb, messagesDb } from '../db/index.js';
import { groupsDb } from '../db/groups.js';
import { skillsDb } from '../db/skills.js';
import { executeSkill } from '../ws/skillExecutor.js';
import { resolveAIConfig } from '../middleware/config.js';

const router = Router();
const MAX_HISTORY = parseInt(process.env.MAX_HISTORY_TURNS || '20') * 2;

// 累积 streaming tool_calls
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

/**
 * POST /api/chat/:sessionId
 * Body: { message: string, systemPrompt?: string, botId?: string }
 * 响应: SSE 流式输出（支持 Function Calling）
 */
router.post('/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  const { message, systemPrompt, botId } = req.body;

  if (!message?.trim()) {
    return res.status(400).json({ error: '消息不能为空' });
  }

  const session = sessionsDb.get(sessionId);
  if (!session) {
    return res.status(404).json({ error: '会话不存在' });
  }

  // 解析 AI 配置（支持请求头覆盖 or bot 配置）
  let aiConfig = resolveAIConfig(req);
  let bot = null;
  let skills = [];
  let tools;

  if (botId) {
    bot = groupsDb.getBot(botId);
    if (bot) {
      // bot 配置覆盖全局配置
      if (bot.api_key) aiConfig = { ...aiConfig, apiKey: bot.api_key };
      if (bot.base_url) aiConfig = { ...aiConfig, baseURL: bot.base_url };
      if (bot.model) aiConfig = { ...aiConfig, model: bot.model };
      // 加载技能
      skills = skillsDb.getAgentSkills(bot.id);
      if (skills.length > 0) {
        tools = skills.map(s => ({
          type: 'function',
          function: {
            name: s.key,
            description: s.description,
            parameters: JSON.parse(s.parameters || '{"type":"object","properties":{}}'),
          },
        }));
      }
    }
  }

  if (!aiConfig.apiKey) {
    return res.status(500).json({ error: '未配置 API Key' });
  }

  const client = new OpenAI({ apiKey: aiConfig.apiKey, baseURL: aiConfig.baseURL });

  // 加载历史消息
  const history = messagesDb.listBySession(sessionId, MAX_HISTORY);
  const historyMessages = history.map(m => ({ role: m.role, content: m.content }));

  // 保存用户消息
  const userMsgId = uuidv4();
  messagesDb.add(userMsgId, sessionId, 'user', message);
  sessionsDb.touch(sessionId);

  // 自动生成会话标题
  if (history.length === 0 && session.title === '新对话') {
    const title = message.slice(0, 20) + (message.length > 20 ? '...' : '');
    sessionsDb.updateTitle(sessionId, title);
  }

  // SSE 头
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  let assistantContent = '';

  try {
    // 构建 system prompt（bot prompt 优先于传入的 systemPrompt）
    const sysPromptText = bot?.system_prompt || systemPrompt || '';
    // 注入工具调用规则
    let finalSysPrompt = sysPromptText;
    if (skills.length > 0) {
      const TYPE_TRIGGER = {
        file_list: '当用户要求列出目录、查看文件列表时',
        file_read: '当用户要求读取、查看文件内容时',
        file_write: '当用户要求写入、创建、修改文件时',
        database_query: '当用户要求查询数据库时',
        database_write: '当用户要求写入数据库时',
        websearch: '当用户要求搜索、查询实时信息时',
        http: '当用户需要调用外部接口时',
        builtin_datetime: '当用户询问当前时间、日期时',
        builtin_calculator: '当用户要求计算数学表达式时',
        builtin_random: '当用户要求生成随机数时',
      };
      const rules = skills.map(s => {
        const trigger = TYPE_TRIGGER[s.type] || s.description;
        return `- 调用 \`${s.key}\`：${trigger}`;
      }).join('\n');
      finalSysPrompt += `\n\n## 工具调用规则（必须严格遵守）\n${rules}\n\n⚠️ 涉及实时数据或文件操作，即使"认为知道答案"，也必须先调用工具。`;
    }

    const messages = [];
    if (finalSysPrompt) messages.push({ role: 'system', content: finalSysPrompt });
    messages.push(...historyMessages, { role: 'user', content: message });

    // 第一次流式调用
    const stream1 = await client.chat.completions.create({
      model: aiConfig.model,
      messages,
      stream: true,
      ...(tools ? { tools, tool_choice: 'auto' } : {}),
    });

    const toolCallsAcc = [];
    for await (const chunk of stream1) {
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;
      if (delta.tool_calls?.length) {
        accumulateToolCalls(toolCallsAcc, delta.tool_calls);
      } else if (delta.content) {
        assistantContent += delta.content;
        sendEvent('delta', { content: delta.content });
      }
    }

    // 执行 tool_calls（若有）
    if (toolCallsAcc.length > 0) {
      const toolResults = [];
      for (const tc of toolCallsAcc) {
        const toolCallId = tc.id || uuidv4();
        const toolName = tc.function.name;
        sendEvent('tool_call_start', { toolName, toolCallId });
        try {
          let args = {};
          try { args = JSON.parse(tc.function.arguments || '{}'); } catch {}
          const skill = skillsDb.getByKey(toolName);
          if (!skill) throw new Error(`技能 "${toolName}" 不存在`);
          const result = await executeSkill(skill, args, null);
          const truncated = String(result).slice(0, 1000);
          sendEvent('tool_call_done', { toolName, toolCallId, result: truncated });
          toolResults.push({ role: 'tool', tool_call_id: toolCallId, content: truncated });
        } catch (err) {
          sendEvent('tool_call_error', { toolName, toolCallId, error: err.message });
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
        model: aiConfig.model, messages: messages2, stream: true,
      });
      for await (const chunk of stream2) {
        const delta = chunk.choices[0]?.delta?.content || '';
        if (delta) {
          assistantContent += delta;
          sendEvent('delta', { content: delta });
        }
      }
    }

    // 保存 AI 回复
    const assistantMsgId = uuidv4();
    messagesDb.add(assistantMsgId, sessionId, 'assistant', assistantContent);

    sendEvent('done', {
      messageId: assistantMsgId,
      sessionId,
      title: sessionsDb.get(sessionId).title,
    });

  } catch (err) {
    console.error('[Chat Error]', err);
    sendEvent('error', { message: err.message || '请求失败，请检查配置' });
  } finally {
    res.end();
  }
});

export default router;
