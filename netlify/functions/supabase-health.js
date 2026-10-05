exports.handler = async () => {
  const url = process.env.SUPABASE_URL || '';
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const headers = { apikey: key, Accept: 'application/json' };
  const safeHost = (() => { try { return new URL(url).host; } catch { return ''; } })();
  try {
    if (!url || !key) return { statusCode: 500, headers: {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}, body: JSON.stringify({ok:false,error:'missing_env',host:safeHost}) };
    const r = await fetch(`${url}/rest/v1/bank_accounts?select=id&limit=1`, { headers });
    const body = await r.text();
    return { statusCode: 200, headers: {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}, body: JSON.stringify({ok:r.ok,status:r.status,host:safeHost,message:r.ok?'Supabase connection OK':(r.status===401?'API key rejected by Supabase':`Supabase returned HTTP ${r.status}`)}) };
  } catch (e) {
    return { statusCode: 200, headers: {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}, body: JSON.stringify({ok:false,error:'request_failed',host:safeHost,message:e.message||'request failed'}) };
  }
};