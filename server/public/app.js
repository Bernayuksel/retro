const app = document.getElementById('app');
const state = { ws: null, participantId: null, boardId: null, name: null, columns: [], status: 'open' };

function h(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content; }

function navigate() {
  const hash = location.hash || '#/';
  if (hash === '#/') return renderHome();
  const boardMatch = hash.match(/^#\/board\/([a-zA-Z0-9-]+)$/);
  if (boardMatch) return renderBoard(boardMatch[1]);
  const reportMatch = hash.match(/^#\/report\/([a-zA-Z0-9-]+)$/);
  if (reportMatch) return renderReport(reportMatch[1]);
  renderHome();
}
window.addEventListener('hashchange', navigate);

// ---------- Ana sayfa: board oluştur / katıl ----------
function renderHome() {
  app.innerHTML = '';
  app.appendChild(h(`
    <h1>Retro Board</h1>
    <div class="card-box">
      <h2>Yeni board oluştur</h2>
      <div class="row" style="margin-bottom:8px">
        <input id="title" placeholder="Board başlığı (örn: Sprint 24 Retro)" style="flex:1" />
      </div>
      <div id="colInputs"></div>
      <button id="addCol" class="secondary" type="button">+ Kolon ekle</button>
      <div class="row" style="margin-top:12px">
        <label>Otomatik silinme (saat): <input id="ttl" type="number" value="48" style="width:70px" /></label>
      </div>
      <div style="margin-top:12px">
        <button id="createBtn">Board Oluştur</button>
      </div>
    </div>
    <div class="card-box">
      <h2>Mevcut board'a katıl</h2>
      <div class="row">
        <input id="joinId" placeholder="Board ID" style="flex:1" />
        <button id="joinBtn" class="secondary">Katıl</button>
      </div>
    </div>
  `));

  const colInputs = document.getElementById('colInputs');
  const defaultCols = ['İyi gitti', 'Kötü gitti', 'Aksiyonlar'];
  function addColRow(value = '') {
    const row = document.createElement('div');
    row.className = 'col-input-row';
    row.innerHTML = `<input class="colName" value="${value}" placeholder="Kolon adı" style="flex:1" />`;
    colInputs.appendChild(row);
  }
  defaultCols.forEach(addColRow);

  document.getElementById('addCol').onclick = () => {
    if (colInputs.children.length >= 5) return alert('En fazla 5 kolon eklenebilir');
    addColRow();
  };

  document.getElementById('createBtn').onclick = async () => {
    const title = document.getElementById('title').value.trim();
    const cols = [...document.querySelectorAll('.colName')].map(i => i.value.trim()).filter(Boolean);
    const ttl = parseInt(document.getElementById('ttl').value, 10) || 48;
    if (!title || cols.length === 0) return alert('Başlık ve en az 1 kolon gerekli');
    const res = await fetch('/api/boards', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, columns: cols, ttl_hours: ttl }),
    });
    const data = await res.json();
    location.hash = `#/board/${data.id}`;
  };

  document.getElementById('joinBtn').onclick = () => {
    const id = document.getElementById('joinId').value.trim();
    if (id) location.hash = `#/board/${id}`;
  };
}

