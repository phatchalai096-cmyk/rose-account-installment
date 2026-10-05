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

function clean(v) { return String(v ?? '').trim(); }
function encodePath(path) {
  return String(path || '').split('/').map(encodeURIComponent).join('/');
}
function getBearer(event) {
  const h = event?.headers || {};
  const raw = h.authorization || h.Authorization || '';
  const m = String(raw).match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : String(raw).trim();
}
async function readJson(resp) {
  const text = await resp.text();
  let data = null;
  try { data = JSON.parse(text); } catch (_) {}
  return { data, text };
}

function makeViewToken(id) {
  const crypto = require('crypto');
  const secret = String(
    process.env.SLIP_VIEW_SECRET ||
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.EASYSLIP_API_KEY || ''
  );
  if (!secret) throw new Error('ยังไม่ได้ตั้งค่า secret สำหรับดูสลิปย้อนหลัง');
  const payload = Buffer.from(JSON.stringify({ id: String(id), exp: Date.now() + 3600000 })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function authHeaders(key, token) {
  return {
    apikey: key,
    Authorization: `Bearer ${token || key}`,
    Accept: 'application/json'
  };
}

async function isAdmin(base, serviceKey, accessToken) {
  if (!accessToken) return { ok: false, status: 401, message: 'กรุณาเข้าสู่ระบบหลังบ้าน' };

  const userResp = await fetch(`${base}/auth/v1/user`, {
    headers: authHeaders(serviceKey, accessToken)
  });
  const userJson = await readJson(userResp);
  if (!userResp.ok || !userJson.data?.id) {
    return { ok: false, status: 401, message: 'เซสชันหลังบ้านหมดอายุ กรุณาเข้าสู่ระบบใหม่' };
  }

  const uid = encodeURIComponent(userJson.data.id);
  const adminResp = await fetch(
    `${base}/rest/v1/admin_users?select=user_id,email,is_active&user_id=eq.${uid}&is_active=eq.true&limit=1`,
    { headers: authHeaders(serviceKey, serviceKey) }
  );
  const adminJson = await readJson(adminResp);
  if (!adminResp.ok) {
    return { ok: false, status: 500, message: `ตรวจสอบสิทธิ์ Admin ไม่สำเร็จ: ${adminJson.text || adminResp.statusText}` };
  }
  if (!Array.isArray(adminJson.data) || !adminJson.data[0]) {
    return { ok: false, status: 403, message: 'บัญชีนี้ไม่มีสิทธิ์ดูสลิปย้อนหลัง' };
  }

  return { ok: true, user: userJson.data, admin: adminJson.data[0] };
}

async function signPath(base, serviceKey, path) {
  if (!path) return { url: null, error: null };
  const encoded = encodePath(path);
  const resp = await fetch(`${base}/storage/v1/object/sign/payment-slips/${encoded}`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ expiresIn: 3600 })
  });
  const out = await readJson(resp);
  const signed = out.data?.signedURL || out.data?.signedUrl || null;
  if (!resp.ok || !signed) {
    return { url: null, error: out.text || resp.statusText || 'ไม่สามารถสร้างลิงก์ดูสลิป' };
  }
  return {
    url: String(signed).startsWith('http') ? signed : `${base}${signed}`,
    error: null
  };
}

async function getArchiveRows(base, serviceKey, q, limit) {
  const params = new URLSearchParams();
  params.set('select', '*');
  params.set('order', 'created_at.desc');
  params.set('limit', String(limit));
  if (q) {
    const safe = q.replace(/[(),*]/g, ' ').replace(/\s+/g, ' ').trim();
    if (safe) {
      params.set('or', `(customer_code.ilike.*${safe}*,reference.ilike.*${safe}*,payer_name.ilike.*${safe}*,receiver_name.ilike.*${safe}*)`);
    }
  }
  return fetch(`${base}/rest/v1/slip_archive?${params.toString()}`, {
    headers: authHeaders(serviceKey, serviceKey)
  });
}

async function getPaymentRows(base, serviceKey, q, limit) {
  const params = new URLSearchParams();
  params.set('select', '*');
  params.set('order', 'created_at.desc');
  params.set('limit', String(limit));
  if (q) {
    const safe = q.replace(/[(),*]/g, ' ').replace(/\s+/g, ' ').trim();
    if (safe) {
      params.set('or', `(reference.ilike.*${safe}*,payer_name.ilike.*${safe}*,receiver_name.ilike.*${safe}*)`);
    }
  }
  return fetch(`${base}/rest/v1/payment_submissions?${params.toString()}`, {
    headers: authHeaders(serviceKey, serviceKey)
  });
}

