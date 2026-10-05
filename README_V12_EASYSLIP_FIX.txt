Rose Account Installment – V12 EasySlip Fix

แก้ปัญหา EasySlip ขึ้นข้อความ:
"Please provide either a payload string, a image file, a base64 encoded image, or a image URL"

เปลี่ยน Netlify Function verify-slip.js ให้ส่งรูปสลิปไป EasySlip v2 ด้วย Base64 JSON แทน multipart FormData
เพื่อหลีกเลี่ยงปัญหา multipart boundary/Blob บน Netlify

ไม่ต้องรัน SQL ใหม่สำหรับการแก้รอบนี้
อัปโหลด/แทนที่เฉพาะ:
netlify/functions/verify-slip.js

หลัง Commit ให้รอ Netlify Published แล้วทดสอบใหม่
หมายเหตุ: ระบบจะหักยอดผ่อนเฉพาะเมื่อ EasySlip ตรวจผ่านและกฎรายการผ่อนผ่านเท่านั้น
