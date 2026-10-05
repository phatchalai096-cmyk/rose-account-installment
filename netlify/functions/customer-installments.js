function json(statusCode,payload){return {statusCode,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'},body:JSON.stringify(payload)}}
exports.handler=async(event)=>{
  if(event.httpMethod!=='GET')return json(405,{ok:false,message:'Method Not Allowed'});
  const code=String(event.queryStringParameters?.code||'').trim();
  if(!code)return json(400,{ok:false,message:'กรุณาใส่รหัสลูกค้า'});
  try{
    const url=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
    const key=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY||'';
    if(!url||!key)return json(500,{ok:false,message:'ยังไม่ได้ตั้งค่า Supabase Secret Key ใน Netlify'});
    const r=await fetch(`${url}/rest/v1/rpc/get_customer_installments`,{method:'POST',headers:{apikey:key,'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({p_customer_code:code})});
    const text=await r.text(); let data=[]; try{data=JSON.parse(text)}catch{}
    if(!r.ok)return json(r.status,{ok:false,message:'โหลดข้อมูลผ่อนไม่สำเร็จ',detail:data||text});
    const plans=(Array.isArray(data)?data:[]).map(pl=>({...pl,bank_accounts:[
      pl.bank_account_id?{id:pl.bank_account_id,bank_name:pl.bank_name,account_name:pl.account_name,account_number:pl.account_number,qr_url:pl.qr_url,qr_link_url:pl.qr_link_url}:null,
      pl.bank_account_id_2?{id:pl.bank_account_id_2,bank_name:pl.bank_name_2,account_name:pl.account_name_2,account_number:pl.account_number_2,qr_url:pl.qr_url_2,qr_link_url:pl.qr_link_url_2}:null
    ].filter(Boolean)}));
    return json(200,{ok:true,customer:plans?.[0]?.customer_name||null,plans});
  }catch(e){return json(500,{ok:false,message:e.message||'Server error'})}
};