// ---------- Board ekranı ----------
async function renderBoard(boardId) {
  const res = await fetch(`/api/boards/${boardId}`);
  if (!res.ok) { app.innerHTML = '<p>Board bulunamadı ya da süresi doldu.</p>'; return; }
  const board = await res.json();
  state.boardId = boardId;
  state.columns = board.columns;
  state.status = board.status;

  if (!state.name) {
    state.name = prompt('Adınız:') || 'Anonim';
  }

  app.innerHTML = '';
  app.appendChild(h(`
    <div class="topbar">
      <div>
        <h1>${board.title}</h1>
        <span class="badge" id="statusBadge">${statusLabel(board.status)}</span>
      </div>
      <div class="row">
        <button id="revealBtn" class="secondary">Kartları Aç</button>
        <button id="closeBtn" class="danger">Board'u Kapat &amp; Rapor Oluştur</button>
      </div>
    </div>
    <div class="board-columns" id="columns"></div>
    <div class="card-box">
      <h2>Aksiyon Maddeleri</h2>
      <div id="actionsList"></div>
      <div class="row" style="margin-top:10px">
        <input id="actionContent" placeholder="Aksiyon" style="flex:2" />
        <input id="actionOwner" placeholder="Sorumlu" style="flex:1" />
        <input id="actionDue" type="date" />
        <button id="addActionBtn">Ekle</button>
      </div>
    </div>
  `));

  const columnsEl = document.getElementById('columns');
  board.columns.forEach(col => {
    const colEl = document.createElement('div');
    colEl.className = 'board-column';
    colEl.dataset.colId = col.id;
    colEl.innerHTML = `
      <h3>${col.name}</h3>
      <div class="cards" id="cards-${col.id}"></div>
      <div class="row" style="margin-top:8px">
        <input class="newCardInput" placeholder="Kart ekle..." style="flex:1" />
        <label style="font-size:12px"><input type="checkbox" class="anonCheck" /> anonim</label>
        <button class="addCardBtn">Ekle</button>
      </div>
    `;
    columnsEl.appendChild(colEl);
    colEl.querySelector('.addCardBtn').onclick = () => {
      const input = colEl.querySelector('.newCardInput');
      const content = input.value.trim();
      if (!content) return;
      const anonymous = colEl.querySelector('.anonCheck').checked;
      send({ type: 'card_add', column_id: col.id, content, anonymous, author_name: state.name });
      input.value = '';
    };
  });

  renderCards(board.cards, board.status);
  renderActions(board.actions);

  document.getElementById('revealBtn').onclick = () => send({ type: 'reveal' });
  document.getElementById('closeBtn').onclick = () => {
    if (confirm('Board kapatılacak ve rapor otomatik oluşturulacak. Emin misiniz?')) {
      send({ type: 'board_close' });
    }
  };
  document.getElementById('addActionBtn').onclick = () => {
    const content = document.getElementById('actionContent').value.trim();
    if (!content) return;
    const owner = document.getElementById('actionOwner').value.trim();
    const due_date = document.getElementById('actionDue').value;
    send({ type: 'action_add', content, owner, due_date });
    document.getElementById('actionContent').value = '';
    document.getElementById('actionOwner').value = '';
    document.getElementById('actionDue').value = '';
  };

  connectWs(boardId, board.status);
}

function statusLabel(status) {
  return { open: 'Kartlar gizli', revealed: 'Kartlar açık', closed: 'Kapatıldı' }[status] || status;
}

function renderCards(cards, boardStatus) {
  const grouped = {};
  for (const c of cards) {
    (grouped[c.column_id] = grouped[c.column_id] || []).push(c);
  }
  for (const colId in grouped) {
    const container = document.getElementById(`cards-${colId}`);
    if (!container) continue;
    container.innerHTML = '';
    grouped[colId].forEach(card => container.appendChild(renderCardEl(card, boardStatus)));
  }
}

function renderCardEl(card, boardStatus) {
  const masked = boardStatus === 'open';
  const el = document.createElement('div');
  el.className = 'retro-card' + (masked ? ' masked' : '');
  el.dataset.cardId = card.id;
  const authorLabel = card.is_anonymous ? 'Anonim' : (card.author_name || 'Anonim');
  el.innerHTML = `
    <div class="content">${masked ? 'Kart gizli (henüz açılmadı)' : escapeHtml(card.content)}</div>
    <div class="meta">
      <span>${masked ? '' : authorLabel}</span>
      <button class="vote-btn" ${masked ? 'disabled' : ''}>👍 ${card.vote_count || 0}</button>
    </div>
  `;
  if (!masked) {
    el.querySelector('.vote-btn').onclick = () => send({ type: 'vote_add', card_id: card.id });
  }
  return el;
}

