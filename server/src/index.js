```js
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


/*
============================================================
WEBSOCKET CONNECTIONS
============================================================
*/

const boardSockets = new Map();


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


/*
============================================================
HELPERS
============================================================
*/

function getParticipant(participantId, boardId) {
  return db.prepare(`
    SELECT id, board_id, name, role
    FROM participants
    WHERE id = ?
      AND board_id = ?
  `).get(participantId, boardId);
}


function isAdmin(participantId, boardId) {
  const participant = getParticipant(participantId, boardId);

  return participant && participant.role === 'admin';
}


function sendError(ws, message) {
  ws.send(JSON.stringify({
    type: 'error',
    message
  }));
}


/*
============================================================
REST API
============================================================
*/


/*
------------------------------------------------------------
CREATE BOARD
------------------------------------------------------------
*/

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
      error: 'Geçersiz başlık veya kolon listesi (1-5 kolon)'
    });
  }

  const id = uuidv4();

  const cols = columns.map(name => ({
    id: uuidv4(),
    name
  }));

  db.prepare(`
    INSERT INTO boards (
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


/*
------------------------------------------------------------
GET BOARD
------------------------------------------------------------
*/

app.get('/api/boards/:id', (req, res) => {

  const board = db.prepare(`
    SELECT *
    FROM boards
    WHERE id = ?
  `).get(req.params.id);

  if (!board) {
    return res.status(404).json({
      error: 'Board bulunamadı'
    });
  }

  const columns = JSON.parse(board.columns);


  const cards = db.prepare(`
    SELECT
      c.*,

      (
        SELECT COUNT(*)
        FROM votes v
        WHERE v.card_id = c.id
      ) AS vote_count

    FROM cards c

    WHERE c.board_id = ?
  `).all(board.id);


  const actions = db.prepare(`
    SELECT *
    FROM actions
    WHERE board_id = ?
  `).all(board.id);


  const participants = db.prepare(`
    SELECT
      id,
      name,
      role
    FROM participants
    WHERE board_id = ?
    ORDER BY joined_at ASC
  `).all(board.id);


  const admin = participants.find(
    participant => participant.role === 'admin'
  );


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
        card.vote_count

    })),

    actions,

    participants,

    admin: admin || null

  });
});


/*
============================================================
REPORT
============================================================
*/

app.get('/api/reports/:token', (req, res) => {

  const report = db.prepare(`
    SELECT *
    FROM reports
    WHERE token = ?
  `).get(req.params.token);

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

  const report = db.prepare(`
    SELECT *
    FROM reports
    WHERE token = ?
  `).get(req.params.token);

  if (!report) {
    return res.status(404).send(
      'Rapor bulunamadı'
    );
  }

  res.download(
    report.pdf_path,
    'retro-raporu.pdf'
  );
});


