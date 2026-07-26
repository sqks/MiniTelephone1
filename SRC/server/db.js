import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const RESOURCE_DIR = path.join(__dirname, '..', '..', 'resource');
fs.mkdirSync(RESOURCE_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(RESOURCE_DIR, 'minitelephone.db'));

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  uid         INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  age         INTEGER,
  school      TEXT NOT NULL DEFAULT '',
  avatar_id   INTEGER,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS avatars (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_uid    INTEGER NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  file_name   TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_uid    INTEGER NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entry_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id    INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  tag         TEXT NOT NULL,
  content     TEXT NOT NULL DEFAULT '',
  sort        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS friendships (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_uid    INTEGER NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  friend_uid  INTEGER NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  UNIQUE(user_uid, friend_uid)
);

CREATE TABLE IF NOT EXISTS friend_requests (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  from_uid     INTEGER NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  to_uid       INTEGER NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'pending',  -- pending / accepted / rejected
  created_at   TEXT NOT NULL,
  processed_at TEXT
);

CREATE TABLE IF NOT EXISTS registration_requests (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  age          INTEGER,
  school       TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'pending',
  uid          INTEGER,
  created_at   TEXT NOT NULL,
  processed_at TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  from_uid    INTEGER NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  to_uid      INTEGER NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  kind        TEXT NOT NULL DEFAULT 'text',
  content     TEXT NOT NULL DEFAULT '',
  duration    REAL,
  created_at  TEXT NOT NULL,
  read_at     TEXT
);

CREATE TABLE IF NOT EXISTS chat_groups (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS group_members (
  group_id    INTEGER NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
  user_uid    INTEGER NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (group_id, user_uid)
);

CREATE TABLE IF NOT EXISTS group_messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id    INTEGER NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
  from_uid    INTEGER NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  kind        TEXT NOT NULL DEFAULT 'text',
  content     TEXT NOT NULL DEFAULT '',
  duration    REAL,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_avatars_user ON avatars(user_uid, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_entries_user ON entries(user_uid, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_items_entry  ON entry_items(entry_id, sort);
CREATE INDEX IF NOT EXISTS idx_friend_user  ON friendships(user_uid);
CREATE INDEX IF NOT EXISTS idx_freq_to      ON friend_requests(to_uid, status);
CREATE INDEX IF NOT EXISTS idx_freq_from    ON friend_requests(from_uid, status);
CREATE INDEX IF NOT EXISTS idx_reg_status   ON registration_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_msg_pair     ON messages(from_uid, to_uid, id);
CREATE INDEX IF NOT EXISTS idx_msg_unread   ON messages(to_uid, from_uid, read_at);
CREATE INDEX IF NOT EXISTS idx_gmember_user ON group_members(user_uid);
CREATE INDEX IF NOT EXISTS idx_gmsg_group   ON group_messages(group_id, id);
`);

export function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value));
}

if (!getSetting('registration_mode')) setSetting('registration_mode', 'open');
if (!getSetting('admin_token')) setSetting('admin_token', 'admin123');

export function now() {
  return new Date().toISOString();
}
