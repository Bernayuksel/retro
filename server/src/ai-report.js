const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');

const REPORTS_DIR = path.join(__dirname, '..', 'reports');
const pendingReports = new Map();

const SUMMARY_SCHEMA = {
  type: 'object',
  properties: {
    executive_summary: { type: 'string' },
    positives: { type: 'array', items: { type: 'string' } },
    improvements: { type: 'array', items: { type: 'string' } },
    themes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          evidence: { type: 'string' },
          impact: { type: 'string' }
        },
        required: ['title', 'evidence', 'impact'],
        additionalProperties: false
      }
    },
    recommended_actions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          reason: { type: 'string' },
          priority: { type: 'string', enum: ['high', 'medium', 'low'] }
        },
        required: ['title', 'reason', 'priority'],
        additionalProperties: false
      }
    },
    conclusion: { type: 'string' }
  },
  required: [
    'executive_summary',
    'positives',
    'improvements',
    'themes',
    'recommended_actions',
    'conclusion'
  ],
  additionalProperties: false
};

function findFont(bold = false) {
  const candidates = bold
    ? [
        '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
        'C:/Windows/Fonts/arialbd.ttf',
        'C:/Windows/Fonts/calibrib.ttf',
        '/System/Library/Fonts/Supplemental/Arial Bold.ttf'
      ]
    : [
        '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
        'C:/Windows/Fonts/arial.ttf',
        'C:/Windows/Fonts/calibri.ttf',
        '/System/Library/Fonts/Supplemental/Arial.ttf'
      ];
  return candidates.find(candidate => fs.existsSync(candidate)) || null;
}

function anonymizeSnapshot(snapshot) {
  const columns = snapshot.columns.map(column => ({
    name: column.name,
    cards: (snapshot.cardsByColumn[column.id] || []).map(card => ({
      id: card.id,
      content: card.content,
      votes: card.votes,
      comments: (snapshot.comments || [])
        .filter(comment => comment.card_id === card.id)
        .map(comment => comment.content)
    }))
  }));

  return {
    board_title: snapshot.board.title,
    sprint_dashboard: snapshot.sprint_dashboard,
    columns,
    actions: snapshot.actions.map(action => ({
      content: action.content,
      due_date: action.due_date,
      status: action.status,
      has_owner: Boolean(action.owner)
    })),
    stats: snapshot.stats
  };
}

function extractOutputText(response) {
  for (const output of response.output || []) {
    for (const content of output.content || []) {
      if (content.type === 'output_text' && content.text) return content.text;
    }
  }
  throw new Error('OpenAI yanıtında özet metni bulunamadı.');
}

async function createSummary(snapshot) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const error = new Error('OPENAI_API_KEY eksik');
    error.code = 'AI_NOT_CONFIGURED';
    throw error;
  }

  const model = process.env.OPENAI_MODEL || 'gpt-5.6-luna';
  const input = anonymizeSnapshot(snapshot);
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: 'system',
          content: [
            'Deneyimli bir Agile retrospektif kolaylaştırıcısısın.',
            'Yalnızca verilen retro içeriğine dayanarak Türkçe, tarafsız ve yapıcı bir özet hazırla.',
            'Anonim veya isimli kişilerin kimliğini tahmin etme; bireysel performans değerlendirmesi yapma.',
            'Oy sayılarını yalnızca konu önceliğinin sinyali olarak değerlendir.',
            'Somut olmayan iddialar üretme ve önerileri uygulanabilir yaz.'
          ].join(' ')
        },
        {
          role: 'user',
          content: `Aşağıdaki anonimleştirilmiş retro verisini analiz et:\n${JSON.stringify(input)}`
        }
      ],
      max_output_tokens: 2500,
      text: {
        format: {
          type: 'json_schema',
          name: 'retro_summary',
          strict: true,
          schema: SUMMARY_SCHEMA
        }
      }
    })
  });

  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error?.message || `OpenAI API hatası (${response.status})`);
  }

  return { summary: JSON.parse(extractOutputText(body)), model };
}

