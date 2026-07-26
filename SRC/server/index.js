import express from 'express';
import cors from 'cors';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import os from 'node:os';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import selfsigned from 'selfsigned';
import { db, now, getSetting, setSetting, RESOURCE_DIR } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));
// resource/<uid>/avatars|messages/<file> 静态托管
app.use('/resource', express.static(RESOURCE_DIR));

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const httpError = (status, message) => new HttpError(status, message);

// ---------------- helpers ----------------
const avatarUrl = (uid, fileName) => `/resource/${uid}/avatars/${fileName}`;
const msgUrl = (uid, fileName) => `/resource/${uid}/messages/${fileName}`;

function userPayload(uid) {
  const u = db
    .prepare(
      `SELECT u.uid, u.name, u.age, u.school, u.created_at, u.updated_at, av.file_name AS avatar_file
       FROM users u
       LEFT JOIN avatars av ON av.id = u.avatar_id
       WHERE u.uid = ?`
    )
    .get(uid);
  if (!u) return null;
  return {
    uid: u.uid,
    name: u.name,
    age: u.age,
    school: u.school,
    avatar_url: u.avatar_file ? avatarUrl(u.uid, u.avatar_file) : null,
    created_at: u.created_at,
    updated_at: u.updated_at,
  };
}

function uidTaken(uid) {
  return !!db.prepare('SELECT 1 FROM users WHERE uid = ?').get(uid);
}

function allocUid(preferred) {
  if (preferred !== null && preferred !== undefined && preferred !== '') {
    const uid = Number(preferred);
    if (!Number.isInteger(uid) || uid < 1 || uid > 999999) {
      throw httpError(400, 'UID 必须是 1～999999 之间的整数（不超过 6 位）');
    }
    if (uidTaken(uid)) throw httpError(400, `UID ${uid} 已被使用`);
    return uid;
  }
  for (let i = 0; i < 300; i += 1) {
    const uid = crypto.randomInt(1, 1_000_000); // 1 ~ 999999，不超过 6 位
    if (!uidTaken(uid)) return uid;
  }
  throw httpError(500, 'UID 分配失败，请重试');
}

