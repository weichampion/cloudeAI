import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '../../data');
mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(join(DATA_DIR, 'openclaw.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '新对话',
    user_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);
`);

// 兼容旧数据库：添加 user_id 列（如果不存在）
try {
  db.exec(`ALTER TABLE sessions ADD COLUMN user_id TEXT`);
} catch {}

// ---- sessions ----
export const sessionsDb = {
  list: (userId) =>
    db.prepare('SELECT * FROM sessions WHERE user_id = ? ORDER BY updated_at DESC').all(userId),

  get: (id) =>
    db.prepare('SELECT * FROM sessions WHERE id = ?').get(id),

  create: (id, title, userId) => {
    const now = Date.now();
    db.prepare('INSERT INTO sessions (id, title, user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, title, userId, now, now);
    return sessionsDb.get(id);
  },

  updateTitle: (id, title) => {
    db.prepare('UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?')
      .run(title, Date.now(), id);
  },

  touch: (id) => {
    db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?')
      .run(Date.now(), id);
  },

  delete: (id) => {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  },
};

// ---- messages ----
export const messagesDb = {
  listBySession: (sessionId, limit = 200) =>
    db.prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC LIMIT ?')
      .all(sessionId, limit),

  add: (id, sessionId, role, content) => {
    db.prepare('INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, sessionId, role, content, Date.now());
  },

  deleteBySession: (sessionId) => {
    db.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId);
  },
};

export default db;
