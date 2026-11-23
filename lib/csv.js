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

export function resolveColumnMap(headerCells = []) {
  const normalized = headerCells.map(normalizeHeader);
  const hasHeader =
    normalized.includes('date') ||
    normalized.includes('model') ||
    normalized.includes('s/n') ||
    normalized.includes('problem') ||
    normalized.includes('status') ||
    normalized.includes('เวลาแจ้ง');

  const findCol = (candidates, fallbackIndex) => {
    if (!hasHeader) return fallbackIndex;
    const idx = normalized.findIndex((h) => candidates.includes(h));
    return idx >= 0 ? idx : fallbackIndex;
  };

  return {
    hasHeader,
    idxDate: findCol(['date', 'timestamp', 'เวลาแจ้ง'], 0),
    idxModel: findCol(['model', 'รุ่น', 'รุ่นเครื่อง'], 1),
    idxSn: findCol(['s/n', 'sn', 'serial number', 'เลขประจำเครื่อง'], 2),
    idxProblem: findCol(['problem', 'อาการ', 'รายละเอียดปัญหา'], 3),
    idxReporter: findCol(['reporter', 'ผู้แจ้ง', 'ผู้รายงาน'], 4),
    idxDetails: findCol(['service / update', 'service/update', 'service update', 'details', 'รายละเอียดการแก้ไข'], 5),
    idxStatus: findCol(['status', 'สถานะ', 'สถานะปัจจุบัน'], 6),
    idxEquipment: findCol(['equipment', 'equipmenttype', 'ชนิดเครื่อง'], 7),
  };
}

export function columnIndexToLetter(index) {
  let num = index + 1;
  let letters = '';
  while (num > 0) {
    const rem = (num - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    num = Math.floor((num - 1) / 26);
  }
  return letters || 'A';
}

export function rowsToJobs(rows, sheetName = 'Report') {
  if (!rows || rows.length === 0) return [];

  const cols = resolveColumnMap(rows[0]);
  const startIndex = cols.hasHeader ? 1 : 0;
  const jobs = [];

  for (let i = startIndex; i < rows.length; i += 1) {
    const r = rows[i];
    if (!r || r.every((cell) => String(cell || '').trim() === '')) continue;

    const equipmentType =
      String(r[cols.idxEquipment] || '').trim() ||
      (sheetName === 'Carm' ? 'Carm' : 'Ultrasound');

    jobs.push({
      timestamp: String(r[cols.idxDate] || '').trim(),
      model: String(r[cols.idxModel] || '').trim(),
      sn: String(r[cols.idxSn] || '').trim(),
      problem: String(r[cols.idxProblem] || '').trim(),
      reporter: String(r[cols.idxReporter] || '').trim(),
      details: String(r[cols.idxDetails] || '').trim(),
      status: String(r[cols.idxStatus] || '').trim() || 'รอดำเนินการ',
      equipmentType,
      sheetName,
      rowNumber: i + 1,
    });
  }

  return jobs;
}

export function jobToRowByHeaders(job, headerCells = []) {
  if (!headerCells || headerCells.length === 0) {
    return jobToRow(job);
  }
  const cols = resolveColumnMap(headerCells);
  const maxIdx = Math.max(
    headerCells.length - 1,
    cols.idxDate,
    cols.idxModel,
    cols.idxSn,
    cols.idxProblem,
    cols.idxReporter,
    cols.idxDetails,
    cols.idxStatus,
    cols.idxEquipment
  );
  const row = new Array(maxIdx + 1).fill('');
  row[cols.idxDate] = job.timestamp || '';
  row[cols.idxModel] = job.model || '';
  row[cols.idxSn] = job.sn || '';
  row[cols.idxProblem] = job.problem || '';
  row[cols.idxReporter] = job.reporter || '';
  row[cols.idxDetails] = job.details || '';
  row[cols.idxStatus] = job.status || 'รอดำเนินการ';
  row[cols.idxEquipment] = job.equipmentType || 'Ultrasound';
  return row;
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