function createUser({ name, age = null, school = '', uid = null }) {
  const assigned = allocUid(uid);
  const t = now();
  db.prepare(
    'INSERT INTO users (uid, name, age, school, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(assigned, name, age, school, t, t);
  return assigned;
}

function cleanProfile(body, { requireAll = false } = {}) {
  const name = String(body?.name ?? '').trim();
  const school = String(body?.school ?? '').trim();
  const rawAge = body?.age;
  const age = rawAge === undefined || rawAge === null || rawAge === '' ? null : Number(rawAge);
  if (!name) throw httpError(400, '姓名不能为空');
  if (name.length > 30) throw httpError(400, '姓名最长 30 个字符');
  if (requireAll) {
    if (age === null) throw httpError(400, '年龄不能为空');
    if (!school) throw httpError(400, '学校不能为空');
  }
  if (age !== null && (!Number.isInteger(age) || age < 1 || age > 150)) {
    throw httpError(400, '年龄必须是 1～150 的整数');
  }
  if (school.length > 60) throw httpError(400, '学校最长 60 个字符');
  return { name, age, school };
}

// ---------------- identity middleware ----------------
app.use('/api', (req, res, next) => {
  req.accountId = null;
  const raw = req.header('x-account-id');
  if (raw) {
    const uid = Number(raw);
    if (
      Number.isInteger(uid) &&
      uid > 0 &&
      db.prepare('SELECT 1 FROM users WHERE uid = ?').get(uid)
    ) {
      req.accountId = uid;
    }
  }
  next();
});

function requireUser(req, res, next) {
  if (!req.accountId) return res.status(401).json({ error: '未登录或用户不存在' });
  next();
}

function requireAdmin(req, res, next) {
  const token = req.header('x-admin-token') || '';
  if (token && token === getSetting('admin_token')) return next();
  return res.status(401).json({ error: '管理密钥错误或已失效' });
}

// ---------------- public routes ----------------
app.get('/api/mode', (req, res) => {
  res.json({ mode: getSetting('registration_mode', 'open') });
});

app.post('/api/register', (req, res) => {
  if (getSetting('registration_mode') !== 'open') {
    throw httpError(403, '当前未开放注册，请联系管理员获取账号');
  }
  const { name, age, school } = cleanProfile(req.body, { requireAll: true });
  const dup = db
    .prepare("SELECT id FROM registration_requests WHERE name = ? AND school = ? AND status = 'pending'")
    .get(name, school);
  if (dup) {
    return res.json({ request_id: dup.id, status: 'pending', duplicated: true });
  }
  const r = db
    .prepare('INSERT INTO registration_requests (name, age, school, created_at) VALUES (?, ?, ?, ?)')
    .run(name, age, school, now());
  res.status(201).json({ request_id: Number(r.lastInsertRowid), status: 'pending' });
});

app.get('/api/register/status/:id', (req, res) => {
  const row = db
    .prepare('SELECT id, name, status, uid, created_at, processed_at FROM registration_requests WHERE id = ?')
    .get(Number(req.params.id));
  if (!row) throw httpError(404, '申请不存在');
  res.json(row);
});

// ---------------- admin routes ----------------
const admin = express.Router();
admin.use(requireAdmin);

admin.get('/overview', (req, res) => {
  const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  const pendingCount = db
    .prepare("SELECT COUNT(*) AS c FROM registration_requests WHERE status = 'pending'")
    .get().c;
  res.json({
    user_count: userCount,
    pending_count: pendingCount,
    mode: getSetting('registration_mode', 'open'),
  });
});

admin.put('/settings', (req, res) => {
  const mode = req.body?.mode;
  if (!['open', 'closed'].includes(mode)) throw httpError(400, 'mode 只能是 open 或 closed');
  setSetting('registration_mode', mode);
  res.json({ mode });
});

admin.put('/token', (req, res) => {
  const next = String(req.body?.next ?? '');
  if (next.length < 4 || next.length > 64) throw httpError(400, '新密钥长度须为 4～64 个字符');
  setSetting('admin_token', next);
  res.json({ ok: true });
});

admin.get('/integrations', (req, res) => {
  const key = getSetting('deepseek_api_key', '');
  const envKey = process.env.DEEPSEEK_API_KEY || '';
  res.json({
    deepseek_key_set: !!(key || envKey),
    deepseek_key_masked: key
      ? `${key.slice(0, 6)}…${key.slice(-4)}`
      : envKey
        ? '（来自环境变量 DEEPSEEK_API_KEY）'
        : null,
  });
});

admin.put('/integrations', (req, res) => {
  const key = String(req.body?.deepseek_api_key ?? '').trim();
  if (key && (key.length < 10 || key.length > 128)) throw httpError(400, 'API Key 格式不正确');
  setSetting('deepseek_api_key', key); // 空字符串 = 清除
  res.json({ ok: true, deepseek_key_set: !!key });
});

admin.get('/requests', (req, res) => {
  const status = String(req.query.status ?? 'pending');
  const where = ['pending', 'approved', 'rejected'].includes(status) ? status : 'pending';
  const rows = db
    .prepare(
      `SELECT id, name, age, school, status, uid, created_at, processed_at
       FROM registration_requests WHERE status = ? ORDER BY created_at DESC, id DESC`
    )
    .all(where);
  res.json(rows);
});

admin.post('/requests/:id/approve', (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM registration_requests WHERE id = ?').get(id);
  if (!row) throw httpError(404, '申请不存在');
  if (row.status !== 'pending') throw httpError(400, '该申请已处理过了');
  const uid = createUser({
    name: row.name,
    age: row.age,
    school: row.school,
    uid: req.body?.uid ?? null,
  });
  db.prepare("UPDATE registration_requests SET status = 'approved', uid = ?, processed_at = ? WHERE id = ?")
    .run(uid, now(), id);
  res.json({ uid });
});

admin.post('/requests/:id/reject', (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM registration_requests WHERE id = ?').get(id);
  if (!row) throw httpError(404, '申请不存在');
  if (row.status !== 'pending') throw httpError(400, '该申请已处理过了');
  db.prepare("UPDATE registration_requests SET status = 'rejected', processed_at = ? WHERE id = ?")
    .run(now(), id);
  res.json({ ok: true });
});

admin.get('/users', (req, res) => {
  const rows = db
    .prepare('SELECT uid FROM users ORDER BY created_at DESC, uid DESC')
    .all();
  res.json(rows.map((r) => userPayload(r.uid)));
});

admin.post('/users', (req, res) => {
  const { name, age, school } = cleanProfile(req.body);
  const uid = createUser({ name, age, school, uid: req.body?.uid ?? null });
  res.status(201).json(userPayload(uid));
});

admin.delete('/users/:uid', (req, res) => {
  const uid = Number(req.params.uid);
  if (!uidTaken(uid)) throw httpError(404, '用户不存在');
  db.prepare('DELETE FROM users WHERE uid = ?').run(uid); // avatars/entries/friendships/messages 级联删除
  // 删除该用户的整个资源目录（历史头像 + 聊天文件）
  fs.rm(path.join(RESOURCE_DIR, String(uid)), { recursive: true, force: true }, () => {});
  res.json({ ok: true });
});

// ---------------- admin: 群组管理 ----------------
function groupPayload(id) {
  const g = db.prepare('SELECT * FROM chat_groups WHERE id = ?').get(id);
  if (!g) return null;
  const members = db
    .prepare('SELECT user_uid FROM group_members WHERE group_id = ? ORDER BY created_at, user_uid')
    .all(id)
    .map((r) => userPayload(r.user_uid));
  return { id: g.id, name: g.name, created_at: g.created_at, members, member_count: members.length };
}

admin.get('/groups', (req, res) => {
  const rows = db.prepare('SELECT id FROM chat_groups ORDER BY created_at DESC, id DESC').all();
  res.json(rows.map((r) => groupPayload(r.id)));
});

admin.post('/groups', (req, res) => {
  const uids = Array.isArray(req.body?.uids) ? [...new Set(req.body.uids.map(Number))] : [];
  if (uids.length < 2) throw httpError(400, '群组至少需要选择 2 位用户');
  if (uids.length > 100) throw httpError(400, '一个群组最多 100 人');
  if (uids.some((u) => !Number.isInteger(u) || u < 1 || u > 999999)) throw httpError(400, '成员 UID 不正确');
  const missing = uids.filter((u) => !uidTaken(u));
  if (missing.length) throw httpError(400, `UID ${missing[0]} 不存在`);
  let name = String(req.body?.name ?? '').trim();
  if (name.length > 30) throw httpError(400, '群名最长 30 个字符');
  if (!name) {
    const names = uids.slice(0, 3).map((u) => db.prepare('SELECT name FROM users WHERE uid = ?').get(u).name);
    name = names.join('、') + (uids.length > 3 ? ' 等的群' : ' 的群');
  }
  const t = now();
  db.exec('BEGIN');
  try {
    const r = db.prepare('INSERT INTO chat_groups (name, created_at) VALUES (?, ?)').run(name, t);
    const gid = Number(r.lastInsertRowid);
    const ins = db.prepare('INSERT INTO group_members (group_id, user_uid, created_at) VALUES (?, ?, ?)');
    for (const u of uids) ins.run(gid, u, t);
    db.exec('COMMIT');
    res.status(201).json(groupPayload(gid));
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
});

admin.delete('/groups/:id', (req, res) => {
  const r = db.prepare('DELETE FROM chat_groups WHERE id = ?').run(Number(req.params.id));
  if (r.changes === 0) throw httpError(404, '群组不存在');
  res.json({ ok: true }); // 成员与群消息级联删除
});

admin.post('/groups/:id/members', (req, res) => {
  const gid = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM chat_groups WHERE id = ?').get(gid)) throw httpError(404, '群组不存在');
  const uid = Number(req.body?.uid);
  if (!Number.isInteger(uid) || uid < 1 || uid > 999999) throw httpError(400, 'UID 不正确');
  if (!uidTaken(uid)) throw httpError(404, `UID ${uid} 不存在`);
  const dup = db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_uid = ?').get(gid, uid);
  if (dup) throw httpError(400, '该用户已在群里');
  db.prepare('INSERT INTO group_members (group_id, user_uid, created_at) VALUES (?, ?, ?)').run(gid, uid, now());
  res.status(201).json(groupPayload(gid));
});

admin.delete('/groups/:id/members/:uid', (req, res) => {
  const r = db
    .prepare('DELETE FROM group_members WHERE group_id = ? AND user_uid = ?')
    .run(Number(req.params.id), Number(req.params.uid));
  if (r.changes === 0) throw httpError(404, '该成员不在群里');
  res.json(groupPayload(Number(req.params.id)));
});

// ---------------- admin: 存储监控 ----------------
function dirStats(dir) {
  let bytes = 0;
  let files = 0;
  let stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let items;
    try {
      items = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const it of items) {
      const p = path.join(cur, it.name);
      if (it.isDirectory()) stack.push(p);
      else if (it.isFile()) {
        files += 1;
        try {
          bytes += fs.statSync(p).size;
        } catch {
          // 文件被占用等情况忽略
        }
      }
    }
  }
  return { bytes, files };
}

admin.get('/storage', (req, res) => {
  // resource/<uid>/avatars|messages 分类统计
  let avatarBytes = 0;
  let avatarFiles = 0;
  let messageBytes = 0;
  let messageFiles = 0;
  for (const entry of fs.readdirSync(RESOURCE_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const a = dirStats(path.join(RESOURCE_DIR, entry.name, 'avatars'));
    const m = dirStats(path.join(RESOURCE_DIR, entry.name, 'messages'));
    avatarBytes += a.bytes;
    avatarFiles += a.files;
    messageBytes += m.bytes;
    messageFiles += m.files;
  }
  const count = (sql) => db.prepare(sql).get().c;
  const dbFile = path.join(RESOURCE_DIR, 'minitelephone.db');
  let dbBytes = 0;
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      dbBytes += fs.statSync(dbFile + suffix).size;
    } catch {
      // 文件不存在时忽略
    }
  }
  let disk = null;
  try {
    const s = fs.statfsSync(RESOURCE_DIR);
    disk = { total: s.blocks * s.bsize, free: s.bavail * s.bsize };
  } catch {
    // 个别平台不支持 statfs，忽略
  }
  res.json({
    db_bytes: dbBytes,
    avatars: { bytes: avatarBytes, files: avatarFiles },
    messages_files: { bytes: messageBytes, files: messageFiles },
    total_bytes: dbBytes + avatarBytes + messageBytes,
    disk,
    counts: {
      users: count('SELECT COUNT(*) AS c FROM users'),
      dm_messages: count('SELECT COUNT(*) AS c FROM messages'),
      group_messages: count('SELECT COUNT(*) AS c FROM group_messages'),
      groups: count('SELECT COUNT(*) AS c FROM chat_groups'),
      pending_requests: count("SELECT COUNT(*) AS c FROM registration_requests WHERE status = 'pending'"),
    },
  });
});

