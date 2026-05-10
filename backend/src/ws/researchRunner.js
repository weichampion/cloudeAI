import { v4 as uuidv4 } from 'uuid';
import { writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { skillsDb } from '../db/skills.js';
import { UPLOADS_DIR } from '../routes/upload.js';
import { createAIClient } from '../ai/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 获取群中可用的联网搜索技能
function getWebSearchSkill(bots) {
  for (const bot of bots) {
    const skills = skillsDb.getAgentSkills(bot.id);
    const ws = skills.find(s => s.type === 'websearch');
    if (ws) return { bot, skill: ws };
  }
  return null;
}

// 搜索函数
async function webSearch(config, query) {
  const provider = config.provider || 'serper';
  const apiKey = config.api_key;
  if (!apiKey) throw new Error('缺少搜索 API Key');

  if (provider === 'serper') {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, num: 5 }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || '搜索失败');
    return (data.organic || []).slice(0, 5).map(r => ({
      title: r.title, snippet: r.snippet, url: r.link,
    }));
  }

  if (provider === 'tavily') {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: apiKey, query, max_results: 5 }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || '搜索失败');
    return (data.results || []).slice(0, 5).map(r => ({
      title: r.title, snippet: r.content?.slice(0, 300) || '', url: r.url,
    }));
  }

  throw new Error(`不支持的搜索提供商: ${provider}`);
}

// 用 LLM 生成搜索查询列表
async function generateQueries(client, model, topic, signal) {
  const res = await client.chat.completions.create({
    model, stream: false,
    messages: [
      {
        role: 'system',
        content: '你是一名研究助手。给定一个研究主题，请生成3-5个最有价值的搜索查询（中英文混合，尽量多元化角度），以JSON数组返回，格式：["query1","query2",...]，不要任何其他内容。',
      },
      { role: 'user', content: `研究主题：${topic}` },
    ],
    ...(signal ? { signal } : {}),
  });
  const text = res.choices[0]?.message?.content || '[]';
  const match = text.match(/\[[\s\S]*\]/);
  try {
    const queries = JSON.parse(match?.[0] || '[]');
    return Array.isArray(queries) ? queries.slice(0, 5) : [topic];
  } catch {
    return [topic];
  }
}

// 综合报告（流式）
async function synthesizeReport(client, model, topic, allResults, broadcast, groupId, msgId, botId, signal) {
  const resultsText = allResults.map((r, i) =>
    `[${i + 1}] ${r.title}\n${r.snippet}\n来源: ${r.url}`
  ).join('\n\n---\n\n');

  const stream = await client.chat.completions.create({
    model, stream: true,
    messages: [
      {
        role: 'system',
        content: `你是一名深度研究分析师。请基于以下搜索结果，撰写一份关于"${topic}"的深度研究报告。
要求：
1. 结构清晰（使用 ## 标题分节）
2. 综合多方来源，不偏不倚
3. 包含关键发现、主要观点、核心数据
4. 结尾给出总结与展望
5. 用中文撰写，专业且易读
6. 在引用具体信息时注明来源编号（如 [1]）`,
      },
      {
        role: 'user',
        content: `研究主题：${topic}\n\n搜索结果：\n\n${resultsText}`,
      },
    ],
    ...(signal ? { signal } : {}),
  });

  let fullContent = '';
  for await (const chunk of stream) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const delta = chunk.choices[0]?.delta?.content || '';
    if (delta) {
      fullContent += delta;
      broadcast(groupId, { type: 'ai_delta', msgId, botId, delta });
    }
  }
  return fullContent;
}

// 仅用训练知识（流式）
async function synthesizeFromKnowledge(client, model, topic, broadcast, groupId, msgId, botId, signal) {
  const stream = await client.chat.completions.create({
    model, stream: true,
    messages: [
      { role: 'system', content: '你是一名深度研究分析师。请基于你的知识，撰写一份深度研究报告（使用 ## 标题分节，结构清晰，包含关键发现、主要观点、总结展望）。' },
      { role: 'user', content: `请撰写关于"${topic}"的深度研究报告：` },
    ],
    ...(signal ? { signal } : {}),
  });

  let fullContent = '';
  for await (const chunk of stream) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const delta = chunk.choices[0]?.delta?.content || '';
    if (delta) {
      fullContent += delta;
      broadcast(groupId, { type: 'ai_delta', msgId, botId, delta });
    }
  }
  return fullContent;
}

