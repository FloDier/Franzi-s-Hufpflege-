-- =====================================================================
-- Franzi's Hufpflege – Datenbank-Einrichtung für Supabase
-- Einmal komplett im Supabase "SQL Editor" ausführen (Run).
-- Kann gefahrlos erneut ausgeführt werden (bestehende Daten bleiben).
-- =====================================================================

-- ---------- Tabellen ----------
create table if not exists public.settings (
  id int primary key default 1 check (id = 1),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.customers (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.appts (
  id text primary key,
  customer_id text,
  day date not null,
  start_min int not null,
  end_min int not null,
  status text not null default 'bestätigt',   -- 'neu' = online vom Kunden gebucht, noch nicht bestätigt
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create index if not exists appts_day_idx on public.appts (day);

-- ---------- Zugriffsschutz (Row Level Security) ----------
-- Nur angemeldete Benutzer (Franzi + zweite Person) dürfen Kunden & Termine lesen/ändern.
-- Kunden ohne Anmeldung (QR-Code) haben KEINEN Tabellenzugriff, nur die zwei Funktionen unten.
alter table public.settings  enable row level security;
alter table public.customers enable row level security;
alter table public.appts     enable row level security;

drop policy if exists "team_all" on public.settings;
drop policy if exists "team_all" on public.customers;
drop policy if exists "team_all" on public.appts;
create policy "team_all" on public.settings  for all to authenticated using (true) with check (true);
create policy "team_all" on public.customers for all to authenticated using (true) with check (true);
create policy "team_all" on public.appts     for all to authenticated using (true) with check (true);

revoke all on public.settings, public.customers, public.appts from anon;
grant select, insert, update, delete on public.settings, public.customers, public.appts to authenticated;

-- ---------- Öffentlich: freie Zeiten abrufen (ohne Kundendaten) ----------
create or replace function public.get_booking_info()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  s jsonb;
  today date := (now() at time zone 'Europe/Berlin')::date;
  horizon int;
begin
  select data into s from settings where id = 1;
  if s is null then
    return json_build_object('ok', false, 'error', 'Online-Buchung ist noch nicht eingerichtet.');
  end if;
  horizon := least(greatest(coalesce((s->>'horizonWeeks')::int, 8), 1), 26);
  return json_build_object(
    'ok', true,
    'today', today,
    'name', s->>'name', 'phone', s->>'phone', 'mail', s->>'mail',
    'work', s->'work', 'raster', s->'raster', 'minPerHorse', s->'minPerHorse', 'buffer', s->'buffer',
    'horizonWeeks', horizon,
    'blocked', coalesce(s->'blocked', '[]'::jsonb),
    'busy', coalesce((
      select json_agg(json_build_array(to_char(day, 'YYYY-MM-DD'), start_min, end_min))
      from appts where day between today and today + horizon * 7
    ), '[]'::json)
  );
end;
$$;

-- ---------- Öffentlich: Termin verbindlich buchen ----------
-- Prüft auf dem Server, ob die Zeit wirklich frei ist (inkl. Puffer), damit nie doppelt gebucht wird.
create or replace function public.book_slot(p_day date, p_start int, p_end int, p_customer jsonb, p_note text default '')
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  s jsonb; wh jsonb; buf int; horizon int; open_count int; new_id text;
  today date := (now() at time zone 'Europe/Berlin')::date;
  now_min int := extract(hour from now() at time zone 'Europe/Berlin')::int * 60 + extract(minute from now() at time zone 'Europe/Berlin')::int;
  horses jsonb;
begin
  select data into s from settings where id = 1;
  if s is null then return json_build_object('ok', false, 'error', 'Online-Buchung ist noch nicht eingerichtet.'); end if;
  buf := coalesce((s->>'buffer')::int, 0);
  horizon := least(greatest(coalesce((s->>'horizonWeeks')::int, 8), 1), 26);

  -- Eingaben prüfen
  if p_customer is null or jsonb_typeof(p_customer) <> 'object' or length(p_customer::text) > 3000 or length(coalesce(p_note, '')) > 1000 then
    return json_build_object('ok', false, 'error', 'Ungültige Angaben.');
  end if;
  if coalesce(trim(p_customer->>'o'), '') = '' or coalesce(trim(p_customer->>'t'), '') = '' then
    return json_build_object('ok', false, 'error', 'Bitte Name und Telefonnummer angeben.');
  end if;
  if p_day < today or p_day > today + horizon * 7 or (p_day = today and p_start < now_min) then
    return json_build_object('ok', false, 'error', 'Dieser Tag ist nicht buchbar.');
  end if;
  if p_end <= p_start or p_end - p_start > 720 then
    return json_build_object('ok', false, 'error', 'Ungültige Uhrzeit.');
  end if;
  if coalesce(s->'blocked', '[]'::jsonb) ? to_char(p_day, 'YYYY-MM-DD') then
    return json_build_object('ok', false, 'error', 'An diesem Tag ist geschlossen.');
  end if;
  wh := s->'work'->(extract(dow from p_day)::int);
  if wh is null or jsonb_typeof(wh) <> 'array' or p_start < (wh->>0)::int or p_end > (wh->>1)::int then
    return json_build_object('ok', false, 'error', 'Außerhalb der Arbeitszeit.');
  end if;

  -- Schutz gegen Spam: höchstens 3 offene Online-Buchungen pro Telefonnummer
  select count(*) into open_count from appts
   where status = 'neu' and regexp_replace(data->'request'->>'t', '\D', '', 'g') = regexp_replace(p_customer->>'t', '\D', '', 'g');
  if open_count >= 3 then
    return json_build_object('ok', false, 'error', 'Sie haben bereits mehrere offene Buchungen. Bitte warten Sie auf die Bestätigung.');
  end if;

  -- Gleichzeitige Buchungen für denselben Tag nacheinander abarbeiten
  perform pg_advisory_xact_lock(hashtext('hufpflege-' || p_day::text));
  if exists (select 1 from appts where day = p_day and p_start < end_min + buf and p_end + buf > start_min) then
    return json_build_object('ok', false, 'error', 'belegt');
  end if;

  horses := case when jsonb_typeof(p_customer->'h') = 'array' then p_customer->'h' else '[]'::jsonb end;
  new_id := 'k' || substr(md5(random()::text || clock_timestamp()::text), 1, 12);
  insert into appts (id, customer_id, day, start_min, end_min, status, data) values (
    new_id, nullif(p_customer->>'i', ''), p_day, p_start, p_end, 'neu',
    jsonb_build_object(
      'id', new_id, 'customerId', nullif(p_customer->>'i', ''), 'date', to_char(p_day, 'YYYY-MM-DD'),
      'start', p_start, 'end', p_end, 'horses', horses,
      'count', greatest(case when p_customer->>'n' ~ '^\d{1,2}$' then (p_customer->>'n')::int else jsonb_array_length(horses) end, 1),
      'note', coalesce(p_note, ''), 'source', 'kunde', 'status', 'neu', 'request', p_customer,
      'created', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    )
  );
  return json_build_object('ok', true, 'id', new_id);
end;
$$;

revoke all on function public.get_booking_info() from public;
revoke all on function public.book_slot(date, int, int, jsonb, text) from public;
grant execute on function public.get_booking_info() to anon, authenticated;
grant execute on function public.book_slot(date, int, int, jsonb, text) to anon, authenticated;
