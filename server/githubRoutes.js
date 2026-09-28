// Express router: app.use('/api/github', require('./githubRoutes'));
const express = require('express');
const gh = require('./github');

const router = express.Router();

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
router.post('/refresh', handle(async () => { gh.clearCache(); return { ok: true }; }));

module.exports = router;