/*
============================================================
WEBSOCKET
============================================================
*/

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


    /*
    ========================================================
    JOIN
    ========================================================
    */

    if (msg.type === 'join') {

      const board = db.prepare(`
        SELECT *
        FROM boards
        WHERE id = ?
      `).get(msg.board_id);


      if (!board) {

        return sendError(
          ws,
          'Board bulunamadı'
        );

      }


      currentBoardId =
        msg.board_id;


      currentParticipantId =
        uuidv4();


      /*
      Board'da admin var mı?
      */

      const existingAdmin =
        db.prepare(`
          SELECT id
          FROM participants
          WHERE board_id = ?
            AND role = 'admin'
          LIMIT 1
        `).get(currentBoardId);


      /*
      Admin yoksa ilk katılan kişi admin.
      */

      const role =
        existingAdmin
          ? 'participant'
          : 'admin';


      db.prepare(`
        INSERT INTO participants (
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


      /*
      WebSocket listesine ekle
      */

      if (!boardSockets.has(currentBoardId)) {

        boardSockets.set(
          currentBoardId,
          new Set()
        );

      }


      boardSockets
        .get(currentBoardId)
        .add(ws);


      /*
      Kullanıcıya kendi rolünü gönder.
      */

      ws.send(JSON.stringify({

        type: 'joined',

        participant_id:
          currentParticipantId,

        role

      }));


      /*
      Diğer kullanıcılara bildir.
      */

      broadcast(
        currentBoardId,
        {
          type: 'participant_joined',

          name:
            msg.name || 'Anonim',

          role
        }
      );


      return;
    }


    /*
    Join olmadan işlem yapılmasın.
    */

    if (!currentBoardId) {
      return;
    }


    /*
    ========================================================
    ACTIONS
    ========================================================
    */

    switch (msg.type) {


      /*
      ------------------------------------------------------
      CARD ADD
      ------------------------------------------------------
      */

      case 'card_add': {

        if (!msg.content || !msg.column_id) {
          return;
        }


        const id =
          uuidv4();


        db.prepare(`
          INSERT INTO cards (
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
            : (msg.author_name || null),

          msg.anonymous
            ? 1
            : 0,

          Date.now()

        );


        broadcast(
          currentBoardId,
          {
            type: 'card_added',
            id,
            column_id: msg.column_id
          }
        );


        break;
      }


      /*
      ------------------------------------------------------
      VOTE ADD
      ------------------------------------------------------
      */

      case 'vote_add': {

        try {

          db.prepare(`
            INSERT INTO votes (
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


          broadcast(
            currentBoardId,
            {
              type: 'vote_changed',
              card_id: msg.card_id
            }
          );

        } catch {

          // Kullanıcı zaten oy vermiş.
        }

        break;
      }


      /*
      ------------------------------------------------------
      VOTE REMOVE
      ------------------------------------------------------
      */

      case 'vote_remove': {

        db.prepare(`
          DELETE FROM votes

          WHERE card_id = ?

            AND participant_id = ?
        `).run(

          msg.card_id,

          currentParticipantId

        );


        broadcast(
          currentBoardId,
          {
            type: 'vote_changed',
            card_id: msg.card_id
          }
        );


        break;
      }


      /*
      ------------------------------------------------------
      ACTION ADD
      ------------------------------------------------------
      */

      case 'action_add': {

        const id =
          uuidv4();


        db.prepare(`
          INSERT INTO actions (
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

          msg.content || null,

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


        break;
      }


      /*
      ======================================================
      REVEAL
      ======================================================
      */

      case 'reveal': {

        /*
        SADECE ADMIN
        */

        if (
          !isAdmin(
            currentParticipantId,
            currentBoardId
          )
        ) {

          return sendError(
            ws,
            'Bu işlem sadece admin tarafından yapılabilir.'
          );

        }


        db.prepare(`
          UPDATE boards

          SET status = 'revealed'

          WHERE id = ?
        `).run(
          currentBoardId
        );


        broadcast(
          currentBoardId,
          {
            type: 'revealed'
          }
        );


        break;
      }


      /*
      ======================================================
      TRANSFER ADMIN
      ======================================================
      */

      case 'transfer_admin': {

        /*
        Sadece mevcut admin yapabilir.
        */

        if (
          !isAdmin(
            currentParticipantId,
            currentBoardId
          )
        ) {

          return sendError(
            ws,
            'Adminliği sadece mevcut admin devredebilir.'
          );

        }


        const newAdmin =
          getParticipant(
            msg.participant_id,
            currentBoardId
          );


        if (!newAdmin) {

          return sendError(
            ws,
            'Katılımcı bulunamadı.'
          );

        }


        if (
          newAdmin.id ===
          currentParticipantId
        ) {

          return sendError(
            ws,
            'Zaten adminsiniz.'
          );

        }


        /*
        Önce eski admin participant.
        */

        db.prepare(`
          UPDATE participants

          SET role = 'participant'

          WHERE id = ?
        `).run(
          currentParticipantId
        );


        /*
        Sonra yeni admin.
        */

        db.prepare(`
          UPDATE participants

          SET role = 'admin'

          WHERE id = ?
        `).run(
          newAdmin.id
        );


        /*
        Eski admin'e bildir.
        */

        ws.send(JSON.stringify({

          type: 'admin_transferred',

          new_admin_id:
            newAdmin.id

        }));


        /*
        Tüm kullanıcılara bildir.
        */

        broadcast(
          currentBoardId,
          {

            type:
              'admin_changed',

            admin_id:
              newAdmin.id,

            admin_name:
              newAdmin.name

          }
        );


        /*
        Mevcut websocket'in rolünü
        güncelliyoruz.
        */

        currentParticipantId =
          currentParticipantId;


        break;
      }


      /*
      ======================================================
      BOARD CLOSE
      ======================================================
      */

      case 'board_close': {

        /*
        SADECE ADMIN
        */

        if (
          !isAdmin(
            currentParticipantId,
            currentBoardId
          )
        ) {

          return sendError(
            ws,
            'Boardu sadece admin kapatabilir.'
          );

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
        } =
          generateReport(
            currentBoardId
          );


        broadcast(
          currentBoardId,
          {

            type:
              'board_closed',

            report_token:
              token

          }
        );


        break;
      }

    }

  });


  /*
  ==========================================================
  DISCONNECT
  ==========================================================
  */

  ws.on('close', () => {

    if (
      currentBoardId &&
      boardSockets.has(
        currentBoardId
      )
    ) {

      boardSockets
        .get(currentBoardId)
        .delete(ws);

    }

  });

});


/*
============================================================
TTL CLEANUP
============================================================
*/

function cleanupExpiredBoards() {

  const boards =
    db.prepare(`
      SELECT
        id,
        created_at,
        ttl_hours

      FROM boards
    `).all();


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

      del.run(
        board.id
      );

    }

  }

}


setInterval(
  cleanupExpiredBoards,
  60 * 60 * 1000
);


/*
============================================================
SERVER
============================================================
*/

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
```
