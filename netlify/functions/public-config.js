exports.handler=async()=>{
  const url=process.env.SUPABASE_URL||'';
  const publishableKey=process.env.SUPABASE_PUBLISHABLE_KEY||'';
  const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'};
  if(!url||!publishableKey)return {statusCode:500,headers,body:JSON.stringify({ok:false,message:'กรุณาตั้งค่า SUPABASE_URL และ SUPABASE_PUBLISHABLE_KEY ใน Netlify'})};
  if(publishableKey.startsWith('sb_secret_'))return {statusCode:500,headers,body:JSON.stringify({ok:false,message:'Publishable Key ไม่ถูกต้อง'})};
  return {statusCode:200,headers,body:JSON.stringify({ok:true,url,publishableKey})};
};
