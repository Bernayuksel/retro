```js
const app = document.getElementById('app');

const state = {
  ws: null,
  participantId: null,
  boardId: null,
  name: null,
  role: null,
  columns: [],
  status: 'open',
  openCommentCard: null,
  board: null
};


/* =========================================================
   HELPERS
========================================================= */

function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content;
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, m => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[m]));
}

function statusLabel(status) {
  return {
    open: 'Kartlar gizli',
    revealed: 'Kartlar açık',
    closed: 'Kapatıldı'
  }[status] || status;
}


/* =========================================================
   ROUTER
========================================================= */

function navigate() {

  const hash = location.hash || '#/';

  if (hash === '#/') {
    renderHome();
    return;
  }

  const boardMatch =
    hash.match(/^#\/board\/([a-zA-Z0-9-]+)$/);

  if (boardMatch) {
    renderBoard(boardMatch[1]);
    return;
  }

  const reportMatch =
    hash.match(/^#\/report\/([a-zA-Z0-9-]+)$/);

  if (reportMatch) {
    renderReport(reportMatch[1]);
    return;
  }

  renderHome();
}

window.addEventListener(
  'hashchange',
  navigate
);


/* =========================================================
   HOME
========================================================= */

function renderHome() {

  app.innerHTML = '';

  app.appendChild(h(`
    <div class="home-page">

      <div class="hero">

        <div class="logo-mark">✦</div>

        <div>
          <div class="eyebrow">RETROSPECTIVE</div>
          <h1>Better retros.<br><span>Better teams.</span></h1>
          <p>
            Ekibinle birlikte neyin iyi gittiğini,
            neyin geliştirilmesi gerektiğini ve
            sonraki sprint için aksiyonları keşfet.
          </p>
        </div>

      </div>


      <div class="home-grid">

        <div class="glass-card">

          <div class="card-icon">＋</div>

          <h2>Yeni Retro</h2>

          <p class="muted">
            Yeni bir retrospektif board oluştur.
          </p>

          <input
            id="title"
            class="modern-input"
            placeholder="Örn. Sprint 24 Retro"
          />

          <div class="section-label">
            KOLONLAR
          </div>

          <div id="colInputs"></div>

          <button
            id="addCol"
            class="ghost-button"
            type="button"
          >
            + Kolon ekle
          </button>

          <div class="section-label">
            BOARD SÜRESİ
          </div>

          <div class="ttl-row">

            <input
              id="ttl"
              type="number"
              value="48"
              class="modern-input small-input"
            />

            <span> saat</span>

          </div>

          <button
            id="createBtn"
            class="primary-button full"
          >
            Retro Oluştur →
          </button>

        </div>


        <div class="glass-card join-card">

          <div class="card-icon">↗</div>

          <h2>Retro'ya Katıl</h2>

          <p class="muted">
            Takım arkadaşının gönderdiği
            board ID'sini kullan.
          </p>

          <input
            id="joinId"
            class="modern-input"
            placeholder="Board ID"
          />

          <button
            id="joinBtn"
            class="secondary-button full"
          >
            Board'a Katıl
          </button>

        </div>

      </div>

    </div>
  `));


  const colInputs =
    document.getElementById('colInputs');


  function addColRow(value = '') {

    const row =
      document.createElement('div');

    row.className =
      'col-input-row modern-col-row';

    row.innerHTML = `

      <input
        class="colName modern-input"
        value="${escapeHtml(value)}"
        placeholder="Kolon adı"
      />

      <button
        class="remove-col"
        type="button"
      >
        ×
      </button>
    `;

    row.querySelector('.remove-col').onclick =
      () => {

        if (colInputs.children.length <= 1) {
          return;
        }

        row.remove();
      };

    colInputs.appendChild(row);
  }


  [
    'İyi gitti',
    'Geliştirebiliriz',
    'Aksiyonlar'
  ].forEach(addColRow);


  document.getElementById('addCol').onclick =
    () => {

      if (colInputs.children.length >= 5) {

        alert(
          'En fazla 5 kolon ekleyebilirsiniz.'
        );

        return;
      }

      addColRow();
    };


  document.getElementById('createBtn').onclick =
    async () => {

      const title =
        document.getElementById('title')
          .value.trim();


      const cols =
        [...document.querySelectorAll('.colName')]
          .map(input => input.value.trim())
          .filter(Boolean);


      const ttl =
        parseInt(
          document.getElementById('ttl').value,
          10
        ) || 48;


      if (!title || !cols.length) {

        alert(
          'Board başlığı ve en az bir kolon gerekli.'
        );

        return;
      }


      const name =
        prompt(
          'Adınız:'
        );


      if (!name || !name.trim()) {
        return;
      }


      state.name =
        name.trim();


      const res =
        await fetch(
          '/api/boards',
          {
            method: 'POST',

            headers: {
              'Content-Type':
                'application/json'
            },

            body: JSON.stringify({
              title,
              columns: cols,
              ttl_hours: ttl
            })
          }
        );


      const data =
        await res.json();


      location.hash =
        `#/board/${data.id}`;
    };


  document.getElementById('joinBtn').onclick =
    () => {

      const id =
        document.getElementById('joinId')
          .value.trim();


      if (!id) {
        return;
      }


      const name =
        prompt(
          'Adınız:'
        );


      if (!name || !name.trim()) {
        return;
      }


      state.name =
        name.trim();


      location.hash =
        `#/board/${id}`;
    };
}


