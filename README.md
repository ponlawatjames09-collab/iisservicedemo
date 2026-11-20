# ระบบแจ้งซ่อม Ultrasound & Carm (IIS Service)

เว็บแอปพลิเคชันสำหรับบันทึกและติดตามสถานะการแจ้งซ่อมเครื่อง Ultrasound & Carm พร้อมข้อมูลตั้งต้นจากไฟล์ CSV (`public/assets/aistudio/Report_Problem_Ultrasound___Carm_13c59d27`) และรองรับการ Deploy บน **GitHub + Vercel**

## คุณสมบัติหลัก
- โหลดข้อมูลประวัติการแจ้งซ่อมตั้งต้นทั้งหมดจากไฟล์ CSV (`Report_Problem_Ultrasound___Carm`)
- แจ้งซ่อมใหม่และอัปเดตสถานะ / รายละเอียดการแก้ไข พร้อมตัวกรองตามชนิดเครื่อง, สถานะ และคำค้นหา
- รองรับการเชื่อมต่อกับ Google Apps Script Web App (`/exec`) ผ่านตัวแปรสภาพแวดล้อม `GAS_WEB_APP_URL`
- ส่งออกข้อมูลเป็นไฟล์ CSV (`UTF-8 BOM` รองรับภาษาไทยใน Excel)

## การรันในเครื่อง (Local Development)
```bash
npm install
npm run dev
```
เปิดเบราว์เซอร์ไปที่ `http://localhost:3000`

## การเชื่อมต่อ GitHub และ Deploy ขึ้น Vercel
1. **Push โค้ดขึ้น GitHub**:
   ```bash
   git init
   git add .
   git commit -m "Initial commit: IIS Service Ultrasound & Carm repair portal"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<your-repo>.git
   git push -u origin main
   ```
2. **Import โปรเจกต์ใน Vercel**:
   - เข้า [vercel.com](https://vercel.com) → **Add New Project** → เลือก Repository จาก GitHub
   - Vercel จะใช้ `vercel.json` และ `api/index.js` โดยอัตโนมัติ
   - (ไม่บังคับ) หากมี Google Apps Script Web App (`/exec`) สามารถเพิ่ม `GAS_WEB_APP_URL` ใน Environment Variables ของ Vercel ได้
