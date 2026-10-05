const MAX = 4 * 1024 * 1024;
const ALLOWED = new Set(['image/jpeg','image/png','image/gif','image/webp']);

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

function parseHeaderBlock(buffer) {
  const text = buffer.toString('utf8');
  const headers = {};
  for (const line of text.split('\r\n')) {
    const i = line.indexOf(':');
    if (i <= 0) continue;
    headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return headers;
}

function parseDisposition(value) {
  const out = {};
  const m = String(value || '').match(/form-data(?:;|$)/i);
  if (!m) return out;
  const re = /;\s*([a-zA-Z0-9_-]+)=(?:"([^"]*)"|([^;]*))/g;
  let hit;
  while ((hit = re.exec(String(value || '')))) out[hit[1]] = hit[2] ?? hit[3] ?? '';
  return out;
}

function parseMultipart(event) {
  const headers = Object.fromEntries(Object.entries(event.headers || {}).map(([k,v]) => [String(k).toLowerCase(), v]));
  const contentType = String(headers['content-type'] || '');
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundaryMatch) throw new Error('ไม่พบ boundary ของแบบฟอร์มอัปโหลดสลิป');
  const boundary = Buffer.from(`--${boundaryMatch[1] || boundaryMatch[2]}`);
  const body = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64')
    : Buffer.from(event.body || '', 'utf8');
  if (!body.length) return { file: null, fields: {} };

  const fields = {};
  let file = null;
  let pos = body.indexOf(boundary);
  let partCount = 0;
  while (pos !== -1) {
    partCount += 1;
    if (partCount > 12) throw new Error('แบบฟอร์มมีข้อมูลเกินจำนวนที่รองรับ');
    const afterBoundary = pos + boundary.length;
    if (body.slice(afterBoundary, afterBoundary + 2).toString('ascii') === '--') break;

    let partStart = afterBoundary;
    if (body.slice(partStart, partStart + 2).toString('ascii') === '\r\n') partStart += 2;
    const next = body.indexOf(Buffer.from(`\r\n--${boundaryMatch[1] || boundaryMatch[2]}`), partStart);
    if (next === -1) break;
    const part = body.slice(partStart, next);
    const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'));
    if (headerEnd === -1) { pos = next + 2; continue; }
    const headerBlock = part.slice(0, headerEnd);
    const content = part.slice(headerEnd + 4);
    const h = parseHeaderBlock(headerBlock);
    const disp = parseDisposition(h['content-disposition']);
    const name = String(disp.name || '').trim();
    if (!name) { pos = next + 2; continue; }

    if (disp.filename != null) {
      const size = content.length;
      if (size > MAX) throw new Error('ไฟล์สลิปต้องมีขนาดไม่เกิน 4 MB');
      file = {
        filename: disp.filename || 'slip',
        mimeType: String(h['content-type'] || 'application/octet-stream').split(';')[0].trim().toLowerCase(),
        size,
        buffer: Buffer.from(content)
      };
    } else {
      if (Buffer.byteLength(content) > 64 * 1024) throw new Error('ข้อมูลในแบบฟอร์มมีขนาดใหญ่เกินไป');
      fields[name] = content.toString('utf8').trim();
    }
    pos = next + 2;
  }
  return { file, fields };
}

