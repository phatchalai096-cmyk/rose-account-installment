function json(statusCode,payload){return {statusCode,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'},body:JSON.stringify(payload)}}
async function read(resp){const text=await resp.text();let data=null;try{data=JSON.parse(text)}catch{}return {ok:resp.ok,status:resp.status,data,text}}
function cleanDate(v){
  if(v===null||v===undefined||v==='') return null;
  const s=String(v).trim();
  if(/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m=s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if(m) return `${m[3]}-${m[2]}-${m[1]}`;
  return s.slice(0,10);
}
exports.handler=async(event)=>{
  if(event.httpMethod!=='GET')return json(405,{ok:false,message:'Method Not Allowed'});
  const code=String(event.queryStringParameters?.code||'').trim();
  if(!code)return json(400,{ok:false,message:'กรุณาใส่รหัสลูกค้า'});
  try{
    const url=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
    const key=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY||'';
    if(!url||!key)return json(500,{ok:false,message:'ยังไม่ได้ตั้งค่า Supabase Secret Key ใน Netlify'});
    const headers={apikey:key,Accept:'application/json'};
    const customerQ=await read(await fetch(`${url}/rest/v1/customers?select=id,customer_code,facebook_name,is_active&customer_code=eq.${encodeURIComponent(code)}&limit=1`,{headers}));
    if(!customerQ.ok)return json(customerQ.status,{ok:false,message:'ค้นหาลูกค้าไม่สำเร็จ',detail:customerQ.data||customerQ.text});
    const customer=Array.isArray(customerQ.data)?customerQ.data[0]:null;
    if(!customer)return json(404,{ok:false,message:'ไม่พบรหัสลูกค้านี้'});
    const plansQ=await read(await fetch(`${url}/rest/v1/installment_plans?select=id,installment_code,product_id,customer_id,agreed_price,paid_amount,manual_remaining_amount,status,unlock_code,cutoff_time,violation_count,required_bank_account_id,required_bank_account_id_2,note,start_date,end_date,updated_at,created_at&customer_id=eq.${encodeURIComponent(customer.id)}&status=in.(active,paid)&order=created_at.desc`,{headers}));
    if(!plansQ.ok)return json(plansQ.status,{ok:false,message:'โหลดรายการผ่อนไม่สำเร็จ',detail:plansQ.data||plansQ.text});
    const plans=Array.isArray(plansQ.data)?plansQ.data:[];
    const productIds=[...new Set(plans.map(p=>p.product_id).filter(Boolean))];
    const bankIds=[...new Set(plans.flatMap(p=>[p.required_bank_account_id,p.required_bank_account_id_2]).filter(Boolean))];
    const productMap={},bankMap={};
    if(productIds.length){
      const ids=productIds.map(x=>encodeURIComponent(String(x))).join(',');
      const q=await read(await fetch(`${url}/rest/v1/installment_products?select=id,product_name,sku,full_price,product_image_url,image_link_url,code_image_url,code_image_link_url,terms,note,is_active&id=in.(${ids})`,{headers}));
      if(!q.ok)return json(q.status,{ok:false,message:'โหลดข้อมูลสินค้าไม่สำเร็จ',detail:q.data||q.text});
      for(const p of (Array.isArray(q.data)?q.data:[]))productMap[p.id]=p;
    }
    if(bankIds.length){
      const ids=bankIds.map(x=>encodeURIComponent(String(x))).join(',');
      const q=await read(await fetch(`${url}/rest/v1/bank_accounts?select=id,bank_name,account_name,account_number,qr_url,qr_link_url,is_active&id=in.(${ids})`,{headers}));
      if(!q.ok)return json(q.status,{ok:false,message:'โหลดบัญชีรับเงินไม่สำเร็จ',detail:q.data||q.text});
      for(const b of (Array.isArray(q.data)?q.data:[]))bankMap[b.id]=b;
    }
    const out=plans.map(pl=>{
      const product=productMap[pl.product_id]||{};
      const bank_accounts=[pl.required_bank_account_id,pl.required_bank_account_id_2].filter(Boolean).map(id=>bankMap[id]).filter(Boolean).map(b=>({id:b.id,bank_name:b.bank_name,account_name:b.account_name,account_number:b.account_number,qr_url:b.qr_url,qr_link_url:b.qr_link_url,is_active:b.is_active}));
      const remaining=Math.max(Number(pl.manual_remaining_amount??(Number(pl.agreed_price||0)-Number(pl.paid_amount||0))),0);
      const paid=Math.max(Number(pl.agreed_price||0)-remaining,0);
      return {
        ...pl,
        product_id:pl.product_id,
        product_name:product.product_name||'-',sku:product.sku||null,
        agreed_price:Number(pl.agreed_price||0),remaining_amount:remaining,paid_amount:paid,
        product_image_url:product.product_image_url||null,image_link_url:product.image_link_url||null,
        code_image_url:product.code_image_url||null,code_image_link_url:product.code_image_link_url||null,
        terms:product.terms||null,product_note:product.note||null,
        customer_code:customer.customer_code,customer_name:customer.facebook_name||null,
        start_date:cleanDate(pl.start_date),end_date:cleanDate(pl.end_date),bank_accounts
      };
    });
    return json(200,{ok:true,customer:customer.facebook_name||null,customer_code:customer.customer_code,plans:out});
  }catch(e){return json(500,{ok:false,message:e.message||'Server error'})}
};
