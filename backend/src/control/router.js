import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authMiddleware } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/admin.js';
import { controlPlane } from './plane.js';
import { controlDb } from '../db/control.js';

const router = Router();

router.use(authMiddleware, requireAdmin);

router.get('/overview', (req, res) => {
  res.json({ data: controlPlane.getOverview() });
});

router.get('/lanes', (req, res) => {
  res.json({ data: controlPlane.listLanes() });
});

router.get('/plugins', (req, res) => {
  res.json({ data: controlPlane.listPlugins() });
});

router.post('/plugins/reload', (req, res) => {
  const data = controlPlane.reloadPlugins();
  res.json({ data });
});

router.post('/messages', (req, res) => {
  try {
    const { message, session } = controlPlane.acceptIncomingMessage(req.body || {});
    res.status(202).json({ data: { message, session } });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/jobs/:id/cancel', (req, res) => {
  const r = controlPlane.cancelJob(req.params.id);
  if (!r.ok) return res.status(400).json({ error: r.error });
  res.json({ data: r.job });
});

// ---- Service Connectors (YOLOv8 / local models / external APIs) ----
router.get('/connectors', (req, res) => {
  res.json({ data: controlDb.listConnectors() });
});

router.post('/connectors', (req, res) => {
  const { name, type, base_url, health_path, api_key, config, enabled } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'name 不能为空' });
  if (!type?.trim()) return res.status(400).json({ error: 'type 不能为空' });
  if (!base_url?.trim()) return res.status(400).json({ error: 'base_url 不能为空' });
  const created = controlDb.createConnector(uuidv4(), {
    name: name.trim(),
    type: type.trim(),
    base_url: base_url.trim(),
    health_path: (health_path || '/health').trim(),
    api_key: api_key || '',
    config: config || {},
    enabled: enabled !== false,
  });
  res.status(201).json({ data: created });
});

router.patch('/connectors/:id', (req, res) => {
  const found = controlDb.getConnector(req.params.id);
  if (!found) return res.status(404).json({ error: 'connector 不存在' });
  const { name, type, base_url, health_path, api_key, config, enabled } = req.body || {};
  const updated = controlDb.updateConnector(req.params.id, {
    ...(name !== undefined ? { name: String(name).trim() } : {}),
    ...(type !== undefined ? { type: String(type).trim() } : {}),
    ...(base_url !== undefined ? { base_url: String(base_url).trim() } : {}),
    ...(health_path !== undefined ? { health_path: String(health_path).trim() } : {}),
    ...(api_key !== undefined ? { api_key: String(api_key) } : {}),
    ...(config !== undefined ? { config } : {}),
    ...(enabled !== undefined ? { enabled: !!enabled } : {}),
  });
  res.json({ data: updated });
});

router.delete('/connectors/:id', (req, res) => {
  const found = controlDb.getConnector(req.params.id);
  if (!found) return res.status(404).json({ error: 'connector 不存在' });
  controlDb.deleteConnector(req.params.id);
  res.json({ data: true });
});

// ---- Skill Packs ----
router.get('/skill-packs', (req, res) => {
  res.json({ data: controlDb.listSkillPacks() });
});

router.post('/skill-packs', (req, res) => {
  const { name, key, description, config, enabled } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'name 不能为空' });
  if (!key?.trim()) return res.status(400).json({ error: 'key 不能为空' });
  try {
    const created = controlDb.createSkillPack(uuidv4(), {
      name: name.trim(),
      key: key.trim(),
      description: description || '',
      config: config || {},
      enabled: enabled !== false,
    });
    res.status(201).json({ data: created });
  } catch (e) {
    if (e.message?.includes('UNIQUE')) return res.status(400).json({ error: 'key 已存在' });
    res.status(500).json({ error: e.message || '创建失败' });
  }
});

router.patch('/skill-packs/:id', (req, res) => {
  const found = controlDb.getSkillPack(req.params.id);
  if (!found) return res.status(404).json({ error: 'skill pack 不存在' });
  const { name, key, description, config, enabled } = req.body || {};
  try {
    const updated = controlDb.updateSkillPack(req.params.id, {
      ...(name !== undefined ? { name: String(name).trim() } : {}),
      ...(key !== undefined ? { key: String(key).trim() } : {}),
      ...(description !== undefined ? { description: String(description) } : {}),
      ...(config !== undefined ? { config } : {}),
      ...(enabled !== undefined ? { enabled: !!enabled } : {}),
    });
    res.json({ data: updated });
  } catch (e) {
    if (e.message?.includes('UNIQUE')) return res.status(400).json({ error: 'key 已存在' });
    res.status(500).json({ error: e.message || '更新失败' });
  }
});

router.delete('/skill-packs/:id', (req, res) => {
  const found = controlDb.getSkillPack(req.params.id);
  if (!found) return res.status(404).json({ error: 'skill pack 不存在' });
  controlDb.deleteSkillPack(req.params.id);
  res.json({ data: true });
});

export default router;

