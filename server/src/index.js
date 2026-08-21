const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');
const { generateReport } = require('./report');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// boardId -> Set<ws>
const boardSockets = new Map();

function broadcast(boardId, payload) {
  const sockets = boardSockets.get(boardId);
  if (!sockets) return;
  const msg = JSON.stringify(payload);
  for (const ws of sockets) {
    if (ws.readyState === ws.OPEN) ws.send(msg);
  }
}

// ---------- REST API ----------

// Board oluştur
app.post('/api/boards', (req, res) => {
  const { title, columns, ttl_hours } = req.body;
  if (!title || !Array.isArray(columns) || columns.length === 0 || columns.length > 5) {
    return res.status(400).json({ error: 'Geçersiz başlık veya kolon listesi (1-5 kolon)' });
  }
  const id = uuidv4();
  const cols = columns.map(name => ({ id: uuidv4(), name }));
  db.prepare(`
    INSERT INTO boards (id, title, columns, status, ttl_hours, created_at)
    VALUES (?, ?, ?, 'open', ?, ?)
  `).run(id, title, JSON.stringify(cols), ttl_hours || 48, Date.now());
  res.json({ id, title, columns: cols });
});

// Board bilgisi + tüm state (join sonrası ilk yükleme için)
app.get('/api/boards/:id', (req, res) => {
  const board = db.prepare('SELECT * FROM boards WHERE id = ?').get(req.params.id);
  if (!board) return res.status(404).json({ error: 'Board bulunamadı' });
  const columns = JSON.parse(board.columns);
  const cards = db.prepare(`
    SELECT c.*, (SELECT COUNT(*) FROM votes v WHERE v.card_id = c.id) AS vote_count
    FROM cards c WHERE c.board_id = ?
  `).all(board.id);
  const actions = db.prepare('SELECT * FROM actions WHERE board_id = ?').all(board.id);
  const participants = db.prepare('SELECT id, name FROM participants WHERE board_id = ?').all(board.id);
  res.json({
    id: board.id,
    title: board.title,
    status: board.status,
    columns,
    cards: cards.map(c => ({
      id: c.id, column_id: c.column_id,
      content: board.status === 'open' ? null : c.content, // reveal edilmeden içerik gizli
      is_anonymous: !!c.is_anonymous,
      author_name: c.is_anonymous ? null : c.author_name,
      vote_count: c.vote_count,
    })),
    actions,
    participants,
  });
});

// Rapor görüntüleme (paylaşılabilir link - salt okunur, auth yok, token = erişim anahtarı)
app.get('/api/reports/:token', (req, res) => {
  const report = db.prepare('SELECT * FROM reports WHERE token = ?').get(req.params.token);
  if (!report) return res.status(404).json({ error: 'Rapor bulunamadı' });
  res.json(JSON.parse(report.snapshot));
});

// PDF indirme
app.get('/api/reports/:token/pdf', (req, res) => {
  const report = db.prepare('SELECT * FROM reports WHERE token = ?').get(req.params.token);
  if (!report) return res.status(404).send('Rapor bulunamadı');
  res.download(report.pdf_path, 'retro-raporu.pdf');
});

// ---------- WebSocket ----------
// Mesaj tipleri: join, card_add, vote_add, vote_remove, action_add, action_update, reveal, board_close

wss.on('connection', (ws) => {
  let currentBoardId = null;
  let currentParticipantId = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'join') {
      const board = db.prepare('SELECT * FROM boards WHERE id = ?').get(msg.board_id);
      if (!board) return ws.send(JSON.stringify({ type: 'error', message: 'Board bulunamadı' }));

      currentBoardId = msg.board_id;
      currentParticipantId = uuidv4();
      db.prepare('INSERT INTO participants (id, board_id, name, joined_at) VALUES (?, ?, ?, ?)')
        .run(currentParticipantId, currentBoardId, msg.name || 'Anonim', Date.now());

      if (!boardSockets.has(currentBoardId)) boardSockets.set(currentBoardId, new Set());
      boardSockets.get(currentBoardId).add(ws);

      ws.send(JSON.stringify({ type: 'joined', participant_id: currentParticipantId }));
      broadcast(currentBoardId, { type: 'participant_joined', name: msg.name });
      return;
    }

    if (!currentBoardId) return; // join olmadan işlem yok

    switch (msg.type) {
      case 'card_add': {
        const id = uuidv4();
        db.prepare(`
          INSERT INTO cards (id, board_id, column_id, content, author_name, is_anonymous, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(id, currentBoardId, msg.column_id, msg.content,
               msg.anonymous ? null : (msg.author_name || null),
               msg.anonymous ? 1 : 0, Date.now());
        broadcast(currentBoardId, { type: 'card_added', id, column_id: msg.column_id });
        break;
      }
      case 'vote_add': {
        try {
          db.prepare('INSERT INTO votes (id, card_id, participant_id) VALUES (?, ?, ?)')
            .run(uuidv4(), msg.card_id, currentParticipantId);
          broadcast(currentBoardId, { type: 'vote_changed', card_id: msg.card_id });
        } catch (e) { /* zaten oy vermiş - UNIQUE constraint */ }
        break;
      }
      case 'vote_remove': {
        db.prepare('DELETE FROM votes WHERE card_id = ? AND participant_id = ?')
          .run(msg.card_id, currentParticipantId);
        broadcast(currentBoardId, { type: 'vote_changed', card_id: msg.card_id });
        break;
      }
      case 'action_add': {
        const id = uuidv4();
        db.prepare(`
          INSERT INTO actions (id, board_id, content, owner, due_date, status, created_at)
          VALUES (?, ?, ?, ?, ?, 'open', ?)
        `).run(id, currentBoardId, msg.content || null, msg.owner || null, msg.due_date || null, Date.now());
        broadcast(currentBoardId, { type: 'action_added', id });
        break;
      }
      case 'reveal': {
        db.prepare("UPDATE boards SET status = 'revealed' WHERE id = ?").run(currentBoardId);
        broadcast(currentBoardId, { type: 'revealed' });
        break;
      }
      case 'board_close': {
        db.prepare("UPDATE boards SET status = 'closed', closed_at = ? WHERE id = ?")
          .run(Date.now(), currentBoardId);
        const { token } = generateReport(currentBoardId);
        broadcast(currentBoardId, { type: 'board_closed', report_token: token });
        break;
      }
    }
  });

  ws.on('close', () => {
    if (currentBoardId && boardSockets.has(currentBoardId)) {
      boardSockets.get(currentBoardId).delete(ws);
    }
  });
});

// ---------- TTL temizliği ----------
// Board verisi (kart/oy/katılımcı) TTL süresi dolunca silinir.
// Raporlar (reports tablosu) bundan bağımsız, ayrı saklanır — silinmez.
function cleanupExpiredBoards() {
  const boards = db.prepare('SELECT id, created_at, ttl_hours FROM boards').all();
  const now = Date.now();
  const del = db.prepare('DELETE FROM boards WHERE id = ?');
  for (const b of boards) {
    if (now - b.created_at > b.ttl_hours * 3600 * 1000) {
      del.run(b.id); // ON DELETE CASCADE ile cards/votes/actions/participants de silinir
    }
  }
}
setInterval(cleanupExpiredBoards, 60 * 60 * 1000); // saatte bir kontrol

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Retro app http://localhost:${PORT} adresinde çalışıyor`));
