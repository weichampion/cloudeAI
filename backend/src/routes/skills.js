import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { skillsDb } from '../db/skills.js';
import { executeSkill } from '../ws/skillExecutor.js';

const router = Router(); // authMiddleware applied in index.js

// 获取全部技能
router.get('/', (req, res) => {
  res.json({ data: skillsDb.list() });
});

// 创建技能
router.post('/', (req, res) => {
  const { name, key, description, type, icon, config, parameters } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: '技能名称不能为空' });
  if (!key?.trim()) return res.status(400).json({ error: '技能 key 不能为空' });
  if (!description?.trim()) return res.status(400).json({ error: '描述不能为空' });
  if (!type) return res.status(400).json({ error: '类型不能为空' });

  const safeKey = key.trim().replace(/[^a-z0-9_]/gi, '_').toLowerCase();
  try {
    const skill = skillsDb.create(uuidv4(), name.trim(), safeKey, description.trim(),
      type, icon, config, parameters);
    res.status(201).json({ data: skill });
  } catch (e) {
    if (e.message?.includes('UNIQUE')) return res.status(400).json({ error: '该 key 已存在' });
    throw e;
  }
});

// 更新技能
router.patch('/:id', (req, res) => {
  const skill = skillsDb.get(req.params.id);
  if (!skill) return res.status(404).json({ error: '技能不存在' });

  const { name, key, description, type, icon, config, parameters } = req.body;
  const fields = {};
  if (name !== undefined) fields.name = name.trim();
  if (key !== undefined) fields.key = key.trim().replace(/[^a-z0-9_]/gi, '_').toLowerCase();
  if (description !== undefined) fields.description = description.trim();
  if (type !== undefined) fields.type = type;
  if (icon !== undefined) fields.icon = icon;
  if (config !== undefined) fields.config = typeof config === 'string' ? config : JSON.stringify(config);
  if (parameters !== undefined) fields.parameters = typeof parameters === 'string' ? parameters : JSON.stringify(parameters);

  if (!Object.keys(fields).length) return res.status(400).json({ error: '无更新字段' });
  try {
    res.json({ data: skillsDb.update(req.params.id, fields) });
  } catch (e) {
    if (e.message?.includes('UNIQUE')) return res.status(400).json({ error: '该 key 已存在' });
    throw e;
  }
});

// 删除技能
router.delete('/:id', (req, res) => {
  const skill = skillsDb.get(req.params.id);
  if (!skill) return res.status(404).json({ error: '技能不存在' });
  if (skill.type.startsWith('builtin_')) return res.status(400).json({ error: '内置技能不能删除' });
  skillsDb.delete(req.params.id);
  res.json({ data: { ok: true } });
});

// 测试执行技能
router.post('/:id/test', async (req, res) => {
  const skill = skillsDb.get(req.params.id);
  if (!skill) return res.status(404).json({ error: '技能不存在' });
  try {
    const result = await executeSkill(skill, req.body.params || {});
    res.json({ data: { result } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
