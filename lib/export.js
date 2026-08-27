const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, HeadingLevel, WidthType } = require('docx');

const STAGE_LABELS = {
  prospection: 'Prospection', qualification: 'Qualification', proposition: 'Proposition',
  negociation: 'Négociation', gagne: 'Gagné', perdu: 'Perdu',
};
const CHANNEL_LABELS = { email: 'E-mail', appel: 'Appel', sms: 'SMS', whatsapp: 'WhatsApp', autre: 'Autre' };

function contactName(data, id) {
  const c = data.contacts.find((x) => x.id === id);
  return c ? `${c.firstName} ${c.lastName}`.trim() : '';
}
function companyName(data, id) {
  const c = data.companies.find((x) => x.id === id);
  return c ? c.name : '';
}

/* ============================================================
   Tableaux communs : une ligne d'en-tête + des lignes de données,
   partagés entre les trois formats pour rester cohérents.
   ============================================================ */
function buildSheets(data) {
  return {
    Contacts: {
      headers: ['Prénom', 'Nom', 'Entreprise', 'E-mail', 'Téléphone', 'Poste', 'Notes'],
      rows: data.contacts.map((c) => [c.firstName, c.lastName, companyName(data, c.companyId), c.email || '', c.phone || '', c.position || '', c.notes || '']),
    },
    Entreprises: {
      headers: ['Nom', 'Secteur', 'Site web', 'Téléphone', 'Adresse', 'Notes'],
      rows: data.companies.map((c) => [c.name, c.sector || '', c.website || '', c.phone || '', c.address || '', c.notes || '']),
    },
    Pipeline: {
      headers: ['Titre', 'Entreprise', 'Contact', 'Valeur (€)', 'Étape', 'Probabilité (%)', 'Date de clôture prévue'],
      rows: data.deals.map((d) => [d.title, companyName(data, d.companyId), contactName(data, d.contactId), Number(d.value) || 0, STAGE_LABELS[d.stage] || d.stage, d.probability ?? '', d.closeDate || '']),
    },
    Tâches: {
      headers: ['Titre', 'Type', 'Échéance', 'Terminée', 'Notes'],
      rows: data.tasks.map((t) => [t.title, t.type || '', t.dueDate || '', t.done ? 'Oui' : 'Non', t.notes || '']),
    },
    Messages: {
      headers: ['Contact', 'Canal', 'Sens', 'Date', 'Contenu'],
      rows: data.messages.map((m) => [contactName(data, m.contactId) || m.fromRaw || '', CHANNEL_LABELS[m.channel] || m.channel, m.direction === 'entrant' ? 'Reçu' : 'Envoyé', (m.date || '').slice(0, 16).replace('T', ' '), m.content || '']),
    },
  };
}

/* ============================================================
   Excel
   ============================================================ */
async function generateExcelBuffer(data) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'MonCRM';
  workbook.created = new Date();
  const sheets = buildSheets(data);

  for (const [name, { headers, rows }] of Object.entries(sheets)) {
    const sheet = workbook.addWorksheet(name);
    sheet.columns = headers.map((h) => ({ header: h, key: h, width: Math.max(14, h.length + 4) }));
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2A78D6' } };
    rows.forEach((r) => sheet.addRow(r));
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
  }
  return workbook.xlsx.writeBuffer();
}

/* ============================================================
   PDF — rendu de tableaux "à la main" (pdfkit n'a pas de tableau intégré)
   ============================================================ */
