import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { usersDb } from '../db/users.js';
import { groupsDb } from '../db/groups.js';

const router = Router(); // 已在 index.js 挂上 authMiddleware

// 好友列表
router.get('/', (req, res) => {
  res.json({ data: usersDb.getFriends(req.userId) });
});

// 收到的好友申请
router.get('/requests', (req, res) => {
  res.json({ data: usersDb.getPendingRequests(req.userId) });
});

// 搜索用户
router.get('/search', (req, res) => {
  const q = req.query.q?.trim();
  if (!q || q.length < 2) return res.status(400).json({ error: '请输入至少2个字符' });
  const results = usersDb.search(q, req.userId);
  // 附加好友关系状态
  const withStatus = results.map(u => {
    const fs = usersDb.getFriendship(req.userId, u.id);
    const incoming = usersDb.getFriendship(u.id, req.userId);
    return {
      ...u,
      friendStatus: fs?.status || (incoming?.status === 'pending' ? 'incoming' : null),
    };
  });
  res.json({ data: withStatus });
});

// 发送好友申请
router.post('/request', (req, res) => {
  const { friendId } = req.body;
  if (!friendId) return res.status(400).json({ error: '缺少 friendId' });
  if (friendId === req.userId) return res.status(400).json({ error: '不能添加自己' });

  const target = usersDb.getById(friendId);
  if (!target) return res.status(404).json({ error: '用户不存在' });

  const existing = usersDb.getFriendship(req.userId, friendId);
  if (existing) return res.status(400).json({ error: existing.status === 'accepted' ? '已经是好友' : '申请已发送' });

  usersDb.sendFriendRequest(req.userId, friendId);
  res.json({ data: { ok: true } });
});

// 同意好友申请
router.post('/accept', (req, res) => {
  const { userId: fromId } = req.body;
  if (!fromId) return res.status(400).json({ error: '缺少 userId' });

  const request = usersDb.getFriendship(fromId, req.userId);
  if (!request || request.status !== 'pending')
    return res.status(404).json({ error: '申请不存在' });

  usersDb.acceptFriendRequest(fromId, req.userId);
  res.json({ data: { ok: true } });
});

// 拒绝好友申请
router.post('/reject', (req, res) => {
  const { userId: fromId } = req.body;
  if (!fromId) return res.status(400).json({ error: '缺少 userId' });
  usersDb.rejectFriendRequest(fromId, req.userId);
  res.json({ data: { ok: true } });
});

// 获取或创建与好友的私聊
router.post('/:friendId/chat', (req, res) => {
  const { friendId } = req.params;
  const myId = req.userId;

  if (friendId === myId) return res.status(400).json({ error: '不能与自己私聊' });

  const fs = usersDb.getFriendship(myId, friendId) || usersDb.getFriendship(friendId, myId);
  if (!fs || fs.status !== 'accepted')
    return res.status(403).json({ error: '请先添加好友' });

  let chat = groupsDb.findPrivateChat(myId, friendId);
  if (!chat) {
    const me = usersDb.getById(myId);
    const friend = usersDb.getById(friendId);
    const id = uuidv4();
    const inviteCode = uuidv4().replace(/-/g, '').slice(0, 8).toUpperCase();
    chat = groupsDb.createPrivateChat(
      id, inviteCode,
      myId, me.nickname || me.username,
      friendId, friend.nickname || friend.username
    );
  }

  res.json({ data: chat });
});

export default router;
