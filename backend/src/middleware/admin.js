import { usersDb } from '../db/users.js';

export function requireAdmin(req, res, next) {
  const user = usersDb.getById(req.userId);
  if (!user) return res.status(401).json({ error: '用户不存在' });
  if (user.role !== 'admin') return res.status(403).json({ error: '仅管理员可访问' });
  req.user = user;
  next();
}