function drawPdfTable(doc, title, headers, rows, colWidths) {
  const startX = doc.page.margins.left;
  const pageBottom = doc.page.height - doc.page.margins.bottom;
  const rowHeight = 20;

  doc.moveDown(0.5);
  doc.fontSize(14).fillColor('#0b0b0b').font('Helvetica-Bold').text(title);
  doc.moveDown(0.3);

  function drawHeader(y) {
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#ffffff');
    doc.rect(startX, y, colWidths.reduce((a, b) => a + b, 0), rowHeight).fill('#2a78d6');
    let x = startX;
    headers.forEach((h, i) => {
      doc.fillColor('#ffffff').text(h, x + 4, y + 5, { width: colWidths[i] - 8, ellipsis: true });
      x += colWidths[i];
    });
    return y + rowHeight;
  }

  let y = drawHeader(doc.y);
  doc.font('Helvetica').fontSize(8.5);

  if (rows.length === 0) {
    doc.fillColor('#898781').text('Aucune donnée.', startX + 4, y + 5);
    doc.moveDown(2);
    return;
  }

  rows.forEach((row, idx) => {
    if (y + rowHeight > pageBottom) {
      doc.addPage();
      y = drawHeader(doc.page.margins.top);
    }
    if (idx % 2 === 1) doc.rect(startX, y, colWidths.reduce((a, b) => a + b, 0), rowHeight).fill('#f9f9f7');
    let x = startX;
    row.forEach((cell, i) => {
      doc.fillColor('#0b0b0b').text(String(cell ?? ''), x + 4, y + 5, { width: colWidths[i] - 8, height: rowHeight - 4, ellipsis: true });
      x += colWidths[i];
    });
    y += rowHeight;
  });
  doc.y = y + 10;
}

function generatePdfBuffer(data) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4', layout: 'landscape' });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(22).font('Helvetica-Bold').fillColor('#0b0b0b').text('MonCRM — Export', { align: 'left' });
    doc.fontSize(10).font('Helvetica').fillColor('#52514e').text(`Généré le ${new Date().toLocaleString('fr-FR')}`);
    doc.moveDown();

    const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const sheets = buildSheets(data);
    const widths = {
      Contacts: [90, 90, 110, 150, 90, 100, usableWidth - (90 + 90 + 110 + 150 + 90 + 100)],
      Entreprises: [140, 100, 130, 100, 160, usableWidth - (140 + 100 + 130 + 100 + 160)],
      Pipeline: [140, 110, 110, 80, 90, 80, usableWidth - (140 + 110 + 110 + 80 + 90 + 80)],
      Tâches: [180, 80, 80, 70, usableWidth - (180 + 80 + 80 + 70)],
      Messages: [120, 70, 60, 90, usableWidth - (120 + 70 + 60 + 90)],
    };

    Object.entries(sheets).forEach(([name, { headers, rows }], i) => {
      if (i > 0) doc.addPage();
      drawPdfTable(doc, name, headers, rows, widths[name]);
    });

    doc.end();
  });
}

/* ============================================================
   Word (.docx)
   ============================================================ */
function wordTable(headers, rows) {
  const headerRow = new TableRow({
    children: headers.map((h) => new TableCell({
      shading: { fill: '2A78D6' },
      children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, color: 'FFFFFF' })] })],
    })),
  });
  const dataRows = rows.map((r) => new TableRow({
    children: r.map((cell) => new TableCell({ children: [new Paragraph(String(cell ?? ''))] })),
  }));
  if (rows.length === 0) {
    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [headerRow, new TableRow({ children: headers.map(() => new TableCell({ children: [new Paragraph('—')] })) })],
    });
  }
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [headerRow, ...dataRows] });
}

async function generateWordBuffer(data) {
  const sheets = buildSheets(data);
  const children = [
    new Paragraph({ text: 'MonCRM — Export', heading: HeadingLevel.TITLE }),
    new Paragraph({ text: `Généré le ${new Date().toLocaleString('fr-FR')}` }),
  ];
  Object.entries(sheets).forEach(([name, { headers, rows }]) => {
    children.push(new Paragraph({ text: name, heading: HeadingLevel.HEADING_1, spacing: { before: 300 } }));
    children.push(wordTable(headers, rows));
  });
  const doc = new Document({ sections: [{ children }] });
  return Packer.toBuffer(doc);
}

module.exports = { generateExcelBuffer, generatePdfBuffer, generateWordBuffer };
