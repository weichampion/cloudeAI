import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { sessionsDb, messagesDb } from '../db/index.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

// 获取当前用户的会话列表
router.get('/', (req, res) => {
  res.json({ data: sessionsDb.list(req.userId) });
});

// 创建新会话
router.post('/', (req, res) => {
  const id = uuidv4();
  const title = req.body.title || '新对话';
  const session = sessionsDb.create(id, title, req.userId);
  res.status(201).json({ data: session });
});

// 获取单个会话及消息历史（验证归属）
router.get('/:id', (req, res) => {
  const session = sessionsDb.get(req.params.id);
  if (!session) return res.status(404).json({ error: '会话不存在' });
  if (session.user_id && session.user_id !== req.userId)
    return res.status(403).json({ error: '无权访问' });
  const messages = messagesDb.listBySession(req.params.id);
  res.json({ data: { ...session, messages } });
});

// 更新会话标题
router.patch('/:id', (req, res) => {
  const session = sessionsDb.get(req.params.id);
  if (!session) return res.status(404).json({ error: '会话不存在' });
  if (session.user_id && session.user_id !== req.userId)
    return res.status(403).json({ error: '无权访问' });
  if (req.body.title) sessionsDb.updateTitle(req.params.id, req.body.title);
  res.json({ data: sessionsDb.get(req.params.id) });
});

// 删除会话
router.delete('/:id', (req, res) => {
  const session = sessionsDb.get(req.params.id);
  if (!session) return res.status(404).json({ error: '会话不存在' });
  if (session.user_id && session.user_id !== req.userId)
    return res.status(403).json({ error: '无权访问' });
  sessionsDb.delete(req.params.id);
  res.json({ data: { success: true } });
});

// 清空会话消息
router.delete('/:id/messages', (req, res) => {
  const session = sessionsDb.get(req.params.id);
  if (!session) return res.status(404).json({ error: '会话不存在' });
  if (session.user_id && session.user_id !== req.userId)
    return res.status(403).json({ error: '无权访问' });
  messagesDb.deleteBySession(req.params.id);
  sessionsDb.touch(req.params.id);
  res.json({ data: { success: true } });
});

export default router;
