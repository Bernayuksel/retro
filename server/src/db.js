const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', 'data');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new DatabaseSync(path.join(DATA_DIR, 'retro.db'));

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
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

  FOREIGN KEY (board_id)
    REFERENCES boards(id)
    ON DELETE CASCADE,

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

  FOREIGN KEY (board_id)
    REFERENCES boards(id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS votes (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,

  FOREIGN KEY (card_id)
    REFERENCES cards(id)
    ON DELETE CASCADE,

  FOREIGN KEY (participant_id)
    REFERENCES participants(id)
    ON DELETE CASCADE,

  UNIQUE(card_id, participant_id)
);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,

  FOREIGN KEY (card_id)
    REFERENCES cards(id)
    ON DELETE CASCADE,

  FOREIGN KEY (participant_id)
    REFERENCES participants(id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS actions (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL,
  content TEXT NOT NULL,
  owner TEXT,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL,

  FOREIGN KEY (board_id)
    REFERENCES boards(id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL,
  token TEXT UNIQUE NOT NULL,
  snapshot TEXT NOT NULL,
  pdf_path TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`);

/*
 * Eski veritabanları için migration
 *
 * Eski participants tablosunda role yoksa ekliyoruz.
 */

const participantColumns = db
  .prepare(`PRAGMA table_info(participants)`)
  .all();

const hasRoleColumn = participantColumns.some(
  column => column.name === 'role'
);

if (!hasRoleColumn) {
  db.exec(`
    ALTER TABLE participants
    ADD COLUMN role TEXT NOT NULL DEFAULT 'participant'
  `);
}

/*
 * Eski board'larda admin yoksa,
 * o board'a ilk katılan kişiyi admin yap.
 */

const boards = db
  .prepare(`SELECT id FROM boards`)
  .all();

for (const board of boards) {
  const adminExists = db
    .prepare(`
      SELECT id
      FROM participants
      WHERE board_id = ?
      AND role = 'admin'
      LIMIT 1
    `)
    .get(board.id);

  if (!adminExists) {
    const firstParticipant = db
      .prepare(`
        SELECT id
        FROM participants
        WHERE board_id = ?
        ORDER BY joined_at ASC
        LIMIT 1
      `)
      .get(board.id);

    if (firstParticipant) {
      db.prepare(`
        UPDATE participants
        SET role = 'admin'
        WHERE id = ?
      `).run(firstParticipant.id);
    }
  }
}

module.exports = db;
