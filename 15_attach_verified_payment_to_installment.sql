-- 15_แปลงสลิปที่ตรวจแล้วเป็นรายการผ่อน.sql
-- ใช้เมื่อสลิปถูกตรวจและบันทึกเป็น payment ปกติไปแล้ว
-- จากนั้นลูกค้ากด "ส่งยอดผ่อน" จากใบเสร็จ เพื่อย้ายรายการเดิมเข้ารายการผ่อนอย่างปลอดภัย

create or replace function public.attach_verified_payment_to_installment(
  p_reference text,
  p_customer_code text,
  p_installment_plan_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  pay public.payment_submissions%rowtype;
  plan_row public.installment_plans%rowtype;
  cust public.customers%rowtype;
  allowed_bank boolean := false;
  remaining_before numeric;
  new_remaining numeric;
  new_paid numeric;
  slip_ts timestamptz;
  slip_local_date date;
  slip_local_time time;
  payer_norm text;
  payer_ok boolean := false;
  alias_item text;
  alias_norm text;
  today_local date := (now() at time zone 'Asia/Bangkok')::date;
begin
  if nullif(trim(p_reference),'') is null then
    raise exception 'REFERENCE_REQUIRED';
  end if;
  if nullif(trim(p_customer_code),'') is null then
    raise exception 'CUSTOMER_CODE_REQUIRED';
  end if;
  if p_installment_plan_id is null then
    raise exception 'INSTALLMENT_PLAN_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(hashtext(trim(p_reference)));

  select * into pay
  from public.payment_submissions
  where reference = trim(p_reference)
  order by created_at desc
  limit 1
  for update;

  if not found then raise exception 'PAYMENT_NOT_FOUND'; end if;
  if coalesce(pay.status,'') <> 'verified' or coalesce(pay.rule_status,'counted') <> 'counted' then
    raise exception 'PAYMENT_NOT_VERIFIED';
  end if;
  if pay.installment_plan_id is not null then
    raise exception 'PAYMENT_ALREADY_INSTALLMENT';
  end if;
  if coalesce(pay.amount,0) <= 0 then raise exception 'INVALID_PAYMENT_AMOUNT'; end if;

  select * into plan_row
  from public.installment_plans
  where id = p_installment_plan_id
  for update;
  if not found then raise exception 'INSTALLMENT_PLAN_NOT_FOUND'; end if;
  if plan_row.status <> 'active' then raise exception 'INSTALLMENT_PLAN_NOT_ACTIVE'; end if;

  select * into cust
  from public.customers
  where id = plan_row.customer_id;
  if not found or not cust.is_active then raise exception 'CUSTOMER_INACTIVE'; end if;
  if lower(trim(cust.customer_code)) <> lower(trim(p_customer_code)) then raise exception 'CUSTOMER_CODE_MISMATCH'; end if;

  remaining_before := greatest(coalesce(plan_row.manual_remaining_amount, greatest(plan_row.agreed_price - plan_row.paid_amount,0)),0);
  if pay.amount > remaining_before then
    raise exception 'PAYMENT_EXCEEDS_REMAINING';
  end if;

  begin
    slip_ts := nullif(pay.date_time,'')::timestamptz;
  exception when others then
    raise exception 'SLIP_DATE_INVALID';
  end;
  if slip_ts is null then raise exception 'SLIP_DATE_INVALID'; end if;
  slip_local_date := (slip_ts at time zone 'Asia/Bangkok')::date;
  slip_local_time := (slip_ts at time zone 'Asia/Bangkok')::time;
  if slip_local_date <> today_local then raise exception 'SLIP_NOT_TODAY'; end if;
  if slip_local_date < plan_row.start_date or slip_local_date > plan_row.end_date then raise exception 'SLIP_OUTSIDE_PERIOD'; end if;
  if slip_local_time >= plan_row.cutoff_time then raise exception 'SLIP_AFTER_CUTOFF'; end if;

  if position('พัชชลัยย์' in coalesce(pay.receiver_name,'')) = 0
     and position('phatchalai' in lower(coalesce(pay.receiver_name,''))) = 0 then
    raise exception 'RECEIVER_NAME_MISMATCH';
  end if;

  allowed_bank := pay.bank_account_id is not null and (
    pay.bank_account_id = plan_row.required_bank_account_id
    or pay.bank_account_id = plan_row.required_bank_account_id_2
  );
  if not allowed_bank then raise exception 'INSTALLMENT_BANK_MISMATCH'; end if;

  payer_norm := lower(regexp_replace(coalesce(pay.payer_name,''),'\s','','g'));
  if payer_norm <> '' then
    if lower(regexp_replace(coalesce(cust.full_name,''),'\s','','g')) <> ''
       and (payer_norm like '%'||lower(regexp_replace(cust.full_name,'\s','','g'))||'%'
            or lower(regexp_replace(cust.full_name,'\s','','g')) like '%'||payer_norm||'%') then
      payer_ok := true;
    else
      foreach alias_item in array coalesce(string_to_array(cust.payer_aliases,','), array[]::text[]) loop
        alias_norm := lower(regexp_replace(trim(alias_item),'\s','','g'));
        if alias_norm <> '' and (payer_norm like '%'||alias_norm||'%' or alias_norm like '%'||payer_norm||'%') then
          payer_ok := true; exit;
        end if;
      end loop;
    end if;
  end if;
  if not payer_ok then raise exception 'PAYER_MISMATCH'; end if;

  update public.payment_submissions
  set customer_id = plan_row.customer_id,
      installment_plan_id = plan_row.id,
      rule_status = 'counted',
      violation_reason = null
  where id = pay.id;

  new_remaining := greatest(remaining_before - pay.amount,0);
  new_paid := greatest(plan_row.agreed_price - new_remaining,0);
  update public.installment_plans
  set manual_remaining_amount = new_remaining,
      paid_amount = least(agreed_price,new_paid),
      status = case when new_remaining <= 0 then 'paid' else 'active' end,
      unlocked_at = case when new_remaining <= 0 then coalesce(unlocked_at,now()) else unlocked_at end,
      updated_at = now()
  where id = plan_row.id;

  insert into public.installment_payments(installment_plan_id,payment_submission_id,amount,paid_at,reference)
  values(plan_row.id,pay.id,pay.amount,coalesce(nullif(pay.date_time,'')::timestamptz,now()),pay.reference)
  on conflict (payment_submission_id) do nothing;

  return jsonb_build_object(
    'payment_submission_id',pay.id,
    'installment_plan_id',plan_row.id,
    'amount',pay.amount,
    'before',remaining_before,
    'after',new_remaining,
    'status',case when new_remaining <= 0 then 'paid' else 'active' end
  );
end;
$$;

revoke all on function public.attach_verified_payment_to_installment(text,text,uuid) from public, anon, authenticated;
grant execute on function public.attach_verified_payment_to_installment(text,text,uuid) to service_role;
