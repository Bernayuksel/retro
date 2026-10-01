// GitHub Project (v2) entegrasyonu - salt okunur
// Gerekli ortam değişkenleri: .env.example dosyasına bakın.

const API = process.env.NODE_ENV === 'test' && process.env.GITHUB_API_URL
  ? process.env.GITHUB_API_URL : 'https://api.github.com/graphql';
const CACHE_MS = 5 * 60 * 1000;

const cfg = () => ({
  token: process.env.GITHUB_TOKEN,
  org: process.env.GITHUB_ORG,
  projectNumber: Number(process.env.GITHUB_PROJECT_NUMBER),
  boardField: process.env.GITHUB_BOARD_FIELD || 'Board',
  sprintField: process.env.GITHUB_SPRINT_FIELD || 'Sprint',
  statusField: process.env.GITHUB_STATUS_FIELD || 'Status',
  estimateField: process.env.GITHUB_ESTIMATE_FIELD || 'Original Estimate',
  doneStatuses: (process.env.GITHUB_DONE_STATUSES || 'Done')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
});

const cache = new Map();
async function cached(key, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;
  const data = await fn();
  cache.set(key, { at: Date.now(), data });
  return data;
}

async function gql(query, variables) {
  const { token } = cfg();
  if (!token) throw new Error('GITHUB_TOKEN tanımlı değil');
  const res = await fetch(API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.errors) {
    const msg = json.errors ? json.errors.map(e => e.message).join('; ') : `HTTP ${res.status}`;
    throw new Error(`GitHub API hatası: ${msg}`);
  }
  return json.data;
}

// ---------- 1) Proje alanları: board listesi + sprint listesi ----------
const FIELDS_QUERY = `
query($org: String!, $number: Int!) {
  organization(login: $org) {
    projectV2(number: $number) {
      id
      title
      fields(first: 50) {
        nodes {
          ... on ProjectV2Field { id name dataType }
          ... on ProjectV2SingleSelectField { id name options { id name } }
          ... on ProjectV2IterationField {
            id name
            configuration {
              iterations { id title startDate duration }
              completedIterations { id title startDate duration }
            }
          }
        }
      }
    }
  }
}`;

async function getProjectMeta() {
  const c = cfg();
  if (!c.org || !Number.isInteger(c.projectNumber) || c.projectNumber < 1) {
    throw new Error('GITHUB_ORG ve GITHUB_PROJECT_NUMBER tanımlanmalı');
  }
  return cached('meta', async () => {
    const data = await gql(FIELDS_QUERY, { org: c.org, number: c.projectNumber });
    const project = data.organization && data.organization.projectV2;
    if (!project) throw new Error(`Proje bulunamadı: ${c.org} / ${c.projectNumber}`);
    const fields = project.fields.nodes.filter(f => f && f.name);
    const boardField = fields.find(f => f.name === c.boardField && f.options);
    const sprintField = fields.find(f => f.name === c.sprintField && f.configuration);
    if (!boardField) throw new Error(`"${c.boardField}" alanı bulunamadı. Mevcut alanlar: ${fields.map(f => f.name).join(', ')}`);
    if (!sprintField) throw new Error(`"${c.sprintField}" alanı bulunamadı. Mevcut alanlar: ${fields.map(f => f.name).join(', ')}`);

    const today = new Date().toISOString().slice(0, 10);
    const endOf = s => {
      const d = new Date(s.startDate); d.setDate(d.getDate() + s.duration);
      return d.toISOString().slice(0, 10);
    };
    const sprints = [
      ...sprintField.configuration.iterations,
      ...sprintField.configuration.completedIterations,
    ].map(s => ({
      id: s.id, title: s.title, startDate: s.startDate, endDate: endOf(s),
      state: endOf(s) <= today ? 'completed' : (s.startDate <= today ? 'current' : 'upcoming'),
    })).sort((a, b) => b.startDate.localeCompare(a.startDate));

    return {
      fields,
      projectId: project.id,
      projectTitle: project.title,
      boards: boardField.options.map(o => o.name),
      sprints,
    };
  });
}

// Dropdown için: board -> sprint listesi (gelecek sprintler hariç)
async function getBoardSprints() {
  const meta = await getProjectMeta();
  const sprints = meta.sprints.filter(s => s.state !== 'upcoming');
  return meta.boards.map(board => ({ board, sprints }));
}

// ---------- 2) Proje işleri ----------
const ITEMS_QUERY = `
query($id: ID!, $cursor: String) {
  node(id: $id) {
    ... on ProjectV2 {
      items(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          type
          content {
            ... on Issue {
              number title url state
              issueType { name }
              labels(first: 20) { nodes { name } }
              assignees(first: 10) { nodes { login name } }
            }
            ... on DraftIssue { title assignees(first: 10) { nodes { login name } } }
          }
          fieldValues(first: 30) {
            nodes {
              ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2FieldCommon { name } } }
              ... on ProjectV2ItemFieldIterationValue { iterationId title field { ... on ProjectV2FieldCommon { name } } }
              ... on ProjectV2ItemFieldTextValue { text field { ... on ProjectV2FieldCommon { name } } }
              ... on ProjectV2ItemFieldNumberValue { number field { ... on ProjectV2FieldCommon { name } } }
            }
          }
        }
      }
    }
  }
}`;

async function getAllItems() {
  const meta = await getProjectMeta();
  return cached('items', async () => {
    const items = [];
    let cursor = null;
    for (let page = 0; page < 100; page++) {
      const data = await gql(ITEMS_QUERY, { id: meta.projectId, cursor });
      const conn = data.node.items;
      items.push(...conn.nodes.map(normalizeItem).filter(Boolean));
      if (!conn.pageInfo.hasNextPage) break;
      cursor = conn.pageInfo.endCursor;
    }
    return items;
  });
}

