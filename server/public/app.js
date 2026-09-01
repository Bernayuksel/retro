const app = document.getElementById('app');

const state = {
  ws: null,
  participantId: null,
  boardId: null,
  name: null,
  role: 'participant',
  columns: [],
  status: 'open',
  participants: [],
  openComments: new Set()
};


// =========================================================
// HELPERS
// =========================================================

function h(html) {
  const template = document.createElement('template');
  template.innerHTML = html.trim();
  return template.content;
}


function escapeHtml(value) {
  return String(value || '').replace(
    /[&<>"']/g,
    char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[char])
  );
}


function initials(name) {
  return (name || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(x => x[0])
    .join('')
    .toUpperCase();
}


function statusLabel(status) {
  return {
    open: 'Kartlar gizli',
    revealed: 'Kartlar açık',
    closed: 'Kapatıldı'
  }[status] || status;
}


function navigate() {
  const hash = location.hash || '#/';

  if (hash === '#/') {
    return renderHome();
  }

  const boardMatch =
    hash.match(/^#\/board\/([a-zA-Z0-9-]+)$/);

  if (boardMatch) {
    return renderBoard(boardMatch[1]);
  }

  const reportMatch =
    hash.match(/^#\/report\/([a-zA-Z0-9-]+)$/);

  if (reportMatch) {
    return renderReport(reportMatch[1]);
  }

  renderHome();
}


window.addEventListener(
  'hashchange',
  navigate
);


// =========================================================
// HOME
// =========================================================

function renderHome() {

  app.innerHTML = '';

  app.appendChild(h(`
    <main class="home-page">

      <section class="hero">

        <div class="logo-mark">
          ↗
        </div>

        <div>
          <div class="eyebrow">
            SPRINT RETROSPECTIVE
          </div>

          <h1>
            Better retros,<br>
            <span>better teams.</span>
          </h1>

          <p>
            Ekibinizle birlikte nelerin iyi gittiğini,
            nelerin geliştirilebileceğini ve bir sonraki
            sprint için hangi aksiyonların alınacağını
            kolayca belirleyin.
          </p>
        </div>

      </section>


      <section class="home-grid">

        <div class="glass-card">

          <div class="card-icon">+</div>

          <h2>Yeni retro oluştur</h2>

          <p class="muted">
            Ekibiniz için yeni bir retrospective board
            oluşturun.
          </p>


          <div class="section-label">
            BOARD BAŞLIĞI
          </div>

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
              class="modern-input small-input"
              type="number"
              value="48"
              min="1"
            />

            <span>saat sonra otomatik silinsin</span>

          </div>


          <div style="margin-top:24px">

            <button
              id="createBtn"
              class="primary-button full"
            >
              Board Oluştur →
            </button>

          </div>

        </div>


        <div class="glass-card join-card">

          <div class="card-icon">↗</div>

          <h2>Board'a katıl</h2>

          <p class="muted">
            Ekibinizden gelen board ID'sini girerek
            mevcut retroya katılın.
          </p>


          <div class="section-label">
            BOARD ID
          </div>

          <input
            id="joinId"
            class="modern-input"
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx"
          />


          <div style="margin-top:12px">

            <button
              id="joinBtn"
              class="secondary-button full"
            >
              Board'a Katıl
            </button>

          </div>

        </div>

      </section>

    </main>
  `));


  const colInputs =
    document.getElementById('colInputs');


  const defaultCols = [
    'İyi gitti',
    'Daha iyi olabilirdi',
    'Aksiyonlar'
  ];


  function addColRow(value = '') {

    const row =
      document.createElement('div');

    row.className =
      'modern-col-row';


    row.innerHTML = `

      <input
        class="modern-input colName"
        value="${escapeHtml(value)}"
        placeholder="Kolon adı"
      >

      <button
        class="remove-col"
        type="button"
      >
        ×
      </button>

    `;


    row
      .querySelector('.remove-col')
      .onclick = () => {

        if (colInputs.children.length <= 1) {
          return;
        }

        row.remove();
      };


    colInputs.appendChild(row);
  }


  defaultCols.forEach(addColRow);


  document.getElementById('addCol').onclick =
    () => {

      if (colInputs.children.length >= 5) {

        return alert(
          'En fazla 5 kolon eklenebilir.'
        );
      }

      addColRow();
    };


  document.getElementById('createBtn').onclick =
    async () => {

      const title =
        document
          .getElementById('title')
          .value
          .trim();


      const cols =
        [...document.querySelectorAll('.colName')]
          .map(input => input.value.trim())
          .filter(Boolean);


      const ttl =
        parseInt(
          document.getElementById('ttl').value,
          10
        ) || 48;


      if (!title || cols.length === 0) {

        return alert(
          'Başlık ve en az bir kolon gerekli.'
        );
      }


      const res =
        await fetch('/api/boards', {

          method: 'POST',

          headers: {
            'Content-Type': 'application/json'
          },

          body: JSON.stringify({
            title,
            columns: cols,
            ttl_hours: ttl
          })

        });


      const data =
        await res.json();


      if (!res.ok) {

        return alert(
          data.error || 'Board oluşturulamadı.'
        );
      }


      location.hash =
        `#/board/${data.id}`;
    };


  document.getElementById('joinBtn').onclick =
    () => {

      const id =
        document
          .getElementById('joinId')
          .value
          .trim();


      if (id) {
        location.hash =
          `#/board/${id}`;
      }
    };
}


// =========================================================
// BOARD
// =========================================================

async function renderBoard(boardId) {

  const res =
    await fetch(
      `/api/boards/${boardId}`
    );


  if (!res.ok) {

    app.innerHTML = `
      <div class="empty-page">
        <div class="empty-icon">!</div>
        <h2>Board bulunamadı</h2>
        <p class="muted">
          Board silinmiş veya süresi dolmuş olabilir.
        </p>
        <button
          class="primary-button"
          onclick="location.hash='#/'"
        >
          Ana sayfaya dön
        </button>
      </div>
    `;

    return;
  }


  const board =
    await res.json();


  state.boardId = boardId;
  state.columns = board.columns;
  state.status = board.status;
  state.participants =
    board.participants || [];


  /*
   * Kullanıcı daha önce isim girmediyse sor.
   */

  if (!state.name) {

    state.name =
      prompt('Adınız:') ||
      'Anonim';
  }


  /*
   * WebSocket'e bağlanmadan önce
   * eski UI state'ini temizle.
   */

  state.openComments.clear();


  app.innerHTML = '';


  app.appendChild(h(`

    <main class="retro-page">


      <header class="retro-header">

        <div class="brand">

          <div class="logo-mark small">
            ↗
          </div>

          <div>

            <div class="brand-title">
              Retro
            </div>

            <div class="brand-subtitle">
              Sprint retrospective
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
              ${board.participants.length}
            </span>
          </button>

        </div>

      </header>


      <section class="board-intro">

        <div class="eyebrow">
          RETROSPECTIVE BOARD
        </div>

        <h1>
          ${escapeHtml(board.title)}
        </h1>

        <p>
          Düşüncelerinizi paylaşın, birbirinizin
          fikirlerine oy verin ve aksiyonları belirleyin.
        </p>

      </section>


      <section
        class="board-columns"
        id="columns"
      ></section>


      <section
        class="actions-section"
        id="actionsSection"
      >

        <div class="section-heading">

          <div class="eyebrow">
            NEXT STEPS
          </div>

          <h2>
            Aksiyon Maddeleri
          </h2>

        </div>


        <div
          id="actionsList"
          class="actions-list"
        ></div>


        <div class="action-form">

          <input
            id="actionContent"
            class="modern-input"
            placeholder="Aksiyon maddesi..."
          >

          <input
            id="actionOwner"
            class="modern-input"
            placeholder="Sorumlu"
          >

          <input
            id="actionDue"
            class="modern-input"
            type="date"
          >

          <button
            id="addActionBtn"
            class="primary-button"
          >
            Ekle
          </button>

        </div>

      </section>


      <section
        id="adminPanel"
        class="admin-panel"
        style="display:none"
      ></section>


    </main>

  `));


  renderColumns(
    board.columns,
    board.cards,
    board.status
  );


  renderActions(
    board.actions || []
  );


  document
    .getElementById('participantsBtn')
    .onclick =
      () => openParticipantsModal();


  document
    .getElementById('addActionBtn')
    .onclick =
      addAction;


  connectWs(
    boardId,
    board.status
  );
}


// =========================================================
// COLUMNS
// =========================================================

function renderColumns(
  columns,
  cards,
  boardStatus
) {

  const container =
    document.getElementById('columns');


  if (!container) return;


  container.innerHTML = '';


  const grouped = {};


  columns.forEach(col => {
    grouped[col.id] = [];
  });


  cards.forEach(card => {

    if (!grouped[card.column_id]) {
      grouped[card.column_id] = [];
    }

    grouped[card.column_id].push(card);
  });


  columns.forEach((column, index) => {

    const cardsInColumn =
      grouped[column.id] || [];


    const columnEl =
      document.createElement('div');


    const colorClasses = [
      'column-yellow',
      'column-purple',
      'column-green',
      'column-blue',
      'column-pink'
    ];


    columnEl.className =
      `retro-column ${
        colorClasses[index % colorClasses.length]
      }`;


    columnEl.dataset.colId =
      column.id;


    columnEl.innerHTML = `

      <div class="column-header">

        <div class="column-title">

          <span class="column-dot"></span>

          <h3>
            ${escapeHtml(column.name)}
          </h3>

        </div>

        <span class="column-count">
          ${cardsInColumn.length}
        </span>

      </div>


      <div
        class="cards"
        id="cards-${column.id}"
      ></div>


      <div class="add-card-area">

        <input
          class="modern-input newCardInput"
          placeholder="Kart ekle..."
        >


        <div class="card-form-bottom">

          <label class="anonymous-toggle">

            <input
              type="checkbox"
              class="anonCheck"
            >

            anonim

          </label>


          <button
            class="small-primary addCardBtn"
          >
            Ekle
          </button>

        </div>

      </div>

    `;


    container.appendChild(columnEl);


    columnEl
      .querySelector('.addCardBtn')
      .onclick = () => {

        const input =
          columnEl.querySelector(
            '.newCardInput'
          );


        const content =
          input.value.trim();


        if (!content) return;


        const anonymous =
          columnEl.querySelector(
            '.anonCheck'
          ).checked;


        send({

          type: 'card_add',

          column_id: column.id,

          content,

          anonymous,

          author_name: state.name

        });


        input.value = '';
      };


    columnEl
      .querySelector('.newCardInput')
      .addEventListener(
        'keydown',
        event => {

          if (
            event.key === 'Enter'
          ) {

            columnEl
              .querySelector('.addCardBtn')
              .click();
          }
        }
      );


    const cardsContainer =
      columnEl.querySelector(
        `#cards-${column.id}`
      );


    cardsInColumn.forEach(card => {

      cardsContainer.appendChild(
        renderCardEl(
          card,
          boardStatus
        )
      );

    });

  });
}


// =========================================================
// CARD
// =========================================================

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


  const author =
    card.is_anonymous
      ? 'Anonim'
      : (
          card.author_name ||
          'Anonim'
        );


  const comments =
    card.comments || [];


  const commentsOpen =
    state.openComments.has(card.id);


  el.innerHTML = `

    ${
      masked

        ? `

          <div class="hidden-card">
            🔒 Kart gizli — admin kartları açtığında
            içerik görünecek.
          </div>

        `

        : `

          <div class="card-top">

            <span class="card-author">
              ${escapeHtml(author)}
            </span>

            <button
              class="card-menu"
              title="Kart"
            >
              •••
            </button>

          </div>


          <div class="card-content">
            ${escapeHtml(card.content)}
          </div>


          <div class="card-footer">

            <button
              class="reaction-button"
              data-vote
            >
              👍 ${card.vote_count || 0}
            </button>


            <button
              class="comment-button"
              data-comments
            >
              💬 ${comments.length}
            </button>

          </div>


          ${
            commentsOpen
              ? renderCommentsHtml(
                  card
                )
              : ''
          }

        `
    }

  `;


  if (!masked) {

    const voteButton =
      el.querySelector(
        '[data-vote]'
      );


    if (voteButton) {

      voteButton.onclick =
        () => {

          send({
            type: 'vote_add',
            card_id: card.id
          });

        };
    }


    const commentButton =
      el.querySelector(
        '[data-comments]'
      );


    if (commentButton) {

      commentButton.onclick =
        () => {

          /*
           * ÖNEMLİ:
           * Set.delete ile gerçekten kapanıyor.
           */

          if (
            state.openComments.has(
              card.id
            )
          ) {

            state.openComments.delete(
              card.id
            );

          } else {

            state.openComments.add(
              card.id
            );
          }


          refreshBoardData();
        };
    }


    if (commentsOpen) {

      bindCommentEvents(
        el,
        card
      );
    }

  }


  return el;
}


// =========================================================
// COMMENTS
// =========================================================

function renderCommentsHtml(card) {

  const comments =
    card.comments || [];


  return `

    <div class="comments-panel">

      <div class="comments-header">

        <strong>
          Yorumlar
        </strong>

        <button
          class="close-comments"
          data-close-comments
          title="Yorumları kapat"
        >
          ×
        </button>

      </div>


      ${
        comments.length

          ? comments.map(comment => `

              <div class="comment-row"
                   style="
                     padding:7px 0;
                     border-bottom:1px solid #eee;
                     font-size:12px;
                   ">

                <div
                  style="
                    display:flex;
                    justify-content:space-between;
                    gap:8px;
                  "
                >

                  <strong>
                    ${escapeHtml(
                      comment.author_name
                    )}
                  </strong>

                  <button
                    class="delete-comment"
                    data-comment-id="${comment.id}"
                    style="
                      border:0;
                      background:transparent;
                      color:#aaa;
                      cursor:pointer;
                    "
                  >
                    ×
                  </button>

                </div>

                <div
                  style="
                    margin-top:3px;
                    color:#555;
                  "
                >
                  ${escapeHtml(
                    comment.content
                  )}
                </div>

              </div>

            `).join('')

          : `

              <div class="comments-empty">
                Henüz yorum yok.
              </div>

            `
      }


      <div
        style="
          display:flex;
          gap:6px;
          margin-top:10px;
        "
      >

        <input
          class="modern-input comment-input"
          placeholder="Yorum yaz..."
        >

        <button
          class="small-primary add-comment"
        >
          Gönder
        </button>

      </div>

    </div>

  `;
}


function bindCommentEvents(
  cardElement,
  card
) {

  const closeButton =
    cardElement.querySelector(
      '[data-close-comments]'
    );


  if (closeButton) {

    closeButton.onclick =
      () => {

        state.openComments.delete(
          card.id
        );

        refreshBoardData();
      };
  }


  const input =
    cardElement.querySelector(
      '.comment-input'
    );


  const addButton =
    cardElement.querySelector(
      '.add-comment'
    );


  if (addButton) {

    addButton.onclick =
      () => {

        const content =
          input.value.trim();


        if (!content) return;


        send({

          type: 'comment_add',

          card_id: card.id,

          content

        });


        input.value = '';

      };
  }


  if (input) {

    input.addEventListener(
      'keydown',
      event => {

        if (
          event.key === 'Enter'
        ) {

          addButton.click();
        }

      }
    );
  }


  cardElement
    .querySelectorAll(
      '.delete-comment'
    )
    .forEach(button => {

      button.onclick =
        () => {

          send({

            type: 'comment_delete',

            comment_id:
              button.dataset.commentId

          });

        };

    });
}


// =========================================================
// ACTIONS
// =========================================================

function renderActions(actions) {

  const list =
    document.getElementById(
      'actionsList'
    );


  if (!list) return;


  if (!actions.length) {

    list.innerHTML = `
      <div class="empty-actions">
        Henüz aksiyon maddesi eklenmedi.
      </div>
    `;

    return;
  }


  list.innerHTML =
    actions.map(action => `

      <div class="action-item-modern">

        <div class="action-check">
          ✓
        </div>

        <div class="action-main">

          <div class="action-content">
            ${escapeHtml(
              action.content
            )}
          </div>

          <div class="action-meta">
            Sorumlu:
            ${escapeHtml(
              action.owner || '-'
            )}
            ·
            Tarih:
            ${escapeHtml(
              action.due_date || '-'
            )}
          </div>

        </div>

      </div>

    `).join('');
}


function addAction() {

  const content =
    document
      .getElementById(
        'actionContent'
      )
      .value
      .trim();


  if (!content) return;


  const owner =
    document
      .getElementById(
        'actionOwner'
      )
      .value
      .trim();


  const due_date =
    document
      .getElementById(
        'actionDue'
      )
      .value;


  send({

    type: 'action_add',

    content,

    owner,

    due_date

  });


  document
    .getElementById(
      'actionContent'
    )
    .value = '';


  document
    .getElementById(
      'actionOwner'
    )
    .value = '';


  document
    .getElementById(
      'actionDue'
    )
    .value = '';
}


// =========================================================
// PARTICIPANTS MODAL
// =========================================================

function openParticipantsModal() {

  const old =
    document.querySelector(
      '.modal'
    );


  if (old) old.remove();


  const modal =
    document.createElement('div');


  modal.className =
    'modal';


  modal.innerHTML = `

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
          class="close-button"
          data-close
        >
          ×
        </button>

      </div>


      <div>

        ${
          state.participants.length

            ? state.participants.map(
                participant => `

                  <div
                    class="participant-item"
                  >

                    <div
                      class="participant-avatar"
                    >
                      ${initials(
                        participant.name
                      )}
                    </div>

                    <div
                      class="participant-info"
                    >

                      <strong>
                        ${escapeHtml(
                          participant.name
                        )}
                      </strong>

                      <span>

                        ${
                          participant.role ===
                          'admin'

                            ? '👑 Admin'

                            : 'Katılımcı'
                        }

                      </span>

                    </div>

                  </div>

                `
              ).join('')

            : `

                <p class="muted">
                  Henüz başka katılımcı yok.
                </p>

              `
        }

      </div>

    </div>

  `;


  document.body.appendChild(
    modal
  );


  modal
    .querySelector(
      '[data-close]'
    )
    .onclick = () =>
      modal.remove();


  modal
    .querySelector(
      '.modal-backdrop'
    )
    .onclick = () =>
      modal.remove();
}


// =========================================================
// ADMIN PANEL
// =========================================================

function renderAdminPanel() {

  const panel =
    document.getElementById(
      'adminPanel'
    );


  if (!panel) return;


  if (
    state.role !== 'admin'
  ) {

    panel.style.display =
      'none';

    panel.innerHTML = '';

    return;
  }


  panel.style.display =
    'block';


  const participants =
    state.participants
      .filter(
        participant =>
          participant.id !==
          state.participantId
      );


  panel.innerHTML = `

    <div class="admin-header">

      <div>

        <div class="eyebrow">
          ADMIN CONTROLS
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
        class="admin-action"
        id="adminReveal"
      >

        <div class="admin-action-icon">
          👁
        </div>

        <div>

          <strong>
            Kartları Aç
          </strong>

          <small>
            Tüm kartların içeriğini göster
          </small>

        </div>

      </button>


      <button
        class="admin-action"
        id="adminParticipants"
      >

        <div class="admin-action-icon">
          👥
        </div>

        <div>

          <strong>
            Katılımcılar
          </strong>

          <small>
            Ekip üyelerini görüntüle
          </small>

        </div>

      </button>


      <button
        class="admin-action danger-action"
        id="adminClose"
      >

        <div class="admin-action-icon">
          ✓
        </div>

        <div>

          <strong>
            Retro'yu Bitir
          </strong>

          <small>
            Board'u kapat ve rapor oluştur
          </small>

        </div>

      </button>

    </div>


    <div class="transfer-area">

      <div class="transfer-title">
        👑 Adminliği devret
      </div>


      ${
        participants.length

          ? `

              <select
                id="newAdmin"
                class="modern-input"
              >

                <option value="">
                  Katılımcı seçin...
                </option>

                ${
                  participants.map(
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
                id="transferAdmin"
                class="small-primary"
              >
                Devret
              </button>

            `

          : `

              <span
                style="
                  color:#999;
                  font-size:12px;
                "
              >
                Adminliği devretmek için başka
                bir katılımcı gerekli.
              </span>

            `
      }

    </div>

  `;


  document
    .getElementById(
      'adminReveal'
    )
    .onclick = () => {

      if (
        confirm(
          'Tüm kartlar açılacak. Emin misiniz?'
        )
      ) {

        send({
          type: 'reveal'
        });

      }

    };


  document
    .getElementById(
      'adminParticipants'
    )
    .onclick =
      () =>
        openParticipantsModal();


  document
    .getElementById(
      'adminClose'
    )
    .onclick = () => {

      if (
        confirm(
          'Retro kapatılacak ve rapor oluşturulacak. Emin misiniz?'
        )
      ) {

        send({
          type: 'board_close'
        });

      }

    };


  const transferButton =
    document.getElementById(
      'transferAdmin'
    );


  if (transferButton) {

    transferButton.onclick =
      () => {

        const select =
          document.getElementById(
            'newAdmin'
          );


        if (!select.value) {

          return alert(
            'Önce bir katılımcı seçin.'
          );
        }


        const selectedName =
          select.options[
            select.selectedIndex
          ].text;


        if (
          !confirm(
            `${selectedName} artık admin olacak. Adminliği devretmek istediğinize emin misiniz?`
          )
        ) {

          return;
        }


        send({

          type:
            'transfer_admin',

          participant_id:
            select.value

        });

      };

  }
}


// =========================================================
// WEBSOCKET
// =========================================================

function connectWs(
  boardId,
  initialStatus
) {

  if (state.ws) {
    state.ws.close();
  }


  const proto =
    location.protocol === 'https:'
      ? 'wss'
      : 'ws';


  const ws =
    new WebSocket(
      `${proto}://${location.host}/ws`
    );


  state.ws = ws;

  state.status =
    initialStatus;


  ws.onopen = () => {

    send({

      type: 'join',

      board_id: boardId,

      name: state.name

    });

  };


  ws.onmessage =
    async event => {

      const msg =
        JSON.parse(event.data);


      switch (msg.type) {


        // ---------------------------------------------
        // JOINED
        // ---------------------------------------------

        case 'joined':

          state.participantId =
            msg.participant_id;


          state.role =
            msg.role || 'participant';


          await refreshBoardData();

          renderAdminPanel();

          break;


        // ---------------------------------------------
        // PARTICIPANT JOINED
        // ---------------------------------------------

        case 'participant_joined':

          await refreshBoardData();

          break;


        // ---------------------------------------------
        // CARD
        // ---------------------------------------------

        case 'card_added':

        case 'vote_changed':

          await refreshBoardData();

          break;


        // ---------------------------------------------
        // COMMENTS
        // ---------------------------------------------

        case 'comment_added':

        case 'comment_deleted':

          await refreshBoardData();

          break;


        // ---------------------------------------------
        // ACTION
        // ---------------------------------------------

        case 'action_added':

          await refreshBoardData();

          break;


        // ---------------------------------------------
        // REVEAL
        // ---------------------------------------------

        case 'revealed':

          state.status =
            'revealed';


          updateStatusBadge(
            'revealed'
          );


          await refreshBoardData();

          break;


        // ---------------------------------------------
        // ADMIN CHANGED
        // ---------------------------------------------

        case 'admin_changed':

          /*
           * Yeni admin bizsek admin,
           * değilsek participant.
           */

          state.role =
            msg.admin_id ===
            state.participantId

              ? 'admin'

              : 'participant';


          await refreshBoardData();

          renderAdminPanel();

          break;


        // ---------------------------------------------
        // CLOSE
        // ---------------------------------------------

        case 'board_closed':

          if (msg.report_token) {

            location.hash =
              `#/report/${msg.report_token}`;

          }

          break;


        // ---------------------------------------------
        // ERROR
        // ---------------------------------------------

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


function send(payload) {

  if (
    state.ws &&
    state.ws.readyState ===
      WebSocket.OPEN
  ) {

    state.ws.send(
      JSON.stringify(payload)
    );
  }
}


// =========================================================
// REFRESH
// =========================================================

async function refreshBoardData() {

  if (!state.boardId) return;


  const res =
    await fetch(
      `/api/boards/${state.boardId}`
    );


  if (!res.ok) return;


  const board =
    await res.json();


  state.status =
    board.status;


  state.columns =
    board.columns;


  state.participants =
    board.participants || [];


  /*
   * Refresh sonrasında rolümüzü DB'den
   * tekrar tespit ediyoruz.
   */

  const me =
    state.participants.find(
      participant =>
        participant.id ===
        state.participantId
    );


  if (me) {

    state.role =
      me.role;
  }


  renderColumns(
    board.columns,
    board.cards,
    board.status
  );


  renderActions(
    board.actions || []
  );


  updateStatusBadge(
    board.status
  );


  updateParticipantCount();


  renderAdminPanel();
}


function updateStatusBadge(
  status
) {

  const badge =
    document.getElementById(
      'statusBadge'
    );


  if (badge) {

    badge.textContent =
      statusLabel(status);
  }
}


function updateParticipantCount() {

  const count =
    document.getElementById(
      'participantCount'
    );


  if (count) {

    count.textContent =
      state.participants.length;
  }
}


// =========================================================
// REPORT
// =========================================================

async function renderReport(
  token
) {

  const res =
    await fetch(
      `/api/reports/${token}`
    );


  if (!res.ok) {

    app.innerHTML = `
      <div class="empty-page">

        <div class="empty-icon">
          !
        </div>

        <h2>
          Rapor bulunamadı
        </h2>

        <p class="muted">
          Bu rapor mevcut değil.
        </p>

        <button
          class="primary-button"
          onclick="location.hash='#/'"
        >
          Ana sayfa
        </button>

      </div>
    `;

    return;
  }


  const report =
    await res.json();


  app.innerHTML = `

    <main class="report-page">

      <header class="report-header">

        <div>

          <div class="eyebrow">
            RETROSPECTIVE REPORT
          </div>

          <h1>
            ${escapeHtml(
              report.board.title
            )}
          </h1>

          <p class="muted">
            Retro tamamlandı.
          </p>

        </div>


        <a
          href="/api/reports/${token}/pdf"
        >

          <button
            class="primary-button"
          >
            PDF İndir
          </button>

        </a>

      </header>


      <section class="stats-grid">

        <div class="stat-card">

          <strong>
            ${report.stats.participant_count}
          </strong>

          <span>
            Katılımcı
          </span>

        </div>


        <div class="stat-card">

          <strong>
            ${report.stats.card_count}
          </strong>

          <span>
            Kart
          </span>

        </div>


        <div class="stat-card">

          <strong>
            ${report.stats.vote_count}
          </strong>

          <span>
            Oy
          </span>

        </div>


        <div class="stat-card">

          <strong>
            ${report.stats.action_count}
          </strong>

          <span>
            Aksiyon
          </span>

        </div>

      </section>


      <section
        class="report-columns"
      >

        ${
          report.columns.map(
            column => {

              const items =
                report.cardsByColumn[
                  column.id
                ] || [];


              return `

                <div class="report-column">

                  <h2>
                    ${escapeHtml(
                      column.name
                    )}
                  </h2>


                  ${
                    items.length

                      ? items.map(
                          item => `

                            <div
                              class="report-card"
                            >

                              ${escapeHtml(
                                item.content
                              )}

                              <small>

                                ${escapeHtml(
                                  item.author
                                )}

                                ·

                                👍
                                ${item.votes}

                              </small>

                            </div>

                          `
                        ).join('')

                      : `

                          <p class="muted">
                            Kart yok
                          </p>

                        `
                  }

                </div>

              `;
            }
          ).join('')
        }

      </section>


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

                  <div
                    class="action-item-modern"
                  >

                    <div
                      class="action-check"
                    >
                      ✓
                    </div>

                    <div
                      class="action-main"
                    >

                      <div
                        class="action-content"
                      >
                        ${escapeHtml(
                          action.content
                        )}
                      </div>

                      <div
                        class="action-meta"
                      >
                        Sorumlu:
                        ${escapeHtml(
                          action.owner || '-'
                        )}

                        ·

                        Tarih:
                        ${escapeHtml(
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
        Bu rapor, board silindikten sonra da
        paylaşılabilir link üzerinden erişilebilir.
      </p>

    </main>

  `;
}


// =========================================================
// START
// =========================================================

navigate();