// ---------------- admin: 数据导出（zip：数据库 + 图片/语音文件） ----------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf, crc = 0) {
  let c = crc ^ 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function collectFiles(dir, zipPrefix, out) {
  let items;
  try {
    items = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const it of items) {
    const abs = path.join(dir, it.name);
    if (it.isDirectory()) collectFiles(abs, `${zipPrefix}/${it.name}`, out);
    else if (it.isFile()) out.push({ name: `${zipPrefix}/${it.name}`, absPath: abs });
  }
}

async function streamZip(res, entries) {
  const central = [];
  let offset = 0;
  const write = async (buf) => {
    offset += buf.length;
    if (!res.write(buf)) await once(res, 'drain');
  };
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const localOffset = offset;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0808, 6); // bit3 数据描述符 + bit11 UTF-8 文件名
    local.writeUInt16LE(0, 8); // store（不压缩，语音/图片本身已是压缩格式）
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(0, 14); // crc 写入数据描述符
    local.writeUInt32LE(0, 18);
    local.writeUInt32LE(0, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    await write(local);
    await write(nameBuf);
    let crc = 0;
    let size = 0;
    const source = e.buffer ? [e.buffer] : fs.createReadStream(e.absPath);
    for await (const chunk of source) {
      crc = crc32(chunk, crc);
      size += chunk.length;
      await write(chunk);
    }
    const dd = Buffer.alloc(16);
    dd.writeUInt32LE(0x08074b50, 0); // data descriptor
    dd.writeUInt32LE(crc, 4);
    dd.writeUInt32LE(size, 8);
    dd.writeUInt32LE(size, 12);
    await write(dd);
    central.push({ nameBuf, crc, size, localOffset });
  }
  const cdStart = offset;
  for (const c of central) {
    const h = Buffer.alloc(46);
    h.writeUInt32LE(0x02014b50, 0); // central directory header
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(20, 6);
    h.writeUInt16LE(0x0808, 8);
    h.writeUInt16LE(0, 10);
    h.writeUInt16LE(0, 12);
    h.writeUInt16LE(0, 14);
    h.writeUInt32LE(c.crc, 16);
    h.writeUInt32LE(c.size, 20);
    h.writeUInt32LE(c.size, 24);
    h.writeUInt16LE(c.nameBuf.length, 28);
    h.writeUInt32LE(0, 38);
    h.writeUInt32LE(c.localOffset, 42);
    await write(h);
    await write(c.nameBuf);
  }
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // end of central directory
  eocd.writeUInt16LE(central.length, 8);
  eocd.writeUInt16LE(central.length, 10);
  eocd.writeUInt32LE(offset - cdStart, 12);
  eocd.writeUInt32LE(cdStart, 16);
  await write(eocd);
  res.end();
}

