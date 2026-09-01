```js
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

/*
  ============================================================
  DATABASE
  ============================================================
*/

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

  -- admin | participant
  role TEXT NOT NULL DEFAULT 'participant',

  joined_at INTEGER NOT NULL,

  FOREIGN KEY (board_id)
    REFERENCES boards(id)
    ON DELETE CASCADE
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

  UNIQUE(card_id, participant_id)
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
  ============================================================
  MIGRATION
  ============================================================

  Eğer eski database daha önce oluşturulduysa participants
  tablosunda role kolonu olmayabilir.

  Bu yüzden uygulama ilk açıldığında kontrol ediyoruz.
*/

function addRoleColumnIfNeeded() {
  const columns = db
    .prepare(`PRAGMA table_info(participants)`)
    .all();

  const hasRole = columns.some(column => column.name === 'role');

  if (!hasRole) {
    db.exec(`
      ALTER TABLE participants
      ADD COLUMN role TEXT NOT NULL DEFAULT 'participant'
    `);
  }
}

addRoleColumnIfNeeded();


/*
  ============================================================
  DATA NORMALIZATION
  ============================================================

  Eski board'larda admin yoksa ilk katılımcıyı admin yapıyoruz.

  Böylece mevcut database'in varsa tamamen silinmesine gerek
  kalmaz.
*/

function ensureOneAdminPerBoard() {
  const boards = db
    .prepare(`SELECT id FROM boards`)
    .all();

  const getAdmin = db.prepare(`
    SELECT id
    FROM participants
    WHERE board_id = ?
      AND role = 'admin'
    LIMIT 1
  `);

  const getFirstParticipant = db.prepare(`
    SELECT id
    FROM participants
    WHERE board_id = ?
    ORDER BY joined_at ASC
    LIMIT 1
  `);

  const makeAdmin = db.prepare(`
    UPDATE participants
    SET role = 'admin'
    WHERE id = ?
  `);

  for (const board of boards) {
    const admin = getAdmin.get(board.id);

    if (!admin) {
      const firstParticipant = getFirstParticipant.get(board.id);

      if (firstParticipant) {
        makeAdmin.run(firstParticipant.id);
      }
    }
  }
}

ensureOneAdminPerBoard();


/*
  ============================================================
  HELPER FUNCTIONS
  ============================================================
*/

function getAdmin(boardId) {
  return db.prepare(`
    SELECT id, name, role
    FROM participants
    WHERE board_id = ?
      AND role = 'admin'
    LIMIT 1
  `).get(boardId);
}

function isAdmin(participantId, boardId) {
  const participant = db.prepare(`
    SELECT id
    FROM participants
    WHERE id = ?
      AND board_id = ?
      AND role = 'admin'
  `).get(participantId, boardId);

  return !!participant;
}


/*
  Bu fonksiyonlar index.js tarafından kullanılacak.
*/

module.exports = db;

module.exports.getAdmin = getAdmin;
module.exports.isAdmin = isAdmin;
```
