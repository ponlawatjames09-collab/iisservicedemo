import crypto from 'crypto';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  parseCsv,
  rowsToJobs,
  resolveColumnMap,
  columnIndexToLetter,
  jobToRowByHeaders,
} from './lib/csv.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DEFAULT_SPREADSHEET_ID =
  process.env.GOOGLE_SHEET_ID || '1IqXL30M0O23dkaQaP85iLRHuUH7IMxGEUs-cJyzEbkQ';

export const DEFAULT_GAS_WEB_APP_URL =
  'https://script.google.com/macros/s/AKfycbyjHnqrxzAW-5rLem5aNtR4oeBrQxAIE2F9Zrv0qIEcbiUS87jqd5nLmGUWMWblod5dIQ/exec';

const CSV_ASSET_PATH = path.join(
  __dirname,
  'public',
  'assets',
  'aistudio',
  'Report_Problem_Ultrasound___Carm_13c59d27'
);

let cachedServiceToken = { token: null, expiresAt: 0 };
let lastSheetError = null;

function loadCsvSeedJobs() {
  try {
    if (fs.existsSync(CSV_ASSET_PATH)) {
      const content = fs.readFileSync(CSV_ASSET_PATH, 'utf-8');
      return rowsToJobs(parseCsv(content), 'Sheet');
    }
  } catch (err) {
    console.warn('Failed to load initial CSV asset:', err.message);
  }
  return [];
}

