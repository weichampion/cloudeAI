import db from './index.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS service_connectors (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL, -- llm / vision / asr / tts / mcp / custom
    base_url TEXT NOT NULL,
    health_path TEXT DEFAULT '/health',
    api_key TEXT DEFAULT '',
    config_json TEXT DEFAULT '{}',
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS skill_packs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    key TEXT UNIQUE NOT NULL,
    description TEXT DEFAULT '',
    config_json TEXT DEFAULT '{}',
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
`);

function parseJsonSafe(str, fallback = {}) {
  try { return JSON.parse(str || '{}'); } catch { return fallback; }
}

function hydrateConnector(row) {
  if (!row) return row;
  return {
    ...row,
    enabled: !!row.enabled,
    config: parseJsonSafe(row.config_json, {}),
  };
}

function hydrateSkillPack(row) {
  if (!row) return row;
  return {
    ...row,
    enabled: !!row.enabled,
    config: parseJsonSafe(row.config_json, {}),
  };
}

export const controlDb = {
  // ----- connectors -----
  listConnectors: () =>
    db.prepare('SELECT * FROM service_connectors ORDER BY updated_at DESC').all().map(hydrateConnector),

  getConnector: (id) =>
    hydrateConnector(db.prepare('SELECT * FROM service_connectors WHERE id = ?').get(id)),

  createConnector: (id, fields) => {
    const now = Date.now();
    db.prepare(`INSERT INTO service_connectors
      (id, name, type, base_url, health_path, api_key, config_json, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        id,
        fields.name,
        fields.type,
        fields.base_url,
        fields.health_path || '/health',
        fields.api_key || '',
        JSON.stringify(fields.config || {}),
        fields.enabled === false ? 0 : 1,
        now,
        now
      );
    return controlDb.getConnector(id);
  },

  updateConnector: (id, fields) => {
    const sets = [];
    const vals = [];
    if (fields.name !== undefined) { sets.push('name = ?'); vals.push(fields.name); }
    if (fields.type !== undefined) { sets.push('type = ?'); vals.push(fields.type); }
    if (fields.base_url !== undefined) { sets.push('base_url = ?'); vals.push(fields.base_url); }
    if (fields.health_path !== undefined) { sets.push('health_path = ?'); vals.push(fields.health_path); }
    if (fields.api_key !== undefined) { sets.push('api_key = ?'); vals.push(fields.api_key); }
    if (fields.config !== undefined) { sets.push('config_json = ?'); vals.push(JSON.stringify(fields.config || {})); }
    if (fields.enabled !== undefined) { sets.push('enabled = ?'); vals.push(fields.enabled ? 1 : 0); }
    sets.push('updated_at = ?'); vals.push(Date.now());
    vals.push(id);
    db.prepare(`UPDATE service_connectors SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    return controlDb.getConnector(id);
  },

  deleteConnector: (id) =>
    db.prepare('DELETE FROM service_connectors WHERE id = ?').run(id),

  // ----- skill packs -----
  listSkillPacks: () =>
    db.prepare('SELECT * FROM skill_packs ORDER BY updated_at DESC').all().map(hydrateSkillPack),

  getSkillPack: (id) =>
    hydrateSkillPack(db.prepare('SELECT * FROM skill_packs WHERE id = ?').get(id)),

  createSkillPack: (id, fields) => {
    const now = Date.now();
    db.prepare(`INSERT INTO skill_packs
      (id, name, key, description, config_json, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        id,
        fields.name,
        fields.key,
        fields.description || '',
        JSON.stringify(fields.config || {}),
        fields.enabled === false ? 0 : 1,
        now,
        now
      );
    return controlDb.getSkillPack(id);
  },

  updateSkillPack: (id, fields) => {
    const sets = [];
    const vals = [];
    if (fields.name !== undefined) { sets.push('name = ?'); vals.push(fields.name); }
    if (fields.key !== undefined) { sets.push('key = ?'); vals.push(fields.key); }
    if (fields.description !== undefined) { sets.push('description = ?'); vals.push(fields.description); }
    if (fields.config !== undefined) { sets.push('config_json = ?'); vals.push(JSON.stringify(fields.config || {})); }
    if (fields.enabled !== undefined) { sets.push('enabled = ?'); vals.push(fields.enabled ? 1 : 0); }
    sets.push('updated_at = ?'); vals.push(Date.now());
    vals.push(id);
    db.prepare(`UPDATE skill_packs SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    return controlDb.getSkillPack(id);
  },

  deleteSkillPack: (id) =>
    db.prepare('DELETE FROM skill_packs WHERE id = ?').run(id),
};

