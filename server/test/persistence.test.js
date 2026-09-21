const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const WebSocket = require('ws');

async function availablePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function waitForServer(url) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch { /* Starting. */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Sunucu başlatılamadı');
}

function connect(port, boardId, resumeToken, name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    ws.once('error', reject);
    ws.once('open', () => ws.send(JSON.stringify({
      type: 'join', board_id: boardId, resume_token: resumeToken, name
    })));
    ws.on('message', bytes => {
      const message = JSON.parse(bytes);
      if (message.type === 'joined') resolve({ ws, ...message });
      if (message.type === 'error') reject(new Error(message.message));
    });
  });
}

test('board, admin identity and report survive a server restart', { timeout: 30000 }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'retro-storage-'));
  const port = await availablePort();
  const base = `http://127.0.0.1:${port}`;
  const children = [];
  const start = async () => {
    const child = spawn(process.execPath, ['src/index.js'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, PORT: String(port), NODE_ENV: 'test', RETRO_DATA_DIR: dataDir,
        TURSO_DATABASE_URL: '', TURSO_AUTH_TOKEN: '' }, stdio: 'ignore'
    });
    children.push(child);
    await waitForServer(base);
    return child;
  };

  try {
    let child = await start();
    const createResponse = await fetch(`${base}/api/boards`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Kalıcı retro', columns: ['İyi gitti', 'Gelişim'], weekly_question: 'Bu hafta ne öğrendik?', timer_minutes: 30 })
    });
    assert.equal(createResponse.status, 200);
    const board = await createResponse.json();
    const first = await connect(port, board.id, null, 'Yönetici');
    assert.equal(first.role, 'admin');
    const second = await connect(port, board.id, first.resume_token, 'Yönetici');
    assert.equal(second.participant_id, first.participant_id);
    assert.equal(second.role, 'admin');
    const colleague = await connect(port, board.id, null, 'Ekip arkadaşı');
    const waitFor = (socket, type) => new Promise(resolve => {
      const handler = bytes => { const message = JSON.parse(bytes); if (message.type === type) { socket.off('message', handler); resolve(message); } };
      socket.on('message', handler);
    });
    const promoted = waitFor(colleague.ws, 'admin_changed');
    first.ws.send(JSON.stringify({ type: 'set_admin', participant_id: colleague.participant_id, admin: true }));
    await promoted;
    const started = waitFor(colleague.ws, 'timer_changed');
    colleague.ws.send(JSON.stringify({ type: 'timer_start' }));
    assert.ok((await started).timer_ends_at > Date.now());
    const added = waitFor(first.ws, 'card_added');
    colleague.ws.send(JSON.stringify({ type: 'card_add', column_id: board.columns[0].id, content: 'Öğrendik' }));
    const addedCard = await added;
    const moved = waitFor(first.ws, 'card_moved');
    colleague.ws.send(JSON.stringify({ type: 'card_move', card_id: addedCard.id, column_id: board.columns[1].id }));
    await moved;
    first.ws.close();
    second.ws.close();
    colleague.ws.close();

    await new Promise(resolve => { child.once('exit', resolve); child.kill(); });
    child = await start();
    const persisted = await (await fetch(`${base}/api/boards/${board.id}`)).json();
    assert.equal(persisted.title, 'Kalıcı retro');
    assert.equal(persisted.participants.length, 2);
    assert.equal(persisted.participants.filter(person => person.role === 'admin').length, 2);
    assert.equal(persisted.weekly_question, 'Bu hafta ne öğrendik?');
    assert.ok(persisted.timer_ends_at > Date.now());
    assert.equal(persisted.cards[0].column_id, board.columns[1].id);

    const joined = await connect(port, board.id, first.resume_token, 'Yönetici');
    assert.equal(joined.role, 'admin');
    const closed = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Rapor oluşturulmadı')), 10000);
      joined.ws.on('message', bytes => {
        const msg = JSON.parse(bytes);
        if (msg.type === 'board_closed') { clearTimeout(timer); resolve(msg.report_token); }
        if (msg.type === 'error') { clearTimeout(timer); reject(new Error(msg.message)); }
      });
    });
    joined.ws.send(JSON.stringify({ type: 'board_close' }));
    const token = await closed;
    joined.ws.close();
    const snapshotResponse = await fetch(`${base}/api/reports/${token}`);
    assert.equal(snapshotResponse.status, 200);
    const pdfResponse = await fetch(`${base}/api/reports/${token}/pdf`);
    assert.equal(pdfResponse.status, 200);
    assert.equal((await pdfResponse.arrayBuffer()).byteLength > 100, true);
    await new Promise(resolve => { child.once('exit', resolve); child.kill(); });
    const pdfPath = path.join(__dirname, '..', 'reports', `${token}.pdf`);
    fs.rmSync(pdfPath, { force: true });
    child = await start();
    const restoredPdf = await fetch(`${base}/api/reports/${token}/pdf`);
    assert.equal(restoredPdf.status, 200);
    assert.equal((await restoredPdf.arrayBuffer()).byteLength > 100, true);
    fs.rmSync(pdfPath, { force: true });
  } finally {
    for (const child of children) child.kill();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