async function fetchPublicSheetCsvJobs() {
  try {
    const exportUrl = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(DEFAULT_SPREADSHEET_ID)}/export?format=csv`;
    const upstream = await fetch(exportUrl, { redirect: 'follow' });
    const contentType = upstream.headers.get('content-type') || '';
    if (upstream.ok && contentType.includes('text/csv')) {
      const csvText = await upstream.text();
      const rows = parseCsv(csvText);
      if (rows.length > 0) {
        return { jobs: rowsToJobs(rows, 'Sheet'), source: 'public_sheet' };
      }
    }
  } catch {
    // fallback to attached seed asset
  }
  return { jobs: loadCsvSeedJobs(), source: 'local_seed' };
}

function formatThaiTimestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const d = pad(date.getDate());
  const m = pad(date.getMonth() + 1);
  const y = date.getFullYear();
  const hh = pad(date.getHours());
  const mm = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  return `${d}/${m}/${y} ${hh}:${mm}:${ss}`;
}

function base64UrlEncode(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'utf8');
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

/**
 * Escapes raw CR/LF control characters that appear inside JSON string literals
 * without altering structural whitespace outside strings.
 */
function escapeNewlinesInsideJsonStrings(jsonStr) {
  let out = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < jsonStr.length; i += 1) {
    const ch = jsonStr[i];
    if (inString) {
      if (escaped) {
        out += ch;
        escaped = false;
      } else if (ch === '\\') {
        out += ch;
        escaped = true;
      } else if (ch === '"') {
        out += ch;
        inString = false;
      } else if (ch === '\n') {
        out += '\\n';
      } else if (ch === '\r') {
        out += '\\r';
      } else {
        out += ch;
      }
    } else {
      if (ch === '"') inString = true;
      out += ch;
    }
  }
  return out;
}

function parseServiceAccountJson(rawInput) {
  if (!rawInput || typeof rawInput !== 'string') return { creds: null, error: 'Empty env var' };

  let text = rawInput.replace(/^\uFEFF/, '').trim();
  if (!text) return { creds: null, error: 'Empty env var' };

  if (
    (text.startsWith("'") && text.endsWith("'")) ||
    (text.startsWith('"') && text.endsWith('"'))
  ) {
    text = text.slice(1, -1).trim();
  }

  const candidates = [text, escapeNewlinesInsideJsonStrings(text)];

  if (text.includes('\\"')) {
    const unescaped = text.replace(/\\"/g, '"');
    candidates.push(unescaped, escapeNewlinesInsideJsonStrings(unescaped));
  }

  if (!text.startsWith('{')) {
    try {
      const decoded = Buffer.from(text, 'base64').toString('utf8').trim();
      if (decoded.startsWith('{')) {
        candidates.push(decoded, escapeNewlinesInsideJsonStrings(decoded));
      }
    } catch {
      // ignore base64 decode errors
    }
  }

  if (!text.startsWith('{') && text.includes('@') && !text.includes('private_key')) {
    return {
      creds: null,
      error: 'GOOGLE_SERVICE_ACCOUNT_JSON ต้องเป็นไฟล์ JSON Key (ขึ้นต้นด้วย { และมี private_key) ไม่ใช่อีเมล',
    };
  }

  let lastParseError = 'GOOGLE_SERVICE_ACCOUNT_JSON รูปแบบ JSON ไม่ถูกต้อง';
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object') {
        if (!parsed.client_email || !parsed.private_key) {
          lastParseError = 'GOOGLE_SERVICE_ACCOUNT_JSON ขาด client_email หรือ private_key';
          continue;
        }
        parsed.private_key = String(parsed.private_key).replace(/\\n/g, '\n');
        return { creds: parsed, error: null };
      }
    } catch {
      lastParseError = 'GOOGLE_SERVICE_ACCOUNT_JSON รูปแบบ JSON ไม่ถูกต้อง (กรุณาวางเนื้อหาไฟล์ JSON Key ทั้งหมด)';
    }
  }

  return { creds: null, error: lastParseError };
}

let lastGasDiagnostic = null;

function getSafeEnvDiagnostic() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '';
  const trimmed = raw.trim();
  const { error } = trimmed ? parseServiceAccountJson(raw) : { error: 'Not configured' };
  const rawGas = (process.env.GAS_WEB_APP_URL || '').trim();
  return {
    serviceAccountEnvSet: Boolean(trimmed),
    length: trimmed.length,
    startsWithBrace: trimmed.startsWith('{'),
    endsWithBrace: trimmed.endsWith('}'),
    hasClientEmailField: trimmed.includes('client_email'),
    hasPrivateKeyField: trimmed.includes('private_key'),
    parseError: error,
    hasGasWebAppUrl: Boolean(rawGas),
    gasStartsWithHttps: rawGas.startsWith('https://'),
    gasContainsExec: rawGas.includes('/exec'),
    gasContainsEdit: rawGas.includes('/edit'),
    lastGasDiagnostic,
    lastSheetError,
  };
}

async function getServiceAccountAccessToken() {
  const rawJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!rawJson || !rawJson.trim()) return { token: null, error: null };

  const now = Math.floor(Date.now() / 1000);
  if (cachedServiceToken.token && cachedServiceToken.expiresAt - 60 > now) {
    return { token: cachedServiceToken.token, error: null };
  }

  const { creds, error: parseErr } = parseServiceAccountJson(rawJson);
  if (!creds) {
    return { token: null, error: parseErr };
  }

  try {
    const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claimSet = base64UrlEncode(
      JSON.stringify({
        iss: creds.client_email,
        scope: 'https://www.googleapis.com/auth/spreadsheets',
        aud: 'https://oauth2.googleapis.com/token',
        exp: now + 3600,
        iat: now,
      })
    );

    const unsignedJwt = `${header}.${claimSet}`;
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(unsignedJwt);
    signer.end();
    const signature = base64UrlEncode(signer.sign(creds.private_key));
    const assertion = `${unsignedJwt}.${signature}`;

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }).toString(),
    });

    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.access_token) {
      return {
        token: null,
        error: tokenData.error_description || tokenData.error || 'Service account token request failed',
      };
    }

    cachedServiceToken = {
      token: tokenData.access_token,
      expiresAt: now + Number(tokenData.expires_in || 3600),
    };

    return { token: cachedServiceToken.token, error: null };
  } catch (err) {
    return { token: null, error: err.message };
  }
}

async function serviceReadJobs(token, requestedTab = '') {
  const metaRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(DEFAULT_SPREADSHEET_ID)}?fields=properties.title,sheets.properties.title`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const meta = await metaRes.json();
  if (!metaRes.ok) {
    throw new Error(meta.error?.message || 'ไม่สามารถอ่านข้อมูล Google Sheet ได้');
  }

  const sheetTitles = (meta.sheets || []).map((s) => s.properties.title);
  if (sheetTitles.length === 0) {
    return { title: meta.properties?.title || '', sheets: [], jobs: [] };
  }

  const tabsToFetch =
    requestedTab && requestedTab !== '__ALL__' && sheetTitles.includes(requestedTab)
      ? [requestedTab]
      : sheetTitles;

  const rangesQuery = tabsToFetch.map((t) => `ranges=${encodeURIComponent(`'${t}'!A:Z`)}`).join('&');
  const valuesRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(DEFAULT_SPREADSHEET_ID)}/values:batchGet?${rangesQuery}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const valuesData = await valuesRes.json();
  if (!valuesRes.ok) {
    throw new Error(valuesData.error?.message || 'ไม่สามารถอ่านแถวข้อมูลใน Google Sheet ได้');
  }

  const allJobs = [];
  (valuesData.valueRanges || []).forEach((vr, index) => {
    const tabName = tabsToFetch[index] || sheetTitles[0];
    allJobs.push(...rowsToJobs(vr.values || [], tabName));
  });

  return {
    title: meta.properties?.title || '',
    sheets: sheetTitles,
    jobs: [...allJobs].reverse(),
  };
}

