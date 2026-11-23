# ระบบแจ้งซ่อม Ultrasound & Carm เครื่อง DEMO (IIS Service)

เว็บแอปพลิเคชันสำหรับบันทึกและติดตามสถานะการแจ้งซ่อมเครื่อง Ultrasound & Carm เครื่อง DEMO พร้อมดึงข้อมูลจาก Google Sheet (`1IqXL30M0O23dkaQaP85iLRHuUH7IMxGEUs-cJyzEbkQ`) และบันทึก/อัปเดตได้ทันทีโดย **ไม่ต้องเข้าสู่ระบบ (No Login Required)**

## การเชื่อมต่อ Google Sheet แบบบันทึกได้โดยไม่ต้อง Login
แอปดึงข้อมูลล่าสุดจาก Google Sheet `1IqXL30M0O23dkaQaP85iLRHuUH7IMxGEUs-cJyzEbkQ` ให้อัตโนมัติ และหากต้องการให้การบันทึก/อัปเดตเขียนกลับลง Google Sheet โดยตรงโดยไม่ต้องให้ผู้ใช้งานล็อกอิน สามารถตั้งค่าได้ 1 ใน 2 วิธีใน Environment Variables (ทั้งในเครื่องหรือใน Vercel):

### วิธีที่ 1: ใช้ Google Apps Script Web App (`GAS_WEB_APP_URL`)
1. เปิด Google Sheet `1IqXL30M0O23dkaQaP85iLRHuUH7IMxGEUs-cJyzEbkQ` → **ส่วนขยาย (Extensions)** → **Apps Script**
2. วางโค้ดด้านล่าง แล้วกด **Deploy → New deployment → Web app** (Execute as: **Me**, Who has access: **Anyone**) แล้วนำ URL `/exec` มาใส่ใน `GAS_WEB_APP_URL`:
```javascript
function formatCellDate(val) {
  if (val instanceof Date) {
    return Utilities.formatDate(val, 'Asia/Bangkok', 'dd/MM/yyyy HH:mm:ss');
  }
  return String(val || '');
}

function doPost(e) {
  var req = JSON.parse(e.postData.contents || '{}');
  var ss = SpreadsheetApp.openById('1IqXL30M0O23dkaQaP85iLRHuUH7IMxGEUs-cJyzEbkQ');
  var sheet = (req.sheetName && ss.getSheetByName(req.sheetName)) || ss.getSheets()[0];

  if (req.action === 'getJobs') {
    var rows = sheet.getDataRange().getValues();
    var jobs = [];
    for (var i = 1; i < rows.length; i++) {
      if (!rows[i].join('').trim()) continue;
      jobs.push({
        timestamp: formatCellDate(rows[i][0]),
        model: String(rows[i][1] || ''),
        sn: String(rows[i][2] || ''),
        problem: String(rows[i][3] || ''),
        reporter: String(rows[i][4] || ''),
        details: String(rows[i][5] || ''),
        status: String(rows[i][6] || 'รอดำเนินการ'),
        equipmentType: String(rows[i][7] || 'Ultrasound'),
        sheetName: sheet.getName(),
        rowNumber: i + 1
      });
    }
    return ContentService.createTextOutput(JSON.stringify({ status: 'success', data: jobs.reverse() }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (req.action === 'addJob') {
    var d = req.data || {};
    var now = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'dd/MM/yyyy HH:mm:ss');
    sheet.appendRow([now, d.model || '', d.sn || '', d.problem || '', d.reporter || '', '', 'รอดำเนินการ', d.equipmentType || 'Ultrasound']);
    return ContentService.createTextOutput(JSON.stringify({ status: 'success', message: 'Success' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (req.action === 'updateJob') {
    var row = Number(req.rowNumber);
    sheet.getRange(row, 6).setValue(req.details || '');
    sheet.getRange(row, 7).setValue(req.status || 'รอดำเนินการ');
    return ContentService.createTextOutput(JSON.stringify({ status: 'success', message: 'Success' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: 'Unknown action' }))
    .setMimeType(ContentService.MimeType.JSON);
}
```

### วิธีที่ 2: ใช้ Google Service Account (`GOOGLE_SERVICE_ACCOUNT_JSON`)
- สร้าง Service Account ใน Google Cloud (เปิด Google Sheets API) และแชร์ Google Sheet `1IqXL30M0O23dkaQaP85iLRHuUH7IMxGEUs-cJyzEbkQ` ให้กับอีเมล Service Account เป็น **Editor**
- นำ JSON Key มาใส่ในตัวแปรสภาพแวดล้อม `GOOGLE_SERVICE_ACCOUNT_JSON` บน Vercel

## การ Deploy ขึ้น GitHub & Vercel
```bash
npm install
npm run dev
```
Push โค้ดขึ้น GitHub และ Import ใน Vercel (`vercel.json` + `api/index.js` พร้อมใช้งานทันที)
