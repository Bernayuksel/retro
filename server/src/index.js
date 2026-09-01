
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
    ttl_hours
  } = req.body;

  if (
    !title ||
    !Array.isArray(columns) ||
    columns.length === 0 ||
    columns.length > 5
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
      ttl_hours,
      created_at
    )
    VALUES (?, ?, ?, 'open', ?, ?)
  `).run(
    id,
    title,
    JSON.stringify(cols),
    ttl_hours || 48,
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
        c.created_at,
        p.name AS author_name

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

    if (!commentsByCard[comment.card_id]) {
      commentsByCard[comment.card_id] = [];
    }

    commentsByCard[comment.card_id].push(comment);
  }


  res.json({

    id: board.id,

    title: board.title,

    status: board.status,

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

      currentParticipantId =
        uuidv4();


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


      db.prepare(`
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
        msg.name || 'Anonim',
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

          role

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


      const id = uuidv4();


      db.prepare(`
        INSERT INTO comments
        (
          id,
          card_id,
          participant_id,
          content,
          created_at
        )

        VALUES (?, ?, ?, ?, ?)
      `).run(

        id,

        msg.card_id,

        currentParticipantId,

        content,

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

        SET role = 'participant'

        WHERE board_id = ?
        AND role = 'admin'
      `).run(currentBoardId);


      db.prepare(`
        UPDATE participants

        SET role = 'admin'

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
// TTL CLEANUP
// =========================================================

function cleanupExpiredBoards() {

  const boards =
    db
      .prepare(`
        SELECT
          id,
          created_at,
          ttl_hours

        FROM boards
      `)
      .all();


  const now =
    Date.now();


  const del =
    db.prepare(`
      DELETE FROM boards
      WHERE id = ?
    `);


  for (const board of boards) {

    if (
      now - board.created_at >
      board.ttl_hours *
      3600 *
      1000
    ) {

      del.run(board.id);
    }
  }
}


setInterval(
  cleanupExpiredBoards,
  60 * 60 * 1000
);


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
