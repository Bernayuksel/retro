const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('GitHub multi-board selection saves combined hour estimates', { timeout: 30000 }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'retro-github-'));
  const start = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  let itemRequests = 0;
  const fake = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const query = JSON.parse(body).query;
    if (!query.includes('fields(first: 50)')) {
      itemRequests++;
      await new Promise(resolve => setTimeout(resolve, 60));
    }
    const result = query.includes('fields(first: 50)')
      ? { organization: { projectV2: {
          id: 'project-id', title: 'Team Project', fields: { nodes: [
            { name: 'Board', options: [{ name: 'Team' }, { name: 'Mobile' }, { name: 'Other' }] },
            { name: 'Sprint', configuration: { iterations: [{ id: 'sprint-id', title: 'Sprint 1', startDate: start, duration: 14 }], completedIterations: [] } }
          ] }
        } } }
      : { node: { items: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [
          { type: 'ISSUE', content: { number: 1, title: 'Test item', state: 'OPEN', issueType: { name: 'Task' }, labels: { nodes: [] }, assignees: { nodes: [{ login: 'teammate', name: 'Teammate' }] }, issueFieldValues: { nodes: [{ number: 3.5, field: { name: 'Original Estimate' } }] } },
            fieldValues: { nodes: [
              { name: 'Team', field: { name: 'Board' } },
              { iterationId: 'sprint-id', title: 'Sprint 1', field: { name: 'Sprint' } },
              { name: 'Done', field: { name: 'Status' } },
              { number: 99, field: { name: 'Original Estimate' } },
              { number: 99, field: { name: 'Story Point' } }
            ] } },
          { type: 'ISSUE', content: { number: 2, title: 'Mobile item', state: 'OPEN', assignees: { nodes: [{ login: 'mobile', name: 'Mobile teammate' }] } },
            fieldValues: { nodes: [
              { name: 'Mobile', field: { name: 'Board' } },
              { iterationId: 'sprint-id', field: { name: 'Sprint' } },
              { name: 'In progress', field: { name: 'Status' } },
              { issueFieldValue: { text: '2,5h' }, field: { name: 'Original Estimate' } }
            ] } },
          { type: 'ISSUE', content: { title: 'Excluded board', state: 'CLOSED' },
            fieldValues: { nodes: [
              { name: 'Other', field: { name: 'Board' } },
              { iterationId: 'sprint-id', field: { name: 'Sprint' } },
              { number: 100, field: { name: 'Original Estimate' } }
            ] } },
          { type: 'ISSUE', content: { title: 'Excluded sprint', state: 'CLOSED' },
            fieldValues: { nodes: [
              { name: 'Team', field: { name: 'Board' } },
              { iterationId: 'other-sprint', field: { name: 'Sprint' } },
              { number: 100, field: { name: 'Original Estimate' } }
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
    await Promise.all([1, 2].map(() => fetch(base + '/api/github/sprint-summary?board=Team&iterationId=sprint-id', { headers: { Cookie: cookie } }).then(res => {
      assert.equal(res.status, 200);
      return res.json();
    })));
    assert.equal(itemRequests, 1, 'concurrent preload and creation must share one item request');
    const createdResponse = await fetch(base + '/api/boards', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ columns: ['Good'], weekly_questions: ['Question?'], timer_minutes: 15,
        github_boards: ['Team', 'Mobile', 'Team'], github_iteration_id: 'sprint-id' })
    });
    if (createdResponse.status !== 200) throw new Error(await createdResponse.text());
    const created = await createdResponse.json();
    const board = await fetch(base + '/api/boards/' + created.id).then(res => res.json());
    assert.equal(board.title, 'Team + Mobile – Sprint 1');
    assert.deepEqual(board.sprint_dashboard.boards, ['Team', 'Mobile']);
    assert.equal(board.sprint_dashboard.totalItems, 2);
    assert.equal(board.sprint_dashboard.effortUnit, 'saat');
    assert.equal(board.sprint_dashboard.plannedHours, 6);
    assert.equal(board.sprint_dashboard.estimatedItems, 2);
    assert.equal(board.sprint_dashboard.missingEstimateItems, 0);
    assert.equal(board.sprint_dashboard.estimateSchemaVersion, 2);
    assert.equal(board.sprint_dashboard.completedItems, 1);
    assert.equal(board.sprint_dashboard.completedHours, 3.5);
    assert.deepEqual(board.github_members, ['Mobile teammate', 'Teammate']);
    assert.equal(board.sprint_dashboard.contributors[0].hours, 3.5);
    const single = await fetch(base + '/api/github/sprint-summary?board=Team&iterationId=sprint-id', { headers: { Cookie: cookie } }).then(res => res.json());
    assert.equal(single.total, 1);
    assert.equal(single.doneHours, 3.5);
    assert.equal(itemRequests, 1, 'board creation reuses preloaded project data');
    const { createClient } = require('@libsql/client');
    const legacyDb = createClient({ url: `file:${path.join(dataDir, 'retro.db')}` });
    try {
      await legacyDb.execute({ sql: 'UPDATE boards SET sprint_dashboard = ?, github_board = ? WHERE id = ?',
        args: [JSON.stringify({ ...board.sprint_dashboard, estimateSchemaVersion: undefined, effortUnit: undefined, completedHours: undefined, plannedHours: undefined, plannedPoints: 99, completedPoints: 99 }), 'Team', created.id] });
      const anonymous = await fetch(base + '/api/boards/' + created.id).then(res => res.json());
      assert.equal(anonymous.sprint_dashboard.completedPoints, 99, 'unauthorized reads cannot migrate');
      const migrated = await fetch(base + '/api/boards/' + created.id, { headers: { Cookie: cookie } }).then(res => res.json());
      assert.equal(migrated.sprint_dashboard.effortUnit, 'saat');
      assert.equal(migrated.sprint_dashboard.completedHours, 3.5, 'hours must come from GitHub, not relabelled SP');
      assert.equal(migrated.sprint_dashboard.completedPoints, undefined);
      const persisted = await fetch(base + '/api/boards/' + created.id).then(res => res.json());
      assert.equal(persisted.sprint_dashboard.completedHours, 3.5);
    } finally { legacyDb.close(); }

  } finally {
    child.kill();
    fake.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('hour estimates parse numeric and hour text values and ignore SP', () => {
  const { estimateHours, normalizeItem } = require('../github');
  assert.equal(estimateHours({ number: 1.25 }), 1.25);
  assert.equal(estimateHours({ text: '2 saat' }), 2);
  assert.equal(estimateHours({ text: '1,5' }), 1.5);
  assert.equal(estimateHours(null), 0);
  assert.throws(() => estimateHours({ text: '1d' }));
  const item = normalizeItem({ content: { title: 'Missing estimate' }, fieldValues: { nodes: [{ number: 8, field: { name: 'Story Point' } }] } });
  assert.equal(item.hours, 0);
});

test('issue estimates distinguish missing values from genuine zero and support decimals', () => {
  const { normalizeItem, summarize, toDashboard } = require('../github');
  const missing = normalizeItem({ content: { title: 'Missing' }, fieldValues: { nodes: [] } });
  const zero = normalizeItem({ content: { title: 'Zero', issueFieldValues: { nodes: [{ number: 0, field: { name: 'Original Estimate' } }] } }, fieldValues: { nodes: [] } });
  const estimate = normalizeItem({ content: { title: 'Estimate', state: 'CLOSED', issueFieldValues: { nodes: [{ number: 2, field: { name: 'Original Estimate' } }] } }, fieldValues: { nodes: [] } });
  assert.equal(missing.hasEstimate, false);
  assert.equal(zero.hasEstimate, true);
  assert.equal(estimate.hours, 2);
  const result = summarize([missing, zero, estimate]);
  assert.equal(result.estimatedItems, 2);
  assert.equal(result.missingEstimateItems, 1);
  assert.equal(result.doneHours, 2);
  const dashboard = toDashboard({ ...result, board: 'Team', boards: ['Team'], sprint: { title: 'Sprint' } });
  assert.equal(dashboard.estimateSchemaVersion, 2);
});