admin.get('/export', (req, res, next) => {
  (async () => {
    try {
      db.exec('PRAGMA wal_checkpoint(FULL)'); // 先落盘，保证 db 文件是最新完整数据
    } catch {
      // checkpoint 失败仍继续导出
    }
    const entries = [];
    const dbFile = path.join(RESOURCE_DIR, 'minitelephone.db');
    if (fs.existsSync(dbFile)) entries.push({ name: 'minitelephone.db', absPath: dbFile });
    for (const entry of fs.readdirSync(RESOURCE_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      collectFiles(path.join(RESOURCE_DIR, entry.name), `resource/${entry.name}`, entries);
    }
    entries.push({
      name: 'manifest.json',
      buffer: Buffer.from(
        JSON.stringify(
          {
            app: 'MiniTelephone',
            exported_at: now(),
            users: db.prepare('SELECT COUNT(*) AS c FROM users').get().c,
            dm_messages: db.prepare('SELECT COUNT(*) AS c FROM messages').get().c,
            group_messages: db.prepare('SELECT COUNT(*) AS c FROM group_messages').get().c,
            files: entries.length - 1,
          },
          null,
          2
        ),
        'utf8'
      ),
    });
    const stamp = now().replace(/[:.]/g, '-').slice(0, 19);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="minitelephone-backup-${stamp}.zip"`);
    try {
      await streamZip(res, entries);
    } catch (e) {
      res.destroy(e);
    }
  })().catch(next);
});

// ---------------- admin: 数据删除 ----------------
admin.delete('/data/messages', (req, res) => {
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM messages').run();
    db.prepare('DELETE FROM group_messages').run();
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  // 删除所有聊天文件（图片/语音），保留头像
  for (const entry of fs.readdirSync(RESOURCE_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    fs.rm(path.join(RESOURCE_DIR, entry.name, 'messages'), { recursive: true, force: true }, () => {});
  }
  res.json({ ok: true });
});

admin.delete('/data/all', (req, res) => {
  // 清空全部业务数据，保留 settings（管理密钥 / DeepSeek Key / 注册模式）
  db.exec('BEGIN');
  try {
    for (const table of [
      'messages',
      'group_messages',
      'group_members',
      'chat_groups',
      'friendships',
      'friend_requests',
      'entry_items',
      'entries',
      'avatars',
      'registration_requests',
      'users',
    ]) {
      db.prepare(`DELETE FROM ${table}`).run();
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  // 删除所有用户资源目录，保留根部的 minitelephone.db*
  for (const entry of fs.readdirSync(RESOURCE_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    fs.rm(path.join(RESOURCE_DIR, entry.name), { recursive: true, force: true }, () => {});
  }
  res.json({ ok: true });
});

app.use('/api/admin', admin);

// ---------------- current user ----------------
app.get('/api/me', requireUser, (req, res) => {
  res.json(userPayload(req.accountId));
});

app.put('/api/me', requireUser, (req, res) => {
  const { name, age, school } = cleanProfile(req.body);
  db.prepare('UPDATE users SET name = ?, age = ?, school = ?, updated_at = ? WHERE uid = ?')
    .run(name, age, school, now(), req.accountId);
  res.json(userPayload(req.accountId));
});

// ---------------- avatars ----------------
const EXT_MAP = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/heic': '.heic',
  'image/heif': '.heif',
  'image/avif': '.avif',
};

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(RESOURCE_DIR, String(req.accountId), 'avatars');
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = EXT_MAP[file.mimetype] || path.extname(file.originalname || '').toLowerCase() || '.jpg';
      cb(null, `${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`);
    },
  }),
  fileFilter: (req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('只支持图片文件'));
  },
  limits: { fileSize: 15 * 1024 * 1024 },
});

app.get('/api/me/avatars', requireUser, (req, res) => {
  const me = db.prepare('SELECT avatar_id FROM users WHERE uid = ?').get(req.accountId);
  const rows = db
    .prepare('SELECT id, file_name, created_at FROM avatars WHERE user_uid = ? ORDER BY created_at DESC, id DESC')
    .all(req.accountId);
  res.json(
    rows.map((r) => ({
      id: r.id,
      url: avatarUrl(req.accountId, r.file_name),
      created_at: r.created_at,
      current: r.id === me.avatar_id,
    }))
  );
});

app.post('/api/me/avatar', requireUser, upload.single('avatar'), (req, res) => {
  if (!req.file) throw httpError(400, '缺少头像文件');
  const t = now();
  const r = db
    .prepare('INSERT INTO avatars (user_uid, file_name, created_at) VALUES (?, ?, ?)')
    .run(req.accountId, req.file.filename, t);
  const avatarId = Number(r.lastInsertRowid);
  db.prepare('UPDATE users SET avatar_id = ?, updated_at = ? WHERE uid = ?')
    .run(avatarId, t, req.accountId);
  res.status(201).json({ id: avatarId, url: avatarUrl(req.accountId, req.file.filename), created_at: t });
});

app.post('/api/me/avatars/:id/use', requireUser, (req, res) => {
  const av = db
    .prepare('SELECT id FROM avatars WHERE id = ? AND user_uid = ?')
    .get(Number(req.params.id), req.accountId);
  if (!av) throw httpError(404, '头像不存在');
  db.prepare('UPDATE users SET avatar_id = ?, updated_at = ? WHERE uid = ?')
    .run(av.id, now(), req.accountId);
  res.json(userPayload(req.accountId));
});

app.delete('/api/me/avatars/:id', requireUser, (req, res) => {
  const av = db
    .prepare('SELECT id, file_name FROM avatars WHERE id = ? AND user_uid = ?')
    .get(Number(req.params.id), req.accountId);
  if (!av) throw httpError(404, '头像不存在');
  db.prepare('UPDATE users SET avatar_id = NULL, updated_at = ? WHERE uid = ? AND avatar_id = ?')
    .run(now(), req.accountId, av.id);
  db.prepare('DELETE FROM avatars WHERE id = ?').run(av.id);
  fs.rm(path.join(RESOURCE_DIR, String(req.accountId), 'avatars', av.file_name), { force: true }, () => {});
  res.json(userPayload(req.accountId));
});

// ---------------- friends ----------------
function friendPayload(uid, friendUid, since) {
  const u = userPayload(friendUid);
  return { ...u, friend_since: since, is_self: friendUid === uid };
}

app.get('/api/friends', requireUser, (req, res) => {
  const rows = db
    .prepare('SELECT friend_uid, created_at FROM friendships WHERE user_uid = ? ORDER BY created_at DESC, id DESC')
    .all(req.accountId);
  res.json(rows.map((r) => friendPayload(req.accountId, r.friend_uid, r.created_at)));
});

// 把双方写入 friendships（双向），幂等
function makeFriends(aUid, bUid) {
  const t = now();
  const ins = db.prepare(
    'INSERT OR IGNORE INTO friendships (user_uid, friend_uid, created_at) VALUES (?, ?, ?)'
  );
  db.exec('BEGIN');
  try {
    ins.run(aUid, bUid, t);
    ins.run(bUid, aUid, t);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return t;
}

function pendingRequestBetween(aUid, bUid) {
  return db
    .prepare("SELECT * FROM friend_requests WHERE from_uid = ? AND to_uid = ? AND status = 'pending' ORDER BY id DESC")
    .get(aUid, bUid);
}

// 发送好友请求（不再是直接加好友，需对方在「添加好友」页审批同意）
app.post('/api/friends', requireUser, (req, res) => {
  const friendUid = Number(req.body?.uid);
  if (!Number.isInteger(friendUid) || friendUid < 1 || friendUid > 999999) {
    throw httpError(400, '请输入正确的 UID');
  }
  if (friendUid === req.accountId) throw httpError(400, '不能添加自己为好友');
  if (!uidTaken(friendUid)) throw httpError(404, `UID ${friendUid} 不存在`);
  const exists = db
    .prepare('SELECT 1 FROM friendships WHERE user_uid = ? AND friend_uid = ?')
    .get(req.accountId, friendUid);
  if (exists) throw httpError(400, '你们已经是好友了');
  if (pendingRequestBetween(req.accountId, friendUid)) {
    throw httpError(400, '好友请求已发送，等待对方处理');
  }
  // 对方已经向我发过请求：直接视为互相同意，立即成为好友
  const reverse = pendingRequestBetween(friendUid, req.accountId);
  if (reverse) {
    const t = makeFriends(req.accountId, friendUid);
    db.prepare("UPDATE friend_requests SET status = 'accepted', processed_at = ? WHERE id = ?").run(t, reverse.id);
    return res.status(201).json({ ...friendPayload(req.accountId, friendUid, t), auto_accepted: true });
  }
  const t = now();
  const r = db
    .prepare("INSERT INTO friend_requests (from_uid, to_uid, status, created_at) VALUES (?, ?, 'pending', ?)")
    .run(req.accountId, friendUid, t);
  res.status(201).json({ request_id: Number(r.lastInsertRowid), to_uid: friendUid, pending: true, created_at: t });
});

// 好友请求列表：incoming 待我审批，outgoing 我发出的待处理
app.get('/api/friends/requests', requireUser, (req, res) => {
  const incoming = db
    .prepare("SELECT * FROM friend_requests WHERE to_uid = ? AND status = 'pending' ORDER BY id DESC")
    .all(req.accountId)
    .map((r) => ({ request_id: r.id, created_at: r.created_at, user: userPayload(r.from_uid) }));
  const outgoing = db
    .prepare("SELECT * FROM friend_requests WHERE from_uid = ? AND status = 'pending' ORDER BY id DESC")
    .all(req.accountId)
    .map((r) => ({ request_id: r.id, created_at: r.created_at, user: userPayload(r.to_uid) }));
  res.json({ incoming, outgoing });
});

function loadPendingRequest(req, res) {
  const id = Number(req.params.id);
  const r = db.prepare("SELECT * FROM friend_requests WHERE id = ? AND status = 'pending'").get(id);
  if (!r) throw httpError(404, '请求不存在或已处理');
  return r;
}

// 同意好友请求（仅接收方）
app.post('/api/friends/requests/:id/accept', requireUser, (req, res) => {
  const r = loadPendingRequest(req);
  if (r.to_uid !== req.accountId) throw httpError(403, '只能处理发给你的请求');
  const t = makeFriends(r.from_uid, r.to_uid);
  db.prepare("UPDATE friend_requests SET status = 'accepted', processed_at = ? WHERE id = ?").run(t, r.id);
  res.json(friendPayload(req.accountId, r.from_uid, t));
});

// 拒绝好友请求（仅接收方）
app.post('/api/friends/requests/:id/reject', requireUser, (req, res) => {
  const r = loadPendingRequest(req);
  if (r.to_uid !== req.accountId) throw httpError(403, '只能处理发给你的请求');
  db.prepare("UPDATE friend_requests SET status = 'rejected', processed_at = ? WHERE id = ?").run(now(), r.id);
  res.json({ ok: true });
});

// 撤回我发出的好友请求（仅发送方）
app.delete('/api/friends/requests/:id', requireUser, (req, res) => {
  const r = loadPendingRequest(req);
  if (r.from_uid !== req.accountId) throw httpError(403, '只能撤回自己发出的请求');
  db.prepare('DELETE FROM friend_requests WHERE id = ?').run(r.id);
  res.json({ ok: true });
});

app.delete('/api/friends/:uid', requireUser, (req, res) => {
  const friendUid = Number(req.params.uid);
  const r = db
    .prepare('DELETE FROM friendships WHERE (user_uid = ? AND friend_uid = ?) OR (user_uid = ? AND friend_uid = ?)')
    .run(req.accountId, friendUid, friendUid, req.accountId);
  if (r.changes === 0) throw httpError(404, '好友关系不存在');
  res.json({ ok: true });
});

app.get('/api/users/lookup/:uid', requireUser, (req, res) => {
  const uid = Number(req.params.uid);
  const u = userPayload(uid);
  if (!u) throw httpError(404, `UID ${req.params.uid} 不存在`);
  const isFriend = !!db
    .prepare('SELECT 1 FROM friendships WHERE user_uid = ? AND friend_uid = ?')
    .get(req.accountId, uid);
  const outgoing = pendingRequestBetween(req.accountId, uid);
  const incoming = pendingRequestBetween(uid, req.accountId);
  res.json({
    ...u,
    is_friend: isFriend,
    is_self: uid === req.accountId,
    outgoing_pending: !!outgoing,
    incoming_pending: incoming ? { request_id: incoming.id } : null,
  });
});

// ---------------- messages (聊天) ----------------
const MSG_EXT = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/heic': '.heic',
  'image/avif': '.avif',
  'audio/webm': '.webm',
  'audio/mp4': '.m4a',
  'audio/x-m4a': '.m4a',
  'audio/mpeg': '.mp3',
  'audio/ogg': '.ogg',
  'audio/wav': '.wav',
  'audio/aac': '.aac',
};

const msgUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(RESOURCE_DIR, String(req.accountId), 'messages');
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = MSG_EXT[file.mimetype] || path.extname(file.originalname || '').toLowerCase() || '.bin';
      cb(null, `${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`);
    },
  }),
  fileFilter: (req, file, cb) => {
    if (file.mimetype && (file.mimetype.startsWith('image/') || file.mimetype.startsWith('audio/'))) cb(null, true);
    else cb(new Error('只支持图片或语音文件'));
  },
  limits: { fileSize: 20 * 1024 * 1024 },
});

function requireFriend(req, res, next) {
  const peer = Number(req.params.peer);
  if (!Number.isInteger(peer) || peer < 1 || peer > 999999) {
    return res.status(400).json({ error: '好友 UID 不正确' });
  }
  const isFriend = db
    .prepare('SELECT 1 FROM friendships WHERE user_uid = ? AND friend_uid = ?')
    .get(req.accountId, peer);
  if (!isFriend) return res.status(403).json({ error: '你们还不是好友，无法聊天' });
  req.peerUid = peer;
  next();
}

function messagePayload(m) {
  return {
    id: m.id,
    from_uid: m.from_uid,
    to_uid: m.to_uid,
    kind: m.kind,
    content: m.kind === 'text' ? m.content : msgUrl(m.from_uid, m.content),
    duration: m.duration,
    created_at: m.created_at,
    read_at: m.read_at,
  };
}

app.get('/api/conversations', requireUser, (req, res) => {
  const peers = db
    .prepare(
      `SELECT peer FROM (
         SELECT to_uid AS peer FROM messages WHERE from_uid = ?
         UNION
         SELECT from_uid AS peer FROM messages WHERE to_uid = ?
       )`
    )
    .all(req.accountId, req.accountId);
  const lastStmt = db.prepare(
    `SELECT * FROM messages
     WHERE (from_uid = ? AND to_uid = ?) OR (from_uid = ? AND to_uid = ?)
     ORDER BY id DESC LIMIT 1`
  );
  const unreadStmt = db.prepare(
    'SELECT COUNT(*) AS c FROM messages WHERE from_uid = ? AND to_uid = ? AND read_at IS NULL'
  );
  const list = peers.map(({ peer }) => ({
    type: 'dm',
    peer: userPayload(peer),
    last_message: (() => {
      const m = lastStmt.get(req.accountId, peer, peer, req.accountId);
      return m ? messagePayload(m) : null;
    })(),
    unread_count: unreadStmt.get(peer, req.accountId).c,
  }));
  // 我所在的群组（管理员创建，始终显示，即使没有消息）
  const myGroups = db
    .prepare(
      `SELECT g.id, g.name, g.created_at,
              (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id = g.id) AS member_count
       FROM chat_groups g
       JOIN group_members gm ON gm.group_id = g.id
       WHERE gm.user_uid = ?`
    )
    .all(req.accountId);
  const lastGStmt = db.prepare('SELECT * FROM group_messages WHERE group_id = ? ORDER BY id DESC LIMIT 1');
  for (const g of myGroups) {
    const m = lastGStmt.get(g.id);
    list.push({
      type: 'group',
      group: { id: g.id, name: g.name, member_count: g.member_count, created_at: g.created_at },
      last_message: m ? groupMessagePayload(m) : null,
      unread_count: 0,
    });
  }
  list.sort((a, b) => {
    const ta = a.last_message?.created_at || (a.type === 'group' ? a.group.created_at : '');
    const tb = b.last_message?.created_at || (b.type === 'group' ? b.group.created_at : '');
    return tb.localeCompare(ta);
  });
  res.json(list);
});

app.get('/api/messages/:peer', requireUser, requireFriend, (req, res) => {
  const after = Number(req.query.after) || 0;
  let rows;
  if (after > 0) {
    rows = db
      .prepare(
        `SELECT * FROM messages
         WHERE id > ? AND ((from_uid = ? AND to_uid = ?) OR (from_uid = ? AND to_uid = ?))
         ORDER BY id ASC LIMIT 200`
      )
      .all(after, req.accountId, req.peerUid, req.peerUid, req.accountId);
  } else {
    rows = db
      .prepare(
        `SELECT * FROM (
           SELECT * FROM messages
           WHERE (from_uid = ? AND to_uid = ?) OR (from_uid = ? AND to_uid = ?)
           ORDER BY id DESC LIMIT 100
         ) ORDER BY id ASC`
      )
      .all(req.accountId, req.peerUid, req.peerUid, req.accountId);
  }
  res.json(rows.map(messagePayload));
});

app.post('/api/messages/:peer', requireUser, requireFriend, (req, res) => {
  const content = String(req.body?.content ?? '').trim();
  if (!content) throw httpError(400, '消息内容不能为空');
  if (content.length > 2000) throw httpError(400, '消息最长 2000 字');
  const t = now();
  const r = db
    .prepare('INSERT INTO messages (from_uid, to_uid, kind, content, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(req.accountId, req.peerUid, 'text', content, t);
  res.status(201).json(messagePayload(db.prepare('SELECT * FROM messages WHERE id = ?').get(Number(r.lastInsertRowid))));
});

app.post('/api/messages/:peer/file', requireUser, requireFriend, msgUpload.single('file'), (req, res) => {
  if (!req.file) throw httpError(400, '缺少文件');
  const kind = req.file.mimetype.startsWith('image/') ? 'image' : 'audio';
  const rawDuration = Number(req.body?.duration);
  const duration = kind === 'audio' && Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : null;
  const t = now();
  const r = db
    .prepare('INSERT INTO messages (from_uid, to_uid, kind, content, duration, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(req.accountId, req.peerUid, kind, req.file.filename, duration, t);
  res.status(201).json(messagePayload(db.prepare('SELECT * FROM messages WHERE id = ?').get(Number(r.lastInsertRowid))));
});

app.post('/api/messages/:peer/read', requireUser, requireFriend, (req, res) => {
  db.prepare('UPDATE messages SET read_at = ? WHERE from_uid = ? AND to_uid = ? AND read_at IS NULL')
    .run(now(), req.peerUid, req.accountId);
  res.json({ ok: true });
});

// ---------------- group chat (群聊) ----------------
function requireGroupMember(req, res, next) {
  const gid = Number(req.params.id);
  if (!Number.isInteger(gid) || gid < 1) return res.status(400).json({ error: '群组 ID 不正确' });
  const member = db
    .prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_uid = ?')
    .get(gid, req.accountId);
  if (!member) return res.status(403).json({ error: '你不在这个群组里' });
  req.groupId = gid;
  next();
}

function groupMessagePayload(m) {
  const sender = userPayload(m.from_uid);
  return {
    id: m.id,
    group_id: m.group_id,
    from_uid: m.from_uid,
    kind: m.kind,
    content: m.kind === 'text' ? m.content : msgUrl(m.from_uid, m.content),
    duration: m.duration,
    created_at: m.created_at,
    sender: sender ? { uid: sender.uid, name: sender.name, avatar_url: sender.avatar_url } : null,
  };
}

app.get('/api/groups/:id', requireUser, requireGroupMember, (req, res) => {
  const g = db.prepare('SELECT * FROM chat_groups WHERE id = ?').get(req.groupId);
  if (!g) throw httpError(404, '群组不存在');
  const members = db
    .prepare('SELECT user_uid FROM group_members WHERE group_id = ? ORDER BY created_at, user_uid')
    .all(req.groupId)
    .map((r) => userPayload(r.user_uid));
  res.json({ id: g.id, name: g.name, created_at: g.created_at, members, member_count: members.length });
});

app.get('/api/groups/:id/messages', requireUser, requireGroupMember, (req, res) => {
  const after = Number(req.query.after) || 0;
  let rows;
  if (after > 0) {
    rows = db
      .prepare('SELECT * FROM group_messages WHERE group_id = ? AND id > ? ORDER BY id ASC LIMIT 200')
      .all(req.groupId, after);
  } else {
    rows = db
      .prepare(
        `SELECT * FROM (
           SELECT * FROM group_messages WHERE group_id = ? ORDER BY id DESC LIMIT 100
         ) ORDER BY id ASC`
      )
      .all(req.groupId);
  }
  res.json(rows.map(groupMessagePayload));
});

app.post('/api/groups/:id/messages', requireUser, requireGroupMember, (req, res) => {
  const content = String(req.body?.content ?? '').trim();
  if (!content) throw httpError(400, '消息内容不能为空');
  if (content.length > 2000) throw httpError(400, '消息最长 2000 字');
  const t = now();
  const r = db
    .prepare('INSERT INTO group_messages (group_id, from_uid, kind, content, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(req.groupId, req.accountId, 'text', content, t);
  res
    .status(201)
    .json(groupMessagePayload(db.prepare('SELECT * FROM group_messages WHERE id = ?').get(Number(r.lastInsertRowid))));
});

app.post('/api/groups/:id/messages/file', requireUser, requireGroupMember, msgUpload.single('file'), (req, res) => {
  if (!req.file) throw httpError(400, '缺少文件');
  const kind = req.file.mimetype.startsWith('image/') ? 'image' : 'audio';
  const rawDuration = Number(req.body?.duration);
  const duration = kind === 'audio' && Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : null;
  const t = now();
  const r = db
    .prepare(
      'INSERT INTO group_messages (group_id, from_uid, kind, content, duration, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(req.groupId, req.accountId, kind, req.file.filename, duration, t);
  res
    .status(201)
    .json(groupMessagePayload(db.prepare('SELECT * FROM group_messages WHERE id = ?').get(Number(r.lastInsertRowid))));
});

// ---------------- translate (DeepSeek) ----------------
const LANG_NAMES = { zh: '中文（简体）', en: 'English', ru: 'Русский' };

async function translateHandler(req, res) {
  const text = String(req.body?.text ?? '').trim();
  const target = String(req.body?.target ?? '');
  if (!text) throw httpError(400, '缺少待翻译文本');
  if (text.length > 2000) throw httpError(400, '文本最长 2000 字');
  const targetName = LANG_NAMES[target];
  if (!targetName) throw httpError(400, '目标语言只支持 zh / en / ru');
  const key = getSetting('deepseek_api_key', '') || process.env.DEEPSEEK_API_KEY || '';
  if (!key) throw httpError(400, '管理员尚未配置 DeepSeek API Key（管理面板 → 设置）');
  let resp;
  try {
    resp = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          {
            role: 'system',
            content: `You are a professional translation engine. Translate the user's text into ${targetName}. Preserve the original meaning, tone and line breaks. Output ONLY the translated text — no explanations, notes, or quotation marks.`,
          },
          { role: 'user', content: text },
        ],
        temperature: 0.3,
        max_tokens: 2000,
      }),
      signal: AbortSignal.timeout(25000),
    });
  } catch (e) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError') throw httpError(504, 'DeepSeek 翻译超时，请重试');
    throw httpError(502, '无法连接 DeepSeek API');
  }
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    console.error('DeepSeek error', resp.status, detail.slice(0, 300));
    if (resp.status === 401) throw httpError(502, 'DeepSeek API Key 无效，请管理员检查配置');
    if (resp.status === 429) throw httpError(429, 'DeepSeek 请求过于频繁，请稍后再试');
    throw httpError(502, `DeepSeek 翻译失败（${resp.status}）`);
  }
  const data = await resp.json();
  const translated = data?.choices?.[0]?.message?.content?.trim();
  if (!translated) throw httpError(502, 'DeepSeek 返回为空');
  res.json({ translated, target });
}