/* =========================================================
   BOARD
========================================================= */

async function renderBoard(boardId) {

  const res =
    await fetch(
      `/api/boards/${boardId}`
    );


  if (!res.ok) {

    app.innerHTML = `
      <div class="empty-page">
        <div class="empty-icon">404</div>
        <h2>Board bulunamadı</h2>
        <p>Board silinmiş veya süresi dolmuş olabilir.</p>
        <button onclick="location.hash='#/'">
          Ana sayfaya dön
        </button>
      </div>
    `;

    return;
  }


  const board =
    await res.json();


  state.boardId =
    boardId;

  state.board =
    board;

  state.columns =
    board.columns;

  state.status =
    board.status;


  if (!state.name) {

    const name =
      prompt('Adınız:');

    state.name =
      name?.trim() || 'Anonim';
  }


  /*
   * Önce board ekranını oluşturuyoruz.
   * WebSocket bağlandıktan sonra gerçek rolümüz geliyor.
   */

  app.innerHTML = '';

  app.appendChild(h(`

    <div class="retro-page">


      <!-- HEADER -->

      <header class="retro-header">

        <div class="brand">
          <div class="logo-mark small">✦</div>

          <div>
            <div class="brand-title">
              ${escapeHtml(board.title)}
            </div>

            <div class="brand-subtitle">
              Sprint Retrospective
            </div>
          </div>
        </div>


        <div class="header-right">

          <div
            class="status-pill"
            id="statusBadge"
          >
            ${statusLabel(board.status)}
          </div>

          <button
            id="participantsBtn"
            class="icon-button"
          >
            👥
            <span id="participantCount">
              ${board.participants?.length || 0}
            </span>
          </button>

        </div>

      </header>


      <!-- BOARD -->

      <main>

        <div
          class="board-intro"
        >

          <div>

            <div class="eyebrow">
              TEAM RETRO
            </div>

            <h1>
              Let's reflect.
            </h1>

            <p>
              Fikirlerini paylaş, takım arkadaşlarını
              destekle ve birlikte daha iyisini yapın.
            </p>

          </div>

        </div>


        <div
          id="columns"
          class="board-columns"
        ></div>


        <!-- ACTIONS -->

        <section class="actions-section">

          <div class="section-heading">

            <div>

              <div class="eyebrow">
                NEXT STEPS
              </div>

              <h2>
                Aksiyon Maddeleri
              </h2>

            </div>

          </div>


          <div
            id="actionsList"
            class="actions-list"
          ></div>


          <div class="action-form">

            <input
              id="actionContent"
              class="modern-input"
              placeholder="Hangi aksiyonu alacağız?"
            />

            <input
              id="actionOwner"
              class="modern-input"
              placeholder="Sorumlu"
            />

            <input
              id="actionDue"
              type="date"
              class="modern-input"
            />

            <button
              id="addActionBtn"
              class="primary-button"
            >
              + Ekle
            </button>

          </div>

        </section>


        <!-- ADMIN PANEL -->

        <section
          id="adminPanel"
          class="admin-panel hidden"
        ></section>

      </main>


      <!-- PARTICIPANTS MODAL -->

      <div
        id="participantsModal"
        class="modal hidden"
      >

        <div class="modal-backdrop"></div>

        <div class="modal-content">

          <div class="modal-header">

            <div>
              <div class="eyebrow">
                TEAM
              </div>

              <h2>
                Katılımcılar
              </h2>
            </div>

            <button
              id="closeParticipants"
              class="close-button"
            >
              ×
            </button>

          </div>

          <div
            id="participantsList"
          ></div>

        </div>

      </div>

    </div>

  `));


  renderColumns(board);

  renderActions(board.actions);

  renderParticipants(board.participants);

  setupBoardEvents();

  connectWs(
    boardId,
    board.status
  );
}


