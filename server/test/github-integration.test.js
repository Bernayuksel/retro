const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('GitHub sprint dropdown requires access and selected sprint is saved on the board', { timeout: 30000 }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'retro-github-'));
  const start = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const fake = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const query = JSON.parse(body).query;
    const result = query.includes('fields(first: 50)')
      ? { organization: { projectV2: {
          id: 'project-id', title: 'Team Project', fields: { nodes: [
            { name: 'Board', options: [{ name: 'Team' }] },
            { name: 'Sprint', configuration: { iterations: [{ id: 'sprint-id', title: 'Sprint 1', startDate: start, duration: 14 }], completedIterations: [] } }
          ] }
        } } }
      : { node: { items: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [
          { type: 'ISSUE', content: { number: 1, title: 'Test item', state: 'OPEN', issueType: { name: 'Task' }, labels: { nodes: [] }, assignees: { nodes: [{ login: 'teammate', name: 'Teammate' }] } },
            fieldValues: { nodes: [
              { name: 'Team', field: { name: 'Board' } },
              { iterationId: 'sprint-id', title: 'Sprint 1', field: { name: 'Sprint' } },
              { name: 'Done', field: { name: 'Status' } },
              { number: 3, field: { name: 'Story Point' } }
            ] } }
        ] } } };
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ data: result }));
  });
  await new Promise(resolve => fake.listen(0, '127.0.0.1', resolve));
  const fakeUrl = `http://127.0.0.1:${fake.address().port}`;
  const appPort = await new Promise(resolve => {
    const server = http.createServer();
    server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); });
  });
  const child = spawn(process.execPath, ['src/index.js'], {
    cwd: path.join(__dirname, '..'), stdio: 'ignore',
    env: { ...process.env, NODE_ENV: 'test', PORT: String(appPort), RETRO_DATA_DIR: dataDir,
      TURSO_DATABASE_URL: '', TURSO_AUTH_TOKEN: '', GITHUB_API_URL: fakeUrl,
      GITHUB_TOKEN: 'mock-token', GITHUB_ORG: 'example', GITHUB_PROJECT_NUMBER: '1',
      GITHUB_PROJECT_ACCESS_KEY: 'separate-random-access-key-for-test' }
  });
  const base = `http://127.0.0.1:${appPort}`;
  try {
    let ready = false;
    for (let i = 0; i < 80; i++) {
      try { const response = await fetch(base + '/api/github/availability'); if (response.ok) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, 'server should start');
    assert.equal((await fetch(base + '/api/github/board-sprints')).status, 401);
    const login = await fetch(base + '/api/github/access', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_key: 'separate-random-access-key-for-test' })
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const options = await fetch(base + '/api/github/board-sprints', { headers: { Cookie: cookie } }).then(res => res.json());
    assert.equal(options[0].sprints[0].id, 'sprint-id');
    const createdResponse = await fetch(base + '/api/boards', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ columns: ['Good'], weekly_questions: ['Question?'], timer_minutes: 15,
        github_board: 'Team', github_iteration_id: 'sprint-id' })
    });
    if (createdResponse.status !== 200) throw new Error(await createdResponse.text());
    const created = await createdResponse.json();
    const board = await fetch(base + '/api/boards/' + created.id).then(res => res.json());
    assert.equal(board.title, 'Team – Sprint 1');
    assert.equal(board.sprint_dashboard.completedItems, 1);
    assert.equal(board.sprint_dashboard.completedPoints, 3);
    assert.deepEqual(board.github_members, ['Teammate']);
  } finally {
    child.kill();
    fake.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