function detectType(content) {
  if (content.issueType && content.issueType.name) return content.issueType.name;
  const labels = ((content.labels && content.labels.nodes) || []).map(l => l.name.toLowerCase());
  if (labels.some(l => l.includes('bug'))) return 'Bug';
  if (labels.some(l => l.includes('story'))) return 'User Story';
  if (labels.some(l => l.includes('task'))) return 'Task';
  return 'Diğer';
}

function estimateHours(value) {
  if (!value) return 0;
  if (typeof value.number === 'number' && Number.isFinite(value.number) && value.number >= 0) return value.number;
  const text = String(value.text || '').trim();
  if (!text) return 0;
  const match = text.match(/^(\d+(?:[.,]\d+)?)\s*(?:h|hr|hrs|hour|hours|saat)?$/i);
  if (!match) throw new Error('Original Estimate değeri saat olarak okunamadı. Sayısal saat veya "2.5h" biçimini kullanın.');
  return Number(match[1].replace(',', '.'));
}

function normalizeItem(node) {
  if (!node || !node.content) return null;
  const c = cfg();
  const f = {};
  for (const v of node.fieldValues.nodes) {
    if (!v || !v.field) continue;
    f[v.field.name] = v;
  }
  const status = f[c.statusField] ? f[c.statusField].name : null;
  const content = node.content;
  return {
    number: content.number || null,
    title: content.title,
    url: content.url || null,
    board: f[c.boardField] ? f[c.boardField].name : null,
    iterationId: f[c.sprintField] ? f[c.sprintField].iterationId : null,
    status,
    done: (status && c.doneStatuses.includes(status.toLowerCase())) || content.state === 'CLOSED',
    type: node.type === 'DRAFT_ISSUE' ? 'Taslak' : detectType(content),
    hours: estimateHours(f[Object.keys(f).find(name => name.toLowerCase() === c.estimateField.toLowerCase())]),
    assignees: ((content.assignees && content.assignees.nodes) || []).map(a => a.name || a.login),
  };
}

// ---------- 3) Sprint özeti hesaplama ----------
function summarize(items) {
  const done = items.filter(i => i.done);
  const sum = arr => arr.reduce((t, i) => t + i.hours, 0);
  const byType = {};
  for (const i of items) {
    byType[i.type] = byType[i.type] || { total: 0, done: 0 };
    byType[i.type].total++;
    if (i.done) byType[i.type].done++;
  }
  const byPerson = {};
  for (const i of done) {
    for (const p of (i.assignees.length ? i.assignees : ['Atanmamış'])) {
      byPerson[p] = byPerson[p] || { name: p, items: 0, hours: 0 };
      byPerson[p].items++;
      byPerson[p].hours += i.hours;
    }
  }
  return {
    total: items.length,
    done: done.length,
    carriedOver: items.length - done.length,
    completionPct: items.length ? Math.round((done.length / items.length) * 100) : 0,
    plannedHours: sum(items),
    doneHours: sum(done),
    byType,
    byPerson: Object.values(byPerson).sort((a, b) => b.items - a.items),
    openItems: items.filter(i => !i.done).map(i => ({ number: i.number, title: i.title, url: i.url, status: i.status })),
  };
}

async function getSprintSummary(board, iterationId) {
  const boards = [...new Set(Array.isArray(board) ? board : [board])];
  if (!boards.length || boards.some(b => typeof b !== 'string' || !b) || !iterationId) throw new Error('En az bir board ve sprint seçin.');
  const meta = await getProjectMeta();
  if (boards.some(b => !meta.boards.includes(b))) throw new Error('Geçersiz board seçimi');
  const estimateField = meta.fields.find(f => f.name.toLowerCase() === cfg().estimateField.toLowerCase());
  if (!estimateField || !['NUMBER', 'TEXT'].includes(estimateField.dataType)) {
    throw new Error(`Saat tahmini alanı bulunamadı veya desteklenmiyor: ${cfg().estimateField}. GITHUB_ESTIMATE_FIELD ayarını kontrol edin.`);
  }
  const sprint = meta.sprints.find(s => s.id === iterationId);
  if (!sprint || sprint.state === 'upcoming') throw new Error('Geçersiz sprint seçimi');
  const items = (await getAllItems()).filter(i => boards.includes(i.board) && i.iterationId === iterationId);
  return {
    source: 'github',
    project: meta.projectTitle,
    board: boards.join(' + '),
    boards,
    effortUnit: 'saat',
    sprint: sprint || { id: iterationId },
    generatedAt: new Date().toISOString(),
    members: [...new Set(items.flatMap(i => i.assignees))].sort(),
    ...summarize(items),
  };
}

function toDashboard(summary) {
  const colors = ['#635bff', '#ef6a67', '#30a46c', '#4b9ee5', '#e7a441'];
  return {
    isDemo: false,
    name: `${summary.board} – ${summary.sprint.title}`,
    dateRange: `${summary.sprint.startDate} – ${summary.sprint.endDate}`,
    totalItems: summary.total,
    completedItems: summary.done,
    carriedItems: summary.carriedOver,
    boards: summary.boards,
    effortUnit: 'saat',
    plannedHours: summary.plannedHours,
    completedHours: summary.doneHours,
    itemTypes: Object.entries(summary.byType).map(([label, value], index) => ({
      label, value: value.done, color: colors[index % colors.length]
    })),
    contributors: summary.byPerson.map(person => ({
      name: person.name, completed: person.items, hours: person.hours
    }))
  };
}

function clearCache() { cache.clear(); }

module.exports = { getBoardSprints, getSprintSummary, getProjectMeta, summarize, normalizeItem, estimateHours, toDashboard, clearCache };
