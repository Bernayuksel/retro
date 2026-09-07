const wsModule = require('ws');
const db = require('./db');
const crypto = require('crypto');

const OriginalWebSocketServer = wsModule.WebSocketServer;

function broadcast(boardId, payload, except = null) {
  const sockets = connectionsByBoard.get(boardId);
  if (!sockets) return;
  const message = JSON.stringify(payload);
  for (const socket of sockets) {
    if (socket !== except && socket.readyState === socket.OPEN) {
      socket.send(message);
    }
  }
}

const connectionsByBoard = new Map();

class RetroWebSocketServer extends OriginalWebSocketServer {
  on(event, listener) {
    if (event !== 'connection') return super.on(event, listener);

    return super.on('connection', ws => {
      let boardId = null;
      let participantId = null;

      const originalSend = ws.send.bind(ws);
      ws.send = (data, ...args) => {
        try {
          const message = JSON.parse(data.toString());
          if (message.type === 'joined') {
            participantId = message.participant_id;
            if (boardId) {
              if (!connectionsByBoard.has(boardId)) connectionsByBoard.set(boardId, new Set());
              connectionsByBoard.get(boardId).add(ws);
            }
          }
        } catch (_) {}
        return originalSend(data, ...args);
      };

      // Register the application's original connection handler first.
      listener(ws);

      ws.on('message', raw => {
        let msg;
        try { msg = JSON.parse(raw.toString()); } catch (_) { return; }

        if (msg.type === 'join') {
          boardId = msg.board_id;
          return;
        }

        if (!boardId || !participantId) return;

        if (msg.type === 'comment_add') {
          const content = String(msg.content || '').trim();
          if (!content) return;

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
            SELECT id FROM comments
            WHERE card_id = ? AND participant_id = ? AND content = ?
            ORDER BY created_at DESC LIMIT 1
          `).get(msg.card_id, participantId, content);

          if (comment) {
            db.prepare(`
              UPDATE comments
              SET is_anonymous = ?, parent_id = ?
              WHERE id = ?
            `).run(msg.anonymous ? 1 : 0, parentId, comment.id);

            broadcast(boardId, {
              type: 'comment_added',
              card_id: msg.card_id
            });
          }
          return;
        }

        if (msg.type === 'comment_reaction_add') {
          const allowed = ['👍', '❤️', '😂', '😮', '🎯', '👏', '👎'];
          const emoji = String(msg.emoji || '');
          if (!allowed.includes(emoji)) return;

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

          if (existing) {
            db.prepare(`DELETE FROM comment_reactions WHERE id = ?`).run(existing.id);
          } else {
            db.prepare(`
              INSERT INTO comment_reactions
              (id, comment_id, participant_id, emoji, created_at)
              VALUES (?, ?, ?, ?, ?)
            `).run(crypto.randomUUID(), msg.comment_id, participantId, emoji, Date.now());
          }

          broadcast(boardId, {
            type: 'comment_reactions_changed',
            comment_id: msg.comment_id
          });
          return;
        }

        if (msg.type === 'hide') {
          const participant = db.prepare(`
            SELECT role FROM participants WHERE id = ? AND board_id = ?
          `).get(participantId, boardId);

          if (participant?.role !== 'admin') {
            ws.send(JSON.stringify({
              type: 'error',
              message: 'Sadece admin kartları gizleyebilir.'
            }));
            return;
          }

          db.prepare(`
            UPDATE boards SET status = 'open'
            WHERE id = ? AND status = 'revealed'
          `).run(boardId);

          broadcast(boardId, { type: 'hidden' });
        }
      });

      ws.on('close', () => {
        if (boardId && connectionsByBoard.has(boardId)) {
          connectionsByBoard.get(boardId).delete(ws);
        }
      });
    });
  }
}

wsModule.WebSocketServer = RetroWebSocketServer;

require('./index');