/* =========================================================
   COLUMNS
========================================================= */

function renderColumns(board) {

  const columnsEl =
    document.getElementById('columns');

  if (!columnsEl) {
    return;
  }


  columnsEl.innerHTML = '';


  board.columns.forEach(column => {

    const columnEl =
      document.createElement('section');

    columnEl.className =
      'retro-column';


    const colors = [
      'column-yellow',
      'column-purple',
      'column-green',
      'column-blue',
      'column-pink'
    ];


    const colorClass =
      colors[
        board.columns.indexOf(column) %
        colors.length
      ];


    columnEl.classList.add(
      colorClass
    );


    columnEl.innerHTML = `

      <div class="column-header">

        <div class="column-title">

          <span class="column-dot"></span>

          <h3>
            ${escapeHtml(column.name)}
          </h3>

        </div>

        <span
          class="column-count"
          id="count-${column.id}"
        >
          0
        </span>

      </div>


      <div
        class="cards"
        id="cards-${column.id}"
      ></div>


      <div class="add-card-area">

        <textarea
          class="newCardInput modern-input"
          rows="2"
          placeholder="Bir fikir paylaş..."
        ></textarea>


        <div class="card-form-bottom">

          <label class="anonymous-toggle">

            <input
              type="checkbox"
              class="anonCheck"
            />

            <span>
              Anonim
            </span>

          </label>


          <button
            class="addCardBtn small-primary"
          >
            Ekle
          </button>

        </div>

      </div>

    `;


    columnsEl.appendChild(
      columnEl
    );


    columnEl
      .querySelector('.addCardBtn')
      .onclick = () => {

        const input =
          columnEl.querySelector(
            '.newCardInput'
          );


        const content =
          input.value.trim();


        if (!content) {
          return;
        }


        const anonymous =
          columnEl.querySelector(
            '.anonCheck'
          ).checked;


        send({

          type: 'card_add',

          column_id:
            column.id,

          content,

          anonymous,

          author_name:
            state.name

        });


        input.value = '';
      };
  });
}


/* =========================================================
   CARDS
========================================================= */

function renderCards(cards, boardStatus) {

  const grouped = {};


  state.columns.forEach(column => {
    grouped[column.id] = [];
  });


  for (const card of cards) {

    if (!grouped[card.column_id]) {
      grouped[card.column_id] = [];
    }

    grouped[
      card.column_id
    ].push(card);
  }


  state.columns.forEach(column => {

    const container =
      document.getElementById(
        `cards-${column.id}`
      );


    if (!container) {
      return;
    }


    container.innerHTML = '';


    const count =
      document.getElementById(
        `count-${column.id}`
      );


    if (count) {
      count.textContent =
        grouped[column.id].length;
    }


    grouped[column.id].forEach(card => {

      container.appendChild(
        renderCardEl(
          card,
          boardStatus
        )
      );

    });
  });
}


