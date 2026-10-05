Rose Account Installment – Deploy v6

ชุดนี้ตัด dependency busboy ออกจาก verify-slip.js แล้ว ใช้ parser แบบ built-in ของ Node เพื่อให้ Deploy แบบ ZIP/Manual ไม่ต้องมี node_modules เพิ่ม

Deploy:
1) ใช้ ZIP นี้บน Netlify
2) ไม่ต้องรัน npm install สำหรับชุดนี้
3) Environment Variables เดิมของ Netlify ต้องมี SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (หรือ SUPABASE_SECRET_KEY) และ EASYSLIP_API_KEY
4) Supabase SQL 09, 10, 11, 12, 13 ที่รันไปแล้วไม่ต้องรันซ้ำเพราะการ Deploy ไม่ได้แตะฐานข้อมูล
