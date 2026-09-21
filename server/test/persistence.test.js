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
      body: JSON.stringify({ title: 'Kalıcı retro', columns: ['İyi gitti'], ttl_hours: 48 })
    });
    assert.equal(createResponse.status, 200);
    const board = await createResponse.json();
    const first = await connect(port, board.id, null, 'Yönetici');
    assert.equal(first.role, 'admin');
    const second = await connect(port, board.id, first.resume_token, 'Yönetici');
    assert.equal(second.participant_id, first.participant_id);
    assert.equal(second.role, 'admin');
    first.ws.close();
    second.ws.close();

    await new Promise(resolve => { child.once('exit', resolve); child.kill(); });
    child = await start();
    const persisted = await (await fetch(`${base}/api/boards/${board.id}`)).json();
    assert.equal(persisted.title, 'Kalıcı retro');
    assert.equal(persisted.participants.length, 1);

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