async function serviceAppendJob(token, job, preferredTab = '') {
  const metaRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(DEFAULT_SPREADSHEET_ID)}?fields=sheets.properties.title`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const meta = await metaRes.json();
  if (!metaRes.ok) {
    throw new Error(meta.error?.message || 'ไม่สามารถอ่านแท็บของ Google Sheet ได้');
  }

  const sheetTitles = (meta.sheets || []).map((s) => s.properties.title);
  if (sheetTitles.length === 0) {
    throw new Error('ไม่พบแท็บชีตในไฟล์ Google Sheet');
  }

  let targetTab = sheetTitles[0];
  if (preferredTab && sheetTitles.includes(preferredTab)) {
    targetTab = preferredTab;
  } else if (job.equipmentType && sheetTitles.includes(job.equipmentType)) {
    targetTab = job.equipmentType;
  }

  const headerRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(DEFAULT_SPREADSHEET_ID)}/values/${encodeURIComponent(`'${targetTab}'!1:1`)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const headerData = await headerRes.json();
  const headerCells = (headerData.values && headerData.values[0]) || [];

  const rowValues = jobToRowByHeaders(
    {
      timestamp: job.timestamp || formatThaiTimestamp(),
      model: job.model || '',
      sn: job.sn || '',
      problem: job.problem || '',
      reporter: job.reporter || '',
      details: job.details || '',
      status: job.status || 'รอดำเนินการ',
      equipmentType: job.equipmentType || 'Ultrasound',
    },
    headerCells
  );

  const appendRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(DEFAULT_SPREADSHEET_ID)}/values/${encodeURIComponent(`'${targetTab}'!A1`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values: [rowValues] }),
    }
  );
  const appendData = await appendRes.json();
  if (!appendRes.ok) {
    throw new Error(appendData.error?.message || 'ไม่สามารถเพิ่มข้อมูลลง Google Sheet ได้');
  }

  return { targetTab, appendData };
}

async function serviceUpdateJob(token, { sheetName, rowNumber, status, details }) {
  const metaRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(DEFAULT_SPREADSHEET_ID)}?fields=sheets.properties.title`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const meta = await metaRes.json();
  if (!metaRes.ok) {
    throw new Error(meta.error?.message || 'ไม่สามารถอ่านรายชื่อแท็บของ Google Sheet ได้');
  }
  const sheetTitles = (meta.sheets || []).map((s) => s.properties.title);
  if (sheetTitles.length === 0) {
    throw new Error('ไม่พบแท็บชีตในไฟล์ Google Sheet');
  }
  const targetTab = sheetName && sheetTitles.includes(sheetName) ? sheetName : sheetTitles[0];

  const headerRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(DEFAULT_SPREADSHEET_ID)}/values/${encodeURIComponent(`'${targetTab}'!1:1`)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const headerData = await headerRes.json();
  if (!headerRes.ok) {
    throw new Error(headerData.error?.message || 'ไม่สามารถอ่านหัวตารางของ Google Sheet ได้');
  }

  const headerCells = (headerData.values && headerData.values[0]) || [];
  const cols = resolveColumnMap(headerCells);
  const detailsColLetter = columnIndexToLetter(cols.idxDetails);
  const statusColLetter = columnIndexToLetter(cols.idxStatus);
  const rowNum = Number(rowNumber);

  const batchRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(DEFAULT_SPREADSHEET_ID)}/values:batchUpdate`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        valueInputOption: 'USER_ENTERED',
        data: [
          { range: `'${targetTab}'!${detailsColLetter}${rowNum}`, values: [[details || '']] },
          { range: `'${targetTab}'!${statusColLetter}${rowNum}`, values: [[status || 'รอดำเนินการ']] },
        ],
      }),
    }
  );
  const batchData = await batchRes.json();
  if (!batchRes.ok) {
    throw new Error(batchData.error?.message || 'ไม่สามารถอัปเดตข้อมูลใน Google Sheet ได้');
  }
  return batchData;
}

function parseThaiTimestampMs(ts) {
  const match = String(ts || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!match) return 0;
  const day = Number(match[1]);
  const month = Number(match[2]) - 1;
  let year = Number(match[3]);
  if (year > 2400) year -= 543;
  const hour = Number(match[4] || 0);
  const minute = Number(match[5] || 0);
  const second = Number(match[6] || 0);
  return new Date(year, month, day, hour, minute, second).getTime() || 0;
}

function getGasWebAppInfo() {
  let raw = (process.env.GAS_WEB_APP_URL || '').trim();
  if (
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    raw = raw.slice(1, -1).trim();
  }

  if (raw && raw.startsWith('https://') && raw.includes('/exec') && !raw.includes('/edit')) {
    return { url: raw, error: null };
  }

  if (DEFAULT_GAS_WEB_APP_URL) {
    return { url: DEFAULT_GAS_WEB_APP_URL, error: null };
  }

  if (!raw) return { url: null, error: null };
  if (raw.includes('/edit')) {
    return {
      url: null,
      error:
        'GAS_WEB_APP_URL เป็นลิงก์หน้าแก้ไขโค้ด (/edit) กรุณา Deploy เป็น Web App (สิทธิ์ Anyone) แล้วนำลิงก์ที่ลงท้ายด้วย /exec มาใส่แทน',
    };
  }
  if (!raw.startsWith('https://')) {
    return { url: null, error: 'GAS_WEB_APP_URL ต้องขึ้นต้นด้วย https://' };
  }
  if (!raw.includes('/exec')) {
    return {
      url: null,
      error: 'GAS_WEB_APP_URL ต้องเป็นลิงก์ Web App ที่ลงท้ายด้วย /exec',
    };
  }

  return { url: raw, error: null };
}

async function callGasWebApp(gasUrl, payload) {
  const upstream = await fetch(gasUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload),
    redirect: 'follow',
  });

  const contentType = upstream.headers.get('content-type') || '';
  const rawText = await upstream.text();
  const trimmed = rawText.trim();

  lastGasDiagnostic = {
    action: payload?.action || '',
    httpStatus: upstream.status,
    ok: upstream.ok,
    contentType,
    bodyPreview: trimmed.slice(0, 140).replace(/\s+/g, ' '),
  };

  if (trimmed.startsWith('<') || contentType.includes('text/html')) {
    if (trimmed.includes('ServiceLogin') || trimmed.includes('accounts.google.com')) {
      throw new Error(
        'Google Apps Script Web App ถูกจำกัดสิทธิ์ กรุณาตั้งค่า "Who has access" เป็น "Anyone" แล้ว Deploy ใหม่'
      );
    }
    if (trimmed.includes('Script function not found') || trimmed.includes('doPost')) {
      throw new Error('Google Apps Script ยังไม่มีฟังก์ชัน doPost(e) หรือยังไม่ได้ Deploy เวอร์ชันล่าสุด');
    }
    throw new Error(`Google Apps Script ส่งกลับหน้า HTML แทน JSON (HTTP ${upstream.status})`);
  }

  let parsed = null;
  let isJson = false;
  try {
    parsed = JSON.parse(trimmed);
    isJson = true;
  } catch {
    isJson = false;
  }

  if (isJson) {
    if (Array.isArray(parsed)) {
      return { status: 'success', data: parsed };
    }
    if (parsed && typeof parsed === 'object') {
      const statusLower = String(parsed.status || parsed.result || '').toLowerCase();
      if (statusLower === 'error') {
        throw new Error(parsed.message || parsed.error || 'Apps Script แจ้งข้อผิดพลาด');
      }
      if (
        statusLower === 'success' ||
        parsed.ok === true ||
        String(parsed.message || '').toLowerCase() === 'success' ||
        Array.isArray(parsed.data)
      ) {
        return parsed;
      }
      throw new Error(`คำตอบ JSON จาก Apps Script ไม่ตรงรูปแบบ: ${trimmed.slice(0, 100)}`);
    }
  }

  const lower = trimmed.toLowerCase();
  if (upstream.ok && (lower === 'success' || lower === 'ok' || lower.includes('success'))) {
    return { status: 'success', message: trimmed || 'Success' };
  }

  throw new Error(`Apps Script ตอบกลับ HTTP ${upstream.status}: ${trimmed.slice(0, 100)}`);
}

export function createApp() {
  const app = express();

  app.use(express.text({ type: 'text/plain', limit: '5mb' }));
  app.use(express.json({ limit: '5mb' }));

  app.get('/api/health', async (_req, res) => {
    const gas = getGasWebAppInfo();
    const svc = await getServiceAccountAccessToken();
    const mode = svc.token
      ? 'service_account'
      : gas.url
        ? 'gas_webapp'
        : 'public_sheet_readonly';
    res.json({
      status: 'ok',
      spreadsheetId: DEFAULT_SPREADSHEET_ID,
      sheetTitle: 'Report Problem Ultrasound & Carm',
      mode,
      diagnostic: getSafeEnvDiagnostic(),
    });
  });

  app.get('/api/jobs', async (req, res) => {
    try {
      const readErrors = [];

      const svc = await getServiceAccountAccessToken();
      if (svc.token) {
        try {
          const result = await serviceReadJobs(svc.token, String(req.query.tab || ''));
          lastSheetError = null;
          return res.json({
            status: 'success',
            mode: 'service_account',
            writeReady: true,
            spreadsheetId: DEFAULT_SPREADSHEET_ID,
            title: result.title || 'Report Problem Ultrasound & Carm',
            sheets: result.sheets,
            data: result.jobs,
          });
        } catch (err) {
          lastSheetError = err.message;
          readErrors.push(`Service Account: ${err.message}`);
        }
      } else if (svc.error) {
        lastSheetError = svc.error;
        readErrors.push(svc.error);
      }

      const gas = getGasWebAppInfo();
      if (gas.url) {
        try {
          let data = await callGasWebApp(gas.url, {
            action: 'getJobs',
            spreadsheetId: DEFAULT_SPREADSHEET_ID,
          });
          if (!data || !Array.isArray(data.data)) {
            const getUrl = `${gas.url}${gas.url.includes('?') ? '&' : '?'}action=getJobs&spreadsheetId=${encodeURIComponent(DEFAULT_SPREADSHEET_ID)}`;
            const getRes = await fetch(getUrl, { redirect: 'follow' });
            const getText = (await getRes.text()).trim();
            try {
              const getParsed = JSON.parse(getText);
              if (Array.isArray(getParsed)) {
                data = { status: 'success', data: getParsed };
              } else if (getParsed && Array.isArray(getParsed.data)) {
                data = getParsed;
              }
            } catch {
              // ignore non-JSON GET fallback
            }
          }
          if (data && Array.isArray(data.data)) {
            lastSheetError = null;
            const normalized = data.data.map((row, idx) => ({
              timestamp: String(row.timestamp ?? row.date ?? row.Date ?? '').trim(),
              model: String(row.model ?? row.Model ?? '').trim(),
              sn: String(row.sn ?? row['S/N'] ?? '').trim(),
              problem: String(row.problem ?? row.Problem ?? '').trim(),
              reporter: String(row.reporter ?? row.Reporter ?? '').trim(),
              details: String(row.details ?? row['Service / update'] ?? '').trim(),
              status: String(row.status ?? row.Status ?? 'รอดำเนินการ').trim() || 'รอดำเนินการ',
              equipmentType: String(row.equipmentType ?? row.equipment ?? row.Equipment ?? 'Ultrasound').trim() || 'Ultrasound',
              sheetName: String(row.sheetName || 'Sheet'),
              rowNumber: Number(row.rowNumber) || idx + 2,
            }));
            normalized.sort((a, b) => parseThaiTimestampMs(b.timestamp) - parseThaiTimestampMs(a.timestamp));
            const discoveredSheets = Array.isArray(data.sheets) && data.sheets.length > 0
              ? data.sheets
              : [...new Set(normalized.map((r) => r.sheetName).filter(Boolean))];
            const requestedTab = String(req.query.tab || '').trim();
            const filtered =
              requestedTab && requestedTab !== '__ALL__'
                ? normalized.filter((r) => r.sheetName === requestedTab)
                : normalized;
            return res.json({
              status: 'success',
              mode: 'gas_webapp',
              writeReady: true,
              spreadsheetId: DEFAULT_SPREADSHEET_ID,
              title: data.title || 'Report Problem Ultrasound & Carm',
              sheets: discoveredSheets,
              data: filtered,
            });
          }
        } catch (err) {
          lastSheetError = err.message;
          readErrors.push(`Apps Script: ${err.message}`);
        }
      } else if (gas.error) {
        lastSheetError = gas.error;
        readErrors.push(gas.error);
      }

      const { jobs, source } = await fetchPublicSheetCsvJobs();
      return res.json({
        status: 'success',
        mode: source === 'public_sheet' ? 'public_sheet_readonly' : 'local_seed_readonly',
        writeReady: Boolean(gas.url),
        spreadsheetId: DEFAULT_SPREADSHEET_ID,
        title: 'Report Problem Ultrasound & Carm',
        warning: readErrors.length > 0 ? readErrors.join(' | ') : null,
        data: [...jobs].reverse(),
      });
    } catch (error) {
      return res.status(500).json({ status: 'error', message: error.message || 'Internal Server Error' });
    }
  });

  app.post('/api/jobs', async (req, res) => {
    try {
      const { data: formData = {}, sheetName = '' } = req.body || {};
      const writeErrors = [];

      const svc = await getServiceAccountAccessToken();
      if (svc.token) {
        try {
          const result = await serviceAppendJob(svc.token, formData, sheetName);
          lastSheetError = null;
          return res.json({
            status: 'success',
            mode: 'service_account',
            syncedToSheet: true,
            targetTab: result.targetTab,
            message: 'Success',
          });
        } catch (err) {
          lastSheetError = err.message;
          writeErrors.push(`Service Account: ${err.message}`);
        }
      } else if (svc.error) {
        lastSheetError = svc.error;
        writeErrors.push(svc.error);
      }

      const gas = getGasWebAppInfo();
      if (gas.url) {
        try {
          const data = await callGasWebApp(gas.url, {
            action: 'addJob',
            spreadsheetId: DEFAULT_SPREADSHEET_ID,
            sheetName,
            data: formData,
          });
          lastSheetError = null;
          return res.json({
            ...data,
            status: 'success',
            mode: 'gas_webapp',
            syncedToSheet: true,
            message: data.message || 'Success',
          });
        } catch (err) {
          lastSheetError = err.message;
          writeErrors.push(`Apps Script: ${err.message}`);
        }
      } else if (gas.error) {
        lastSheetError = gas.error;
        writeErrors.push(gas.error);
      }

      const reason =
        writeErrors.length > 0
          ? writeErrors.join(' | ')
          : 'ยังไม่ได้ตั้งค่า GAS_WEB_APP_URL (/exec) หรือ GOOGLE_SERVICE_ACCOUNT_JSON';

      return res.status(400).json({
        status: 'error',
        syncedToSheet: false,
        message: `ไม่สามารถบันทึกลง Google Sheet ได้: ${reason}`,
      });
    } catch (error) {
      return res.status(500).json({ status: 'error', message: error.message || 'Internal Server Error' });
    }
  });

  app.put('/api/jobs', async (req, res) => {
    try {
      const { sheetName = 'Sheet', rowNumber, status, details } = req.body || {};
      const writeErrors = [];

      const svc = await getServiceAccountAccessToken();
      if (svc.token) {
        try {
          await serviceUpdateJob(svc.token, { sheetName, rowNumber, status, details });
          lastSheetError = null;
          return res.json({
            status: 'success',
            mode: 'service_account',
            syncedToSheet: true,
            message: 'Success',
          });
        } catch (err) {
          lastSheetError = err.message;
          writeErrors.push(`Service Account: ${err.message}`);
        }
      } else if (svc.error) {
        lastSheetError = svc.error;
        writeErrors.push(svc.error);
      }

      const gas = getGasWebAppInfo();
      if (gas.url) {
        try {
          const data = await callGasWebApp(gas.url, {
            action: 'updateJob',
            spreadsheetId: DEFAULT_SPREADSHEET_ID,
            sheetName,
            rowNumber,
            status,
            details,
          });
          lastSheetError = null;
          return res.json({
            ...data,
            status: 'success',
            mode: 'gas_webapp',
            syncedToSheet: true,
            message: data.message || 'Success',
          });
        } catch (err) {
          lastSheetError = err.message;
          writeErrors.push(`Apps Script: ${err.message}`);
        }
      } else if (gas.error) {
        lastSheetError = gas.error;
        writeErrors.push(gas.error);
      }

      const reason =
        writeErrors.length > 0
          ? writeErrors.join(' | ')
          : 'ยังไม่ได้ตั้งค่า GAS_WEB_APP_URL (/exec) หรือ GOOGLE_SERVICE_ACCOUNT_JSON';

      return res.status(400).json({
        status: 'error',
        syncedToSheet: false,
        message: `ไม่สามารถอัปเดตข้อมูลลง Google Sheet ได้: ${reason}`,
      });
    } catch (error) {
      return res.status(500).json({ status: 'error', message: error.message || 'Internal Server Error' });
    }
  });

  app.use('/public', express.static(path.join(__dirname, 'public')));
  app.use('/assets', express.static(path.join(__dirname, 'public', 'assets')));
  app.use(express.static(__dirname, { index: false }));

  app.get('*', (_req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
  });

  return app;
}
