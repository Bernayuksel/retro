
const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');

const db = require('./db');
const { generateReport } = require('./report');
const { generateAiReport } = require('./ai-report');

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const server = http.createServer(app);

const wss = new WebSocketServer({
  server,
  path: '/ws'
});

// boardId -> Set<WebSocket>
const boardSockets = new Map();


// =========================================================
// HELPERS
// =========================================================

function broadcast(boardId, payload) {
  const sockets = boardSockets.get(boardId);

  if (!sockets) return;

  const message = JSON.stringify(payload);

  for (const ws of sockets) {
    if (ws.readyState === ws.OPEN) {
      ws.send(message);
    }
  }
}


function getParticipant(participantId) {
  return db
    .prepare(`
      SELECT *
      FROM participants
      WHERE id = ?
    `)
    .get(participantId);
}


function isAdmin(participantId, boardId) {
  const participant = db
    .prepare(`
      SELECT role
      FROM participants
      WHERE id = ?
      AND board_id = ?
    `)
    .get(participantId, boardId);

  return participant?.role === 'admin';
}


// =========================================================
// CREATE BOARD
// =========================================================

app.post('/api/boards', (req, res) => {
  const {
    title,
    columns,
    weekly_questions = [],
    timer_minutes = 60
  } = req.body;

  if (
    !title ||
    !Array.isArray(columns) ||
    columns.length === 0 ||
    columns.length > 5 ||
    !Array.isArray(weekly_questions) ||
    weekly_questions.length > 52 ||
    weekly_questions.some(q => typeof q !== 'string' || !q.trim() || q.length > 500) ||
    !Number.isInteger(timer_minutes) || timer_minutes < 1 || timer_minutes > 1440
  ) {
    return res.status(400).json({
      error: 'Geçersiz başlık veya kolon listesi'
    });
  }

  const id = uuidv4();

  const cols = columns.map(name => ({
    id: uuidv4(),
    name
  }));

  db.prepare(`
    INSERT INTO boards
    (
      id,
      title,
      columns,
      status,
      weekly_questions,
      timer_duration_ms,
      timer_remaining_ms,
      created_at
    )
    VALUES (?, ?, ?, 'open', ?, ?, ?, ?)
  `).run(
    id,
    title,
    JSON.stringify(cols),
    JSON.stringify(weekly_questions.map(q => q.trim())),
    timer_minutes * 60000,
    timer_minutes * 60000,
    Date.now()
  );

  res.json({
    id,
    title,
    columns: cols
  });
});


// =========================================================
// GET BOARD
// =========================================================

app.get('/api/boards/:id', (req, res) => {

  const board = db
    .prepare(`
      SELECT *
      FROM boards
      WHERE id = ?
    `)
    .get(req.params.id);

  if (!board) {
    return res.status(404).json({
      error: 'Board bulunamadı'
    });
  }

  const columns = JSON.parse(board.columns);

  const cards = db
    .prepare(`
      SELECT
        c.*,

        (
          SELECT COUNT(*)
          FROM votes v
          WHERE v.card_id = c.id
        ) AS vote_count

      FROM cards c

      WHERE c.board_id = ?
    `)
    .all(board.id);


  const comments = db
    .prepare(`
      SELECT
        c.id,
        c.card_id,
        c.content,
        c.is_anonymous,
        c.parent_id,
        c.created_at,
        CASE WHEN c.is_anonymous = 1 THEN NULL ELSE p.name END AS author_name

      FROM comments c

      JOIN participants p
        ON p.id = c.participant_id

      WHERE c.card_id IN (
        SELECT id
        FROM cards
        WHERE board_id = ?
      )

      ORDER BY c.created_at ASC
    `)
    .all(board.id);


  const actions = db
    .prepare(`
      SELECT *
      FROM actions
      WHERE board_id = ?
      ORDER BY created_at ASC
    `)
    .all(board.id);


  const participants = db
    .prepare(`
      SELECT
        id,
        name,
        role,
        joined_at

      FROM participants

      WHERE board_id = ?

      ORDER BY joined_at ASC
    `)
    .all(board.id);


  const commentsByCard = {};

  for (const comment of comments) {

    comment.is_anonymous = !!comment.is_anonymous;
    comment.reactions = db.prepare(`
      SELECT emoji, COUNT(*) AS count
      FROM comment_reactions
      WHERE comment_id = ?
      GROUP BY emoji
      ORDER BY count DESC, emoji ASC
    `).all(comment.id);

    if (!commentsByCard[comment.card_id]) {
      commentsByCard[comment.card_id] = [];
    }

    commentsByCard[comment.card_id].push(comment);
  }


  res.json({

    id: board.id,

    title: board.title,

    status: board.status,

    weekly_questions: JSON.parse(board.weekly_questions),
    current_question: (() => {
      const questions = JSON.parse(board.weekly_questions);
      return questions.length ? questions[Math.floor((Date.now() - board.created_at) / 604800000) % questions.length] : null;
    })(),
    timer: {
      duration_ms: board.timer_duration_ms,
      remaining_ms: board.timer_remaining_ms,
      ends_at: board.timer_ends_at
    },

    columns,

    cards: cards.map(card => ({

      id: card.id,

      column_id: card.column_id,

      content:
        board.status === 'open'
          ? null
          : card.content,

      is_anonymous:
        !!card.is_anonymous,

      author_name:
        card.is_anonymous
          ? null
          : card.author_name,

      vote_count:
        card.vote_count,

      comments:
        board.status === 'open'
          ? []
          : commentsByCard[card.id] || []

    })),

    actions,

    participants
  });
});