function renderActions(actions) {
  const list = document.getElementById('actionsList');
  if (!list) return;
  list.innerHTML = actions.length ? '' : '<p style="color:#6b7280">Henüz aksiyon eklenmedi.</p>';
  actions.forEach(a => {
    const el = document.createElement('div');
    el.className = 'action-item';
    el.innerHTML = `
      <div>${escapeHtml(a.content)}</div>
      <div class="action-meta">Sorumlu: ${a.owner || '-'} · Tarih: ${a.due_date || '-'}</div>
    `;
    list.appendChild(el);
  });
}

function escapeHtml(s) {
  return (s || '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

// ---------- WebSocket ----------
function connectWs(boardId, initialStatus) {
  if (state.ws) state.ws.close();
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  state.ws = ws;
  state.status = initialStatus;

  ws.onopen = () => send({ type: 'join', board_id: boardId, name: state.name });

  ws.onmessage = async (ev) => {
    const msg = JSON.parse(ev.data);
    switch (msg.type) {
      case 'joined':
        state.participantId = msg.participant_id;
        break;
      case 'card_added':
      case 'vote_changed':
        await refreshBoardData();
        break;
      case 'action_added':
        await refreshBoardData();
        break;
      case 'revealed':
        state.status = 'revealed';
        document.getElementById('statusBadge').textContent = statusLabel('revealed');
        await refreshBoardData();
        break;
      case 'board_closed':
        location.hash = `#/report/${msg.report_token}`;
        break;
    }
  };
}

async function refreshBoardData() {
  const res = await fetch(`/api/boards/${state.boardId}`);
  const board = await res.json();
  renderCards(board.cards, board.status);
  renderActions(board.actions);
}

function send(payload) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify(payload));
}

// ---------- Rapor ekranı ----------
async function renderReport(token) {
  const res = await fetch(`/api/reports/${token}`);
  if (!res.ok) { app.innerHTML = '<p>Rapor bulunamadı.</p>'; return; }
  const r = await res.json();

  app.innerHTML = '';
  app.appendChild(h(`
    <div class="topbar">
      <h1>${r.board.title} — Retro Raporu</h1>
      <a href="/api/reports/${token}/pdf"><button>PDF İndir</button></a>
    </div>
    <div class="card-box">
      <h2>Katılım Özeti</h2>
      <p>Katılımcı: ${r.stats.participant_count} · Kart: ${r.stats.card_count} · Oy: ${r.stats.vote_count} · Aksiyon: ${r.stats.action_count}</p>
      <p>Katılımcılar: ${r.participants.join(', ') || '-'}</p>
    </div>
    <div class="board-columns" id="reportColumns"></div>
    <div class="card-box">
      <h2>Aksiyon Maddeleri</h2>
      <div id="reportActions"></div>
    </div>
    <p style="color:#6b7280;font-size:12px">Bu link, board silindikten sonra da erişilebilir kalır.</p>
  `));

  const colsEl = document.getElementById('reportColumns');
  r.columns.forEach(col => {
    const items = r.cardsByColumn[col.id] || [];
    const colEl = document.createElement('div');
    colEl.className = 'board-column';
    colEl.innerHTML = `<h3>${col.name}</h3>` + items.map(i =>
      `<div class="retro-card"><div class="content">${escapeHtml(i.content)}</div>
        <div class="meta"><span>${i.author}</span><span>👍 ${i.votes}</span></div></div>`
    ).join('') || '<p style="color:#6b7280">Kart yok</p>';
    colsEl.appendChild(colEl);
  });

  const actionsEl = document.getElementById('reportActions');
  actionsEl.innerHTML = r.actions.length ? r.actions.map(a =>
    `<div class="action-item"><div>${escapeHtml(a.content)}</div>
      <div class="action-meta">Sorumlu: ${a.owner || '-'} · Tarih: ${a.due_date || '-'}</div></div>`
  ).join('') : '<p style="color:#6b7280">Aksiyon eklenmedi.</p>';
}

navigate();
