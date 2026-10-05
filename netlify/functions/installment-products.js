function json(statusCode,payload){return {statusCode,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'},body:JSON.stringify(payload)}}
async function getText(resp){const t=await resp.text();let d=null;try{d=JSON.parse(t)}catch{}return {ok:resp.ok,status:resp.status,data:d,text:t}}
exports.handler=async(event)=>{
  if(event.httpMethod!=='GET') return json(405,{ok:false,message:'Method Not Allowed'});
  try{
    const url=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
    const key=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY||'';
    if(!url||!key) return json(500,{ok:false,message:'ยังไม่ได้ตั้งค่า Supabase Secret Key ใน Netlify'});
    const headers={apikey:key,Accept:'application/json'};
    const [prodResp0,planResp0]=await Promise.all([
      fetch(`${url}/rest/v1/installment_products?select=id,product_name,sku,full_price,product_image_url,image_link_url,code_image_url,code_image_link_url,terms,note,sale_status,code_status,assigned_customer_id,is_active,created_at&order=created_at.asc`,{headers}),
      fetch(`${url}/rest/v1/installment_plans?select=id,installment_code,product_id,customer_id,agreed_price,paid_amount,manual_remaining_amount,status,unlock_code,cutoff_time,violation_count,required_bank_account_id,required_bank_account_id_2,note,start_date,end_date,updated_at&status=in.(active,paid,cancelled)&order=created_at.desc`,{headers})
    ]);
    const prodResp=await getText(prodResp0), planResp=await getText(planResp0);
    if(!prodResp.ok) return json(prodResp.status,{ok:false,message:'โหลดรายการสินค้าไม่สำเร็จ',detail:prodResp.data||prodResp.text});
    if(!planResp.ok) return json(planResp.status,{ok:false,message:'โหลดรายการผ่อนไม่สำเร็จ',detail:planResp.data||planResp.text});
    const products=Array.isArray(prodResp.data)?prodResp.data:[];
    const plans=Array.isArray(planResp.data)?planResp.data:[];
    const customerIds=[...new Set(plans.map(x=>x.customer_id).filter(Boolean))];
    const bankIds=[...new Set(plans.flatMap(x=>[x.required_bank_account_id,x.required_bank_account_id_2]).filter(Boolean))];
    const customerMap={},bankMap={};
    if(customerIds.length){
      const ids=customerIds.map(x=>encodeURIComponent(String(x))).join(',');
      const r=await getText(await fetch(`${url}/rest/v1/customers?select=id,customer_code,facebook_name,is_active&id=in.(${ids})`,{headers}));
      if(!r.ok)return json(r.status,{ok:false,message:'โหลดข้อมูลลูกค้าไม่สำเร็จ',detail:r.data||r.text});
      for(const c of (Array.isArray(r.data)?r.data:[])) customerMap[c.id]=c;
    }
    if(bankIds.length){
      const ids=bankIds.map(x=>encodeURIComponent(String(x))).join(',');
      const r=await getText(await fetch(`${url}/rest/v1/bank_accounts?select=id,bank_name,account_name,account_number,qr_url,qr_link_url,is_active&id=in.(${ids})`,{headers}));
      if(!r.ok)return json(r.status,{ok:false,message:'โหลดบัญชีรับเงินไม่สำเร็จ',detail:r.data||r.text});
      for(const b of (Array.isArray(r.data)?r.data:[])) bankMap[b.id]=b;
    }
    const planByProduct={};
    for(const pl of plans){
      const existing=planByProduct[pl.product_id];
      if(!existing || (pl.status==='active' && existing.status!=='active')) planByProduct[pl.product_id]=pl;
    }
    const out=products.filter(p=>{const pl=planByProduct[p.id]||null;return Boolean(p.is_active||pl)}).map(p=>{
      const pl=planByProduct[p.id]||null;
      const c=pl?customerMap[pl.customer_id]||null:null;
      const bankList=pl?[pl.required_bank_account_id,pl.required_bank_account_id_2].filter(Boolean).map(id=>bankMap[id]).filter(Boolean):[];
      const remaining=pl?Math.max(Number(pl.manual_remaining_amount ?? (Number(pl.agreed_price||0)-Number(pl.paid_amount||0))),0):null;
      const paid=pl?Math.max(Number(pl.agreed_price||0)-remaining,0):null;
      return {...p,plan_status:pl?.status||null,plan:pl?{id:pl.id,status:pl.status,installment_code:pl.installment_code||`RP-${String(pl.id).slice(0,8).toUpperCase()}`,paid,remaining,agreed_price:Number(pl.agreed_price||0),unlock_code:pl.status==='paid'?pl.unlock_code:null,cutoff_time:String(pl.cutoff_time||'22:00').slice(0,5),violation_count:Number(pl.violation_count||0),note:pl.note||null,start_date:pl.start_date||null,end_date:pl.end_date||null,bank_accounts:bankList.map(b=>({id:b.id,bank_name:b.bank_name,account_name:b.account_name,account_number:b.account_number,qr_url:b.qr_url,qr_link_url:b.qr_link_url,is_active:b.is_active}))}:null,bank_account:bankList[0]?{id:bankList[0].id,bank_name:bankList[0].bank_name,account_name:bankList[0].account_name,account_number:bankList[0].account_number,qr_url:bankList[0].qr_url,qr_link_url:bankList[0].qr_link_url,is_active:bankList[0].is_active}:null};
    });
    return json(200,{ok:true,products:out});
  }catch(e){return json(500,{ok:false,message:e.message||'Server error'})}
};