// =========================================================
// REPORT
// =========================================================

app.get('/api/reports/:token', (req, res) => {

  const report = db
    .prepare(`
      SELECT *
      FROM reports
      WHERE token = ?
    `)
    .get(req.params.token);

  if (!report) {
    return res.status(404).json({
      error: 'Rapor bulunamadı'
    });
  }

  res.json(
    JSON.parse(report.snapshot)
  );
});


app.get('/api/reports/:token/pdf', (req, res) => {

  const report = db
    .prepare(`
      SELECT *
      FROM reports
      WHERE token = ?
    `)
    .get(req.params.token);

  if (!report) {
    return res
      .status(404)
      .send('Rapor bulunamadı');
  }

  res.download(
    report.pdf_path,
    'retro-raporu.pdf'
  );
});


app.post('/api/reports/:token/ai', async (req, res) => {
  try {
    const result = await generateAiReport(req.params.token);
    res.json({
      cached: result.cached,
      model: result.model,
      download_url: `/api/reports/${req.params.token}/ai-pdf`
    });
  } catch (error) {
    const status = error.code === 'AI_NOT_CONFIGURED' ? 503 : 500;
    res.status(status).json({
      error: error.code === 'AI_NOT_CONFIGURED'
        ? 'AI raporu için OPENAI_API_KEY ayarlanmamış.'
        : 'AI özetli rapor oluşturulamadı.',
      detail: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});


app.get('/api/reports/:token/ai-pdf', (req, res) => {
  const aiReport = db.prepare(`
    SELECT ai.pdf_path
    FROM ai_reports ai
    JOIN reports r ON r.id = ai.report_id
    WHERE r.token = ?
  `).get(req.params.token);

  if (!aiReport) {
    return res.status(404).send('AI özetli rapor henüz oluşturulmadı');
  }

  res.download(aiReport.pdf_path, 'retro-ai-ozetli-rapor.pdf');
});


// =========================================================
// WEBSOCKET
// =========================================================

wss.on('connection', ws => {

  let currentBoardId = null;
  let currentParticipantId = null;


  ws.on('message', raw => {

    let msg;

    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }


    // =====================================================
    // JOIN
    // =====================================================

    if (msg.type === 'join') {

      const board = db
        .prepare(`
          SELECT *
          FROM boards
          WHERE id = ?
        `)
        .get(msg.board_id);


      if (!board) {

        return ws.send(
          JSON.stringify({
            type: 'error',
            message: 'Board bulunamadı'
          })
        );
      }


      currentBoardId =
        msg.board_id;

      const existing = typeof msg.participant_id === 'string'
        ? db.prepare('SELECT * FROM participants WHERE id = ? AND board_id = ?')
            .get(msg.participant_id, currentBoardId)
        : null;
      currentParticipantId = existing?.id || uuidv4();


      /*
       * Board'da admin var mı?
       */

      const existingAdmin =
        db
          .prepare(`
            SELECT id
            FROM participants

            WHERE board_id = ?
            AND role = 'admin'

            LIMIT 1
          `)
          .get(currentBoardId);


      const role =
        existingAdmin
          ? 'participant'
          : 'admin';


      if (!existing) db.prepare(`
        INSERT INTO participants
        (
          id,
          board_id,
          name,
          role,
          joined_at
        )

        VALUES (?, ?, ?, ?, ?)
      `).run(
        currentParticipantId,
        currentBoardId,
        typeof msg.name === 'string' ? msg.name.trim().slice(0, 80) || 'Anonim' : 'Anonim',
        role,
        Date.now()
      );


      if (!boardSockets.has(currentBoardId)) {
        boardSockets.set(
          currentBoardId,
          new Set()
        );
      }


      boardSockets
        .get(currentBoardId)
        .add(ws);


      ws.send(
        JSON.stringify({

          type: 'joined',

          participant_id:
            currentParticipantId,

          role: existing?.role || role

        })
      );


      broadcast(
        currentBoardId,
        {
          type: 'participant_joined',
          name: msg.name || 'Anonim',
          role
        }
      );

      return;
    }


    if (!currentBoardId) {
      return;
    }


    const participant =
      getParticipant(
        currentParticipantId
      );
    if (!participant || participant.board_id !== currentBoardId) return;

    if (msg.type === 'timer_control') {
      if (!isAdmin(currentParticipantId, currentBoardId)) return;
      const timer = db.prepare('SELECT timer_duration_ms, timer_remaining_ms, timer_ends_at FROM boards WHERE id = ?').get(currentBoardId);
      const remaining = timer.timer_ends_at === null
        ? timer.timer_remaining_ms
        : Math.max(0, timer.timer_ends_at - Date.now());
      if (!['start', 'pause', 'reset'].includes(msg.action)) return;
      const next = msg.action === 'reset'
        ? { remaining_ms: timer.timer_duration_ms, ends_at: null }
        : msg.action === 'pause'
          ? { remaining_ms: remaining, ends_at: null }
          : { remaining_ms: remaining || timer.timer_duration_ms, ends_at: Date.now() + (remaining || timer.timer_duration_ms) };
      db.prepare('UPDATE boards SET timer_remaining_ms = ?, timer_ends_at = ? WHERE id = ?')
        .run(next.remaining_ms, next.ends_at, currentBoardId);
      broadcast(currentBoardId, { type: 'timer_changed' });
      return;
    }

    if (msg.type === 'card_move') {
      const board = db.prepare('SELECT columns, status FROM boards WHERE id = ?').get(currentBoardId);
      const destination = JSON.parse(board.columns).some(col => col.id === msg.column_id);
      if (!destination || board.status === 'closed') return;
      const changed = db.prepare('UPDATE cards SET column_id = ? WHERE id = ? AND board_id = ?')
        .run(msg.column_id, msg.card_id, currentBoardId);
      if (changed.changes) broadcast(currentBoardId, { type: 'card_moved' });
      return;
    }


    // =====================================================
    // CARD ADD
    // =====================================================

    if (msg.type === 'card_add') {

      const id = uuidv4();


      db.prepare(`
        INSERT INTO cards
        (
          id,
          board_id,
          column_id,
          content,
          author_name,
          is_anonymous,
          created_at
        )

        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(

        id,

        currentBoardId,

        msg.column_id,

        msg.content,

        msg.anonymous
          ? null
          : (
              msg.author_name ||
              participant?.name ||
              'Anonim'
            ),

        msg.anonymous ? 1 : 0,

        Date.now()
      );


      broadcast(
        currentBoardId,
        {
          type: 'card_added',
          id
        }
      );

      return;
    }


    // =====================================================
    // VOTE
    // =====================================================

    if (
      msg.type === 'vote_add' ||
      msg.type === 'vote_remove'
    ) {

      if (msg.type === 'vote_add') {

        try {

          db.prepare(`
            INSERT INTO votes
            (
              id,
              card_id,
              participant_id
            )

            VALUES (?, ?, ?)
          `).run(
            uuidv4(),
            msg.card_id,
            currentParticipantId
          );

        } catch {
          // Zaten oy verilmiş
        }

      } else {

        db.prepare(`
          DELETE FROM votes

          WHERE card_id = ?
          AND participant_id = ?
        `).run(
          msg.card_id,
          currentParticipantId
        );
      }


      broadcast(
        currentBoardId,
        {
          type: 'vote_changed',
          card_id: msg.card_id
        }
      );

      return;
    }


    // =====================================================
    // COMMENT ADD
    // =====================================================

    if (msg.type === 'comment_add') {

      const content =
        String(msg.content || '').trim();


      if (!content) {
        return;
      }


      const card =
        db.prepare(`
          SELECT id
          FROM cards

          WHERE id = ?
          AND board_id = ?
        `).get(
          msg.card_id,
          currentBoardId
        );


      if (!card) {
        return;
      }

      let parentId = msg.parent_id || null;

      if (parentId) {
        const parent = db.prepare(`
          SELECT id FROM comments WHERE id = ? AND card_id = ?
        `).get(parentId, msg.card_id);
        if (!parent) parentId = null;
      }


      const id = uuidv4();


      db.prepare(`
        INSERT INTO comments
        (
          id,
          card_id,
          participant_id,
          content,
          is_anonymous,
          parent_id,
          created_at
        )

        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(

        id,

        msg.card_id,

        currentParticipantId,

        content,

        msg.anonymous ? 1 : 0,

        parentId,

        Date.now()
      );


      broadcast(
        currentBoardId,
        {
          type: 'comment_added',
          card_id: msg.card_id
        }
      );

      return;
    }


    // =====================================================
    // COMMENT REACTION TOGGLE
    // =====================================================

    if (msg.type === 'comment_reaction_toggle') {
      const allowedEmojis = ['👍', '❤️', '😂', '😮', '🎯', '👏', '👎'];
      const emoji = String(msg.emoji || '');
      if (!allowedEmojis.includes(emoji)) return;

      const comment = db.prepare(`
        SELECT c.id FROM comments c
        JOIN cards card ON card.id = c.card_id
        WHERE c.id = ? AND card.board_id = ?
      `).get(msg.comment_id, currentBoardId);
      if (!comment) return;

      const existing = db.prepare(`
        SELECT id FROM comment_reactions
        WHERE comment_id = ? AND participant_id = ? AND emoji = ?
      `).get(msg.comment_id, currentParticipantId, emoji);

      if (existing) {
        db.prepare('DELETE FROM comment_reactions WHERE id = ?').run(existing.id);
      } else {
        db.prepare(`
          INSERT INTO comment_reactions
          (id, comment_id, participant_id, emoji, created_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(uuidv4(), msg.comment_id, currentParticipantId, emoji, Date.now());
      }

      broadcast(currentBoardId, { type: 'comment_reactions_changed' });
      return;
    }


    // =====================================================
    // COMMENT DELETE
    // =====================================================

    if (msg.type === 'comment_delete') {

      const comment =
        db.prepare(`
          SELECT *
          FROM comments

          WHERE id = ?
        `).get(msg.comment_id);


      if (!comment) {
        return;
      }


      const allowed =
        comment.participant_id ===
          currentParticipantId ||

        isAdmin(
          currentParticipantId,
          currentBoardId
        );


      if (!allowed) {
        return;
      }


      db.prepare(`
        DELETE FROM comments
        WHERE id = ?
      `).run(msg.comment_id);


      broadcast(
        currentBoardId,
        {
          type: 'comment_deleted',
          card_id: comment.card_id
        }
      );

      return;
    }


    // =====================================================
    // ACTION ADD
    // =====================================================

    if (msg.type === 'action_add') {

      const id = uuidv4();


      db.prepare(`
        INSERT INTO actions
        (
          id,
          board_id,
          content,
          owner,
          due_date,
          status,
          created_at
        )

        VALUES (?, ?, ?, ?, ?, 'open', ?)
      `).run(

        id,

        currentBoardId,

        msg.content || '',

        msg.owner || null,

        msg.due_date || null,

        Date.now()
      );


      broadcast(
        currentBoardId,
        {
          type: 'action_added',
          id
        }
      );

      return;
    }


    // =====================================================
    // REVEAL — SADECE ADMIN
    // =====================================================

    if (msg.type === 'reveal') {

      if (
        !isAdmin(
          currentParticipantId,
          currentBoardId
        )
      ) {

        ws.send(
          JSON.stringify({
            type: 'error',
            message:
              'Sadece admin kartları açabilir.'
          })
        );

        return;
      }


      db.prepare(`
        UPDATE boards

        SET status = 'revealed'

        WHERE id = ?
      `).run(currentBoardId);


      broadcast(
        currentBoardId,
        {
          type: 'revealed'
        }
      );

      return;
    }


    // =====================================================
    // HIDE — SADECE ADMIN
    // =====================================================

    if (msg.type === 'hide') {
      if (!isAdmin(currentParticipantId, currentBoardId)) {
        ws.send(JSON.stringify({ type: 'error', message: 'Sadece admin kartları gizleyebilir.' }));
        return;
      }

      db.prepare(`
        UPDATE boards SET status = 'open'
        WHERE id = ? AND status = 'revealed'
      `).run(currentBoardId);

      broadcast(currentBoardId, { type: 'hidden' });
      return;
    }


    // =====================================================
    // TRANSFER ADMIN
    // =====================================================

    if (msg.type === 'transfer_admin') {

      if (
        !isAdmin(
          currentParticipantId,
          currentBoardId
        )
      ) {

        ws.send(
          JSON.stringify({
            type: 'error',
            message:
              'Sadece admin yetki devredebilir.'
          })
        );

        return;
      }


      const newAdmin =
        db.prepare(`
          SELECT *
          FROM participants

          WHERE id = ?
          AND board_id = ?
        `).get(
          msg.participant_id,
          currentBoardId
        );


      if (!newAdmin) {
        return;
      }


      if (
        newAdmin.id ===
        currentParticipantId
      ) {
        return;
      }


      db.prepare(`
        UPDATE participants

        SET role = CASE WHEN role = 'admin' THEN 'participant' ELSE 'admin' END

        WHERE id = ?
        AND board_id = ?
      `).run(
        newAdmin.id,
        currentBoardId
      );


      broadcast(
        currentBoardId,
        {
          type: 'admin_changed',
          admin_id: newAdmin.id
        }
      );

      return;
    }


    // =====================================================
    // CLOSE BOARD — SADECE ADMIN
    // =====================================================

    if (msg.type === 'board_close') {

      if (
        !isAdmin(
          currentParticipantId,
          currentBoardId
        )
      ) {

        ws.send(
          JSON.stringify({
            type: 'error',
            message:
              'Sadece admin boardu kapatabilir.'
          })
        );

        return;
      }


      db.prepare(`
        UPDATE boards

        SET
          status = 'closed',
          closed_at = ?

        WHERE id = ?
      `).run(
        Date.now(),
        currentBoardId
      );


      const {
        token
      } = generateReport(
        currentBoardId
      );


      broadcast(
        currentBoardId,
        {
          type: 'board_closed',
          report_token: token
        }
      );

      return;
    }

  });


  // =====================================================

  ws.on('close', () => {

    if (
      currentBoardId &&
      boardSockets.has(currentBoardId)
    ) {

      boardSockets
        .get(currentBoardId)
        .delete(ws);
    }

  });

});


// =========================================================
// Boards are retained until explicitly closed; historical TTL settings are ignored.
// =========================================================

// =========================================================
// SERVER
// =========================================================

const PORT =
  process.env.PORT || 3000;


server.listen(
  PORT,
  () => {
    console.log(
      `Retro app http://localhost:${PORT} adresinde çalışıyor`
    );
  }
);