app.post('/api/translate', requireUser, (req, res, next) => {
  translateHandler(req, res).catch(next);
});

// ---------------- entries (我的信息) ----------------
function entryPayload(id) {
  const e = db.prepare('SELECT * FROM entries WHERE id = ?').get(id);
  if (!e) return null;
  const items = db
    .prepare('SELECT id, tag, content, sort FROM entry_items WHERE entry_id = ? ORDER BY sort, id')
    .all(id);
  return { id: e.id, created_at: e.created_at, updated_at: e.updated_at, items };
}

app.get('/api/entries', requireUser, (req, res) => {
  const rows = db
    .prepare('SELECT id FROM entries WHERE user_uid = ? ORDER BY updated_at DESC, id DESC')
    .all(req.accountId);
  res.json(rows.map((r) => entryPayload(r.id)));
});

function cleanItems(body) {
  const items = body?.items;
  if (!Array.isArray(items)) return { error: 'items 必须是数组' };
  const cleaned = items
    .map((i) => ({ tag: String(i?.tag ?? '').trim(), content: String(i?.content ?? '') }))
    .filter((i) => i.tag.length > 0 || i.content.trim().length > 0);
  if (cleaned.length === 0) return { error: '至少需要一项标签内容' };
  if (cleaned.some((i) => !i.tag)) return { error: '标签名不能为空' };
  if (cleaned.some((i) => i.tag.length > 30)) return { error: '标签名最长 30 个字符' };
  return { cleaned };
}

