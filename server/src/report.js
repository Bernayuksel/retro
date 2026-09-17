const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');

const REPORTS_DIR = path.join(__dirname, '..', 'reports');
if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });

function findUnicodeFont() {
  const candidates = [
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/TTF/DejaVuSans.ttf',
    'C:/Windows/Fonts/arial.ttf',
    'C:/Windows/Fonts/calibri.ttf',
    '/System/Library/Fonts/Supplemental/Arial.ttf'
  ];
  return candidates.find(font => fs.existsSync(font)) || null;
}

function getSprintDashboard(board) {
  if (board.sprint_dashboard) {
    try {
      return typeof board.sprint_dashboard === 'string'
        ? JSON.parse(board.sprint_dashboard)
        : board.sprint_dashboard;
    } catch {
      // Geçersiz entegrasyon verisinde rapor üretimini durdurma.
    }
  }

  return {
    isDemo: true,
    name: 'Sprint özeti',
    dateRange: 'GitHub bağlantısı bekleniyor',
    totalItems: 24,
    completedItems: 18,
    carriedItems: 6,
    plannedPoints: 60,
    completedPoints: 45,
    itemTypes: [
      { label: 'User Story', value: 11 },
      { label: 'Bug', value: 5 },
      { label: 'Task', value: 2 }
    ],
    contributors: [
      { name: 'Örnek Kullanıcı 1', completed: 7, points: 18 },
      { name: 'Örnek Kullanıcı 2', completed: 6, points: 15 },
      { name: 'Örnek Kullanıcı 3', completed: 5, points: 12 }
    ]
  };
}

