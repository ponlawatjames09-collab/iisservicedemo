import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0';

// Parse both application/json and text/plain JSON payloads (used by GAS fetch)
app.use(express.text({ type: 'text/plain' }));
app.use(express.json());

// In-memory store fallback when GAS_WEB_APP_URL is not configured with a live /exec endpoint
let nextRowBySheet = {
  Ultrasound: 3,
  Carm: 3,
};

const jobs = [
  {
    timestamp: new Date(Date.now() - 86400000).toLocaleString('th-TH'),
    equipmentType: 'Ultrasound',
    model: 'EPIQ7',
    sn: 'US-2024-001',
    problem: 'หัวตรวจ (Probe) มีสัญญาณรบกวนเป็นเส้น',
    reporter: 'แผนกรังสีวิทยา',
    status: 'กำลังซ่อมดำเนินการ',
    details: 'ตรวจสอบขั้วต่อ Probe และนัดเปลี่ยนสาย',
    sheetName: 'Ultrasound',
    rowNumber: 2,
  },
  {
    timestamp: new Date(Date.now() - 3600000 * 4).toLocaleString('th-TH'),
    equipmentType: 'Carm',
    model: 'Zenition 70FD15',
    sn: 'CM-2024-014',
    problem: 'หน้าจอมอนิเตอร์หลักไม่แสดงภาพหลังเปิดเครื่อง',
    reporter: 'ห้องผ่าตัด 3',
    status: 'รอดำเนินการ',
    details: '',
    sheetName: 'Carm',
    rowNumber: 2,
  },
];

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
      return res.json({ status: 'success', data: [...jobs].reverse() });
    }

    if (action === 'addJob') {
      const data = payload.data || {};
      const sheetName = data.equipmentType || 'General';
      const rowNumber = nextRowBySheet[sheetName] || 2;
      nextRowBySheet[sheetName] = rowNumber + 1;

      jobs.push({
        timestamp: new Date().toLocaleString('th-TH'),
        equipmentType: data.equipmentType || '',
        model: data.model || '',
        sn: data.sn || '',
        problem: data.problem || '',
        reporter: data.reporter || '',
        status: 'รอดำเนินการ',
        details: '',
        sheetName,
        rowNumber,
      });

      return res.json({ status: 'success', message: 'Success' });
    }

    if (action === 'updateJob') {
      const { sheetName, rowNumber, status, details } = payload;
      const target = jobs.find(
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

app.use(express.static(__dirname));

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}`);
});
