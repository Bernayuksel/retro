
const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');
const { randomBytes } = require('crypto');

const { db, initialize } = require('./db');
const fs = require('fs');
const { generateReport, buildPdf } = require('./report');
const { generateAiReport, buildAiPdf } = require('./ai-report');

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


async function getParticipant(participantId) {
  return await db
    .prepare(`
      SELECT *
      FROM participants
      WHERE id = ?
    `)
    .get(participantId);
}


async function isAdmin(participantId, boardId) {
  const participant = await db
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

app.post('/api/boards', async (req, res) => {
  const {
    title,
    columns,
    weekly_question,
    timer_minutes
  } = req.body;

  if (
    !title ||
    !Array.isArray(columns) ||
    columns.length === 0 ||
    columns.length > 5 ||
    typeof weekly_question !== 'string' ||
    !weekly_question.trim() ||
    weekly_question.length > 500 ||
    !Number.isInteger(Number(timer_minutes)) ||
    Number(timer_minutes) < 1 || Number(timer_minutes) > 480
  ) {
    return res.status(400).json({
      error: 'Başlık, kolon, haftanın sorusu ve 1-480 dakika toplantı süresi gerekli.'
    });
  }

  const id = uuidv4();

  const cols = columns.map(name => ({
    id: uuidv4(),
    name
  }));

  await db.prepare(`
    INSERT INTO boards
    (
      id,
      title,
      columns,
      status,
      weekly_question,
      timer_minutes,
      created_at
    )
    VALUES (?, ?, ?, 'open', ?, ?, ?)
  `).run(
    id,
    title,
    JSON.stringify(cols),
    weekly_question.trim(),
    Number(timer_minutes),
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

app.get('/api/boards/:id', async (req, res) => {

  const board = await db
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

  const cards = await db
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


  const comments = await db
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


  const actions = await db
    .prepare(`
      SELECT *
      FROM actions
      WHERE board_id = ?
      ORDER BY created_at ASC
    `)
    .all(board.id);


  const participants = await db
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
    comment.reactions = await db.prepare(`
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

    weekly_question: board.weekly_question || '',
    timer_minutes: board.timer_minutes || 0,
    timer_ends_at: board.timer_ends_at || null,

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

app.get('/api/reports/:token', async (req, res) => {

  const report = await db
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


app.get('/api/reports/:token/pdf', async (req, res) => {

  const report = await db
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

  if (!fs.existsSync(report.pdf_path)) {
    await buildPdf(report.pdf_path, JSON.parse(report.snapshot));
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


app.get('/api/reports/:token/ai-pdf', async (req, res) => {
  const aiReport = await db.prepare(`
    SELECT ai.pdf_path, ai.summary, ai.model, r.snapshot
    FROM ai_reports ai
    JOIN reports r ON r.id = ai.report_id
    WHERE r.token = ?
  `).get(req.params.token);

  if (!aiReport) {
    return res.status(404).send('AI özetli rapor henüz oluşturulmadı');
  }

  if (!fs.existsSync(aiReport.pdf_path)) {
    await buildAiPdf(aiReport.pdf_path, JSON.parse(aiReport.snapshot), JSON.parse(aiReport.summary), aiReport.model);
  }

  res.download(aiReport.pdf_path, 'retro-ai-ozetli-rapor.pdf');
});


// =========================================================
// WEBSOCKET
// =========================================================

wss.on('connection', ws => {

  let currentBoardId = null;
  let currentParticipantId = null;


  ws.on('message', raw => { void (async () => {

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

      const board = await db
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

      const presentedToken = typeof msg.resume_token === 'string' && /^[a-f0-9]{64}$/.test(msg.resume_token)
        ? msg.resume_token : null;
      const returningParticipant = presentedToken && await db.prepare(`
        SELECT id, name, role FROM participants WHERE board_id = ? AND resume_token = ?
      `).get(currentBoardId, presentedToken);

      currentParticipantId = returningParticipant?.id || uuidv4();
      const resumeToken = returningParticipant ? presentedToken : randomBytes(32).toString('hex');


      /*
       * Board'da admin var mı?
       */

      const existingAdmin =
        await db
          .prepare(`
            SELECT id
            FROM participants

            WHERE board_id = ?
            AND role = 'admin'

            LIMIT 1
          `)
          .get(currentBoardId);


      const role = returningParticipant?.role || (existingAdmin ? 'participant' : 'admin');


      if (!returningParticipant) await db.prepare(`
        INSERT INTO participants
        (
          id,
          board_id,
          name,
          role,
          joined_at,
          resume_token
        )

        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        currentParticipantId,
        currentBoardId,
        msg.name || 'Anonim',
        role,
        Date.now(),
        resumeToken
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

          resume_token: resumeToken,

          name: returningParticipant?.name || msg.name || 'Anonim',

          role

        })
      );


      if (!returningParticipant) broadcast(
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
      await getParticipant(
        currentParticipantId
      );


    // =====================================================
    // CARD ADD
    // =====================================================

    if (msg.type === 'card_add') {
      const board = await db.prepare('SELECT columns, status FROM boards WHERE id = ?').get(currentBoardId);
      if (!board || board.status === 'closed' || !JSON.parse(board.columns).some(column => column.id === msg.column_id) || typeof msg.content !== 'string' || !msg.content.trim()) {
        return ws.send(JSON.stringify({ type: 'error', message: 'Kart eklenemedi.' }));
      }

      const id = uuidv4();


      await db.prepare(`
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

    if (msg.type === 'card_move') {
      const board = await db.prepare('SELECT columns, status FROM boards WHERE id = ?').get(currentBoardId);
      const card = await db.prepare('SELECT id FROM cards WHERE id = ? AND board_id = ?').get(msg.card_id, currentBoardId);
      if (!board || board.status === 'closed' || !card || !JSON.parse(board.columns).some(column => column.id === msg.column_id)) {
        return ws.send(JSON.stringify({ type: 'error', message: 'Kart taşınamadı.' }));
      }
      await db.prepare('UPDATE cards SET column_id = ? WHERE id = ? AND board_id = ?').run(msg.column_id, msg.card_id, currentBoardId);
      broadcast(currentBoardId, { type: 'card_moved' });
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

          await db.prepare(`
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

        await db.prepare(`
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
        await db.prepare(`
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
        const parent = await db.prepare(`
          SELECT id FROM comments WHERE id = ? AND card_id = ?
        `).get(parentId, msg.card_id);
        if (!parent) parentId = null;
      }


      const id = uuidv4();


      await db.prepare(`
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

      const comment = await db.prepare(`
        SELECT c.id FROM comments c
        JOIN cards card ON card.id = c.card_id
        WHERE c.id = ? AND card.board_id = ?
      `).get(msg.comment_id, currentBoardId);
      if (!comment) return;

      const existing = await db.prepare(`
        SELECT id FROM comment_reactions
        WHERE comment_id = ? AND participant_id = ? AND emoji = ?
      `).get(msg.comment_id, currentParticipantId, emoji);

      if (existing) {
        await db.prepare('DELETE FROM comment_reactions WHERE id = ?').run(existing.id);
      } else {
        await db.prepare(`
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
        await db.prepare(`
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

        await isAdmin(
          currentParticipantId,
          currentBoardId
        );


      if (!allowed) {
        return;
      }


      await db.prepare(`
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


      await db.prepare(`
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
        !await isAdmin(
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


      await db.prepare(`
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
      if (!await isAdmin(
          currentParticipantId, currentBoardId)) {
        ws.send(JSON.stringify({ type: 'error', message: 'Sadece admin kartları gizleyebilir.' }));
        return;
      }

      await db.prepare(`
        UPDATE boards SET status = 'open'
        WHERE id = ? AND status = 'revealed'
      `).run(currentBoardId);

      return;
    }


    // =====================================================
    // TRANSFER ADMIN
    // =====================================================

    if (msg.type === 'set_admin') {

      if (
        !await isAdmin(
          currentParticipantId,
          currentBoardId
        )
      ) {

        ws.send(
          JSON.stringify({
            type: 'error',
            message:
              'Sadece admin yetki değiştirebilir.'
          })
        );

        return;
      }


      const newAdmin =
        await db.prepare(`
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


      if (msg.admin === false && newAdmin.role === 'admin') {
        const admins = await db.prepare("SELECT COUNT(*) AS count FROM participants WHERE board_id = ? AND role = 'admin'").get(currentBoardId);
        if (Number(admins.count) <= 1) return ws.send(JSON.stringify({ type: 'error', message: 'En az bir admin kalmalı.' }));
      }
      await db.prepare('UPDATE participants SET role = ? WHERE id = ? AND board_id = ?')
        .run(msg.admin === true ? 'admin' : 'participant', newAdmin.id, currentBoardId);


      broadcast(
        currentBoardId,
        {
          type: 'admin_changed',
          participant_id: newAdmin.id,
          role: msg.admin === true ? 'admin' : 'participant'
        }
      );

      return;
    }

    if (msg.type === 'timer_start' || msg.type === 'timer_reset') {
      if (!await isAdmin(currentParticipantId, currentBoardId)) {
        return ws.send(JSON.stringify({ type: 'error', message: 'Sayacı yalnızca admin yönetebilir.' }));
      }
      const board = await db.prepare('SELECT timer_minutes, status FROM boards WHERE id = ?').get(currentBoardId);
      if (!board || board.status === 'closed') return;
      const endsAt = msg.type === 'timer_start' ? Date.now() + Number(board.timer_minutes) * 60000 : null;
      await db.prepare('UPDATE boards SET timer_ends_at = ? WHERE id = ?').run(endsAt, currentBoardId);
      broadcast(currentBoardId, { type: 'timer_changed', timer_ends_at: endsAt });
      return;
    }


    // =====================================================
    // CLOSE BOARD — SADECE ADMIN
    // =====================================================

    if (msg.type === 'board_close') {

      if (
        !await isAdmin(
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


      await db.prepare(`
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
      } = await generateReport(
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

  })().catch(error => {
    console.error('Board işlemi sırasında hata:', error);
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({type: 'error', message: 'İşlem tamamlanamadı. Tekrar deneyin.'}));
  }); });


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
// Board yalnızca admin tarafından kapatılır. Otomatik kapanma yoktur.
// =========================================================

// =========================================================
// SERVER
// =========================================================

const PORT =
  process.env.PORT || 3000;


initialize()
  .then(() => server.listen(PORT, () => console.log(`Retro app http://localhost:${PORT} adresinde çalışıyor`)))
  .catch(error => { console.error('Veritabanı başlatılamadı:', error); process.exitCode = 1; });