function clean(v) { return String(v || '').trim(); }
function normDigits(v) { return clean(v).replace(/\D/g, ''); }
function normText(v) { return clean(v).toLowerCase().replace(/\s+/g, '').replace(/[.\-_,]/g, ''); }
function normalizePersonName(v) {
  return clean(v)
    .toLowerCase()
    .replace(/(นางสาว|น.ส\.?|นาง|นาย|ด\.ญ\.?|ด\.ช\.?|mr\.?|mrs\.?|ms\.?|miss\.?)/g, '')
    .replace(/[^\p{L}\p{N}]/gu, '');
}
function payerMatches(customer, payerName) {
  const pn = normalizePersonName(payerName);
  const candidates = [customer?.full_name, ...(clean(customer?.payer_aliases) ? String(customer.payer_aliases).split(',') : [])]
    .map(normalizePersonName).filter(Boolean);
  return candidates.some(c => pn === c || pn.includes(c) || c.includes(pn));
}
function receiverNameAllowed(name) {
  const n = normText(name);
  return n.includes(normText('พัชชลัยย์')) || n.includes(normText('Phatchalai'));
}
function localTimeParts(isoString) {
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(d);
  const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return {
    year: Number(map.year), month: Number(map.month), day: Number(map.day),
    hour: Number(map.hour), minute: Number(map.minute), second: Number(map.second),
    label: `${map.day}/${map.month}/${map.year} ${map.hour}:${map.minute}`
  };
}
function monthStartBangkok(isoString) {
  const p = localTimeParts(isoString || new Date().toISOString());
  if (!p) return new Date().toISOString().slice(0,7) + '-01';
  return `${p.year}-${String(p.month).padStart(2,'0')}-01`;
}
function isAfterCutoff(isoString, cutoff='22:00') {
  const p = localTimeParts(isoString);
  if (!p) return { late: false, local: null };
  const [h,m] = String(cutoff).split(':').map(Number);
  const late = (p.hour * 60 + p.minute) >= ((h || 0) * 60 + (m || 0));
  return { late, local: p };
}
function isWithinPlanPeriod(isoString,startDate,endDate){const p=localTimeParts(isoString);if(!p)return {ok:true,reason:null};const localDate=`${p.year}-${String(p.month).padStart(2,'0')}-${String(p.day).padStart(2,'0')}`;if(startDate&&localDate<startDate)return {ok:false,reason:`วันที่โอน ${localDate} ก่อนวันเริ่มผ่อน ${startDate}`};if(endDate&&localDate>endDate)return {ok:false,reason:`วันที่โอน ${localDate} หลังวันสิ้นสุดการผ่อน ${endDate}`};return {ok:true,reason:null};}
function bangkokToday(){const p=localTimeParts(new Date().toISOString());if(!p)return null;return `${p.year}-${String(p.month).padStart(2,'0')}-${String(p.day).padStart(2,'0')}`;}
function getParty(raw, key) {
  const party = raw?.[key] || {};
  const name = party?.account?.name?.th || party?.account?.name?.en || party?.name || null;
  const bank = party?.bank?.name || null;
  const bankShort = party?.bank?.short || null;
  const accountBank = party?.account?.bank?.account || null;
  const proxy = party?.account?.proxy?.account || null;
  return { name, bank, bankShort, accountBank, proxy };
}
function receiverIdentifiers(data, raw) {
  const r = getParty(raw, 'receiver');
  const list = [data?.matchedAccount?.bankNumber, r.accountBank, r.proxy].map(normDigits).filter(x => x && x.length >= 6);
  return { ...r, identifiers: [...new Set(list)] };
}

