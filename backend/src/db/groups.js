import db from './index.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    invite_code TEXT UNIQUE NOT NULL,
    system_prompt TEXT DEFAULT '',
    ai_auto_reply INTEGER DEFAULT 1,
    type TEXT DEFAULT 'group',
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS group_members (
    group_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    nickname TEXT NOT NULL,
    joined_at INTEGER NOT NULL,
    PRIMARY KEY (group_id, user_id),
    FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS group_messages (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    nickname TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('user','assistant')),
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_group_messages ON group_messages(group_id, created_at);

  CREATE TABLE IF NOT EXISTS bots (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    color TEXT DEFAULT '#7c3aed',
    system_prompt TEXT DEFAULT '',
    api_key TEXT DEFAULT '',
    base_url TEXT DEFAULT '',
    model TEXT DEFAULT '',
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS group_bots (
    group_id TEXT NOT NULL,
    bot_id TEXT NOT NULL,
    position INTEGER DEFAULT 0,
    PRIMARY KEY (group_id, bot_id),
    FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
    FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE CASCADE
  );
`);

// 兼容旧数据库
try { db.exec(`ALTER TABLE groups ADD COLUMN type TEXT DEFAULT 'group'`); } catch {}
try { db.exec(`ALTER TABLE groups ADD COLUMN active_bot_id TEXT DEFAULT NULL`); } catch {}
try { db.exec(`ALTER TABLE group_members ADD COLUMN role TEXT DEFAULT 'member'`); } catch {}
try { db.exec(`ALTER TABLE bots ADD COLUMN can_moderate INTEGER DEFAULT 0`); } catch {}

// 审计日志表
db.exec(`
  CREATE TABLE IF NOT EXISTS group_audit_log (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    operator_id TEXT NOT NULL,
    operator_type TEXT NOT NULL CHECK(operator_type IN ('bot','user')),
    action TEXT NOT NULL CHECK(action IN ('kick','warn','mute','unmute','promote','demote')),
    target_user_id TEXT NOT NULL,
    target_nickname TEXT DEFAULT '',
    reason TEXT DEFAULT '',
    created_at INTEGER NOT NULL,
    FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
  );
`);

export const groupsDb = {
  create: (id, name, inviteCode, systemPrompt) => {
    const now = Date.now();
    db.prepare(`INSERT INTO groups (id, name, invite_code, system_prompt, created_at)
      VALUES (?, ?, ?, ?, ?)`)
      .run(id, name, inviteCode, systemPrompt || '', now);
    return groupsDb.get(id);
  },

  get: (id) => db.prepare('SELECT * FROM groups WHERE id = ?').get(id),

  getByInviteCode: (code) =>
    db.prepare('SELECT * FROM groups WHERE invite_code = ?').get(code),

  list: () => db.prepare('SELECT * FROM groups ORDER BY created_at DESC').all(),

  listByUser: (userId) =>
    db.prepare(`SELECT g.*, COALESCE(MAX(msg.created_at), 0) AS last_message_at
      FROM groups g
      JOIN group_members gm ON g.id = gm.group_id
      LEFT JOIN group_messages msg ON msg.group_id = g.id
      WHERE gm.user_id = ? AND (g.type = 'group' OR g.type IS NULL)
      GROUP BY g.id
      ORDER BY last_message_at DESC, g.created_at DESC`).all(userId),

  listPrivateByUser: (userId) =>
    db.prepare(`SELECT g.*, gm2.user_id AS peer_id, u.username AS peer_username, u.nickname AS peer_nickname,
        COALESCE(MAX(msg.created_at), 0) AS last_message_at
      FROM groups g
      JOIN group_members gm ON g.id = gm.group_id AND gm.user_id = ?
      JOIN group_members gm2 ON g.id = gm2.group_id AND gm2.user_id != ?
      JOIN users u ON u.id = gm2.user_id
      LEFT JOIN group_messages msg ON msg.group_id = g.id
      WHERE g.type = 'private'
      GROUP BY g.id
      ORDER BY last_message_at DESC, g.created_at DESC`).all(userId, userId),

  findPrivateChat: (userId1, userId2) =>
    db.prepare(`SELECT g.* FROM groups g
      JOIN group_members m1 ON g.id = m1.group_id AND m1.user_id = ?
      JOIN group_members m2 ON g.id = m2.group_id AND m2.user_id = ?
      WHERE g.type = 'private'
      LIMIT 1`).get(userId1, userId2),

  createPrivateChat: (id, inviteCode, userId1, nick1, userId2, nick2) => {
    const now = Date.now();
    db.prepare(`INSERT INTO groups (id, name, invite_code, ai_auto_reply, type, created_at)
      VALUES (?, 'private', ?, 0, 'private', ?)`)
      .run(id, inviteCode, now);
    db.prepare(`INSERT OR REPLACE INTO group_members (group_id, user_id, nickname, joined_at) VALUES (?, ?, ?, ?)`)
      .run(id, userId1, nick1, now);
    db.prepare(`INSERT OR REPLACE INTO group_members (group_id, user_id, nickname, joined_at) VALUES (?, ?, ?, ?)`)
      .run(id, userId2, nick2, now);
    return groupsDb.get(id);
  },

  addMember: (groupId, userId, nickname) => {
    db.prepare(`INSERT OR REPLACE INTO group_members (group_id, user_id, nickname, joined_at)
      VALUES (?, ?, ?, ?)`)
      .run(groupId, userId, nickname, Date.now());
  },

  getMembers: (groupId) =>
    db.prepare('SELECT * FROM group_members WHERE group_id = ?').all(groupId),

  isMember: (groupId, userId) =>
    !!db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?')
      .get(groupId, userId),

  addMessage: (id, groupId, userId, nickname, role, content) => {
    db.prepare(`INSERT INTO group_messages
      (id, group_id, user_id, nickname, role, content, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(id, groupId, userId, nickname, role, content, Date.now());
  },

  getMessages: (groupId, limit = 100) =>
    db.prepare(`SELECT * FROM group_messages WHERE group_id = ?
      ORDER BY created_at ASC LIMIT ?`).all(groupId, limit),

  getRecentMessages: (groupId, limit = 20) =>
    db.prepare(`SELECT * FROM group_messages WHERE group_id = ?
      ORDER BY created_at DESC LIMIT ?`).all(groupId, limit).reverse(),

  // Bot 操作
  createBot: (id, name, color, systemPrompt, apiKey, baseUrl, model) => {
    const now = Date.now();
    db.prepare(`INSERT INTO bots (id, name, color, system_prompt, api_key, base_url, model, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, name, color, systemPrompt || '', apiKey || '', baseUrl || '', model || '', now);
    return db.prepare('SELECT * FROM bots WHERE id = ?').get(id);
  },

  listBots: () => db.prepare('SELECT * FROM bots ORDER BY created_at ASC').all(),

  getBot: (id) => db.prepare('SELECT * FROM bots WHERE id = ?').get(id),

  updateBot: (id, fields) => {
    const sets = Object.keys(fields).map(k => `${k} = ?`).join(', ');
    const vals = [...Object.values(fields), id];
    db.prepare(`UPDATE bots SET ${sets} WHERE id = ?`).run(...vals);
    return db.prepare('SELECT * FROM bots WHERE id = ?').get(id);
  },

  deleteBot: (id) => db.prepare('DELETE FROM bots WHERE id = ?').run(id),

  // 群-Bot 关联
  addBotToGroup: (groupId, botId, position) => {
    db.prepare(`INSERT OR REPLACE INTO group_bots (group_id, bot_id, position)
      VALUES (?, ?, ?)`)
      .run(groupId, botId, position ?? 0);
  },

  removeBotFromGroup: (groupId, botId) =>
    db.prepare('DELETE FROM group_bots WHERE group_id = ? AND bot_id = ?').run(groupId, botId),

  getGroupBots: (groupId) =>
    db.prepare(`SELECT b.* FROM bots b
      JOIN group_bots gb ON b.id = gb.bot_id
      WHERE gb.group_id = ?
      ORDER BY gb.position ASC`).all(groupId),

  setActiveBot: (groupId, botId) =>
    db.prepare('UPDATE groups SET active_bot_id = ? WHERE id = ?').run(botId, groupId),

  clearActiveBot: (groupId) =>
    db.prepare('UPDATE groups SET active_bot_id = NULL WHERE id = ?').run(groupId),

  // 成员角色
  setMemberRole: (groupId, userId, role) =>
    db.prepare('UPDATE group_members SET role = ? WHERE group_id = ? AND user_id = ?').run(role, groupId, userId),

  getMemberRole: (groupId, userId) => {
    const row = db.prepare('SELECT role FROM group_members WHERE group_id = ? AND user_id = ?').get(groupId, userId);
    return row?.role || 'member';
  },

  removeMember: (groupId, userId) =>
    db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').run(groupId, userId),

  // 审计日志
  addAuditLog: (id, groupId, operatorId, operatorType, action, targetUserId, targetNickname, reason) =>
    db.prepare(`INSERT INTO group_audit_log
      (id, group_id, operator_id, operator_type, action, target_user_id, target_nickname, reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, groupId, operatorId, operatorType, action, targetUserId, targetNickname, reason, Date.now()),

  getAuditLog: (groupId, limit = 50) =>
    db.prepare('SELECT * FROM group_audit_log WHERE group_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(groupId, limit),
};
