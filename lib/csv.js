export const SHEET_HEADERS = [
  'Date',
  'Model',
  'S/N',
  'Problem',
  'Reporter',
  'Service / update',
  'Status',
  'Equipment',
];

/**
 * RFC-4180 compliant CSV parser supporting multiline quoted fields and escaped quotes.
 */
export function parseCsv(text) {
  if (!text) return [];
  const cleaned = text.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < cleaned.length; i += 1) {
    const ch = cleaned[i];
    const next = cleaned[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\r' && next === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += 1;
    } else if (ch === '\n' || ch === '\r') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.some((cell) => String(cell).trim() !== ''));
}

function normalizeHeader(name) {
  return String(name || '').trim().toLowerCase();
}

export function rowsToJobs(rows, sheetName = 'Report') {
  if (!rows || rows.length === 0) return [];

  const headerRow = rows[0].map(normalizeHeader);
  const hasHeader =
    headerRow.includes('date') ||
    headerRow.includes('model') ||
    headerRow.includes('s/n') ||
    headerRow.includes('problem') ||
    headerRow.includes('เวลาแจ้ง');

  const findCol = (candidates, fallbackIndex) => {
    if (!hasHeader) return fallbackIndex;
    const idx = headerRow.findIndex((h) => candidates.includes(h));
    return idx >= 0 ? idx : fallbackIndex;
  };

  const idxDate = findCol(['date', 'timestamp', 'เวลาแจ้ง'], 0);
  const idxModel = findCol(['model', 'รุ่น', 'รุ่นเครื่อง'], 1);
  const idxSn = findCol(['s/n', 'sn', 'serial number', 'เลขประจำเครื่อง'], 2);
  const idxProblem = findCol(['problem', 'อาการ', 'รายละเอียดปัญหา'], 3);
  const idxReporter = findCol(['reporter', 'ผู้แจ้ง', 'ผู้รายงาน'], 4);
  const idxDetails = findCol(['service / update', 'service/update', 'details', 'รายละเอียดการแก้ไข'], 5);
  const idxStatus = findCol(['status', 'สถานะ', 'สถานะปัจจุบัน'], 6);
  const idxEquipment = findCol(['equipment', 'equipmenttype', 'ชนิดเครื่อง'], 7);

  const startIndex = hasHeader ? 1 : 0;
  const jobs = [];

  for (let i = startIndex; i < rows.length; i += 1) {
    const r = rows[i];
    if (!r || r.every((cell) => String(cell || '').trim() === '')) continue;

    const equipmentType = String(r[idxEquipment] || '').trim() || (sheetName === 'Carm' ? 'Carm' : 'Ultrasound');
    jobs.push({
      timestamp: String(r[idxDate] || '').trim(),
      model: String(r[idxModel] || '').trim(),
      sn: String(r[idxSn] || '').trim(),
      problem: String(r[idxProblem] || '').trim(),
      reporter: String(r[idxReporter] || '').trim(),
      details: String(r[idxDetails] || '').trim(),
      status: String(r[idxStatus] || '').trim() || 'รอดำเนินการ',
      equipmentType,
      sheetName,
      rowNumber: i + 1,
    });
  }

  return jobs;
}

export function jobToRow(job) {
  return [
    job.timestamp || '',
    job.model || '',
    job.sn || '',
    job.problem || '',
    job.reporter || '',
    job.details || '',
    job.status || 'รอดำเนินการ',
    job.equipmentType || 'Ultrasound',
  ];
}