app.post('/api/entries', requireUser, (req, res) => {
  const { cleaned, error } = cleanItems(req.body);
  if (error) throw httpError(400, error);
  const t = now();
  db.exec('BEGIN');
  try {
    const r = db
      .prepare('INSERT INTO entries (user_uid, created_at, updated_at) VALUES (?, ?, ?)')
      .run(req.accountId, t, t);
    const entryId = Number(r.lastInsertRowid);
    const ins = db.prepare('INSERT INTO entry_items (entry_id, tag, content, sort) VALUES (?, ?, ?, ?)');
    cleaned.forEach((i, idx) => ins.run(entryId, i.tag, i.content, idx));
    db.exec('COMMIT');
    res.status(201).json(entryPayload(entryId));
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
});

app.put('/api/entries/:id', requireUser, (req, res) => {
  const entryId = Number(req.params.id);
  const owned = db
    .prepare('SELECT id FROM entries WHERE id = ? AND user_uid = ?')
    .get(entryId, req.accountId);
  if (!owned) throw httpError(404, '信息不存在');
  const { cleaned, error } = cleanItems(req.body);
  if (error) throw httpError(400, error);
  const t = now();
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM entry_items WHERE entry_id = ?').run(entryId);
    const ins = db.prepare('INSERT INTO entry_items (entry_id, tag, content, sort) VALUES (?, ?, ?, ?)');
    cleaned.forEach((i, idx) => ins.run(entryId, i.tag, i.content, idx));
    db.prepare('UPDATE entries SET updated_at = ? WHERE id = ?').run(t, entryId);
    db.exec('COMMIT');
    res.json(entryPayload(entryId));
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
});

app.delete('/api/entries/:id', requireUser, (req, res) => {
  const r = db
    .prepare('DELETE FROM entries WHERE id = ? AND user_uid = ?')
    .run(Number(req.params.id), req.accountId);
  if (r.changes === 0) throw httpError(404, '信息不存在');
  res.json({ ok: true });
});

app.get('/api/tags', requireUser, (req, res) => {
  const rows = db
    .prepare(
      `SELECT ei.tag, MAX(e.updated_at) AS last_used
       FROM entry_items ei
       JOIN entries e ON e.id = ei.entry_id
       WHERE e.user_uid = ?
       GROUP BY ei.tag
       ORDER BY last_used DESC`
    )
    .all(req.accountId);
  res.json(rows.map((r) => r.tag));
});

// ---------------- serve client build when present ----------------
const CLIENT_DIST = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  app.get(/^\/(?!api\/|resource\/).*/, (req, res) => {
    res.sendFile(path.join(CLIENT_DIST, 'index.html'));
  });
}

