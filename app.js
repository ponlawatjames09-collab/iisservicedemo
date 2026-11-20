import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseCsv, rowsToJobs } from './lib/csv.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CSV_ASSET_PATH = path.join(
  __dirname,
  'public',
  'assets',
  'aistudio',
  'Report_Problem_Ultrasound___Carm_13c59d27'
);

function loadInitialJobs() {
  try {
    if (fs.existsSync(CSV_ASSET_PATH)) {
      const content = fs.readFileSync(CSV_ASSET_PATH, 'utf-8');
      const parsed = parseCsv(content);
      return rowsToJobs(parsed, 'LocalDriveCSV');
    }
  } catch (err) {
    console.warn('Failed to load initial CSV asset:', err.message);
  }
  return [];
}

let inMemoryJobs = loadInitialJobs();
let nextLocalRow = inMemoryJobs.length + 2;

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

export function createApp() {
  const app = express();

  app.use(express.text({ type: 'text/plain', limit: '5mb' }));
  app.use(express.json({ limit: '5mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', seededJobs: inMemoryJobs.length });
  });

  // Local / GAS API (seeded from attached CSV asset)
  app.post('/api/gas', async (req, res) => {
    try {
      const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const gasUrl = process.env.GAS_WEB_APP_URL;

      if (gasUrl && gasUrl.endsWith('/exec')) {
        const upstream = await fetch(gasUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(payload),
        });
        const data = await upstream.json();
        return res.json(data);
      }

      const { action } = payload || {};

      if (action === 'getJobs') {
        return res.json({ status: 'success', data: [...inMemoryJobs].reverse() });
      }

      if (action === 'addJob') {
        const data = payload.data || {};
        const rowNumber = nextLocalRow;
        nextLocalRow += 1;

        const newJob = {
          timestamp: formatThaiTimestamp(),
          equipmentType: data.equipmentType || 'Ultrasound',
          model: data.model || '',
          sn: data.sn || '',
          problem: data.problem || '',
          reporter: data.reporter || '',
          status: 'รอดำเนินการ',
          details: '',
          sheetName: 'LocalDriveCSV',
          rowNumber,
        };
        inMemoryJobs.push(newJob);

        return res.json({ status: 'success', message: 'Success', data: newJob });
      }

      if (action === 'updateJob') {
        const { sheetName, rowNumber, status, details } = payload;
        const target = inMemoryJobs.find(
          (job) => job.sheetName === sheetName && Number(job.rowNumber) === Number(rowNumber)
        );
        if (!target) {
          return res.status(404).json({ status: 'error', message: 'ไม่พบรายการแจ้งซ่อม' });
        }
        target.status = status;
        target.details = details || '';
        return res.json({ status: 'success', message: 'Success' });
      }

      return res.status(400).json({ status: 'error', message: 'Unsupported action' });
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
