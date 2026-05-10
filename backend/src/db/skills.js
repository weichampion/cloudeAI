import db from './index.js';
import { v4 as uuidv4 } from 'uuid';

db.exec(`
  CREATE TABLE IF NOT EXISTS skills (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    key TEXT UNIQUE NOT NULL,
    description TEXT NOT NULL,
    type TEXT NOT NULL,
    icon TEXT DEFAULT '🔧',
    config TEXT DEFAULT '{}',
    parameters TEXT DEFAULT '{}',
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS agent_skills (
    agent_id TEXT NOT NULL,
    skill_id TEXT NOT NULL,
    PRIMARY KEY (agent_id, skill_id),
    FOREIGN KEY (agent_id) REFERENCES bots(id) ON DELETE CASCADE,
    FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
  );
`);

export const skillsDb = {
  create: (id, name, key, description, type, icon, config, parameters) => {
    const now = Date.now();
    db.prepare(`INSERT INTO skills (id, name, key, description, type, icon, config, parameters, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, name, key, description, type, icon || '🔧',
      typeof config === 'string' ? config : JSON.stringify(config || {}),
      typeof parameters === 'string' ? parameters : JSON.stringify(parameters || {}),
      now);
    return skillsDb.get(id);
  },

  list: () => db.prepare('SELECT * FROM skills ORDER BY created_at ASC').all(),

  get: (id) => db.prepare('SELECT * FROM skills WHERE id = ?').get(id),

  getByKey: (key) => db.prepare('SELECT * FROM skills WHERE key = ?').get(key),

  update: (id, fields) => {
    const allowed = ['name', 'key', 'description', 'type', 'icon', 'config', 'parameters'];
    const entries = Object.entries(fields).filter(([k]) => allowed.includes(k));
    if (!entries.length) return skillsDb.get(id);
    const sets = entries.map(([k]) => `${k} = ?`).join(', ');
    const vals = entries.map(([, v]) => typeof v === 'object' ? JSON.stringify(v) : v);
    db.prepare(`UPDATE skills SET ${sets} WHERE id = ?`).run(...vals, id);
    return skillsDb.get(id);
  },

  delete: (id) => db.prepare('DELETE FROM skills WHERE id = ?').run(id),

  // Agent-Skill binding
  getAgentSkills: (agentId) =>
    db.prepare(`SELECT s.* FROM skills s
      JOIN agent_skills as_t ON s.id = as_t.skill_id
      WHERE as_t.agent_id = ?
      ORDER BY s.created_at ASC`).all(agentId),

  addAgentSkill: (agentId, skillId) => {
    db.prepare(`INSERT OR IGNORE INTO agent_skills (agent_id, skill_id) VALUES (?, ?)`)
      .run(agentId, skillId);
  },

  removeAgentSkill: (agentId, skillId) => {
    db.prepare('DELETE FROM agent_skills WHERE agent_id = ? AND skill_id = ?').run(agentId, skillId);
  },

  hasAgentSkill: (agentId, skillId) =>
    !!db.prepare('SELECT 1 FROM agent_skills WHERE agent_id = ? AND skill_id = ?').get(agentId, skillId),
};

// 初始化内置技能（若不存在）
const BUILTIN_SKILLS = [
  {
    key: 'get_current_datetime',
    name: '获取当前时间',
    description: 'Get the current date and time. Use when user asks about current time, date, or day of week.',
    type: 'builtin_datetime',
    icon: '🕐',
    parameters: JSON.stringify({ type: 'object', properties: {} }),
  },
  {
    key: 'calculate',
    name: '数学计算',
    description: 'Evaluate a mathematical expression safely. Use for arithmetic, algebra, or any math calculation.',
    type: 'builtin_calculator',
    icon: '🔢',
    parameters: JSON.stringify({
      type: 'object',
      properties: {
        expression: { type: 'string', description: 'The math expression to evaluate, e.g. "2 + 3 * 4"' },
      },
      required: ['expression'],
    }),
  },
  {
    key: 'generate_random',
    name: '生成随机数',
    description: 'Generate a random integer between min and max (inclusive).',
    type: 'builtin_random',
    icon: '🎲',
    parameters: JSON.stringify({
      type: 'object',
      properties: {
        min: { type: 'number', description: 'Minimum value (inclusive)' },
        max: { type: 'number', description: 'Maximum value (inclusive)' },
      },
      required: ['min', 'max'],
    }),
  },
];

const MODERATION_SKILLS = [
  {
    key: 'moderation_kick',
    name: '踢出成员',
    description: 'Kick a member out of the group. Use when a user violates group rules or posts inappropriate content. Requires target_user_id and reason.',
    type: 'moderation_kick',
    icon: '🚫',
    parameters: JSON.stringify({
      type: 'object',
      properties: {
        target_user_id: { type: 'string', description: 'The user_id of the member to kick' },
        reason: { type: 'string', description: 'Reason for kicking the member' },
      },
      required: ['target_user_id', 'reason'],
    }),
  },
  {
    key: 'moderation_warn',
    name: '警告成员',
    description: 'Warn a member about inappropriate behavior. Use before kicking if the violation is minor.',
    type: 'moderation_warn',
    icon: '⚠️',
    parameters: JSON.stringify({
      type: 'object',
      properties: {
        target_user_id: { type: 'string', description: 'The user_id of the member to warn' },
        reason: { type: 'string', description: 'Reason for the warning' },
      },
      required: ['target_user_id', 'reason'],
    }),
  },
  {
    key: 'moderation_mute',
    name: '禁言成员',
    description: 'Mute a member so they cannot send messages. Use for repeated violations.',
    type: 'moderation_mute',
    icon: '🔇',
    parameters: JSON.stringify({
      type: 'object',
      properties: {
        target_user_id: { type: 'string', description: 'The user_id of the member to mute' },
        reason: { type: 'string', description: 'Reason for muting' },
      },
      required: ['target_user_id', 'reason'],
    }),
  },
  {
    key: 'moderation_unmute',
    name: '解除禁言',
    description: 'Unmute a previously muted member, restoring their ability to send messages.',
    type: 'moderation_unmute',
    icon: '🔔',
    parameters: JSON.stringify({
      type: 'object',
      properties: {
        target_user_id: { type: 'string', description: 'The user_id of the member to unmute' },
        reason: { type: 'string', description: 'Reason for unmuting' },
      },
      required: ['target_user_id'],
    }),
  },
];

for (const s of [...BUILTIN_SKILLS, ...MODERATION_SKILLS]) {
  const existing = skillsDb.getByKey(s.key);
  if (!existing) {
    skillsDb.create(uuidv4(), s.name, s.key, s.description, s.type, s.icon, '{}', s.parameters);
  }
}
