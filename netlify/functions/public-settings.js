exports.handler=async()=>{
  const url=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
  const key=process.env.SUPABASE_PUBLISHABLE_KEY||'';
  const headers={apikey:key,Accept:'application/json'};
  try{
    if(!url||!key)throw new Error('ยังไม่ได้ตั้งค่า SUPABASE_URL หรือ SUPABASE_PUBLISHABLE_KEY');
    if(key.startsWith('sb_secret_'))throw new Error('SUPABASE_PUBLISHABLE_KEY ต้องเป็น sb_publishable_...');
    const [s,b]=await Promise.all([
      fetch(`${url}/rest/v1/site_settings?select=key,value&key=in.(site,theme,motion)`,{headers}),
      fetch(`${url}/rest/v1/bank_accounts?select=id,bank_name,account_name,account_number,qr_url,qr_link_url,is_active&is_active=eq.true&order=created_at.asc`,{headers})
    ]);
    const st=await s.json().catch(()=>[]),bt=await b.json().catch(()=>[]);
    if(!s.ok||!b.ok)throw new Error(!s.ok?JSON.stringify(st):JSON.stringify(bt));
    const out={site:{},theme:{},motion:{},banks:Array.isArray(bt)?bt:[]};
    for(const row of (Array.isArray(st)?st:[]))out[row.key]=row.value||{};
    return {statusCode:200,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'},body:JSON.stringify(out)};
  }catch(e){return {statusCode:500,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'},body:JSON.stringify({site:{},theme:{},motion:{},banks:[],error:e.message||'Server error'})}}
};
