import db from './index.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS discussion_sessions (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    topic TEXT NOT NULL,
    status TEXT DEFAULT 'running' CHECK(status IN ('running','concluded','timeout')),
    round INTEGER DEFAULT 0,
    max_rounds INTEGER DEFAULT 6,
    shared_state TEXT DEFAULT '{}',
    conclusion TEXT DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS discussion_rounds (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    round INTEGER NOT NULL,
    bot_id TEXT NOT NULL,
    bot_name TEXT NOT NULL,
    content TEXT NOT NULL,
    next_bot_id TEXT DEFAULT NULL,
    action TEXT DEFAULT 'continue' CHECK(action IN ('continue','pass_to','conclude','request_info')),
    created_at INTEGER NOT NULL,
    FOREIGN KEY (session_id) REFERENCES discussion_sessions(id) ON DELETE CASCADE
  );
`);

export const discussionDb = {
  createSession: (id, groupId, topic, maxRounds = 6) => {
    const now = Date.now();
    db.prepare(`INSERT INTO discussion_sessions
      (id, group_id, topic, max_rounds, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run(id, groupId, topic, maxRounds, now, now);
    return discussionDb.getSession(id);
  },

  getSession: (id) =>
    db.prepare('SELECT * FROM discussion_sessions WHERE id = ?').get(id),

  updateSession: (id, fields) => {
    const allowed = ['status', 'round', 'shared_state', 'conclusion'];
    const entries = Object.entries(fields).filter(([k]) => allowed.includes(k));
    if (!entries.length) return;
    const sets = entries.map(([k]) => `${k} = ?`).join(', ');
    const vals = entries.map(([, v]) => v);
    db.prepare(`UPDATE discussion_sessions SET ${sets}, updated_at = ? WHERE id = ?`)
      .run(...vals, Date.now(), id);
  },

  addRound: (id, sessionId, round, botId, botName, content, action, nextBotId) => {
    db.prepare(`INSERT INTO discussion_rounds
      (id, session_id, round, bot_id, bot_name, content, action, next_bot_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, sessionId, round, botId, botName, content, action, nextBotId ?? null, Date.now());
  },

  getRounds: (sessionId) =>
    db.prepare('SELECT * FROM discussion_rounds WHERE session_id = ? ORDER BY round ASC')
      .all(sessionId),

  getActiveSession: (groupId) =>
    db.prepare(`SELECT * FROM discussion_sessions WHERE group_id = ? AND status = 'running'
      ORDER BY created_at DESC LIMIT 1`).get(groupId),
};