// ---------------- error handling ----------------
app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err instanceof multer.MulterError) {
    return res.status(400).json({
      error: err.code === 'LIMIT_FILE_SIZE' ? '文件大小超过限制' : `上传失败：${err.message}`,
    });
  }
  if (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || '服务器内部错误' });
  }
  next();
});

const PORT = Number(process.env.PORT) || 3001;
app.listen(PORT, () => {
  console.log(`MiniTelephone server running at http://localhost:${PORT}`);
  console.log(`Resource dir: ${RESOURCE_DIR}`);
});

// ---------------- HTTPS（手机录音需要安全上下文） ----------------
// 浏览器只允许 HTTPS / localhost 页面使用麦克风。这里自动生成一张
// 自签名证书并同时提供 HTTPS 入口，手机访问 https://IP:3444（HTTP 端口 + 443）即可录音。
// 自签证书不受系统信任，首次访问点「高级 → 继续前往」即可，之后不再提示。
const HTTPS_PORT = Number(process.env.HTTPS_PORT) || PORT + 443;

function lanIps() {
  const ips = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const it of list || []) {
      if (it && it.family === 'IPv4' && !it.internal) ips.push(it.address);
    }
  }
  return ips;
}

async function ensureCert() {
  const dir = path.join(RESOURCE_DIR, 'certs');
  const keyFile = path.join(dir, 'server.key');
  const certFile = path.join(dir, 'server.crt');
  if (fs.existsSync(keyFile) && fs.existsSync(certFile)) {
    return { key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) };
  }
  console.log('[HTTPS] 首次运行，正在生成自签名证书（resource/certs/）…');
  const altNames = [
    { type: 2, value: 'localhost' },
    { type: 7, ip: '127.0.0.1' },
    ...lanIps().map((ip) => ({ type: 7, ip })),
  ];
  const pems = await selfsigned.generate([{ name: 'commonName', value: 'MiniTelephone LAN' }], {
    keySize: 2048,
    days: 3650,
    altNames,
    extensions: [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
      { name: 'extKeyUsage', serverAuth: true },
    ],
  });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(keyFile, pems.private, { mode: 0o600 });
  fs.writeFileSync(certFile, pems.cert);
  return { key: pems.private, cert: pems.cert };
}

try {
  const { key, cert } = await ensureCert();
  https.createServer({ key, cert }, app).listen(HTTPS_PORT, () => {
    console.log(`HTTPS (for phones / mic): https://localhost:${HTTPS_PORT}`);
    for (const ip of lanIps()) console.log(`  -> https://${ip}:${HTTPS_PORT}`);
  });
} catch (e) {
  console.warn(`[HTTPS] 启动失败（HTTP :${PORT} 不受影响，但手机无法录音）：${e.message}`);
}
