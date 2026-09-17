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

function findUnicodeBoldFont() {
  const candidates = [
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/TTF/DejaVuSans-Bold.ttf',
    'C:/Windows/Fonts/arialbd.ttf',
    'C:/Windows/Fonts/calibrib.ttf',
    '/System/Library/Fonts/Supplemental/Arial Bold.ttf'
  ];
  return candidates.find(font => fs.existsSync(font)) || findUnicodeFont();
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
  const comments = db.prepare(`
    SELECT cm.card_id, cm.content, cm.parent_id
    FROM comments cm
    JOIN cards c ON c.id = cm.card_id
    WHERE c.board_id = ?
    ORDER BY cm.created_at ASC
  `).all(boardId);

  const cardsByColumn = {};
  for (const col of columns) cardsByColumn[col.id] = [];
  for (const card of cards) {
    if (!cardsByColumn[card.column_id]) cardsByColumn[card.column_id] = [];
    cardsByColumn[card.column_id].push({
      id: card.id,
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
    comments: comments.map(comment => ({
      card_id: comment.card_id,
      content: comment.content,
      parent_id: comment.parent_id
    })),
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
  const doc = new PDFDocument({
    size: 'A4',
    margin: 46,
    bufferPages: true,
    info: { Title: snapshot.board.title || 'Retro Raporu', Language: 'tr-TR' }
  });
  doc.pipe(fs.createWriteStream(filePath));

  // PDFKit'in standart Helvetica fontu Türkçe karakterleri içermez.
  // Unicode destekli bir TTF varsa onu kullanıyoruz.
  const unicodeFont = findUnicodeFont();
  if (!unicodeFont) {
    throw new Error('Türkçe PDF oluşturmak için Unicode destekli bir font bulunamadı.');
  }
  const boldFont = findUnicodeBoldFont();
  doc.registerFont('Regular', unicodeFont);
  doc.registerFont('Bold', boldFont);

  const colors = {
    ink: '#171725',
    muted: '#74748a',
    purple: '#635bff',
    purpleSoft: '#f0efff',
    border: '#e7e7ef',
    surface: '#f8f8fc',
    green: '#248a57',
    greenSoft: '#eaf8f0',
    amber: '#9a6a12',
    amberSoft: '#fff7df',
    red: '#d95858',
    blue: '#3478f6'
  };

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
  const pageWidth = doc.page.width;
  const contentWidth = pageWidth - doc.page.margins.left - doc.page.margins.right;
  const sectionTitle = (title, subtitle) => {
    ensureSpace(42);
    doc.font('Bold').fontSize(14).fillColor(colors.ink).text(title, 46, doc.y, { width: contentWidth });
    if (subtitle) {
      doc.font('Regular').fontSize(8.5).fillColor(colors.muted).text(subtitle, 46, doc.y, { width: contentWidth });
    }
    doc.moveDown(0.45);
  };
  const statCard = (x, y, width, label, value, note, fill = colors.surface) => {
    doc.roundedRect(x, y, width, 68, 10).fill(fill);
    doc.font('Regular').fontSize(8).fillColor(colors.muted).text(label, x + 11, y + 10, { width: width - 22 });
    doc.font('Bold').fontSize(19).fillColor(colors.ink).text(String(value), x + 11, y + 25, { width: width - 22 });
    doc.font('Regular').fontSize(7.5).fillColor(colors.muted).text(note, x + 11, y + 51, { width: width - 22 });
  };
  const progressBar = (x, y, width, ratio, color) => {
    doc.roundedRect(x, y, width, 6, 3).fill('#ececf2');
    const safeRatio = Math.max(0, Math.min(1, ratio || 0));
    if (safeRatio > 0) doc.roundedRect(x, y, Math.max(6, width * safeRatio), 6, 3).fill(color);
  };
  const drawPageHeader = (continued = false) => {
    if (continued) {
      doc.font('Bold').fontSize(9).fillColor(colors.purple).text('RETRO RAPORU', 46, 28);
      doc.moveTo(46, 44).lineTo(pageWidth - 46, 44).lineWidth(1).strokeColor(colors.border).stroke();
      doc.y = 58;
      return;
    }
    doc.roundedRect(46, 38, contentWidth, 90, 16).fill(colors.purple);
    doc.font('Bold').fontSize(10).fillColor('#dedcff').text('SPRINT RETROSPECTIVE', 64, 56);
    doc.font('Bold').fontSize(23).fillColor('#ffffff').text(
      snapshot.board.title || 'Retro Raporu',
      64,
      76,
      { width: contentWidth - 170, ellipsis: true }
    );
    doc.font('Regular').fontSize(8).fillColor('#dedcff').text(
      formatDate(snapshot.board.closed_at || Date.now()),
      pageWidth - 190,
      87,
      { width: 126, align: 'right' }
    );
    doc.y = 150;
  };

  drawPageHeader(false);
  doc.on('pageAdded', () => drawPageHeader(true));

  const dashboard = snapshot.sprint_dashboard;
  if (dashboard) {
    const completionRate = dashboard.totalItems
      ? Math.round((dashboard.completedItems / dashboard.totalItems) * 100)
      : 0;
    const pointRate = dashboard.plannedPoints
      ? Math.round((dashboard.completedPoints / dashboard.plannedPoints) * 100)
      : 0;

    sectionTitle('Sprint Özeti', dashboard.name || 'Sprint performansı');
    doc.roundedRect(46, doc.y, contentWidth, 25, 8).fill(
      dashboard.isDemo ? colors.amberSoft : colors.greenSoft
    );
    doc.font('Bold').fontSize(8.5).fillColor(dashboard.isDemo ? colors.amber : colors.green).text(
      dashboard.isDemo
        ? 'Örnek veri · GitHub bağlantısı bekleniyor'
        : 'Kaynak: GitHub Project',
      58,
      doc.y + 8
    );
    doc.y += 37;

    const gap = 9;
    const cardWidth = (contentWidth - gap * 3) / 4;
    const cardsY = doc.y;
    statCard(46, cardsY, cardWidth, 'TAMAMLANMA', `%${completionRate}`, `${dashboard.completedItems} / ${dashboard.totalItems} madde`, colors.purpleSoft);
    statCard(46 + cardWidth + gap, cardsY, cardWidth, 'TAMAMLANAN EFOR', dashboard.completedPoints, `${dashboard.plannedPoints} SP planlandı`, colors.greenSoft);
    statCard(46 + (cardWidth + gap) * 2, cardsY, cardWidth, 'TAMAMLANAN', dashboard.completedItems, 'sprint içinde', colors.surface);
    statCard(46 + (cardWidth + gap) * 3, cardsY, cardWidth, 'DEVREDEN', dashboard.carriedItems, 'sonraki sprinte', colors.amberSoft);
    doc.y = cardsY + 82;

    const panelGap = 12;
    const panelWidth = (contentWidth - panelGap) / 2;
    const panelY = doc.y;
    const panelHeight = 118;
    doc.roundedRect(46, panelY, panelWidth, panelHeight, 12).lineWidth(1).fillAndStroke('#ffffff', colors.border);
    doc.roundedRect(46 + panelWidth + panelGap, panelY, panelWidth, panelHeight, 12).lineWidth(1).fillAndStroke('#ffffff', colors.border);

    doc.font('Bold').fontSize(10).fillColor(colors.ink).text('İş türü dağılımı', 59, panelY + 13);
    let typeY = panelY + 34;
    const typeTotal = (dashboard.itemTypes || []).reduce((sum, item) => sum + item.value, 0) || 1;
    const typeColors = [colors.purple, colors.red, colors.green, colors.blue];
    (dashboard.itemTypes || []).forEach((item, index) => {
      doc.font('Regular').fontSize(8).fillColor(colors.ink).text(item.label, 59, typeY, { width: panelWidth - 100 });
      doc.font('Bold').fontSize(8).fillColor(colors.ink).text(String(item.value), 46 + panelWidth - 43, typeY, { width: 28, align: 'right' });
      progressBar(59, typeY + 13, panelWidth - 82, item.value / typeTotal, typeColors[index % typeColors.length]);
      typeY += 25;
    });

    const peopleX = 46 + panelWidth + panelGap + 13;
    doc.font('Bold').fontSize(10).fillColor(colors.ink).text('Kişi bazında katkı', peopleX, panelY + 13);
    let peopleY = panelY + 35;
    (dashboard.contributors || []).slice(0, 4).forEach(person => {
      doc.circle(peopleX + 9, peopleY + 7, 9).fill(colors.purpleSoft);
      doc.font('Bold').fontSize(7).fillColor(colors.purple).text(
        String(person.name || '?').split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase(),
        peopleX + 2,
        peopleY + 3,
        { width: 14, align: 'center' }
      );
      doc.font('Regular').fontSize(8).fillColor(colors.ink).text(person.name, peopleX + 26, peopleY + 2, { width: panelWidth - 115, ellipsis: true });
      doc.font('Bold').fontSize(8).fillColor(colors.ink).text(`${person.completed} iş · ${person.points} SP`, peopleX + panelWidth - 115, peopleY + 2, { width: 88, align: 'right' });
      peopleY += 24;
    });
    doc.y = panelY + panelHeight + 20;
  }

  sectionTitle('Katılım Özeti', 'Retro oturumunun genel görünümü');
  const participationY = doc.y;
  const participationGap = 8;
  const participationWidth = (contentWidth - participationGap * 3) / 4;
  [
    ['KATILIMCI', snapshot.stats.participant_count],
    ['KART', snapshot.stats.card_count],
    ['OY', snapshot.stats.vote_count],
    ['AKSİYON', snapshot.stats.action_count]
  ].forEach(([label, value], index) => {
    const x = 46 + index * (participationWidth + participationGap);
    doc.roundedRect(x, participationY, participationWidth, 42, 9).fill(colors.surface);
    doc.font('Bold').fontSize(15).fillColor(colors.ink).text(String(value), x + 10, participationY + 8);
    doc.font('Regular').fontSize(7.5).fillColor(colors.muted).text(label, x + 10, participationY + 27);
  });
  doc.y = participationY + 52;
  if (snapshot.participants.length) {
    doc.font('Regular').fontSize(8).fillColor(colors.muted).text(`Katılımcılar: ${snapshot.participants.join(', ')}`);
  }
  doc.moveDown(1.2);

  sectionTitle('Retro Kartları', 'Takımın paylaştığı görüşler');
  for (const col of snapshot.columns) {
    const items = snapshot.cardsByColumn[col.id] || [];
    const estimatedHeight = 38 + Math.max(1, items.length) * 34;
    ensureSpace(Math.min(estimatedHeight, 180));
    const columnY = doc.y;
    doc.roundedRect(46, columnY, contentWidth, 29, 8).fill(colors.purpleSoft);
    doc.font('Bold').fontSize(9.5).fillColor(colors.purple).text(col.name, 58, columnY + 9);
    doc.y = columnY + 38;
    if (items.length === 0) {
      doc.font('Regular').fontSize(8.5).fillColor(colors.muted).text('Henüz kart eklenmedi.', 58, doc.y);
      doc.y += 22;
    } else {
      for (const item of items) {
        const itemHeight = Math.max(30, doc.heightOfString(item.content, { width: contentWidth - 125 }) + 18);
        ensureSpace(itemHeight + 8);
        const itemY = doc.y;
        doc.roundedRect(58, itemY, contentWidth - 24, itemHeight, 8).lineWidth(1).fillAndStroke('#ffffff', colors.border);
        doc.font('Regular').fontSize(9).fillColor(colors.ink).text(item.content, 70, itemY + 8, { width: contentWidth - 145 });
        doc.font('Bold').fontSize(7.5).fillColor(colors.purple).text(`${item.votes} oy`, pageWidth - 125, itemY + 8, { width: 55, align: 'right' });
        doc.font('Regular').fontSize(7.5).fillColor(colors.muted).text(item.author, pageWidth - 180, itemY + itemHeight - 14, { width: 110, align: 'right' });
        doc.y = itemY + itemHeight + 7;
      }
    }
    doc.moveDown(0.5);
  }

  ensureSpace(100);
  sectionTitle('Aksiyon Maddeleri', 'Retro sonrasında takip edilecek işler');
  if (snapshot.actions.length === 0) {
    doc.roundedRect(46, doc.y, contentWidth, 42, 9).fill(colors.surface);
    doc.font('Regular').fontSize(8.5).fillColor(colors.muted).text('Henüz aksiyon maddesi eklenmedi.', 58, doc.y + 15);
    doc.y += 52;
  } else {
    for (const a of snapshot.actions) {
      ensureSpace(64);
      const actionY = doc.y;
      doc.roundedRect(46, actionY, contentWidth, 55, 10).lineWidth(1).fillAndStroke('#ffffff', colors.border);
      doc.circle(62, actionY + 18, 7).fill(colors.greenSoft);
      doc.font('Bold').fontSize(8).fillColor(colors.green).text('✓', 57, actionY + 13, { width: 10, align: 'center' });
      doc.font('Bold').fontSize(9).fillColor(colors.ink).text(a.content, 78, actionY + 11, { width: contentWidth - 100, ellipsis: true });
      doc.font('Regular').fontSize(7.5).fillColor(colors.muted).text(
        `Sorumlu: ${a.owner || '-'}   ·   Tarih: ${formatDate(a.due_date)}   ·   Durum: ${statusLabels[a.status] || a.status || '-'}`,
        78,
        actionY + 33,
        { width: contentWidth - 100 }
      );
      doc.y = actionY + 64;
    }
  }

  doc.removeAllListeners('pageAdded');
  const range = doc.bufferedPageRange();
  for (let pageIndex = range.start; pageIndex < range.start + range.count; pageIndex += 1) {
    doc.switchToPage(pageIndex);
    const footerY = doc.page.height - doc.page.margins.bottom - 12;
    doc.moveTo(46, footerY - 9).lineTo(pageWidth - 46, footerY - 9).lineWidth(0.7).strokeColor(colors.border).stroke();
    doc.font('Regular').fontSize(7.5).fillColor(colors.muted).text(
      'Retro Board', 46, footerY, { width: 120, lineBreak: false }
    );
    doc.text(
      `${pageIndex + 1} / ${range.count}`,
      pageWidth - 126,
      footerY,
      { width: 80, align: 'right', lineBreak: false }
    );
  }

  doc.end();
}

module.exports = { generateReport };
