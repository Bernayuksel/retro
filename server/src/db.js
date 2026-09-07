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
`);

// Eski veritabanları için migration.
const participantColumns = db.prepare('PRAGMA table_info(participants)').all();
if (!participantColumns.some(column => column.name === 'role')) {
  db.exec(`ALTER TABLE participants ADD COLUMN role TEXT NOT NULL DEFAULT 'participant'`);
}

const commentColumns = db.prepare('PRAGMA table_info(comments)').all();
if (!commentColumns.some(column => column.name === 'is_anonymous')) {
  db.exec(`ALTER TABLE comments ADD COLUMN is_anonymous INTEGER NOT NULL DEFAULT 0`);
}
if (!commentColumns.some(column => column.name === 'parent_id')) {
  db.exec(`ALTER TABLE comments ADD COLUMN parent_id TEXT`);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS comment_reactions (
    id TEXT PRIMARY KEY,
    comment_id TEXT NOT NULL,
    participant_id TEXT NOT NULL,
    emoji TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE,
    FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE,
    UNIQUE(comment_id, participant_id, emoji)
  )
`);

// Eski board'larda admin yoksa ilk katılan kişiyi admin yap.
const boards = db.prepare(`SELECT id FROM boards`).all();
for (const board of boards) {
  const adminExists = db.prepare(`
    SELECT id FROM participants WHERE board_id = ? AND role = 'admin' LIMIT 1
  `).get(board.id);

  if (!adminExists) {
    const firstParticipant = db.prepare(`
      SELECT id FROM participants WHERE board_id = ? ORDER BY joined_at ASC LIMIT 1
    `).get(board.id);

    if (firstParticipant) {
      db.prepare(`UPDATE participants SET role = 'admin' WHERE id = ?`).run(firstParticipant.id);
    }
  }
}

/*
 * API cevabında yorumların yeni metadata/reaction alanlarını mevcut
 * index.js'i baştan yazmaya gerek kalmadan zenginleştiriyoruz.
 */
const expressResponse = require('express/lib/response');
if (!expressResponse.__retroCommentsPatched) {
  const originalJson = expressResponse.json;

  expressResponse.json = function retroJson(body) {
    if (body && Array.isArray(body.cards) && Array.isArray(body.participants)) {
      for (const card of body.cards) {
        for (const comment of card.comments || []) {
          const row = db.prepare(`
            SELECT is_anonymous, parent_id
            FROM comments
            WHERE id = ?
          `).get(comment.id);

          if (row) {
            comment.is_anonymous = !!row.is_anonymous;
            comment.parent_id = row.parent_id || null;
            if (comment.is_anonymous) comment.author_name = null;
          }

          comment.reactions = db.prepare(`
            SELECT emoji, COUNT(*) AS count
            FROM comment_reactions
            WHERE comment_id = ?
            GROUP BY emoji
            ORDER BY count DESC, emoji ASC
          `).all(comment.id);
        }
      }
    }

    return originalJson.call(this, body);
  };

  expressResponse.__retroCommentsPatched = true;
}

/*
 * index.js'in mevcut WebSocket akışını bozmadan yeni comment reaction,
 * anonim/reply metadata ve kartları tekrar gizleme mesajlarını destekle.
 */
