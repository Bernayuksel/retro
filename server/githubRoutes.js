// Express router: app.use('/api/github', require('./githubRoutes'));
const express = require('express');
const { createHmac, timingSafeEqual } = require('crypto');
const gh = require('./github');

const router = express.Router();
const cookieName = 'retro_github_access';
const accessKey = () => process.env.GITHUB_PROJECT_ACCESS_KEY || '';
const enabled = () => Boolean(process.env.GITHUB_TOKEN && process.env.GITHUB_ORG && process.env.GITHUB_PROJECT_NUMBER);
const signature = expiry => createHmac('sha256', accessKey()).update(`retro-github-project-access:${expiry}`).digest('hex');
function hasAccess(req) {
  if (!enabled() || !accessKey()) return false;
  const value = (req.headers.cookie || '').split(';').map(v => v.trim())
    .find(v => v.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  if (!value || !/^\d{13}\.[a-f0-9]{64}$/.test(value)) return false;
  const [expiry, mac] = value.split('.');
  if (Number(expiry) < Date.now()) return false;
  return timingSafeEqual(Buffer.from(mac, 'hex'), Buffer.from(signature(expiry), 'hex'));
}

router.get('/availability', (req, res) => res.json({ enabled: enabled() }));
router.post('/access', (req, res) => {
  if (!enabled() || !accessKey()) return res.status(503).json({ error: 'GitHub bağlantısı yapılandırılmamış.' });
  const supplied = req.body?.access_key;
  if (typeof supplied !== 'string' || supplied.length > 1024) return res.status(401).json({ error: 'Erişim anahtarı geçersiz.' });
  const expected = Buffer.from(createHmac('sha256', accessKey()).update('submitted-key-check').digest('hex'));
  const actual = Buffer.from(createHmac('sha256', supplied).update('submitted-key-check').digest('hex'));
  if (!timingSafeEqual(actual, expected)) return res.status(401).json({ error: 'Erişim anahtarı geçersiz.' });
  const expiry = String(Date.now() + 8 * 60 * 60 * 1000);
  res.cookie(cookieName, `${expiry}.${signature(expiry)}`, { httpOnly: true, secure: req.secure || req.get('x-forwarded-proto') === 'https', sameSite: 'strict', path: '/api', maxAge: 8 * 60 * 60 * 1000 });
  res.json({ ok: true });
});
router.use((req, res, next) => {
  if (!enabled()) return res.status(503).json({ error: 'GitHub bağlantısı yapılandırılmamış.' });
  if (!hasAccess(req)) return res.status(401).json({ error: 'GitHub Project erişim anahtarı gerekli.' });
  next();
});

const handle = fn => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (e) {
    console.error('[github]', e.message);
    res.status(502).json({ error: e.message });
  }
};

// Bağlantı testi: proje adı, board'lar ve sprint sayısı
router.get('/health', handle(async () => {
  const m = await gh.getProjectMeta();
  return { ok: true, project: m.projectTitle, boards: m.boards, sprintCount: m.sprints.length };
}));

// Dropdown verisi
router.get('/board-sprints', handle(() => gh.getBoardSprints()));

// Sprint özeti: /api/github/sprint-summary?board=Team&iterationId=xxxx
router.get('/sprint-summary', handle(req => gh.getSprintSummary(req.query.board, req.query.iterationId)));

// Önbelleği temizle (GitHub'da değişiklik sonrası)
// Bilgi güncellemesi beş dakikalık önbelleğin ardından otomatik yapılır.

module.exports = { router, hasAccess, enabled };
