function json(statusCode, payload) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    },
    body: JSON.stringify(payload)
  };
}

function encPath(path) {
  return String(path || '').split('/').map(encodeURIComponent).join('/');
}

function secretKey() {
  return String(
    process.env.SLIP_VIEW_SECRET ||
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.EASYSLIP_API_KEY ||
    ''
  );
}

function b64url(value) {
  return Buffer.from(value).toString('base64url');
}

function verifyToken(token) {
  const secret = secretKey();
  if (!secret) throw new Error('ยังไม่ได้ตั้งค่า secret สำหรับดูสลิปย้อนหลัง');
  const parts = String(token || '').split('.');
  if (parts.length !== 2) throw new Error('ลิงก์ดูสลิปไม่ถูกต้อง');
  const crypto = require('crypto');
  const expected = crypto.createHmac('sha256', secret).update(parts[0]).digest('base64url');
  const a = Buffer.from(expected);
  const b = Buffer.from(parts[1]);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error('ลิงก์ดูสลิปไม่ถูกต้องหรือหมดอายุ');
  const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  if (!payload.exp || Date.now() > Number(payload.exp)) throw new Error('ลิงก์ดูสลิปหมดอายุ กรุณาเปิดรายการย้อนหลังใหม่');
  return payload;
}

function adminToken(id, exp) {
  const crypto = require('crypto');
  const secret = secretKey();
  if (!secret) throw new Error('ยังไม่ได้ตั้งค่า secret สำหรับดูสลิปย้อนหลัง');
  const payload = b64url(JSON.stringify({ id, exp }));
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function getBearer(event) {
  const raw = event?.headers?.authorization || event?.headers?.Authorization || '';
  const m = String(raw).match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : '';
}

async function readJson(resp) {
  const text = await resp.text();
  let data = null;
  try { data = JSON.parse(text); } catch (_) {}
  return { data, text };
}

async function isAdmin(base, serviceKey, accessToken) {
  if (!accessToken) return false;
  const userResp = await fetch(`${base}/auth/v1/user`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }
  });
  const user = await readJson(userResp);
  if (!userResp.ok || !user.data?.id) return false;
  const uid = encodeURIComponent(user.data.id);
  const a = await fetch(`${base}/rest/v1/admin_users?select=user_id&user_id=eq.${uid}&is_active=eq.true&limit=1`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Accept: 'application/json' }
  });
  const aj = await readJson(a);
  return a.ok && Array.isArray(aj.data) && !!aj.data[0];
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return json(405, { ok: false, message: 'Method Not Allowed' });

  try {
    const base = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
    const serviceKey = String(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '');
    if (!base || !serviceKey) return json(500, { ok: false, message: 'ยังไม่ได้ตั้งค่า Supabase Secret Key ใน Netlify' });

    const qs = event.queryStringParameters || {};
    const token = String(qs.token || '');
    const payload = verifyToken(token);
   const okAdmin = await isAdmin(base, serviceKey, getBearer(event));

if (!okAdmin) {
  // อนุญาตการเปิดด้วย HMAC token ที่สร้างจาก admin-slips.js
  // เพราะการเปิดแท็บใหม่อาจไม่มี Authorization header
}
    // Normal browser opens do not carry Authorization headers. The HMAC token is only
    // minted by admin-slips after a verified admin request and expires quickly, so it can
    // be used as the second factor for viewing the private object.
    if (!payload.id) throw new Error('ลิงก์ดูสลิปไม่ถูกต้อง');

    const id = encodeURIComponent(payload.id);
    const r = await fetch(`${base}/rest/v1/slip_archive?select=storage_path,mime_type,original_filename&id=eq.${id}&limit=1`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Accept: 'application/json' }
    });
    const j = await readJson(r);
    if (!r.ok || !Array.isArray(j.data) || !j.data[0]) return json(404, { ok: false, message: 'ไม่พบสลิปย้อนหลังรายการนี้' });
    const row = j.data[0];
    if (!row.storage_path) return json(404, { ok: false, message: 'รายการนี้ไม่มีไฟล์สลิปต้นฉบับเก็บไว้' });

    const file = await fetch(`${base}/storage/v1/object/download/payment-slips/${encPath(row.storage_path)}`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
    });
    if (!file.ok) {
      const txt = await file.text();
      return json(file.status, { ok: false, message: 'ไม่สามารถเปิดไฟล์สลิปจาก Storage ได้', detail: txt });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    return {
      statusCode: 200,
      isBase64Encoded: true,
      headers: {
        'Content-Type': row.mime_type || file.headers.get('content-type') || 'image/jpeg',
        'Content-Disposition': `inline; filename="${String(row.original_filename || 'slip').replace(/[^a-zA-Z0-9._-]/g, '_')}"`,
        'Cache-Control': 'private, max-age=300'
      },
      body: buffer.toString('base64')
    };
  } catch (e) {
    return json(400, { ok: false, message: e?.message || 'เปิดสลิปย้อนหลังไม่สำเร็จ' });
  }
};

exports.createAdminViewToken = adminToken;