/* =========================================================
   CARD ELEMENT
========================================================= */

function renderCardEl(
  card,
  boardStatus
) {

  const masked =
    boardStatus === 'open';


  const el =
    document.createElement('article');


  el.className =
    'retro-card' +
    (masked ? ' masked' : '');


  el.dataset.cardId =
    card.id;


  const authorLabel =
    card.is_anonymous
      ? 'Anonim'
      : (
        card.author_name ||
        'Anonim'
      );


  const commentOpen =
    state.openCommentCard ===
    card.id;


  el.innerHTML = `

    <div class="card-top">

      <span class="card-author">
        ${masked ? '' : escapeHtml(authorLabel)}
      </span>

      <button
        class="card-menu"
        title="Daha fazla"
      >
        ···
      </button>

    </div>


    <div class="card-content">

      ${
        masked

          ? `
            <div class="hidden-card">
              🔒
              Kart gizli
            </div>
          `

          : escapeHtml(
              card.content
            )
      }

    </div>


    <div class="card-footer">

      <button
        class="reaction-button vote-btn"
        ${masked ? 'disabled' : ''}
      >
        👍
        <span>
          ${card.vote_count || 0}
        </span>
      </button>


      <button
        class="comment-button"
      >
        💬
        <span>
          Yorum
        </span>
      </button>

    </div>


    ${
      commentOpen && !masked

        ? `

          <div class="comments-panel">

            <div class="comments-header">

              <strong>
                Yorumlar
              </strong>

              <button
                class="close-comments"
              >
                ×
              </button>

            </div>

            <div class="comments-empty">
              Yorum sistemi hazır.
              <br>
              Bu alanı bir sonraki adımda
              gerçek zamanlı yorumlarla bağlıyoruz.
            </div>

          </div>

        `

        : ''
    }

  `;


  /*
   * Vote
   */

  if (!masked) {

    el.querySelector(
      '.vote-btn'
    ).onclick = () => {

      send({

        type: 'vote_add',

        card_id:
          card.id

      });

    };
  }


  /*
   * Comment toggle
   */

  el.querySelector(
    '.comment-button'
  ).onclick = event => {

    event.stopPropagation();


    if (
      state.openCommentCard ===
      card.id
    ) {

      state.openCommentCard =
        null;

    } else {

      state.openCommentCard =
        card.id;

    }


    refreshBoardData();
  };


  /*
   * Close comment
   */

  const closeComments =
    el.querySelector(
      '.close-comments'
    );


  if (closeComments) {

    closeComments.onclick =
      event => {

        event.stopPropagation();

        state.openCommentCard =
          null;

        refreshBoardData();

      };
  }


  return el;
}


/* =========================================================
   ACTIONS
========================================================= */

function renderActions(actions) {

  const list =
    document.getElementById(
      'actionsList'
    );


  if (!list) {
    return;
  }


  if (!actions.length) {

    list.innerHTML = `
      <div class="empty-actions">
        Henüz aksiyon eklenmedi.
      </div>
    `;

    return;
  }


  list.innerHTML = '';


  actions.forEach(action => {

    const el =
      document.createElement('div');


    el.className =
      'action-item-modern';


    el.innerHTML = `

      <div class="action-check">
        ✓
      </div>

      <div class="action-main">

        <div class="action-content">
          ${escapeHtml(action.content)}
        </div>

        <div class="action-meta">
          👤 ${escapeHtml(action.owner || 'Atanmadı')}
          ·
          📅 ${escapeHtml(action.due_date || 'Tarih yok')}
        </div>

      </div>

    `;


    list.appendChild(el);
  });
}


/* =========================================================
   PARTICIPANTS
========================================================= */

