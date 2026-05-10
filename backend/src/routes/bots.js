import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { groupsDb } from '../db/groups.js';
import { skillsDb } from '../db/skills.js';

const router = Router();

// 全局 Bot 列表
router.get('/', (req, res) => {
  res.json({ data: groupsDb.listBots() });
});

// 创建 Bot
router.post('/', (req, res) => {
  const { name, color, systemPrompt, apiKey, baseUrl, model } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Bot 名称不能为空' });
  const id = uuidv4();
  try {
    const bot = groupsDb.createBot(id, name.trim(), color || '#7c3aed',
      systemPrompt, apiKey, baseUrl, model);
    res.status(201).json({ data: bot });
  } catch (e) {
    if (e.message?.includes('UNIQUE')) return res.status(400).json({ error: '该名称已存在' });
    throw e;
  }
});

// 更新 Bot
router.patch('/:id', (req, res) => {
  const { name, color, systemPrompt, apiKey, baseUrl, model } = req.body;
  const fields = {};
  if (name !== undefined) fields.name = name.trim();
  if (color !== undefined) fields.color = color;
  if (systemPrompt !== undefined) fields.system_prompt = systemPrompt;
  if (apiKey !== undefined) fields.api_key = apiKey;
  if (baseUrl !== undefined) fields.base_url = baseUrl;
  if (model !== undefined) fields.model = model;
  if (Object.keys(fields).length === 0) return res.status(400).json({ error: '无更新字段' });
  const bot = groupsDb.updateBot(req.params.id, fields);
  res.json({ data: bot });
});

// 删除 Bot
router.delete('/:id', (req, res) => {
  groupsDb.deleteBot(req.params.id);
  res.json({ data: { ok: true } });
});

// 获取群内 Bot 列表
router.get('/group/:groupId', (req, res) => {
  res.json({ data: groupsDb.getGroupBots(req.params.groupId) });
});

// 添加 Bot 到群
router.post('/group/:groupId', (req, res) => {
  const { botId, position } = req.body;
  if (!botId) return res.status(400).json({ error: '缺少 botId' });
  const bot = groupsDb.getBot(botId);
  if (!bot) return res.status(404).json({ error: 'Bot 不存在' });
  groupsDb.addBotToGroup(req.params.groupId, botId, position ?? 0);
  res.json({ data: groupsDb.getGroupBots(req.params.groupId) });
});

// 从群中移除 Bot
router.delete('/group/:groupId/:botId', (req, res) => {
  groupsDb.removeBotFromGroup(req.params.groupId, req.params.botId);
  res.json({ data: { ok: true } });
});

// 获取 Agent 已绑定的技能
router.get('/:botId/skills', (req, res) => {
  res.json({ data: skillsDb.getAgentSkills(req.params.botId) });
});

// 绑定技能到 Agent
router.post('/:botId/skills', (req, res) => {
  const { skillId } = req.body;
  if (!skillId) return res.status(400).json({ error: '缺少 skillId' });
  if (!groupsDb.getBot(req.params.botId)) return res.status(404).json({ error: 'Agent 不存在' });
  if (!skillsDb.get(skillId)) return res.status(404).json({ error: '技能不存在' });
  skillsDb.addAgentSkill(req.params.botId, skillId);
  res.json({ data: skillsDb.getAgentSkills(req.params.botId) });
});

// 解绑技能
router.delete('/:botId/skills/:skillId', (req, res) => {
  skillsDb.removeAgentSkill(req.params.botId, req.params.skillId);
  res.json({ data: { ok: true } });
});

export default router;
