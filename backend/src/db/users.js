import db from './index.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    nickname TEXT DEFAULT '',
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS friendships (
    user_id TEXT NOT NULL,
    friend_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, friend_id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (friend_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_friendships_friend ON friendships(friend_id, status);
`);

// 兼容旧数据库
try { db.exec(`ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'`); } catch {}

export const usersDb = {
  create: (id, username, passwordHash, nickname) => {
    // 第一个注册用户默认为管理员，后续为普通用户
    const total = db.prepare('SELECT COUNT(1) AS c FROM users').get()?.c || 0;
    const role = total === 0 ? 'admin' : 'user';
    db.prepare(`INSERT INTO users (id, username, password_hash, role, nickname, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run(id, username, passwordHash, role, nickname || '', Date.now());
    return usersDb.getById(id);
  },

  getByUsername: (username) =>
    db.prepare('SELECT * FROM users WHERE username = ?').get(username),

  getById: (id) =>
    db.prepare('SELECT id, username, role, nickname, created_at FROM users WHERE id = ?').get(id),

  getWithHash: (username) =>
    db.prepare('SELECT * FROM users WHERE username = ?').get(username),

  search: (query, excludeId) =>
    db.prepare(`SELECT id, username, nickname FROM users
      WHERE username LIKE ? AND id != ?
      LIMIT 20`)
      .all(`%${query}%`, excludeId),

  sendFriendRequest: (userId, friendId) => {
    db.prepare(`INSERT OR IGNORE INTO friendships (user_id, friend_id, status, created_at)
      VALUES (?, ?, 'pending', ?)`)
      .run(userId, friendId, Date.now());
  },

  acceptFriendRequest: (fromId, toId) => {
    // fromId 发出申请，toId 同意 → 双向
    db.prepare(`UPDATE friendships SET status = 'accepted' WHERE user_id = ? AND friend_id = ?`)
      .run(fromId, toId);
    // 建立反向记录
    db.prepare(`INSERT OR REPLACE INTO friendships (user_id, friend_id, status, created_at)
      VALUES (?, ?, 'accepted', ?)`)
      .run(toId, fromId, Date.now());
  },

  rejectFriendRequest: (fromId, toId) => {
    db.prepare(`DELETE FROM friendships WHERE user_id = ? AND friend_id = ?`)
      .run(fromId, toId);
  },

  getFriends: (userId) =>
    db.prepare(`SELECT u.id, u.username, u.nickname FROM users u
      JOIN friendships f ON u.id = f.friend_id
      WHERE f.user_id = ? AND f.status = 'accepted'`)
      .all(userId),

  getPendingRequests: (userId) =>
    db.prepare(`SELECT u.id, u.username, u.nickname, f.created_at FROM users u
      JOIN friendships f ON u.id = f.user_id
      WHERE f.friend_id = ? AND f.status = 'pending'`)
      .all(userId),

  getFriendship: (userId, friendId) =>
    db.prepare(`SELECT * FROM friendships WHERE user_id = ? AND friend_id = ?`)
      .get(userId, friendId),
};