function renderParticipants(
  participants
) {

  const list =
    document.getElementById(
      'participantsList'
    );


  if (!list) {
    return;
  }


  list.innerHTML = '';


  participants.forEach(
    participant => {

      const item =
        document.createElement('div');


      item.className =
        'participant-item';


      item.innerHTML = `

        <div class="participant-avatar">
          ${escapeHtml(
            participant.name
              .charAt(0)
              .toUpperCase()
          )}
        </div>


        <div class="participant-info">

          <strong>
            ${escapeHtml(
              participant.name
            )}
          </strong>

          <span>
            ${
              participant.role === 'admin'
                ? '👑 Admin'
                : 'Katılımcı'
            }
          </span>

        </div>

      `;


      list.appendChild(item);
    }
  );


  const count =
    document.getElementById(
      'participantCount'
    );


  if (count) {
    count.textContent =
      participants.length;
  }
}


/* =========================================================
   ADMIN PANEL
========================================================= */

function renderAdminPanel() {

  const panel =
    document.getElementById(
      'adminPanel'
    );


  if (!panel) {
    return;
  }


  if (state.role !== 'admin') {

    panel.classList.add(
      'hidden'
    );

    panel.innerHTML = '';

    return;
  }


  panel.classList.remove(
    'hidden'
  );


  const participants =
    state.board?.participants || [];


  const otherParticipants =
    participants.filter(
      participant =>
        participant.id !==
        state.participantId
    );


  panel.innerHTML = `

    <div class="admin-header">

      <div>

        <div class="eyebrow">
          ADMIN CONTROL
        </div>

        <h2>
          Board Yönetimi
        </h2>

      </div>

      <div class="admin-badge">
        👑 Admin
      </div>

    </div>


    <div class="admin-actions">

      <button
        id="adminReveal"
        class="admin-action"
      >

        <span class="admin-action-icon">
          👁
        </span>

        <span>

          <strong>
            Kartları Aç
          </strong>

          <small>
            Tüm kartları görünür yap
          </small>

        </span>

      </button>


      <button
        id="transferAdmin"
        class="admin-action"
      >

        <span class="admin-action-icon">
          👑
        </span>

        <span>

          <strong>
            Adminliği Devret
          </strong>

          <small>
            Başka bir katılımcıyı admin yap
          </small>

        </span>

      </button>


      <button
        id="closeBoard"
        class="admin-action danger-action"
      >

        <span class="admin-action-icon">
          ×
        </span>

        <span>

          <strong>
            Board'u Kapat
          </strong>

          <small>
            Retro'yu tamamla ve rapor oluştur
          </small>

        </span>

      </button>

    </div>


    <div
      id="transferArea"
      class="transfer-area hidden"
    >

      <div class="transfer-title">
        Yeni admini seç
      </div>

      <select
        id="newAdminSelect"
        class="modern-input"
      >

        <option value="">
          Katılımcı seç
        </option>

        ${
          otherParticipants.map(
            participant => `
              <option
                value="${participant.id}"
              >
                ${escapeHtml(
                  participant.name
                )}
              </option>
            `
          ).join('')
        }

      </select>


      <button
        id="confirmTransfer"
        class="primary-button"
      >
        Adminliği Devret
      </button>

    </div>

  `;


  document.getElementById(
    'adminReveal'
  ).onclick = () => {

    send({
      type: 'reveal'
    });

  };


  document.getElementById(
    'closeBoard'
  ).onclick = () => {

    if (
      confirm(
        'Board kapatılacak ve rapor oluşturulacak. Emin misiniz?'
      )
    ) {

      send({
        type: 'board_close'
      });

    }

  };


  const transferArea =
    document.getElementById(
      'transferArea'
    );


  document.getElementById(
    'transferAdmin'
  ).onclick = () => {

    transferArea.classList.toggle(
      'hidden'
    );

  };


  document.getElementById(
    'confirmTransfer'
  ).onclick = () => {

    const participantId =
      document.getElementById(
        'newAdminSelect'
      ).value;


    if (!participantId) {

      alert(
        'Lütfen yeni admini seçin.'
      );

      return;
    }


    if (
      confirm(
        'Adminliği bu katılımcıya devretmek istediğinize emin misiniz?'
      )
    ) {

      send({

        type:
          'transfer_admin',

        participant_id:
          participantId

      });

    }

  };
}