async function supaFetch(path, options = {}) {
  const base = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!base || !key) throw new Error('ยังไม่ได้ตั้งค่า Supabase Secret Key ใน Netlify');
  const headers = { ...(options.headers || {}), apikey: key, Accept: 'application/json' };
  return fetch(`${base}${path}`, { ...options, headers });
}
async function getJson(resp) {
  const text = await resp.text();
  let data = null; try { data = JSON.parse(text); } catch {}
  return { data, text };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { ok:false, message:'Method Not Allowed' });
  try {
    const { file, fields } = await parseMultipart(event);
    if (!file) return json(400, { ok:false, message:'ไม่พบไฟล์สลิป' });
    if (file.size > MAX) return json(400, { ok:false, message:'ไฟล์สลิปต้องมีขนาดไม่เกิน 4 MB' });
    if (!ALLOWED.has(file.mimeType)) return json(400, { ok:false, message:'รองรับเฉพาะ JPG, PNG, GIF และ WebP' });

    const bankAccountId = clean(fields.bankAccountId);
    const submittedCustomerCode = clean(fields.customerCode);
    let installmentPlanId = clean(fields.installmentPlanId);
    const productId = clean(fields.productId);

    let selectedAccount = null;
    let plan = null;
    let customer = null;

    if (installmentPlanId) {
      const pResp = await supaFetch(`/rest/v1/installment_plans?select=id,installment_code,customer_id,product_id,agreed_price,paid_amount,manual_remaining_amount,status,violation_count,cutoff_time,start_date,end_date,required_bank_account_id,required_bank_account_id_2,installment_products(product_name,sku,product_image_url,terms),customers(id,customer_code,facebook_name,full_name,payer_aliases,is_active)&id=eq.${encodeURIComponent(installmentPlanId)}&limit=1`);
      const pJson = await getJson(pResp);
      if (!pResp.ok || !Array.isArray(pJson.data) || !pJson.data[0]) return json(404, { ok:false, message:'ไม่พบรายการผ่อนที่เลือก' });
      plan = pJson.data[0];
      customer = plan.customers;
      if (!customer?.is_active) return json(400, { ok:false, message:'ลูกค้ารายนี้ถูกปิดใช้งาน' });
      if (!submittedCustomerCode || normText(submittedCustomerCode) !== normText(customer.customer_code)) return json(403,{ok:false,code:'CUSTOMER_CODE_REQUIRED',message:'กรุณากรอกรหัสลูกค้าให้ตรงกับรายการผ่อนก่อนส่งยอด'});
      const allowedBankIds=[plan.required_bank_account_id,plan.required_bank_account_id_2].filter(Boolean);
      const requestedBank=bankAccountId||allowedBankIds[0]||'';
      if(!allowedBankIds.length)return json(400,{ok:false,message:'รายการผ่อนนี้ยังไม่ได้กำหนดช่องทางโอน'});
      if(!allowedBankIds.includes(requestedBank))return json(400,{ok:false,code:'INSTALLMENT_BANK_NOT_ALLOWED',message:'ช่องทางโอนที่เลือกไม่ใช่ช่องทางของรายการผ่อนนี้'});
      const aResp=await supaFetch(`/rest/v1/bank_accounts?select=id,bank_name,account_name,account_number,is_active,qr_url&id=eq.${encodeURIComponent(requestedBank)}&is_active=eq.true&limit=1`);
      const aJson=await getJson(aResp);
      if(!aResp.ok||!aJson.data?.[0])return json(400,{ok:false,message:'ช่องทางรับเงินของรายการผ่อนนี้ไม่พร้อมใช้งาน'});
      selectedAccount=aJson.data[0];
    } else if (bankAccountId) {
      const aResp = await supaFetch(`/rest/v1/bank_accounts?select=id,bank_name,account_name,account_number,is_active,qr_url&id=eq.${encodeURIComponent(bankAccountId)}&is_active=eq.true&limit=1`);
      const aJson = await getJson(aResp);
      if (!aResp.ok || !aJson.data?.[0]) return json(400, { ok:false, message:'ไม่พบบัญชีรับเงินที่เลือก' });
      selectedAccount = aJson.data[0];
    }

    const easyKey = process.env.EASYSLIP_API_KEY;
    if (!easyKey) throw new Error('ยังไม่ได้ตั้งค่า EASYSLIP_API_KEY ใน Netlify');

    const isTrueWallet = String(selectedAccount?.bank_name || '').toLowerCase().replace(/\s+/g,'').includes('truemoney');
    const form = new FormData();
    form.append('image', new Blob([file.buffer], { type:file.mimeType }), file.filename);
    form.append('matchAccount', 'true');
    form.append('checkDuplicate', 'true');
    const endpoint = isTrueWallet ? 'https://api.easyslip.com/v2/verify/truewallet' : 'https://api.easyslip.com/v2/verify/bank';
    const esResp = await fetch(endpoint, { method:'POST', headers:{ Authorization:`Bearer ${easyKey}` }, body:form });
    const esText = await esResp.text();
    let es = null; try { es = JSON.parse(esText); } catch {}
    if (!esResp.ok || es?.success !== true) {
      return json(esResp.status || 400, { ok:false, message:es?.error?.message || es?.message || 'EasySlip ตรวจสอบสลิปไม่ผ่าน' });
    }

    const d = es.data || {};
    const raw = d.rawSlip || {};
    if (d.isDuplicate === true) return json(409, { ok:false, code:'DUPLICATE_SLIP', message:'สลิปนี้ถูกตรวจสอบไปแล้ว ไม่สามารถใช้ซ้ำได้' });

    const sender = getParty(raw, 'sender');
    const receiver = receiverIdentifiers(d, raw);
    const payerName = sender.name;
    const receiverName = receiver.name;
    const receiverBank = receiver.bank || (isTrueWallet ? 'TrueMoney Wallet' : null);
    const amount = d.amountInSlip ?? raw?.amount?.amount ?? null;
    const transferDateTime = raw?.date || null;
    const reference = raw?.transRef || raw?.transactionId || null;

    // Product-selected installment flow: match the payer name to exactly one active plan for the selected product.
    if (productId && !installmentPlanId) {
      const q = `/rest/v1/installment_plans?select=id,installment_code,customer_id,product_id,agreed_price,paid_amount,manual_remaining_amount,status,violation_count,cutoff_time,start_date,end_date,required_bank_account_id,required_bank_account_id_2,installment_products(product_name,sku,product_image_url,terms,sale_status,code_status,assigned_customer_id),customers(id,customer_code,facebook_name,full_name,payer_aliases,is_active)&product_id=eq.${encodeURIComponent(productId)}&status=eq.active`;
      const pResp = await supaFetch(q);
      const pJson = await getJson(pResp);
      if (!pResp.ok) return json(500,{ok:false,message:'โหลดรายการผ่อนของสินค้านี้ไม่สำเร็จ'});
      const candidates = Array.isArray(pJson.data) ? pJson.data.filter(x=>x.customers?.is_active && x.installment_products?.sale_status !== 'sold' && (!x.installment_products?.assigned_customer_id || String(x.installment_products.assigned_customer_id)===String(x.customer_id))) : [];
      const matches = candidates.filter(x=>payerMatches(x.customers,payerName));
      if (matches.length === 0) return json(400,{ok:false,code:'PAYER_NOT_ASSIGNED',message:'ไม่พบรายการผ่อนที่กำหนดให้ชำระด้วยชื่อผู้โอนในสลิปนี้'});
      if (matches.length > 1) return json(409,{ok:false,code:'AMBIGUOUS_PAYER',message:'พบลูกค้าที่ชื่อผู้โอนตรงกันมากกว่า 1 รายการ กรุณาติดต่อร้านเพื่อตรวจสอบ'});
      installmentPlanId = matches[0].id;
      plan = matches[0];
      customer = matches[0].customers;
      if (!submittedCustomerCode || normText(submittedCustomerCode) !== normText(customer.customer_code)) return json(403,{ok:false,code:'CUSTOMER_CODE_REQUIRED',message:'กรุณากรอกรหัสลูกค้าให้ตรงกับรายการผ่อนก่อนส่งยอด'});
      const allowedBankIds=[plan.required_bank_account_id,plan.required_bank_account_id_2].filter(Boolean);
      const requestedBank=bankAccountId||allowedBankIds[0]||'';
      if(!allowedBankIds.length)return json(400,{ok:false,message:'รายการผ่อนนี้ยังไม่ได้กำหนดช่องทางโอน'});
      if(!allowedBankIds.includes(requestedBank))return json(400,{ok:false,code:'INSTALLMENT_BANK_NOT_ALLOWED',message:'ช่องทางโอนที่เลือกไม่ใช่ช่องทางของรายการผ่อนนี้'});
      const aResp=await supaFetch(`/rest/v1/bank_accounts?select=id,bank_name,account_name,account_number,is_active,qr_url&id=eq.${encodeURIComponent(requestedBank)}&is_active=eq.true&limit=1`);
      const aJson=await getJson(aResp);
      if(!aResp.ok||!aJson.data?.[0])return json(400,{ok:false,message:'ช่องทางรับเงินของรายการผ่อนนี้ไม่พร้อมใช้งาน'});
      selectedAccount=aJson.data[0];
    }

    if (!receiverNameAllowed(receiverName)) {
      if (installmentPlanId) {
        await supaFetch('/rest/v1/rpc/process_verified_payment', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body:JSON.stringify({p_payer_name:payerName,p_receiver_name:receiverName,p_receiver_bank:receiverBank,p_amount:amount,p_date_time:transferDateTime,p_reference:reference,p_status:'rejected',p_easyslip_response:es,p_bank_account_id:selectedAccount?.id||null,p_month_start:monthStartBangkok(transferDateTime),p_customer_id:customer?.id||null,p_installment_plan_id:installmentPlanId,p_rule_status:'receiver_mismatch',p_violation_reason:'ชื่อผู้รับเงินไม่ใช่ พัชชลัยย์ / Phatchalai'})
        }).catch(()=>{});
      }
      return json(400,{ok:false,code:'RECEIVER_NAME_MISMATCH',message:'ชื่อผู้รับเงินในสลิปไม่ตรงกับ พัชชลัยย์ หรือ Phatchalai จึงไม่นับยอด'});
    }

    if (selectedAccount) {
      const expected = normDigits(selectedAccount.account_number);
      const matched = receiver.identifiers.some(v => v === expected || (expected.length >= 8 && v.endsWith(expected)) || (v.length >= 8 && expected.endsWith(v)));
      if (!matched) {
        if (installmentPlanId) {
          await supaFetch('/rest/v1/rpc/process_verified_payment', {
            method:'POST', headers:{'Content-Type':'application/json'},
            body:JSON.stringify({p_payer_name:payerName,p_receiver_name:receiverName,p_receiver_bank:receiverBank,p_amount:amount,p_date_time:transferDateTime,p_reference:reference,p_status:'rejected',p_easyslip_response:es,p_bank_account_id:selectedAccount.id,p_month_start:monthStartBangkok(transferDateTime),p_customer_id:customer?.id||null,p_installment_plan_id:installmentPlanId,p_rule_status:'receiver_mismatch',p_violation_reason:'โอนเข้าบัญชีไม่ตรงกับบัญชีประจำรายการผ่อน'})
          }).catch(()=>{});
        }
        return json(400,{ok:false,code:'RECEIVER_ACCOUNT_MISMATCH',message:'สลิปนี้โอนเข้าบัญชีไม่ตรงกับบัญชีประจำรายการ จึงไม่นับยอด'});
      }
    }

    let ruleStatus = 'counted';
    let violationReason = null;
    let late = false;
    let local = localTimeParts(transferDateTime);

    if (installmentPlanId) {
      const today=bangkokToday();
      const slipLocal=localTimeParts(transferDateTime);
      if(!slipLocal){
        ruleStatus='slip_date_invalid';
        violationReason='อ่านวันที่จากสลิปไม่ได้ จึงไม่สามารถนับยอดผ่อน';
      } else {
        local=slipLocal;
        const slipDate=`${slipLocal.year}-${String(slipLocal.month).padStart(2,'0')}-${String(slipLocal.day).padStart(2,'0')}`;
        if(!today || slipDate!==today){
          ruleStatus='not_today';
          violationReason=`สลิปผ่อนต้องเป็นวันที่ปัจจุบันเท่านั้น (วันนี้ ${today||'-'} แต่สลิปเป็น ${slipDate})`;
        } else if (!payerMatches(customer, payerName)) {
          ruleStatus = 'payer_mismatch';
          violationReason = 'ชื่อผู้โอนไม่ตรงกับลูกค้าที่ได้รับอนุญาตให้ชำระรายการนี้';
        } else {
          const period=isWithinPlanPeriod(transferDateTime,plan.start_date,plan.end_date);
          if(!period.ok){ruleStatus='outside_period';violationReason=period.reason;}
          else {
            const cutoff = String(plan.cutoff_time || '22:00').slice(0,5);
            const chk = isAfterCutoff(transferDateTime, cutoff);
            late = chk.late; local = chk.local;
            if (late) {ruleStatus = 'late';violationReason = `โอนเวลา ${local?.hour}:${String(local?.minute).padStart(2,'0')} น. ซึ่งถึงหรือเกิน ${cutoff} น. (เวลาไทย)`;}
          }
        }
      }
    }

    const base = (process.env.SUPABASE_URL || '').replace(/\/$/,'');
    const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    let saved = null;
    if (base && key) {
      const rpcResp = await supaFetch('/rest/v1/rpc/process_verified_payment', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          p_payer_name:payerName||null,
          p_receiver_name:receiverName||null,
          p_receiver_bank:receiverBank||null,
          p_amount:amount==null?null:Number(amount),
          p_date_time:transferDateTime||null,
          p_reference:reference||null,
          p_status:ruleStatus==='counted'?'verified':'rejected',
          p_easyslip_response:es,
          p_bank_account_id:selectedAccount?.id||null,
          p_month_start:monthStartBangkok(transferDateTime),
          p_customer_id:customer?.id||null,
          p_installment_plan_id:installmentPlanId||null,
          p_rule_status:ruleStatus,
          p_violation_reason:violationReason
        })
      });
      const rpcJson = await getJson(rpcResp);
      if (!rpcResp.ok) {
        if (String(rpcJson.text || '').includes('DUPLICATE_REFERENCE') || rpcResp.status===409) {
          return json(409,{ok:false,code:'DUPLICATE_SLIP',message:'สลิปนี้ถูกใช้ไปแล้ว ไม่สามารถนับยอดซ้ำได้'});
        }
        throw new Error(`บันทึกรายการลง Supabase ไม่สำเร็จ: ${rpcJson.text || rpcResp.statusText}`);
      }
      saved = Array.isArray(rpcJson.data) ? rpcJson.data[0] : rpcJson.data;
    }

    const remainingBefore = plan ? Math.max(Number(plan.manual_remaining_amount ?? (Number(plan.agreed_price||0)-Number(plan.paid_amount||0))),0) : null;
    const counted = ruleStatus === 'counted';
    const remainingAfter = counted && plan ? Math.max(remainingBefore - Number(amount || 0),0) : remainingBefore;

    return json(200, {
      ok:true,
      counted,
      ruleStatus,
      violationReason,
      amount: amount==null?null:Number(amount),
      dateTime: transferDateTime,
      localDateTimeLabel: local ? `${String(local.day).padStart(2,'0')}/${String(local.month).padStart(2,'0')}/${local.year} ${String(local.hour).padStart(2,'0')}:${String(local.minute).padStart(2,'0')} น.` : null,
      reference,
      payerName,
      receiverName,
      receiverBank,
      receiverAccount: selectedAccount ? selectedAccount.account_number : null,
      isDuplicate:false,
      plan: plan ? {
        id:plan.id,
        installmentCode:plan.installment_code||`RP-${String(plan.id).slice(0,8).toUpperCase()}`,
        customerCode:customer?.customer_code,
        customerName:customer?.facebook_name||null,
        productName:plan.installment_products?.product_name || '-',
        before:remainingBefore,
        after:remainingAfter,
        status:counted && remainingAfter<=0 ? 'paid' : plan.status
      } : null,
      saved
    });
  } catch (e) {
    return json(500, { ok:false, message:e.message || 'Server error' });
  }
};
