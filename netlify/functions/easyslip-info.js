exports.handler=async()=>{
  try{
    const key=process.env.EASYSLIP_API_KEY||'';
    if(!key)return {statusCode:500,headers:{'Content-Type':'application/json'},body:JSON.stringify({ok:false,message:'ยังไม่ได้ตั้งค่า EASYSLIP_API_KEY'})};
    const r=await fetch('https://api.easyslip.com/v2/info',{headers:{Authorization:`Bearer ${key}`}});
    const text=await r.text(); let data=null; try{data=JSON.parse(text)}catch{}
    return {statusCode:r.ok?200:r.status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify({ok:r.ok,data})};
  }catch(e){return {statusCode:500,headers:{'Content-Type':'application/json'},body:JSON.stringify({ok:false,message:e.message})}}
};