/* =========================================================
   BOARD EVENTS
========================================================= */

function setupBoardEvents() {

  document.getElementById(
    'participantsBtn'
  ).onclick = () => {

    document.getElementById(
      'participantsModal'
    ).classList.remove(
      'hidden'
    );

  };


  document.getElementById(
    'closeParticipants'
  ).onclick = closeParticipants;


  document.querySelector(
    '.modal-backdrop'
  ).onclick = closeParticipants;


  document.getElementById(
    'addActionBtn'
  ).onclick = () => {

    const content =
      document.getElementById(
        'actionContent'
      ).value.trim();


    if (!content) {
      return;
    }


    const owner =
      document.getElementById(
        'actionOwner'
      ).value.trim();


    const due_date =
      document.getElementById(
        'actionDue'
      ).value;


    send({

      type:
        'action_add',

      content,

      owner,

      due_date

    });


    document.getElementById(
      'actionContent'
    ).value = '';


    document.getElementById(
      'actionOwner'
    ).value = '';


    document.getElementById(
      'actionDue'
    ).value = '';

  };
}


function closeParticipants() {

  document.getElementById(
    'participantsModal'
  ).classList.add(
    'hidden'
  );
}


/* =========================================================
   WEBSOCKET
========================================================= */

function connectWs(
  boardId,
  initialStatus
) {

  if (state.ws) {
    state.ws.close();
  }


  const protocol =
    location.protocol === 'https:'
      ? 'wss'
      : 'ws';


  const ws =
    new WebSocket(
      `${protocol}://${location.host}/ws`
    );


  state.ws =
    ws;


  state.status =
    initialStatus;


  ws.onopen = () => {

    send({

      type:
        'join',

      board_id:
        boardId,

      name:
        state.name

    });

  };


  ws.onmessage =
    async event => {

      const msg =
        JSON.parse(
          event.data
        );


      switch (msg.type) {


        case 'joined':

          state.participantId =
            msg.participant_id;


          state.role =
            msg.role;


          renderAdminPanel();

          break;


        case 'participant_joined':

          await refreshBoardData();

          break;


        case 'card_added':

        case 'vote_changed':

        case 'action_added':

          await refreshBoardData();

          break;


        case 'revealed':

          state.status =
            'revealed';


          const badge =
            document.getElementById(
              'statusBadge'
            );


          if (badge) {

            badge.textContent =
              statusLabel(
                'revealed'
              );

          }


          await refreshBoardData();

          break;


        case 'admin_changed':

          await refreshBoardData();


          if (
            msg.admin_id ===
            state.participantId
          ) {

            state.role =
              'admin';

          } else {

            state.role =
              'participant';

          }


          renderAdminPanel();

          renderParticipants(
            state.board.participants
          );

          break;


        case 'admin_transferred':

          state.role =
            'participant';


          renderAdminPanel();

          break;


        case 'board_closed':

          if (msg.report_token) {

            location.hash =
              `#/report/${msg.report_token}`;

          }

          break;


        case 'error':

          alert(
            msg.message ||
            'Bir hata oluştu.'
          );

          break;

      }

    };


  ws.onerror = () => {

    console.error(
      'WebSocket bağlantı hatası'
    );

  };

}


/* =========================================================
   REFRESH
========================================================= */