function generateReport(boardId) {
  const board = db.prepare('SELECT * FROM boards WHERE id = ?').get(boardId);
  if (!board) throw new Error('Board bulunamadı');

  const columns = JSON.parse(board.columns);
  const participants = db.prepare('SELECT name, joined_at FROM participants WHERE board_id = ?').all(boardId);
  const cards = db.prepare(`
    SELECT c.*, (SELECT COUNT(*) FROM votes v WHERE v.card_id = c.id) AS vote_count
    FROM cards c WHERE c.board_id = ? ORDER BY vote_count DESC
  `).all(boardId);
  const actions = db.prepare('SELECT * FROM actions WHERE board_id = ? ORDER BY created_at ASC').all(boardId);

  const cardsByColumn = {};
  for (const col of columns) cardsByColumn[col.id] = [];
  for (const card of cards) {
    if (!cardsByColumn[card.column_id]) cardsByColumn[card.column_id] = [];
    cardsByColumn[card.column_id].push({
      content: card.content,
      author: card.is_anonymous ? 'Anonim' : (card.author_name || 'Anonim'),
      votes: card.vote_count,
    });
  }

  const stats = {
    participant_count: participants.length,
    card_count: cards.length,
    vote_count: cards.reduce((sum, c) => sum + c.vote_count, 0),
    action_count: actions.length,
  };

  const snapshot = {
    board: { title: board.title, created_at: board.created_at, closed_at: board.closed_at },
    sprint_dashboard: getSprintDashboard(board),
    columns,
    cardsByColumn,
    participants: participants.map(p => p.name),
    actions: actions.map(a => ({ content: a.content, owner: a.owner, due_date: a.due_date, status: a.status })),
    stats,
  };

  const token = uuidv4();
  const pdfPath = path.join(REPORTS_DIR, `${token}.pdf`);
  buildPdf(pdfPath, snapshot);

  const reportId = uuidv4();
  db.prepare(`
    INSERT INTO reports (id, board_id, token, snapshot, pdf_path, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(reportId, boardId, token, JSON.stringify(snapshot), pdfPath, Date.now());

  return { token, snapshot };
}

function buildPdf(filePath, snapshot) {
  const doc = new PDFDocument({ margin: 50, info: { Title: snapshot.board.title || 'Retro Raporu', Language: 'tr-TR' } });
  doc.pipe(fs.createWriteStream(filePath));

  // PDFKit'in standart Helvetica fontu Türkçe karakterleri içermez.
  // Unicode destekli bir TTF varsa onu kullanıyoruz.
  const unicodeFont = findUnicodeFont();
  if (!unicodeFont) {
    throw new Error('Türkçe PDF oluşturmak için Unicode destekli bir font bulunamadı.');
  }
  doc.font(unicodeFont);

  const statusLabels = {
    open: 'Açık',
    in_progress: 'Devam ediyor',
    done: 'Tamamlandı',
    closed: 'Kapalı'
  };
  const formatDate = value => {
    if (!value) return '-';
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(String(value));
    const date = dateOnly ? new Date(`${value}T00:00:00`) : new Date(value);
    return new Intl.DateTimeFormat('tr-TR', dateOnly
      ? { dateStyle: 'long' }
      : { dateStyle: 'long', timeStyle: 'short' }).format(date);
  };
  const ensureSpace = height => {
    const bottom = doc.page.height - doc.page.margins.bottom;
    if (doc.y + height > bottom) doc.addPage();
  };

  doc.fontSize(20).text(snapshot.board.title || 'Retro Raporu', { underline: true });
  doc.moveDown(0.5);
  doc.fontSize(10).fillColor('gray').text(
    `Oluşturulma: ${formatDate(snapshot.board.closed_at || Date.now())}`
  );
  doc.fillColor('black').moveDown(1);

  const dashboard = snapshot.sprint_dashboard;
  if (dashboard) {
    const completionRate = dashboard.totalItems
      ? Math.round((dashboard.completedItems / dashboard.totalItems) * 100)
      : 0;
    const pointRate = dashboard.plannedPoints
      ? Math.round((dashboard.completedPoints / dashboard.plannedPoints) * 100)
      : 0;

    ensureSpace(215);
    doc.fontSize(14).text('Sprint Özeti', { underline: true });
    doc.moveDown(0.2);
    doc.fontSize(10).fillColor(dashboard.isDemo ? '#8a6214' : '#237a4b').text(
      dashboard.isDemo
        ? 'Örnek veri · GitHub bağlantısı bekleniyor'
        : 'Kaynak: GitHub Project'
    );
    doc.fillColor('gray').text(`${dashboard.name || 'Sprint'} · ${dashboard.dateRange || '-'}`);
    doc.fillColor('black').moveDown(0.5);

    doc.fontSize(11).text(`Tamamlanma: %${completionRate} (${dashboard.completedItems} / ${dashboard.totalItems} madde)`);
    doc.text(`Tamamlanan efor: ${dashboard.completedPoints} / ${dashboard.plannedPoints} SP (%${pointRate})`);
    doc.text(`Devreden madde: ${dashboard.carriedItems}`);
    doc.moveDown(0.6);

    doc.fontSize(11).fillColor('#2563eb').text('Tamamlanan işlerin dağılımı');
    doc.fillColor('black').fontSize(10);
    for (const item of dashboard.itemTypes || []) {
      doc.text(`  • ${item.label}: ${item.value}`);
    }
    doc.moveDown(0.4);

    doc.fontSize(11).fillColor('#2563eb').text('Kişi bazında katkı');
    doc.fillColor('black').fontSize(10);
    for (const person of dashboard.contributors || []) {
      doc.text(`  • ${person.name}: ${person.completed} madde · ${person.points} SP`);
    }
    doc.moveDown(1);
  }

  doc.fontSize(14).text('Katılım Özeti', { underline: true });
  doc.fontSize(11).moveDown(0.3);
  doc.text(`Katılımcı sayısı: ${snapshot.stats.participant_count}`);
  doc.text(`Toplam kart: ${snapshot.stats.card_count}`);
  doc.text(`Toplam oy: ${snapshot.stats.vote_count}`);
  doc.text(`Aksiyon maddesi: ${snapshot.stats.action_count}`);
  if (snapshot.participants.length) {
    doc.moveDown(0.3);
    doc.text(`Katılımcılar: ${snapshot.participants.join(', ')}`);
  }
  doc.moveDown(1);

  ensureSpace(80);
  doc.fontSize(14).text('Kartlar', { underline: true });
  doc.moveDown(0.3);
  for (const col of snapshot.columns) {
    ensureSpace(65);
    doc.fontSize(12).fillColor('#2563eb').text(col.name);
    doc.fillColor('black').fontSize(10);
    const items = snapshot.cardsByColumn[col.id] || [];
    if (items.length === 0) {
      doc.text('  (kart yok)');
    } else {
      for (const item of items) {
        doc.text(`  • ${item.content}  [${item.votes} oy]  — ${item.author}`);
      }
    }
    doc.moveDown(0.5);
  }

  ensureSpace(90);
  doc.moveDown(0.5);
  doc.fontSize(14).text('Aksiyon Maddeleri', { underline: true });
  doc.fontSize(10).moveDown(0.3);
  if (snapshot.actions.length === 0) {
    doc.text('(aksiyon maddesi eklenmedi)');
  } else {
    for (const a of snapshot.actions) {
      doc.text(`• ${a.content}`);
      doc.fillColor('gray').text(`   Sorumlu: ${a.owner || '-'}   Tarih: ${formatDate(a.due_date)}   Durum: ${statusLabels[a.status] || a.status || '-'}`);
      doc.fillColor('black');
    }
  }

  doc.end();
}

module.exports = { generateReport };