// 将研究报告保存为 MD 文件，返回文件名（相对路径由调用方构造全URL）
function saveReportAsMarkdown(topic, content, sources) {
  const safeTopic = topic.replace(/[^a-zA-Z0-9\u4e00-\u9fa5_]/g, '_').slice(0, 30);
  const filename = `research_${Date.now()}_${safeTopic}.md`;
  const filepath = path.join(UPLOADS_DIR, filename);

  const sourcesSection = sources.length > 0
    ? `\n\n## 参考来源\n\n${sources.map((s, i) => `${i + 1}. [${s.title}](${s.url})`).join('\n')}`
    : '';

  const mdContent = `# ${topic} — 深度研究报告\n\n> 生成时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}\n\n${content}${sourcesSection}\n`;

  writeFileSync(filepath, mdContent, 'utf-8');
  return filename;
}

// 主研究循环（支持 AbortSignal + 保存 MD 文件）
export async function runResearch(groupId, group, topic, bots, broadcast, signal, serverBaseUrl) {
  if (bots.length === 0) {
    broadcast(groupId, { type: 'research_error', error: '请先在群设置中添加 Bot' });
    return;
  }

  const wsResult = getWebSearchSkill(bots);
  const bot = wsResult?.bot || bots[0];
  const searchSkill = wsResult?.skill;

  const apiKey  = bot.api_key  || process.env.API_KEY  || '';
  const baseURL = bot.base_url || process.env.BASE_URL  || 'https://token-plan-cn.xiaomimimo.com/anthropic';
  const model   = bot.model    || process.env.MODEL     || 'mimo-v2.5-pro';
  const botId   = bot.id;
  const botName = bot.name || 'AI';
  const botColor = bot.color || '#0ea5e9';

  if (!apiKey) {
    broadcast(groupId, { type: 'research_error', error: `Bot ${botName} 未配置 API Key` });
    return;
  }

  const client = createAIClient(apiKey, baseURL);

  broadcast(groupId, {
    type: 'research_start',
    topic, botId, botName, botColor,
    hasSearch: !!searchSkill,
  });

  try {
    let allResults = [];

    if (searchSkill) {
      const config = JSON.parse(searchSkill.config || '{}');

      broadcast(groupId, { type: 'research_step', step: 'planning', message: '🧠 正在规划搜索策略...' });
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

      const queries = await generateQueries(client, model, topic, signal);
      broadcast(groupId, { type: 'research_step', step: 'queries', message: `📋 生成了 ${queries.length} 个搜索查询`, queries });

      broadcast(groupId, { type: 'research_step', step: 'searching', message: '🔍 正在联网搜索...' });
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

      const searchResults = await Promise.all(queries.map(q => webSearch(config, q).catch(() => [])));
      allResults = searchResults.flat();

      const seen = new Set();
      allResults = allResults.filter(r => {
        if (seen.has(r.url)) return false;
        seen.add(r.url); return true;
      });

      broadcast(groupId, { type: 'research_step', step: 'collected', message: `📚 收集到 ${allResults.length} 条信息`, count: allResults.length });
    } else {
      broadcast(groupId, { type: 'research_step', step: 'no_search', message: '⚠️ 未配置联网搜索，将基于训练知识生成报告' });
    }

    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    broadcast(groupId, { type: 'research_step', step: 'synthesizing', message: '✍️ 正在综合分析，生成报告...' });

    const msgId = uuidv4();
    broadcast(groupId, { type: 'ai_start', msgId, botId, botName, botColor });

    const fullContent = allResults.length > 0
      ? await synthesizeReport(client, model, topic, allResults, broadcast, groupId, msgId, botId, signal)
      : await synthesizeFromKnowledge(client, model, topic, broadcast, groupId, msgId, botId, signal);

    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    // 保存为 MD 文件
    const sources = allResults.map(r => ({ title: r.title, url: r.url }));
    let fileUrl = null;
    try {
      const filename = saveReportAsMarkdown(topic, fullContent, sources);
      fileUrl = serverBaseUrl ? `${serverBaseUrl}/uploads/${filename}` : `/uploads/${filename}`;
      broadcast(groupId, { type: 'research_step', step: 'saved', message: `📄 报告已保存为 MD 文件`, fileUrl });
    } catch (saveErr) {
      console.error('[Research] Failed to save MD:', saveErr);
    }

    const { groupsDb } = await import('../db/groups.js');
    groupsDb.addMessage(msgId, groupId, botId, botName, 'assistant', fullContent);
    broadcast(groupId, { type: 'ai_done', msgId, botId, botName, botColor, content: fullContent });
    broadcast(groupId, {
      type: 'research_end',
      topic, botId, botName, botColor,
      sources,
      fileUrl,
    });

  } catch (err) {
    if (err.name === 'AbortError') {
      broadcast(groupId, { type: 'research_error', error: '研究已被停止' });
    } else {
      broadcast(groupId, { type: 'research_error', error: err.message });
      console.error('[Research]', err);
    }
  }
}
