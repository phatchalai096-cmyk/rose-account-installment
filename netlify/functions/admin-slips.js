function json(statusCode,payload){return{statusCode,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'},body:JSON.stringify(payload)}}
function encPath(path){return String(path||'').split('/').map(encodeURIComponent).join('/')}
async function getJson(r){const text=await r.text();let data=null;try{data=JSON.parse(text)}catch{}return{data,text}}
exports.handler=async event=>{
  if(event.httpMethod!=='GET')return json(405,{ok:false,message:'Method Not Allowed'});
  try{
    const base=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
    const serviceKey=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY||'';
    const auth=event.headers?.authorization||event.headers?.Authorization||'';
    if(!base||!serviceKey)return json(500,{ok:false,message:'Supabase ยังไม่ได้ตั้งค่า Secret Key'});
    if(!auth)return json(401,{ok:false,message:'กรุณาเข้าสู่ระบบหลังบ้าน'});
    const check=await fetch(`${base}/rest/v1/rpc/is_admin`,{method:'POST',headers:{apikey:serviceKey,Authorization:auth,'Content-Type':'application/json'},body:'{}'});
    const cj=await getJson(check);
    if(!check.ok||cj.data!==true)return json(403,{ok:false,message:'ไม่มีสิทธิ์ดูสลิปย้อนหลัง'});
    const u=new URL(event.rawUrl||'https://local.invalid/');
    const q=String(u.searchParams.get('q')||'').trim();
    const limit=Math.min(Math.max(Number(u.searchParams.get('limit')||200),1),500);
    let filter='order=created_at.desc&limit='+limit;
    if(q){const safe=q.replace(/,/g,'').replace(/\*/g,'');filter+=`&or=(customer_code.ilike.*${encodeURIComponent(safe)}*,reference.ilike.*${encodeURIComponent(safe)}*,payer_name.ilike.*${encodeURIComponent(safe)}*,receiver_name.ilike.*${encodeURIComponent(safe)}*)`}
    const r=await fetch(`${base}/rest/v1/slip_archive?select=*&${filter}`,{headers:{apikey:serviceKey,Authorization:`Bearer ${serviceKey}`,Accept:'application/json'}});
    const j=await getJson(r); if(!r.ok)return json(r.status,{ok:false,message:j.text||'โหลดสลิปย้อนหลังไม่สำเร็จ'});
    const rows=Array.isArray(j.data)?j.data:[];
    for(const row of rows){
      row.view_url=null;
      if(row.storage_path){
        const s=await fetch(`${base}/storage/v1/object/sign/payment-slips/${encPath(row.storage_path)}`,{method:'POST',headers:{apikey:serviceKey,Authorization:`Bearer ${serviceKey}`,'Content-Type':'application/json'},body:JSON.stringify({expiresIn:3600})});
        const sj=await getJson(s);
        if(s.ok&&sj.data?.signedURL)row.view_url=String(sj.data.signedURL).startsWith('http')?sj.data.signedURL:`${base}${sj.data.signedURL}`;
      }
    }
    return json(200,{ok:true,rows});
  }catch(e){return json(500,{ok:false,message:e.message||'Server error'})}
};
