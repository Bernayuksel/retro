const { createClient: createLibsqlClient } = require('@libsql/client');
const { createClient: createTursoClient } = require('@tursodatabase/serverless/compat');
const path = require('path');
const fs = require('fs');
const { randomBytes } = require('crypto');

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (process.env.NODE_ENV === 'production' && (!url || !authToken)) {
  throw new Error('TURSO_DATABASE_URL ve TURSO_AUTH_TOKEN üretim ortamında zorunludur. Geçici diske veri yazılmayacak.');
}
if (Boolean(url) !== Boolean(authToken)) {
  throw new Error('TURSO_DATABASE_URL ve TURSO_AUTH_TOKEN birlikte tanımlanmalıdır.');
}
if (url && !/^(turso|libsql|https):\/\//.test(url)) {
  throw new Error('TURSO_DATABASE_URL bir uzak Turso adresi olmalıdır.');
}
const localPath = path.join(process.env.RETRO_DATA_DIR || path.join(__dirname, '..', 'data'), 'retro.db');
if (!url) fs.mkdirSync(path.dirname(localPath), { recursive: true });
const client = url?.startsWith('turso://')
  ? createTursoClient({ url, authToken })
  : createLibsqlClient({ url: url || `file:${localPath}`, ...(url ? { authToken } : {}) });

const db = {
  prepare(sql) {
    const execute = async args => client.execute({ sql, args });
    return {
      async get(...args) { return (await execute(args)).rows[0] || undefined; },
      async all(...args) { return (await execute(args)).rows; },
      async run(...args) { return execute(args); }
    };
  },
  async exec(sql) { return client.executeMultiple(sql); }
};

const schema = `
CREATE TABLE IF NOT EXISTS boards (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  columns TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  ttl_hours INTEGER NOT NULL DEFAULT 48,
  created_at INTEGER NOT NULL,
  closed_at INTEGER
);
CREATE TABLE IF NOT EXISTS participants (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'participant',
  joined_at INTEGER NOT NULL,
  FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE,
  CHECK (role IN ('admin', 'participant'))
);
CREATE TABLE IF NOT EXISTS cards (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL,
  column_id TEXT NOT NULL,
  content TEXT NOT NULL,
  author_name TEXT,
  is_anonymous INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS votes (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE,
  FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE,
  UNIQUE(card_id, participant_id)
);
CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  content TEXT NOT NULL,
  is_anonymous INTEGER NOT NULL DEFAULT 0,
  parent_id TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE,
  FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS comment_reactions (
  id TEXT PRIMARY KEY,
  comment_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  emoji TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE,
  FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE,
  UNIQUE(comment_id, participant_id, emoji)
);
CREATE TABLE IF NOT EXISTS actions (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL,
  content TEXT NOT NULL,
  owner TEXT,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL,
  token TEXT UNIQUE NOT NULL,
  snapshot TEXT NOT NULL,
  pdf_path TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_reports (
  id TEXT PRIMARY KEY,
  report_id TEXT UNIQUE NOT NULL,
  summary TEXT NOT NULL,
  pdf_path TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE
);
`;

async function initialize() {
  // Her bağlantıda yabancı anahtar doğrulaması açık olmalı.
  await db.exec('PRAGMA foreign_keys = ON;');
  await db.exec(schema);
  const boardColumns = await db.prepare('PRAGMA table_info(boards)').all();
  for (const [name, definition] of [
    ['weekly_question', "TEXT NOT NULL DEFAULT ''"],
    ['timer_minutes', 'INTEGER NOT NULL DEFAULT 0'],
    ['timer_ends_at', 'INTEGER']
  ]) {
    if (!boardColumns.some(column => column.name === name)) {
      await db.exec(`ALTER TABLE boards ADD COLUMN ${name} ${definition}`);
    }
  }
  const participantColumns = await db.prepare('PRAGMA table_info(participants)').all();
  if (!participantColumns.some(column => column.name === 'role')) {
    await db.exec("ALTER TABLE participants ADD COLUMN role TEXT NOT NULL DEFAULT 'participant'");
  }
  if (!participantColumns.some(column => column.name === 'resume_token')) {
    await db.exec('ALTER TABLE participants ADD COLUMN resume_token TEXT');
  }
  const legacyParticipants = await db.prepare('SELECT id FROM participants WHERE resume_token IS NULL').all();
  for (const participant of legacyParticipants) {
    await db.prepare('UPDATE participants SET resume_token = ? WHERE id = ?')
      .run(randomBytes(32).toString('hex'), participant.id);
  }
  await db.exec('CREATE UNIQUE INDEX IF NOT EXISTS participants_resume_token ON participants(resume_token)');
  const commentColumns = await db.prepare('PRAGMA table_info(comments)').all();
  if (!commentColumns.some(column => column.name === 'is_anonymous')) {
    await db.exec('ALTER TABLE comments ADD COLUMN is_anonymous INTEGER NOT NULL DEFAULT 0');
  }
  if (!commentColumns.some(column => column.name === 'parent_id')) {
    await db.exec('ALTER TABLE comments ADD COLUMN parent_id TEXT');
  }
  const boards = await db.prepare('SELECT id FROM boards').all();
  for (const board of boards) {
    const adminExists = await db.prepare("SELECT id FROM participants WHERE board_id = ? AND role = 'admin' LIMIT 1").get(board.id);
    if (!adminExists) {
      const first = await db.prepare('SELECT id FROM participants WHERE board_id = ? ORDER BY joined_at ASC LIMIT 1').get(board.id);
      if (first) await db.prepare("UPDATE participants SET role = 'admin' WHERE id = ?").run(first.id);
    }
  }
}

module.exports = { db, initialize };