function buildAiPdf(filePath, snapshot, summary, model) {
  const regular = findFont(false);
  const bold = findFont(true);
  if (!regular || !bold) throw new Error('Türkçe PDF fontu bulunamadı.');

  const doc = new PDFDocument({ size: 'A4', margin: 46, bufferPages: true });
  const stream = fs.createWriteStream(filePath);
  doc.pipe(stream);
  doc.registerFont('Regular', regular);
  doc.registerFont('Bold', bold);

  const colors = {
    ink: '#171725', muted: '#74748a', purple: '#635bff', purpleSoft: '#f0efff',
    border: '#e7e7ef', green: '#248a57', greenSoft: '#eaf8f0',
    amber: '#9a6a12', amberSoft: '#fff7df', red: '#d95858', redSoft: '#fff0f0'
  };
  const pageWidth = doc.page.width;
  const contentWidth = pageWidth - 92;

  const pageHeader = first => {
    if (first) {
      doc.roundedRect(46, 38, contentWidth, 95, 16).fill(colors.purple);
      doc.font('Bold').fontSize(10).fillColor('#dedcff').text('AI DESTEKLİ RETRO RAPORU', 64, 56);
      doc.font('Bold').fontSize(22).fillColor('#ffffff').text(snapshot.board.title, 64, 79, {
        width: contentWidth - 36,
        ellipsis: true
      });
      doc.font('Regular').fontSize(8).fillColor('#dedcff').text(`Model: ${model}`, 64, 112);
      doc.y = 154;
    } else {
      doc.font('Bold').fontSize(9).fillColor(colors.purple).text('AI DESTEKLİ RETRO RAPORU', 46, 28);
      doc.moveTo(46, 44).lineTo(pageWidth - 46, 44).strokeColor(colors.border).stroke();
      doc.y = 60;
    }
  };
  const ensureSpace = height => {
    if (doc.y + height > doc.page.height - doc.page.margins.bottom) doc.addPage();
  };
  const section = (title, subtitle, accent = colors.purple) => {
    // Başlığın sayfa sonunda tek başına kalmasını önle.
    ensureSpace(110);
    doc.font('Bold').fontSize(14).fillColor(colors.ink).text(title, 46, doc.y, { width: contentWidth });
    if (subtitle) doc.font('Regular').fontSize(8).fillColor(colors.muted).text(subtitle, 46, doc.y, { width: contentWidth });
    doc.moveDown(0.45);
    doc.roundedRect(46, doc.y, 42, 4, 2).fill(accent);
    doc.y += 15;
  };
  const bulletCard = (text, accent = colors.purpleSoft) => {
    const textHeight = doc.heightOfString(text, { width: contentWidth - 55 });
    const height = Math.max(38, textHeight + 20);
    ensureSpace(height + 8);
    const y = doc.y;
    doc.roundedRect(46, y, contentWidth, height, 9).fill(accent);
    doc.circle(62, y + 18, 4).fill(colors.purple);
    doc.font('Regular').fontSize(9).fillColor(colors.ink).text(text, 76, y + 10, { width: contentWidth - 45 });
    doc.y = y + height + 7;
  };

  pageHeader(true);
  doc.on('pageAdded', () => pageHeader(false));

  section('Yönetici Özeti', 'Retro çıktılarının kısa ve dengeli değerlendirmesi');
  const summaryHeight = doc.heightOfString(summary.executive_summary, { width: contentWidth - 28 }) + 28;
  doc.roundedRect(46, doc.y, contentWidth, summaryHeight, 12).fill(colors.purpleSoft);
  doc.font('Regular').fontSize(10).fillColor(colors.ink).text(summary.executive_summary, 60, doc.y + 14, { width: contentWidth - 28, lineGap: 2 });
  doc.y += summaryHeight + 20;

  const dashboard = snapshot.sprint_dashboard;
  if (dashboard) {
    section('Sprint Göstergeleri', 'Sayısal sonuçlar');
    const rate = dashboard.totalItems ? Math.round(dashboard.completedItems / dashboard.totalItems * 100) : 0;
    const items = [
      ['Tamamlanma', `%${rate}`],
      ['Tamamlanan', dashboard.completedItems],
      ['Tamamlanan efor', `${dashboard.completedPoints} SP`],
      ['Devreden', dashboard.carriedItems]
    ];
    const gap = 9;
    const width = (contentWidth - gap * 3) / 4;
    const y = doc.y;
    items.forEach(([label, value], index) => {
      const x = 46 + index * (width + gap);
      doc.roundedRect(x, y, width, 58, 10).fill(index === 0 ? colors.purpleSoft : '#f8f8fc');
      doc.font('Bold').fontSize(16).fillColor(colors.ink).text(String(value), x + 10, y + 12);
      doc.font('Regular').fontSize(7.5).fillColor(colors.muted).text(label, x + 10, y + 37, { width: width - 20 });
    });
    doc.y = y + 76;
  }

  section('İyi Gidenler', 'Takımın koruması gereken güçlü noktalar', colors.green);
  summary.positives.forEach(item => bulletCard(item, colors.greenSoft));
  doc.moveDown(0.7);

  section('İyileştirme Alanları', 'Bir sonraki sprintte ele alınabilecek konular', colors.red);
  summary.improvements.forEach(item => bulletCard(item, colors.redSoft));
  doc.moveDown(0.7);

  section('Öne Çıkan Temalar', 'Kartlar ve yorumlarda tekrar eden örüntüler');
  summary.themes.forEach(theme => {
    const text = `${theme.title}\n${theme.evidence}\nEtkisi: ${theme.impact}`;
    bulletCard(text);
  });
  doc.moveDown(0.7);

  section('AI Aksiyon Önerileri', 'Mevcut aksiyonları tamamlayan uygulanabilir öneriler', colors.amber);
  const priorityLabels = { high: 'Yüksek', medium: 'Orta', low: 'Düşük' };
  summary.recommended_actions.forEach(action => {
    bulletCard(`${action.title}  ·  Öncelik: ${priorityLabels[action.priority]}\n${action.reason}`, colors.amberSoft);
  });
  doc.moveDown(0.7);

  section('Sonuç', null, colors.green);
  bulletCard(summary.conclusion, colors.greenSoft);

  doc.removeAllListeners('pageAdded');
  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    const y = doc.page.height - doc.page.margins.bottom - 12;
    doc.moveTo(46, y - 9).lineTo(pageWidth - 46, y - 9).strokeColor(colors.border).stroke();
    doc.font('Regular').fontSize(7.5).fillColor(colors.muted).text(
      'AI tarafından oluşturulmuştur; takım değerlendirmesinin yerine geçmez.',
      46, y, { width: 330, lineBreak: false }
    );
    doc.text(`${index + 1} / ${range.count}`, pageWidth - 126, y, { width: 80, align: 'right', lineBreak: false });
  }
  doc.end();
  return new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

