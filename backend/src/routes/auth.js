import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import { usersDb } from '../db/users.js';
import { signToken, authMiddleware } from '../middleware/auth.js';

const router = Router();

// 注册
router.post('/register', async (req, res) => {
  const { username, password, nickname } = req.body;
  if (!username?.trim()) return res.status(400).json({ error: '用户名不能为空' });
  if (!password || password.length < 6) return res.status(400).json({ error: '密码至少6位' });
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username.trim()))
    return res.status(400).json({ error: '用户名只能包含字母、数字、下划线（3-20位）' });

  const existing = usersDb.getByUsername(username.trim());
  if (existing) return res.status(400).json({ error: '用户名已被使用' });

  const passwordHash = await bcrypt.hash(password, 10);
  const id = uuidv4();
  const user = usersDb.create(id, username.trim(), passwordHash, nickname?.trim() || username.trim());
  const token = signToken(id);
  res.status(201).json({ data: { token, user } });
});

// 登录
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: '请填写用户名和密码' });

  const user = usersDb.getWithHash(username.trim());
  if (!user) return res.status(401).json({ error: '用户名或密码错误' });

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: '用户名或密码错误' });

  const token = signToken(user.id);
  const { password_hash, ...safeUser } = user;
  res.json({ data: { token, user: safeUser } });
});

// 获取当前用户
router.get('/me', authMiddleware, (req, res) => {
  const user = usersDb.getById(req.userId);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  res.json({ data: user });
});

export default router;
