-- 14_เชื่อมลูกค้า_สินค้า_รายการผ่อน_อัตโนมัติ.sql
-- รันต่อจาก 09-13 เพื่อยืนยันคอลัมน์/สิทธิ์ และเชื่อมลูกค้า <-> สินค้า <-> รายการผ่อนอัตโนมัติ
-- ปลอดภัยต่อการรันซ้ำ
create extension if not exists pgcrypto;

alter table public.customers
  add column if not exists facebook_name text,
  add column if not exists payer_aliases text,
  add column if not exists note text,
  add column if not exists is_active boolean not null default true,
  add column if not exists updated_at timestamptz not null default now();

update public.customers
set facebook_name = coalesce(nullif(facebook_name,''), full_name)
where facebook_name is null or btrim(facebook_name)='';

alter table public.installment_products
  add column if not exists product_image_url text,
  add column if not exists terms text,
  add column if not exists note text,
  add column if not exists sale_status text not null default 'available',
  add column if not exists code_status text not null default 'for_sale',
  add column if not exists assigned_customer_id uuid references public.customers(id) on delete set null,
  add column if not exists image_link_url text,
  add column if not exists code_image_url text,
  add column if not exists code_image_link_url text,
  add column if not exists is_active boolean not null default true,
  add column if not exists updated_at timestamptz not null default now();

alter table public.installment_plans
  add column if not exists installment_code text,
  add column if not exists start_date date,
  add column if not exists end_date date,
  add column if not exists required_bank_account_id_2 uuid references public.bank_accounts(id) on delete restrict,
  add column if not exists manual_remaining_amount numeric(12,2),
  add column if not exists violation_count integer not null default 0,
  add column if not exists cutoff_time time not null default time '22:00',
  add column if not exists note text,
  add column if not exists updated_at timestamptz not null default now();

alter table public.installment_products drop constraint if exists installment_products_sale_status_check;
alter table public.installment_products add constraint installment_products_sale_status_check
  check (sale_status in ('available','installment','sold'));
alter table public.installment_products drop constraint if exists installment_products_code_status_check;
alter table public.installment_products add constraint installment_products_code_status_check
  check (code_status in ('for_sale','installment','installment_complete','sold'));

create index if not exists idx_installment_products_assigned_customer on public.installment_products(assigned_customer_id);
create index if not exists idx_installment_plans_product_customer on public.installment_plans(product_id,customer_id,status,created_at desc);

alter table public.customers enable row level security;
alter table public.installment_products enable row level security;
alter table public.installment_plans enable row level security;
grant select,insert,update,delete on public.customers to authenticated;
grant select,insert,update,delete on public.installment_products to authenticated;
grant select,insert,update,delete on public.installment_plans to authenticated;

drop policy if exists "admins can read customers" on public.customers;
drop policy if exists "admins can write customers" on public.customers;
create policy "admins can read customers" on public.customers for select to authenticated using (public.is_admin());
create policy "admins can write customers" on public.customers for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admins can read installment products" on public.installment_products;
drop policy if exists "admins can write installment products" on public.installment_products;
create policy "admins can read installment products" on public.installment_products for select to authenticated using (public.is_admin());
create policy "admins can write installment products" on public.installment_products for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admins can read installment plans" on public.installment_plans;
drop policy if exists "admins can write installment plans" on public.installment_plans;
create policy "admins can read installment plans" on public.installment_plans for select to authenticated using (public.is_admin());
create policy "admins can write installment plans" on public.installment_plans for all to authenticated using (public.is_admin()) with check (public.is_admin());

create or replace function public.sync_installment_product_link()
returns trigger language plpgsql security definer set search_path=public as $$
declare pid uuid;
begin
  pid := case when tg_op='DELETE' then old.product_id else new.product_id end;
  if tg_op <> 'DELETE' then
    update public.installment_products
    set assigned_customer_id=new.customer_id,
        sale_status=case when new.status='paid' then 'sold' when new.status='active' then 'installment' else 'available' end,
        code_status=case when new.status='paid' then 'installment_complete' when new.status='active' then 'installment' else 'for_sale' end,
        is_active=true, updated_at=now()
    where id=pid;
  else
    if exists(select 1 from public.installment_plans where product_id=pid and status='active') then
      update public.installment_products set sale_status='installment',code_status='installment',is_active=true,updated_at=now() where id=pid;
    elsif exists(select 1 from public.installment_plans where product_id=pid and status='paid') then
      update public.installment_products set sale_status='sold',code_status='installment_complete',is_active=true,updated_at=now() where id=pid;
    else
      update public.installment_products set sale_status='available',code_status='for_sale',updated_at=now() where id=pid;
    end if;
  end if;
  return coalesce(new,old);
end $$;

drop trigger if exists trg_sync_installment_product_link on public.installment_plans;
create trigger trg_sync_installment_product_link
after insert or update of customer_id,product_id,status or delete on public.installment_plans
for each row execute function public.sync_installment_product_link();

-- repair existing active/paid plans
update public.installment_products p
set assigned_customer_id=pl.customer_id,sale_status='installment',code_status='installment',is_active=true,updated_at=now()
from public.installment_plans pl
where pl.id=(select x.id from public.installment_plans x where x.product_id=p.id and x.status='active' order by x.created_at desc limit 1);
update public.installment_products p
set sale_status='sold',code_status='installment_complete',is_active=true,updated_at=now()
where not exists(select 1 from public.installment_plans x where x.product_id=p.id and x.status='active')
  and exists(select 1 from public.installment_plans x where x.product_id=p.id and x.status='paid');