async function generateAiReport(token) {
  const report = db.prepare('SELECT * FROM reports WHERE token = ?').get(token);
  if (!report) throw new Error('Rapor bulunamadı');

  const cached = db.prepare('SELECT * FROM ai_reports WHERE report_id = ?').get(report.id);
  if (cached && fs.existsSync(cached.pdf_path)) {
    return { cached: true, model: cached.model, pdfPath: cached.pdf_path };
  }

  if (pendingReports.has(report.id)) return pendingReports.get(report.id);

  const task = (async () => {
    const snapshot = JSON.parse(report.snapshot);
    const { summary, model } = await createSummary(snapshot);
    const id = uuidv4();
    const pdfPath = path.join(REPORTS_DIR, `${id}-ai.pdf`);
    await buildAiPdf(pdfPath, snapshot, summary, model);
    db.prepare(`
      INSERT INTO ai_reports (id, report_id, summary, pdf_path, model, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(report_id) DO UPDATE SET
        summary = excluded.summary,
        pdf_path = excluded.pdf_path,
        model = excluded.model,
        created_at = excluded.created_at
    `).run(id, report.id, JSON.stringify(summary), pdfPath, model, Date.now());
    return { cached: false, model, pdfPath };
  })();

  pendingReports.set(report.id, task);
  try {
    return await task;
  } finally {
    pendingReports.delete(report.id);
  }
}

module.exports = { generateAiReport, buildAiPdf, anonymizeSnapshot };
