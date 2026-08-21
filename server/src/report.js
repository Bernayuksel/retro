const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');

const REPORTS_DIR = path.join(__dirname, '..', 'reports');
if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });

/**
 * Board kapandığında çağrılır: tüm veriyi toplar, kalıcı bir snapshot +
 * PDF üretir ve paylaşılabilir bir token döner. Board'un kendisi TTL ile
 * silinse bile rapor bağımsız olarak (reports tablosunda) yaşamaya devam eder.
 */
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
  const doc = new PDFDocument({ margin: 50 });
  doc.pipe(fs.createWriteStream(filePath));

  doc.fontSize(20).text(snapshot.board.title || 'Retro Raporu', { underline: true });
  doc.moveDown(0.5);
  doc.fontSize(10).fillColor('gray').text(
    `Oluşturulma: ${new Date(snapshot.board.closed_at || Date.now()).toLocaleString('tr-TR')}`
  );
  doc.fillColor('black').moveDown(1);

  // İstatistikler
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

  // Kolonlar ve kartlar
  doc.fontSize(14).text('Kartlar', { underline: true });
  doc.moveDown(0.3);
  for (const col of snapshot.columns) {
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

  // Aksiyon maddeleri
  doc.moveDown(0.5);
  doc.fontSize(14).text('Aksiyon Maddeleri', { underline: true });
  doc.fontSize(10).moveDown(0.3);
  if (snapshot.actions.length === 0) {
    doc.text('(aksiyon maddesi eklenmedi)');
  } else {
    for (const a of snapshot.actions) {
      doc.text(`• ${a.content}`);
      doc.fillColor('gray').text(`   Sorumlu: ${a.owner || '-'}   Tarih: ${a.due_date || '-'}   Durum: ${a.status}`);
      doc.fillColor('black');
    }
  }

  doc.end();
}

module.exports = { generateReport };
