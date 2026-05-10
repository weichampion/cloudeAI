import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { groupsDb } from '../db/groups.js';
import { usersDb } from '../db/users.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

function genInviteCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

// 获取当前用户所在的群列表
router.get('/', authMiddleware, (req, res) => {
  const groups = groupsDb.listByUser(req.userId);
  res.json({ data: groups });
});

// 创建群（从 token 取 userId/nickname）
router.post('/', authMiddleware, (req, res) => {
  const { name, systemPrompt } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: '群名不能为空' });

  const user = usersDb.getById(req.userId);
  if (!user) return res.status(401).json({ error: '用户不存在' });

  const id = uuidv4();
  const inviteCode = genInviteCode();
  const group = groupsDb.create(id, name.trim(), inviteCode, systemPrompt);
  groupsDb.addMember(id, req.userId, user.nickname || user.username);
  groupsDb.setMemberRole(id, req.userId, 'owner');

  res.status(201).json({ data: { ...group, members: groupsDb.getMembers(id) } });
});

// 通过邀请码加入群
router.post('/join', authMiddleware, (req, res) => {
  const { inviteCode } = req.body;
  if (!inviteCode) return res.status(400).json({ error: '请输入邀请码' });

  const user = usersDb.getById(req.userId);
  if (!user) return res.status(401).json({ error: '用户不存在' });

  const group = groupsDb.getByInviteCode(inviteCode.toUpperCase());
  if (!group) return res.status(404).json({ error: '邀请码无效' });

  groupsDb.addMember(group.id, req.userId, user.nickname || user.username);
  res.json({ data: { ...group, members: groupsDb.getMembers(group.id) } });
});

// 获取私聊列表（type=private）
router.get('/private', authMiddleware, (req, res) => {
  const chats = groupsDb.listPrivateByUser(req.userId);
  res.json({ data: chats });
});

// 获取群详情 + 历史消息
router.get('/:id', authMiddleware, (req, res) => {
  const group = groupsDb.get(req.params.id);
  if (!group) return res.status(404).json({ error: '群不存在' });
  if (!groupsDb.isMember(req.params.id, req.userId))
    return res.status(403).json({ error: '您不是该群成员' });
  const members = groupsDb.getMembers(req.params.id);
  const messages = groupsDb.getMessages(req.params.id);
  res.json({ data: { ...group, members, messages } });
});

// 邀请好友加入群
router.post('/:id/members', authMiddleware, (req, res) => {
  const { friendId } = req.body;
  if (!friendId) return res.status(400).json({ error: '缺少 friendId' });

  const group = groupsDb.get(req.params.id);
  if (!group) return res.status(404).json({ error: '群不存在' });
  if (!groupsDb.isMember(req.params.id, req.userId))
    return res.status(403).json({ error: '您不是该群成员' });

  const fs = usersDb.getFriendship(req.userId, friendId) || usersDb.getFriendship(friendId, req.userId);
  if (!fs || fs.status !== 'accepted')
    return res.status(403).json({ error: '只能邀请好友' });

  if (groupsDb.isMember(req.params.id, friendId))
    return res.status(400).json({ error: '该用户已在群中' });

  const friend = usersDb.getById(friendId);
  if (!friend) return res.status(404).json({ error: '用户不存在' });

  groupsDb.addMember(req.params.id, friendId, friend.nickname || friend.username);
  res.json({ data: groupsDb.getMembers(req.params.id) });
});

// 审计日志
router.get('/:id/audit-log', authMiddleware, (req, res) => {
  if (!groupsDb.isMember(req.params.id, req.userId)) return res.status(403).json({ error: '无权限' });
  res.json({ data: groupsDb.getAuditLog(req.params.id) });
});

// 设置/清除群的激活 Bot
router.patch('/:id/active-bot', authMiddleware, (req, res) => {
  const group = groupsDb.get(req.params.id);
  if (!group) return res.status(404).json({ error: '群不存在' });
  if (!groupsDb.isMember(req.params.id, req.userId))
    return res.status(403).json({ error: '无权限' });

  const { botId } = req.body;
  if (botId) {
    const bot = groupsDb.getBot(botId);
    if (!bot) return res.status(404).json({ error: 'Bot 不存在' });
    const inGroup = groupsDb.getGroupBots(req.params.id).some(b => b.id === botId);
    if (!inGroup) return res.status(400).json({ error: '该 Bot 不在本群' });
    groupsDb.setActiveBot(req.params.id, botId);
  } else {
    groupsDb.clearActiveBot(req.params.id);
  }
  res.json({ data: groupsDb.get(req.params.id) });
});

export default router;
