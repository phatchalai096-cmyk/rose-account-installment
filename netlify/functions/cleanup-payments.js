exports.handler=async()=>{
  try{
    const url=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
    const key=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY||'';
    if(!url||!key)throw new Error('Supabase not configured');
    const r=await fetch(`${url}/rest/v1/rpc/cleanup_old_payment_details`,{method:'POST',headers:{apikey:key,'Content-Type':'application/json'}});
    const text=await r.text();
    return {statusCode:r.ok?200:r.status,headers:{'Content-Type':'application/json'},body:text||JSON.stringify({ok:r.ok})};
  }catch(e){return {statusCode:500,headers:{'Content-Type':'application/json'},body:JSON.stringify({ok:false,message:e.message})}}
};