function mapPaymentFallback(row) {
  return {
    id: `payment-${row.id}`,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    storage_path: null,
    original_filename: null,
    mime_type: null,
    size_bytes: null,
    customer_code: row.customer_code || null,
    customer_id: row.customer_id || null,
    installment_plan_id: row.installment_plan_id || null,
    product_id: row.product_id || null,
    payment_submission_id: row.id || null,
    reference: row.reference || null,
    payer_name: row.payer_name || null,
    receiver_name: row.receiver_name || null,
    receiver_bank: row.receiver_bank || null,
    amount: row.amount ?? null,
    date_time: row.date_time || row.transfer_datetime || null,
    status: row.status || null,
    rule_status: row.rule_status || null,
    violation_reason: row.violation_reason || null,
    easyslip_response: row.easyslip_response || null,
    view_url: null,
    history_source: 'payment_submissions'
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return json(405, { ok: false, message: 'Method Not Allowed' });

  try {
    const base = clean(process.env.SUPABASE_URL).replace(/\/$/, '');
    const serviceKey = clean(
      process.env.SUPABASE_SECRET_KEY ||
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SERVICE_KEY ||
      process.env.SUPABASE_SERVICE_ROLE
    );
    if (!base || !serviceKey) return json(500, { ok: false, message: 'ยังไม่ได้ตั้งค่า Supabase Secret Key ใน Netlify' });

    const accessToken = getBearer(event);
    const admin = await isAdmin(base, serviceKey, accessToken);
    if (!admin.ok) return json(admin.status, { ok: false, message: admin.message });

    const u = new URL(event.rawUrl || event.url || 'https://local.invalid/');
    const qs = event.queryStringParameters || {};
    const q = clean(qs.q ?? u.searchParams.get('q'));
    const requestedLimit = Number(qs.limit ?? u.searchParams.get('limit') ?? 200);
    const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : 200, 1), 500);

    let rows = [];
    let archiveAvailable = true;
    let archiveError = null;
    const archiveResp = await getArchiveRows(base, serviceKey, q, limit);
    const archiveJson = await readJson(archiveResp);

    if (archiveResp.ok && Array.isArray(archiveJson.data)) {
      rows = archiveJson.data;
    } else {
      archiveAvailable = false;
      archiveError = archiveJson.data?.message || archiveJson.text || archiveResp.statusText || `HTTP ${archiveResp.status}`;
    }

    // Always provide history from payment_submissions as a safety net.
    // This also makes the page usable when the archive table/bucket was created after older payments.
    const paymentResp = await getPaymentRows(base, serviceKey, q, limit);
    const paymentJson = await readJson(paymentResp);
    const paymentRows = paymentResp.ok && Array.isArray(paymentJson.data)
      ? paymentJson.data.map(mapPaymentFallback)
      : [];

    const existingPaymentIds = new Set(rows.map(r => String(r.payment_submission_id || '')));
    for (const p of paymentRows) {
      const key = String(p.payment_submission_id || '');
      if (!key || !existingPaymentIds.has(key)) rows.push(p);
    }

    rows.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
    rows = rows.slice(0, limit);

    for (const row of rows) {
      row.view_url = row.view_url || null;
      row.view_error = null;
      if (row.storage_path && row.id && !String(row.id).startsWith('payment-')) {
        try {
          row.view_url = `/.netlify/functions/admin-slip-view?id=${encodeURIComponent(row.id)}&token=${encodeURIComponent(makeViewToken(row.id))}`;
        } catch (e) {
          row.view_error = e.message || 'สร้างลิงก์ดูสลิปไม่สำเร็จ';
        }
      }
    }

    return json(200, {
      ok: true,
      rows,
      meta: {
        archiveAvailable,
        archiveError,
        paymentFallbackCount: paymentRows.length,
        note: archiveAvailable
          ? 'แสดงสลิปย้อนหลังจากคลังสลิป และใช้รายการชำระเป็นข้อมูลสำรองเมื่อมีรายการเก่า'
          : 'ตารางคลังสลิปยังอ่านไม่ได้ จึงแสดงประวัติจากรายการชำระเป็นข้อมูลสำรอง'
      }
    });
  } catch (e) {
    return json(500, { ok: false, message: e?.message || 'โหลดสลิปย้อนหลังไม่สำเร็จ', detail: String(e?.stack || '') });
  }
};