const wsModule = require('ws');
if (!wsModule.WebSocketServer.__retroEnhancementsPatched) {
  const OriginalWebSocketServer = wsModule.WebSocketServer;

  class RetroWebSocketServer extends OriginalWebSocketServer {
    on(event, listener) {
      if (event !== 'connection') {
        return super.on(event, listener);
      }

      return super.on('connection', ws => {
        const originalSend = ws.send.bind(ws);
        ws.__retroBoardId = null;
        ws.__retroParticipantId = null;

        ws.send = (data, ...args) => {
          try {
            const message = JSON.parse(data.toString());
            if (message.type === 'joined') {
              ws.__retroParticipantId = message.participant_id;
            }
          } catch (_) {
            // Normal WebSocket mesajı; olduğu gibi gönder.
          }
          return originalSend(data, ...args);
        };

        // Mevcut index.js listener'ı önce çalışsın; ardından enhancement listener'ı.
        listener(ws);

        ws.on('message', raw => {
          let msg;
          try {
            msg = JSON.parse(raw);
          } catch (_) {
            return;
          }

          if (msg.type === 'join') {
            ws.__retroBoardId = msg.board_id;
            return;
          }

          const boardId = ws.__retroBoardId;
          const participantId = ws.__retroParticipantId;
          if (!boardId || !participantId) return;

          // Anonim yorum ve cevap metadata'sını, mevcut comment_add işleminden sonra uygula.
          if (msg.type === 'comment_add') {
            const card = db.prepare(`
              SELECT id FROM cards WHERE id = ? AND board_id = ?
            `).get(msg.card_id, boardId);
            if (!card) return;

            let parentId = msg.parent_id || null;
            if (parentId) {
              const parent = db.prepare(`
                SELECT id FROM comments WHERE id = ? AND card_id = ?
              `).get(parentId, msg.card_id);
              if (!parent) parentId = null;
            }

            const comment = db.prepare(`
              SELECT id
              FROM comments
              WHERE card_id = ?
                AND participant_id = ?
                AND content = ?
              ORDER BY created_at DESC
              LIMIT 1
            `).get(msg.card_id, participantId, String(msg.content || '').trim());

            if (comment) {
              db.prepare(`
                UPDATE comments
                SET is_anonymous = ?, parent_id = ?
                WHERE id = ?
              `).run(msg.anonymous ? 1 : 0, parentId, comment.id);

              broadcastRetro(boardId, {
                type: 'comment_added',
                card_id: msg.card_id
              });
            }
            return;
          }

          if (msg.type === 'comment_reaction_add' || msg.type === 'comment_reaction_remove') {
            const allowedEmojis = ['👍', '❤️', '😂', '😮', '🎯', '👏', '👎'];
            const emoji = String(msg.emoji || '');
            if (!allowedEmojis.includes(emoji)) return;

            const comment = db.prepare(`
              SELECT c.id
              FROM comments c
              JOIN cards card ON card.id = c.card_id
              WHERE c.id = ? AND card.board_id = ?
            `).get(msg.comment_id, boardId);
            if (!comment) return;

            const existing = db.prepare(`
              SELECT id FROM comment_reactions
              WHERE comment_id = ? AND participant_id = ? AND emoji = ?
            `).get(msg.comment_id, participantId, emoji);

            if (msg.type === 'comment_reaction_remove' || existing) {
              if (existing) {
                db.prepare(`DELETE FROM comment_reactions WHERE id = ?`).run(existing.id);
              }
            } else {
              const id = require('crypto').randomUUID();
              db.prepare(`
                INSERT INTO comment_reactions
                (id, comment_id, participant_id, emoji, created_at)
                VALUES (?, ?, ?, ?, ?)
              `).run(id, msg.comment_id, participantId, emoji, Date.now());
            }

            broadcastRetro(boardId, {
              type: 'comment_reactions_changed',
              comment_id: msg.comment_id
            });
            return;
          }

          if (msg.type === 'hide') {
            const admin = db.prepare(`
              SELECT role FROM participants
              WHERE id = ? AND board_id = ?
            `).get(participantId, boardId);

            if (admin?.role !== 'admin') return;

            db.prepare(`
              UPDATE boards
              SET status = 'open'
              WHERE id = ? AND status = 'revealed'
            `).run(boardId);

            broadcastRetro(boardId, { type: 'hidden' });
          }
        });
      });
    }
  }

  function broadcastRetro(boardId, payload) {
    const sockets = global.__retroBoardSockets?.get(boardId);
    if (!sockets) return;
    const message = JSON.stringify(payload);
    for (const socket of sockets) {
      if (socket.readyState === socket.OPEN) socket.send(message);
    }
  }

  // index.js kendi boardSockets Map'ini global'e açmadığı için broadcast fallback'i:
  // custom mesajlarda doğrudan bağlı client'lara yayın yapmak için bağlantıları tutuyoruz.
  const connectionsByBoard = new Map();
  const OriginalOn = RetroWebSocketServer.prototype.on;
  RetroWebSocketServer.prototype.on = function(event, listener) {
    if (event !== 'connection') return OriginalOn.call(this, event, listener);
    return OriginalOn.call(this, event, ws => {
      const wrappedSend = ws.send;
      const track = setInterval(() => {
        if (ws.__retroBoardId) {
          if (!connectionsByBoard.has(ws.__retroBoardId)) connectionsByBoard.set(ws.__retroBoardId, new Set());
          connectionsByBoard.get(ws.__retroBoardId).add(ws);
          clearInterval(track);
        }
      }, 10);
      listener(ws);
      ws.on('close', () => {
        for (const set of connectionsByBoard.values()) set.delete(ws);
      });
    });
  };

  global.__retroBoardSockets = connectionsByBoard;
  wsModule.WebSocketServer = RetroWebSocketServer;
  wsModule.WebSocketServer.__retroEnhancementsPatched = true;
}

module.exports = db;