async function refreshBoardData() {

  const res =
    await fetch(
      `/api/boards/${state.boardId}`
    );


  if (!res.ok) {
    return;
  }


  const board =
    await res.json();


  state.board =
    board;


  state.status =
    board.status;


  state.columns =
    board.columns;


  renderCards(
    board.cards,
    board.status
  );


  renderActions(
    board.actions
  );


  renderParticipants(
    board.participants
  );


  /*
   * Rolü DB'den tekrar doğruluyoruz.
   */

  const me =
    board.participants.find(
      participant =>
        participant.id ===
        state.participantId
    );


  if (me) {

    state.role =
      me.role;

  }


  renderAdminPanel();


  const badge =
    document.getElementById(
      'statusBadge'
    );


  if (badge) {

    badge.textContent =
      statusLabel(
        board.status
      );

  }
}


/* =========================================================
   SEND
========================================================= */

function send(payload) {

  if (
    state.ws &&
    state.ws.readyState ===
      WebSocket.OPEN
  ) {

    state.ws.send(
      JSON.stringify(
        payload
      )
    );

  }
}


/* =========================================================
   REPORT
========================================================= */

async function renderReport(token) {

  const res =
    await fetch(
      `/api/reports/${token}`
    );


  if (!res.ok) {

    app.innerHTML = `
      <div class="empty-page">
        <h2>Rapor bulunamadı.</h2>
      </div>
    `;

    return;
  }


  const report =
    await res.json();


  app.innerHTML = '';

  app.appendChild(h(`

    <div class="report-page">

      <div class="report-header">

        <div>

          <div class="eyebrow">
            RETROSPECTIVE REPORT
          </div>

          <h1>
            ${escapeHtml(
              report.board.title
            )}
          </h1>

        </div>


        <a
          href="/api/reports/${token}/pdf"
          class="primary-button"
        >
          PDF İndir
        </a>

      </div>


      <div class="stats-grid">

        <div class="stat-card">
          <strong>
            ${report.stats.participant_count}
          </strong>
          <span>Katılımcı</span>
        </div>

        <div class="stat-card">
          <strong>
            ${report.stats.card_count}
          </strong>
          <span>Kart</span>
        </div>

        <div class="stat-card">
          <strong>
            ${report.stats.vote_count}
          </strong>
          <span>Oy</span>
        </div>

        <div class="stat-card">
          <strong>
            ${report.stats.action_count}
          </strong>
          <span>Aksiyon</span>
        </div>

      </div>


      <div class="report-columns">

        ${report.columns.map(
          column => {

            const items =
              report.cardsByColumn[
                column.id
              ] || [];


            return `

              <section class="report-column">

                <h2>
                  ${escapeHtml(
                    column.name
                  )}
                </h2>

                ${
                  items.length

                    ? items.map(
                        item => `

                          <article class="report-card">

                            <div>
                              ${escapeHtml(
                                item.content
                              )}
                            </div>

                            <small>
                              ${escapeHtml(
                                item.author
                              )}
                              · 👍
                              ${item.votes}
                            </small>

                          </article>

                        `
                      ).join('')

                    : `
                      <p class="muted">
                        Kart yok
                      </p>
                    `
                }

              </section>

            `;
          }
        ).join('')}

      </div>


      <section class="report-actions">

        <div class="eyebrow">
          NEXT STEPS
        </div>

        <h2>
          Aksiyon Maddeleri
        </h2>

        ${
          report.actions.length

            ? report.actions.map(
                action => `

                  <div class="action-item-modern">

                    <div class="action-check">
                      ✓
                    </div>

                    <div>

                      <strong>
                        ${escapeHtml(
                          action.content
                        )}
                      </strong>

                      <div class="action-meta">
                        👤 ${escapeHtml(
                          action.owner || '-'
                        )}
                        · 📅 ${escapeHtml(
                          action.due_date || '-'
                        )}
                      </div>

                    </div>

                  </div>

                `
              ).join('')

            : `
              <p class="muted">
                Aksiyon eklenmedi.
              </p>
            `
        }

      </section>


      <p class="report-note">
        Bu rapor board silinse bile paylaşılabilir
        link üzerinden erişilebilir.
      </p>

    </div>

  `));
}


/* =========================================================
   START
========================================================= */

navigate();
```
