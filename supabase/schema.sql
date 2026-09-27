-- =====================================================================
--  COMPETENCIA BÍBLICA — Esquema Supabase
--  Ejecuta este archivo completo en: Supabase > SQL Editor > New query
--  Es seguro volver a ejecutarlo (idempotente).
-- =====================================================================

create extension if not exists unaccent with schema extensions;
create extension if not exists fuzzystrmatch with schema extensions;

-- ---------------------------------------------------------------------
-- TABLAS
-- ---------------------------------------------------------------------

create table if not exists public.admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text,
  created_at timestamptz not null default now()
);

create table if not exists public.participants (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(trim(name)) between 1 and 60),
  created_at timestamptz not null default now()
);
create unique index if not exists participants_name_uq on public.participants (lower(trim(name)));

create table if not exists public.emoji_items (
  id         uuid primary key default gen_random_uuid(),
  difficulty text not null check (difficulty in ('facil','intermedio','dificil')),
  clues      text[] not null check (array_length(clues, 1) between 2 and 6),
  answer     text not null,
  aliases    text[] not null default '{}',
  reference  text,
  created_at timestamptz not null default now()
);

create table if not exists public.quiz_questions (
  id            uuid primary key default gen_random_uuid(),
  difficulty    text not null check (difficulty in ('facil','intermedio','dificil')),
  question      text not null,
  options       text[] not null check (array_length(options, 1) between 2 and 4),
  correct_index int not null check (correct_index >= 0 and correct_index < 4),
  reference     text,
  created_at    timestamptz not null default now()
);

-- Código Secreto Bíblico: cada ítem trae el código a descifrar y el versículo que lo confirma.
create table if not exists public.cipher_items (
  id            uuid primary key default gen_random_uuid(),
  difficulty    text not null check (difficulty in ('facil','intermedio','dificil')),
  kind          text not null check (kind in ('numeros','reverso','anagrama','desplazado','sin_vocales','acertijo','frase')),
  puzzle        text not null,
  hint          text,
  answer        text not null,
  aliases       text[] not null default '{}',
  verse_prompt  text not null,
  verse_book    text not null,
  verse_chapter int  not null check (verse_chapter > 0),
  verse_from    int  not null check (verse_from > 0),
  verse_to      int,
  created_at    timestamptz not null default now()
);

create table if not exists public.taboo_items (
  id         uuid primary key default gen_random_uuid(),
  difficulty text not null check (difficulty in ('facil','intermedio','dificil')),
  word       text not null,
  forbidden  text[] not null check (array_length(forbidden, 1) between 3 and 6),
  reference  text,
  created_at timestamptz not null default now()
);

-- Subasta Bíblica: la pregunta llega después de apostar; solo se anuncian categoría y nivel.
create table if not exists public.auction_questions (
  id         uuid primary key default gen_random_uuid(),
  category   text not null check (char_length(trim(category)) between 1 and 60),
  difficulty text not null check (difficulty in ('facil','intermedio','dificil')),
  question   text not null,
  answer     text not null,
  aliases    text[] not null default '{}',
  reference  text,
  created_at timestamptz not null default now()
);

-- Línea del Tiempo Humana: `events` va en orden cronológico; cada equipo recibe
-- tantas tarjetas como integrantes, sacadas al azar de esta lista.
create table if not exists public.timeline_sets (
  id          uuid primary key default gen_random_uuid(),
  difficulty  text not null check (difficulty in ('facil','intermedio','dificil')),
  title       text not null check (char_length(trim(title)) between 1 and 80),
  events      text[] not null check (array_length(events, 1) between 4 and 8),
  explanation text,
  created_at  timestamptz not null default now()
);

create table if not exists public.rooms (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  status           text not null default 'open' check (status in ('open','closed')),
  view             text not null default 'lobby' check (view in ('lobby','round','leaderboard','podium')),
  current_round_id uuid,
  -- Apágalo en salas de prueba para que no ensucien el ranking histórico.
  counts_for_history boolean not null default true,
  created_at       timestamptz not null default now()
);

-- Los códigos viven aparte para que no sean legibles públicamente.
create table if not exists public.room_codes (
  code    text primary key check (code ~ '^[0-9]{4}$'),
  room_id uuid not null unique references public.rooms(id) on delete cascade
);

create table if not exists public.room_players (
  room_id        uuid not null references public.rooms(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  joined_at      timestamptz not null default now(),
  primary key (room_id, participant_id)
);
alter table public.room_players replica identity full;

create table if not exists public.player_tokens (
  token          uuid primary key default gen_random_uuid(),
  room_id        uuid not null,
  participant_id uuid not null,
  last_seen      timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  foreign key (room_id, participant_id)
    references public.room_players(room_id, participant_id) on delete cascade
);

-- Tabú bíblico: los equipos se arman por sala, no son permanentes.
create table if not exists public.teams (
  id         uuid primary key default gen_random_uuid(),
  room_id    uuid not null references public.rooms(id) on delete cascade,
  name       text not null,
  seq        int  not null,
  created_at timestamptz not null default now(),
  unique (room_id, seq)
);

create table if not exists public.team_members (
  team_id        uuid not null references public.teams(id) on delete cascade,
  room_id        uuid not null references public.rooms(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  primary key (team_id, participant_id)
);
create unique index if not exists team_members_one_per_room on public.team_members(room_id, participant_id);
alter table public.teams        replica identity full;
alter table public.team_members replica identity full;

-- Subasta Bíblica: una partida por sala a la vez, con los equipos de la sala.
create table if not exists public.auctions (
  id              uuid primary key default gen_random_uuid(),
  room_id         uuid not null references public.rooms(id) on delete cascade,
  status          text not null default 'running' check (status in ('running','finished')),
  rounds_total    int  not null check (rounds_total between 1 and 30),
  initial_balance int  not null,
  created_at      timestamptz not null default now(),
  finished_at     timestamptz
);
create unique index if not exists auctions_one_running on public.auctions(room_id) where status = 'running';

-- Saldo de cada equipo. Nombre y número se copian para que el resultado sobreviva
-- a que después se rehagan los equipos de la sala.
create table if not exists public.auction_teams (
  id            uuid primary key default gen_random_uuid(),
  auction_id    uuid not null references public.auctions(id) on delete cascade,
  team_id       uuid references public.teams(id) on delete set null,
  name          text not null,
  seq           int  not null,
  balance       int  not null,
  -- el celular que apuesta y responde por el equipo
  controller_id uuid references public.participants(id) on delete set null,
  unique (auction_id, seq)
);
alter table public.auctions      replica identity full;
alter table public.auction_teams replica identity full;

create table if not exists public.rounds (
  id             uuid primary key default gen_random_uuid(),
  room_id        uuid not null references public.rooms(id) on delete cascade,
  game           text not null check (game in ('emoji','quiz','taboo','cipher','auction','timeline')),
  difficulty     text not null check (difficulty in ('facil','intermedio','dificil')),
  item_id        uuid not null,
  seq            int  not null,
  status         text not null default 'active' check (status in ('pending','active','revealed')),
  clues_total    int,
  clues_revealed int  not null default 0,
  prompt         text,
  options        text[],
  team_id        uuid,   -- Tabú: equipo al que le toca el turno
  describer_id   uuid,   -- Tabú: integrante que describe la palabra
  auction_id     uuid references public.auctions(id) on delete set null, -- Subasta
  category       text,   -- Subasta: lo único que se anuncia antes de apostar
  started_at     timestamptz not null default now(),
  deadline       timestamptz,
  answer_text    text,   -- se llena solo al revelar
  correct_index  int,    -- se llena solo al revelar
  revealed_at    timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists rounds_room_idx on public.rounds(room_id);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'rooms_current_round_fk') then
    alter table public.rooms add constraint rooms_current_round_fk
      foreign key (current_round_id) references public.rounds(id) on delete set null;
  end if;
end $$;

-- Actualiza bases creadas antes de «Tabú bíblico» y del ranking histórico.
do $$ begin
  alter table public.rooms  add column if not exists counts_for_history boolean not null default true;
  alter table public.rounds add column if not exists team_id uuid;
  alter table public.rounds add column if not exists describer_id uuid;
  alter table public.rounds add column if not exists auction_id uuid references public.auctions(id) on delete set null;
  alter table public.rounds add column if not exists category text;
  alter table public.rounds drop constraint if exists rounds_game_check;
  alter table public.rounds add  constraint rounds_game_check   check (game in ('emoji','quiz','taboo','cipher','auction','timeline'));
  alter table public.rounds drop constraint if exists rounds_status_check;
  alter table public.rounds add  constraint rounds_status_check check (status in ('pending','active','revealed'));
  if not exists (select 1 from pg_constraint where conname = 'rounds_team_fk') then
    alter table public.rounds add constraint rounds_team_fk
      foreign key (team_id) references public.teams(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'rounds_describer_fk') then
    alter table public.rounds add constraint rounds_describer_fk
      foreign key (describer_id) references public.participants(id) on delete set null;
  end if;
end $$;

create table if not exists public.answers (
  id             uuid primary key default gen_random_uuid(),
  round_id       uuid not null references public.rounds(id) on delete cascade,
  room_id        uuid not null references public.rooms(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  answer_text    text,
  choice         int,
  is_correct     boolean not null default false,
  points         int not null default 0,
  clue_number    int,
  elapsed_ms     int,
  -- Código Secreto: 2ª fase. `points` guarda el total (código + bono del versículo).
  verse_text     text,
  verse_ok       boolean,
  verse_points   int not null default 0,
  verse_tries    int not null default 0,
  created_at     timestamptz not null default now()
);
create index if not exists answers_room_idx on public.answers(room_id);
create index if not exists answers_round_idx on public.answers(round_id);
create unique index if not exists answers_one_correct on public.answers(round_id, participant_id) where is_correct;
create unique index if not exists answers_one_choice  on public.answers(round_id, participant_id) where choice is not null;

-- Actualiza bases creadas antes del «Código Secreto Bíblico».
do $$ begin
  alter table public.answers add column if not exists verse_text   text;
  alter table public.answers add column if not exists verse_ok     boolean;
  alter table public.answers add column if not exists verse_points int not null default 0;
  alter table public.answers add column if not exists verse_tries  int not null default 0;
end $$;

-- Subasta: una fila por equipo y ronda. Solo la lee el admin; los celulares
-- la reciben filtrada por player_state, así nadie ve apuestas ajenas antes de tiempo.
create table if not exists public.auction_bids (
  round_id        uuid not null references public.rounds(id) on delete cascade,
  auction_team_id uuid not null references public.auction_teams(id) on delete cascade,
  amount          int  not null check (amount > 0),
  auto            boolean not null default false,  -- no apostaron a tiempo: se puso la mínima
  bid_at          timestamptz not null default now(),
  answer_text     text,
  is_correct      boolean,
  answered_at     timestamptz,
  delta           int,     -- se llena al revelar: lo que ganó o perdió
  balance_after   int,
  primary key (round_id, auction_team_id)
);

-- Línea del Tiempo: la tarjeta secreta de cada participante en la ronda.
-- `pos` es su lugar en la cronología del set. Solo la lee el admin.
create table if not exists public.timeline_cards (
  round_id       uuid not null references public.rounds(id) on delete cascade,
  team_id        uuid not null references public.teams(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  event          text not null,
  pos            int  not null,
  primary key (round_id, participant_id)
);

-- Línea del Tiempo: intentos y resultado de cada equipo en la ronda.
create table if not exists public.timeline_results (
  round_id    uuid not null references public.rounds(id) on delete cascade,
  team_id     uuid not null references public.teams(id) on delete cascade,
  attempts    int  not null default 0,
  wrong       int  not null default 0,
  last_try_at timestamptz,
  solved_at   timestamptz,
  elapsed_ms  int,
  place       int,
  points      int  not null default 0,
  primary key (round_id, team_id)
);

-- ---------------------------------------------------------------------
-- UTILIDADES
-- ---------------------------------------------------------------------

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- El primer usuario autenticado que llame a esta función se vuelve admin.
create or replace function public.claim_admin() returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return false; end if;
  if exists (select 1 from admins where user_id = auth.uid()) then return true; end if;
  if not exists (select 1 from admins) then
    insert into admins(user_id, email) values (auth.uid(), auth.jwt() ->> 'email');
    return true;
  end if;
  return false;
end $$;

create or replace function public.server_now() returns timestamptz
language sql volatile as $$ select clock_timestamp() $$;

-- Normaliza texto: minúsculas, sin tildes, sin signos, sin palabras vacías.
create or replace function public.norm_text(t text) returns text
language plpgsql stable set search_path = public, extensions as $$
declare
  s text; w text; res text := '';
  stop text[] := array['el','la','los','las','un','una','unos','unas','de','del','al','a','y','e','en',
                       'con','por','su','sus','lo','que','es','era','fue','rey','reina','profeta',
                       'profetisa','apostol','san','santo','historia','parabola'];
begin
  s := lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(t, '')));
  s := regexp_replace(s, '[^a-z0-9 ]', ' ', 'g');
  foreach w in array regexp_split_to_array(trim(s), '\s+') loop
    if w <> '' and not (w = any(stop)) then res := res || ' ' || w; end if;
  end loop;
  return trim(res);
end $$;

-- ¿La respuesta escrita coincide con alguna aceptada? (tolera errores leves de ortografía)
create or replace function public.answer_matches(p_input text, p_accepted text[]) returns boolean
language plpgsql stable set search_path = public, extensions as $$
declare
  i text := norm_text(p_input);
  i_compact text := replace(norm_text(p_input), ' ', '');
  i_words int;
  a text; na text; na_compact text; tol int;
begin
  if i = '' then return false; end if;
  i_words := array_length(regexp_split_to_array(i, ' '), 1);
  foreach a in array p_accepted loop
    na := norm_text(a);
    continue when na = '';
    na_compact := replace(na, ' ', '');
    if i_compact = na_compact then return true; end if;
    tol := case when length(na_compact) >= 10 then 2 when length(na_compact) >= 6 then 1 else 0 end;
    if tol > 0 and extensions.levenshtein(i_compact, na_compact) <= tol then return true; end if;
    -- respuesta contenida en una frase corta ("creo que es moises")
    if length(na_compact) >= 4
       and i_words <= array_length(regexp_split_to_array(na, ' '), 1) + 1
       and position(' ' || na || ' ' in ' ' || i || ' ') > 0 then
      return true;
    end if;
  end loop;
  return false;
end $$;

-- PUNTAJES --------------------------------------------------------------
-- Emojis: 1 pista = 100, 2 = 70, 3 = 50, 4 o más = 30  × nivel (fácil 1, intermedio 1.5, difícil 2)
create or replace function public.emoji_points(p_difficulty text, p_clue int) returns int
language sql immutable as $$
  select round(
    (case when p_clue <= 1 then 100 when p_clue = 2 then 70 when p_clue = 3 then 50 else 30 end)
    * (case p_difficulty when 'dificil' then 2.0 when 'intermedio' then 1.5 else 1.0 end)
  )::int
$$;

-- Selección múltiple: base (fácil 50, intermedio 75, difícil 100) + 1 punto por cada segundo que sobre (máx. 20)
create or replace function public.quiz_points(p_difficulty text, p_elapsed_ms int) returns int
language sql immutable as $$
  select (case p_difficulty when 'dificil' then 100 when 'intermedio' then 75 else 50 end)
       + greatest(0, least(20, floor((20000 - p_elapsed_ms) / 1000.0)))::int
$$;

-- Código Secreto — descifrar: 20 base + 1 punto por cada segundo que sobre de los 60, × nivel.
create or replace function public.cipher_points(p_difficulty text, p_elapsed_ms int) returns int
language sql immutable as $$
  select round(
    (20 + 1.0 * greatest(0, least(60, 60 - p_elapsed_ms / 1000.0)))
    * (case p_difficulty when 'dificil' then 2.0 when 'intermedio' then 1.5 else 1.0 end)
  )::int
$$;

-- Código Secreto — bono bíblico: 10 base + 0.5 por cada segundo que sobre de los 60, × nivel.
create or replace function public.verse_points(p_difficulty text, p_elapsed_ms int) returns int
language sql immutable as $$
  select round(
    (10 + 0.5 * greatest(0, least(60, 60 - p_elapsed_ms / 1000.0)))
    * (case p_difficulty when 'dificil' then 2.0 when 'intermedio' then 1.5 else 1.0 end)
  )::int
$$;

-- Tabú: 30 base + 1.5 puntos por cada segundo que sobre de los 45,
-- todo × nivel (fácil 1, intermedio 1.5, difícil 2). Lo ganan todos los del equipo.
create or replace function public.taboo_points(p_difficulty text, p_elapsed_ms int) returns int
language sql immutable as $$
  select round(
    (30 + 1.5 * greatest(0, least(45, 45 - p_elapsed_ms / 1000.0)))
    * (case p_difficulty when 'dificil' then 2.0 when 'intermedio' then 1.5 else 1.0 end)
  )::int
$$;

-- Subasta: saldo inicial 300; se apuesta de 20 a 150 por ronda (o todo el saldo si es menor).
-- Acertar paga lo apostado × nivel (fácil 1, intermedio 1.5, difícil 2); fallar lo resta.
-- Un equipo con menos de 20 igual puede apostar 20: si falla, su saldo queda en 0, nunca negativo.
create or replace function public.auction_gain(p_difficulty text, p_amount int) returns int
language sql immutable as $$
  select round(p_amount * (case p_difficulty when 'dificil' then 2.0 when 'intermedio' then 1.5 else 1.0 end))::int
$$;

create or replace function public.auction_max_bid(p_balance int) returns int
language sql immutable as $$ select greatest(20, least(150, p_balance)) $$;

-- Línea del Tiempo: según el orden de llegada (1º 100, 2º 80, 3º 65, luego 50),
-- menos 10 por cada intento fallido (mínimo 30), todo × nivel. Lo gana cada integrante.
create or replace function public.timeline_points(p_difficulty text, p_place int, p_wrong int) returns int
language sql immutable as $$
  select round(
    greatest(30, (case p_place when 1 then 100 when 2 then 80 when 3 then 65 else 50 end) - 10 * coalesce(p_wrong, 0))
    * (case p_difficulty when 'dificil' then 2.0 when 'intermedio' then 1.5 else 1.0 end)
  )::int
$$;

-- ---------------------------------------------------------------------
-- FUNCIONES DEL ADMINISTRADOR
-- ---------------------------------------------------------------------

create or replace function public.create_room(p_name text) returns json
language plpgsql security definer set search_path = public as $$
declare v_room uuid; v_code text; v_try int := 0;
begin
  if not is_admin() then raise exception 'No autorizado'; end if;
  insert into rooms(name) values (coalesce(nullif(trim(p_name), ''), 'Sala')) returning id into v_room;
  loop
    v_code := lpad(floor(random() * 10000)::int::text, 4, '0');
    begin
      insert into room_codes(code, room_id) values (v_code, v_room);
      exit;
    exception when unique_violation then
      v_try := v_try + 1;
      if v_try > 100 then raise exception 'No se pudo generar un código'; end if;
    end;
  end loop;
  return json_build_object('id', v_room, 'code', v_code);
end $$;

-- Versión anterior (sin p_force): se elimina para evitar ambigüedad al llamarla.
drop function if exists public.reveal_round(uuid);

-- Revela la respuesta de una ronda.
--  p_force = true  → revela ya (botón "Revelar respuesta" del admin, nueva ronda, cerrar sala).
--  p_force = false → solo si terminó el tiempo o si todos ya respondieron/acertaron.
-- Devuelve true si la ronda quedó revelada.
create or replace function public.reveal_round(p_round uuid, p_force boolean default false) returns boolean
language plpgsql security definer set search_path = public as $$
declare rd rounds; v_players int; v_answered int; v_correct int;
begin
  if not is_admin() then raise exception 'No autorizado'; end if;
  select * into rd from rounds where id = p_round;
  if not found then return false; end if;
  if rd.status = 'revealed' then return true; end if;
  -- Tabú en preparación (aún sin cronómetro): solo el admin puede cerrarla.
  if rd.status = 'pending' and not p_force then return false; end if;

  if not p_force then
    if rd.game = 'cipher' then
      -- La ventana del versículo es personal (60 s desde que cada uno descifra),
      -- así que la ronda solo se cierra cuando ya nadie puede seguir jugando.
      if exists (
        select 1 from room_players rp
         where rp.room_id = rd.room_id
           and not exists (select 1 from answers a
                            where a.round_id = rd.id and a.participant_id = rp.participant_id
                              and a.is_correct and a.verse_ok is not null)
           and ( (clock_timestamp() < rd.deadline
                  and not exists (select 1 from answers a
                                   where a.round_id = rd.id and a.participant_id = rp.participant_id
                                     and a.is_correct))
              or exists (select 1 from answers a
                          where a.round_id = rd.id and a.participant_id = rp.participant_id
                            and a.is_correct
                            and clock_timestamp() < a.created_at + interval '60 seconds') )
      ) then
        return false;
      end if;
    elsif rd.game = 'timeline' then
      -- Se cierra al vencer el tiempo o cuando ya ningún equipo puede seguir
      -- (todos acertaron o agotaron sus 6 intentos).
      if clock_timestamp() < rd.deadline and exists (
        select 1 from timeline_results tr
         where tr.round_id = rd.id and tr.solved_at is null and tr.wrong < 6
      ) then
        return false;
      end if;
    elsif rd.game = 'auction' then
      -- Se cierra al vencer el tiempo o cuando todos los equipos respondieron.
      if clock_timestamp() < rd.deadline and exists (
        select 1 from auction_teams at
         where at.auction_id = rd.auction_id
           and not exists (select 1 from auction_bids b
                            where b.round_id = rd.id and b.auction_team_id = at.id
                              and b.answered_at is not null)
      ) then
        return false;
      end if;
    else
      select count(*) into v_players from room_players where room_id = rd.room_id;
      select count(distinct participant_id), count(*) filter (where is_correct)
        into v_answered, v_correct
        from answers where round_id = rd.id;
      if not (
        (rd.deadline is not null and clock_timestamp() >= rd.deadline)
        or (clock_timestamp() >= rd.started_at and v_players > 0 and (
              (rd.game = 'quiz'  and v_answered >= v_players)
           or (rd.game = 'emoji' and v_correct  >= v_players)))
      ) then
        return false;
      end if;
    end if;
  end if;

  update rounds r set
    status = 'revealed',
    revealed_at = clock_timestamp(),
    answer_text = case r.game
      when 'emoji'  then (select e.answer from emoji_items e where e.id = r.item_id)
      when 'taboo'  then (select ti.word from taboo_items ti where ti.id = r.item_id)
      when 'cipher' then (select ci.answer from cipher_items ci where ci.id = r.item_id)
      when 'auction' then (select aq.answer from auction_questions aq where aq.id = r.item_id)
      when 'timeline' then (select array_to_string(ts.events, ' → ') from timeline_sets ts where ts.id = r.item_id)
      else (select q.options[q.correct_index + 1] from quiz_questions q where q.id = r.item_id) end,
    correct_index = case when r.game = 'quiz'
      then (select q.correct_index from quiz_questions q where q.id = r.item_id) end,
    clues_revealed = coalesce(r.clues_total, r.clues_revealed)
  where r.id = p_round and r.status <> 'revealed';

  -- Subasta: se liquida una sola vez (el update de arriba solo afecta una fila la primera vez).
  -- Si se cerró mientras apostaban, la pregunta nunca se mostró y la ronda queda anulada.
  if found and rd.game = 'auction' and rd.status = 'active' then
    perform settle_auction_round(p_round);
  end if;
  return true;
end $$;

-- Aplica el resultado de la ronda al saldo de cada equipo.
create or replace function public.settle_auction_round(p_round uuid) returns void
language plpgsql security definer set search_path = public as $$
declare rd rounds; b auction_bids; v_bal int; v_delta int;
begin
  select * into rd from rounds where id = p_round and game = 'auction';
  if not found then return; end if;
  for b in select * from auction_bids where round_id = p_round and delta is null loop
    select balance into v_bal from auction_teams where id = b.auction_team_id for update;
    v_delta := case when coalesce(b.is_correct, false)
                    then auction_gain(rd.difficulty, b.amount)
                    else -least(b.amount, v_bal) end;
    update auction_teams set balance = v_bal + v_delta where id = b.auction_team_id;
    update auction_bids set delta = v_delta, balance_after = v_bal + v_delta
     where round_id = b.round_id and auction_team_id = b.auction_team_id;
  end loop;
end $$;

create or replace function public.start_round(p_room uuid, p_game text, p_difficulty text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_seq int; v_id uuid; v_old uuid; e emoji_items; q quiz_questions; ci cipher_items;
begin
  if not is_admin() then raise exception 'No autorizado'; end if;
  if not exists (select 1 from rooms where id = p_room and status = 'open') then
    raise exception 'La sala no está abierta';
  end if;
  if exists (select 1 from auctions where room_id = p_room and status = 'running') then
    raise exception 'Hay una Subasta Bíblica en curso. Termínala antes de cambiar de juego.';
  end if;
  for v_old in select id from rounds where room_id = p_room and status <> 'revealed' loop
    perform reveal_round(v_old, true);
  end loop;
  select coalesce(max(seq), 0) + 1 into v_seq from rounds where room_id = p_room;

  if p_game = 'emoji' then
    select * into e from emoji_items it
     where it.difficulty = p_difficulty
       and not exists (select 1 from rounds r where r.room_id = p_room and r.item_id = it.id)
     order by random() limit 1;
    if not found then raise exception 'Ya no quedan emojis de nivel % en esta sala', p_difficulty; end if;
    insert into rounds(room_id, game, difficulty, item_id, seq, clues_total, clues_revealed, started_at)
    values (p_room, 'emoji', e.difficulty, e.id, v_seq, array_length(e.clues, 1), 1, clock_timestamp())
    returning id into v_id;
  elsif p_game = 'quiz' then
    select * into q from quiz_questions it
     where it.difficulty = p_difficulty
       and not exists (select 1 from rounds r where r.room_id = p_room and r.item_id = it.id)
     order by random() limit 1;
    if not found then raise exception 'Ya no quedan preguntas de nivel % en esta sala', p_difficulty; end if;
    -- 3 segundos de "¡prepárate!" y luego 20 segundos para responder
    insert into rounds(room_id, game, difficulty, item_id, seq, prompt, options, started_at, deadline)
    values (p_room, 'quiz', q.difficulty, q.id, v_seq, q.question, q.options,
            clock_timestamp() + interval '3 seconds', clock_timestamp() + interval '23 seconds')
    returning id into v_id;
  elsif p_game = 'cipher' then
    select * into ci from cipher_items it
     where it.difficulty = p_difficulty
       and not exists (select 1 from rounds r where r.room_id = p_room and r.item_id = it.id)
     order by random() limit 1;
    if not found then raise exception 'Ya no quedan códigos de nivel % en esta sala', p_difficulty; end if;
    -- 60 s para descifrar; el cronómetro del versículo es personal y arranca al acertar.
    insert into rounds(room_id, game, difficulty, item_id, seq, started_at, deadline)
    values (p_room, 'cipher', ci.difficulty, ci.id, v_seq, clock_timestamp(),
            clock_timestamp() + interval '60 seconds')
    returning id into v_id;
  else
    raise exception 'Juego desconocido';
  end if;

  update rooms set current_round_id = v_id, view = 'round' where id = p_room;
  return v_id;
end $$;

create or replace function public.reveal_clue(p_round uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'No autorizado'; end if;
  update rounds set
    clues_revealed = clues_revealed + 1,
    -- al mostrar la última pista empiezan los 30 segundos finales
    deadline = case when clues_revealed + 1 >= clues_total
                    then clock_timestamp() + interval '30 seconds' else deadline end
  where id = p_round and game = 'emoji' and status = 'active' and clues_revealed < clues_total;
end $$;

-- EQUIPOS (Tabú) ------------------------------------------------------
-- Reparte a todos los de la sala en p_teams equipos del mismo tamaño (±1), al azar.
create or replace function public.assign_teams(p_room uuid, p_teams int default 2) returns json
language plpgsql security definer set search_path = public as $$
declare v_n int; v_count int; i int;
begin
  if not is_admin() then raise exception 'No autorizado'; end if;
  if exists (select 1 from rounds where room_id = p_room and game = 'taboo' and status <> 'revealed') then
    raise exception 'Termina la ronda de Tabú en curso antes de rehacer los equipos';
  end if;
  if exists (select 1 from rounds where room_id = p_room and game = 'timeline' and status <> 'revealed') then
    raise exception 'Termina la ronda de Línea del Tiempo antes de rehacer los equipos';
  end if;
  if exists (select 1 from auctions where room_id = p_room and status = 'running') then
    raise exception 'Termina la Subasta Bíblica antes de rehacer los equipos';
  end if;
  select count(*) into v_count from room_players where room_id = p_room;
  if v_count < 2 then raise exception 'Se necesitan al menos 2 participantes dentro de la sala'; end if;
  v_n := greatest(1, least(coalesce(p_teams, 2), 12, v_count));

  delete from teams where room_id = p_room;  -- en cascada borra team_members
  for i in 1..v_n loop
    insert into teams(room_id, name, seq) values (p_room, 'Equipo ' || i, i);
  end loop;

  with shuffled as (
    select rp.participant_id, row_number() over (order by random()) - 1 as pos
      from room_players rp where rp.room_id = p_room
  )
  insert into team_members(team_id, room_id, participant_id)
  select t.id, p_room, s.participant_id
    from shuffled s
    join teams t on t.room_id = p_room and t.seq = (s.pos % v_n) + 1;

  return json_build_object('teams', v_n, 'players', v_count);
end $$;

-- Mueve a una persona de equipo (o la deja sin equipo si p_team es null).
create or replace function public.set_team(p_room uuid, p_participant uuid, p_team uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'No autorizado'; end if;
  -- Durante la subasta el resultado es del equipo completo: solo se puede sumar a quien llegó tarde.
  if exists (select 1 from auctions where room_id = p_room and status = 'running')
     and exists (select 1 from team_members where room_id = p_room and participant_id = p_participant) then
    raise exception 'Durante la Subasta Bíblica no se puede cambiar a nadie de equipo';
  end if;
  -- Quien ya tiene tarjeta en la línea del tiempo en curso no puede cambiar de equipo.
  if exists (select 1 from timeline_cards c join rounds rd on rd.id = c.round_id
              where rd.room_id = p_room and rd.status <> 'revealed' and c.participant_id = p_participant) then
    raise exception 'Esa persona tiene una tarjeta en la ronda en curso. Espera a que termine.';
  end if;
  delete from team_members where room_id = p_room and participant_id = p_participant;
  if p_team is not null then
    if not exists (select 1 from teams where id = p_team and room_id = p_room) then
      raise exception 'Equipo no válido para esta sala';
    end if;
    insert into team_members(team_id, room_id, participant_id) values (p_team, p_room, p_participant);
  end if;
end $$;

create or replace function public.rename_team(p_team uuid, p_name text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'No autorizado'; end if;
  update teams set name = coalesce(nullif(trim(p_name), ''), name) where id = p_team;
  update auction_teams at set name = t.name
    from teams t, auctions au
   where t.id = p_team and at.team_id = t.id and au.id = at.auction_id and au.status = 'running';
end $$;

create or replace function public.room_teams(p_room uuid) returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(x order by x.seq), '[]'::json) from (
    select t.id, t.name, t.seq,
           coalesce((select json_agg(json_build_object('id', p.id, 'name', p.name) order by p.name)
                       from team_members m join participants p on p.id = m.participant_id
                      where m.team_id = t.id), '[]'::json) as members
      from teams t where t.room_id = p_room
  ) x;
$$;

-- RONDA DE TABÚ --------------------------------------------------------
-- Crea la ronda y elige quién describe: el del equipo que menos veces ha
-- descrito en esta sala, con preferencia a quien está conectado.
create or replace function public.start_taboo_round(p_room uuid, p_difficulty text, p_team uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_seq int; v_id uuid; v_old uuid; it taboo_items; v_desc uuid;
begin
  if not is_admin() then raise exception 'No autorizado'; end if;
  if not exists (select 1 from rooms where id = p_room and status = 'open') then
    raise exception 'La sala no está abierta';
  end if;
  if not exists (select 1 from teams where id = p_team and room_id = p_room) then
    raise exception 'Equipo no válido para esta sala';
  end if;
  if exists (select 1 from auctions where room_id = p_room and status = 'running') then
    raise exception 'Hay una Subasta Bíblica en curso. Termínala antes de cambiar de juego.';
  end if;
  for v_old in select id from rounds where room_id = p_room and status <> 'revealed' loop
    perform reveal_round(v_old, true);
  end loop;

  select c.participant_id into v_desc from (
    select m.participant_id,
           exists (select 1 from room_players rp
                    where rp.room_id = p_room and rp.participant_id = m.participant_id) as here,
           (select count(*) from rounds r
             where r.room_id = p_room and r.describer_id = m.participant_id) as turns
      from team_members m where m.team_id = p_team
  ) c order by c.here desc, c.turns, random() limit 1;
  if v_desc is null then raise exception 'Ese equipo no tiene integrantes'; end if;

  select * into it from taboo_items ti
   where ti.difficulty = p_difficulty
     and not exists (select 1 from rounds r where r.room_id = p_room and r.item_id = ti.id)
   order by random() limit 1;
  if not found then raise exception 'Ya no quedan palabras de nivel % en esta sala', p_difficulty; end if;

  select coalesce(max(seq), 0) + 1 into v_seq from rounds where room_id = p_room;
  insert into rounds(room_id, game, difficulty, item_id, seq, status, team_id, describer_id, started_at)
  values (p_room, 'taboo', it.difficulty, it.id, v_seq, 'pending', p_team, v_desc, clock_timestamp())
  returning id into v_id;

  update rooms set current_round_id = v_id, view = 'round' where id = p_room;
  return v_id;
end $$;

-- Arranca los 45 segundos (el describidor ya leyó su palabra).
create or replace function public.start_taboo_timer(p_round uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'No autorizado'; end if;
  update rounds set status = 'active', started_at = clock_timestamp(),
                    deadline = clock_timestamp() + interval '45 seconds'
   where id = p_round and game = 'taboo' and status = 'pending';
end $$;

-- El admin detiene el cronómetro. p_guessed = true → el equipo acertó y
-- todos sus integrantes reciben los puntos según el tiempo que sobró.
create or replace function public.stop_taboo(p_round uuid, p_guessed boolean) returns json
language plpgsql security definer set search_path = public as $$
declare rd rounds; v_elapsed int := 45000; v_pts int := 0; v_n int := 0;
begin
  if not is_admin() then raise exception 'No autorizado'; end if;
  select * into rd from rounds where id = p_round and game = 'taboo';
  if not found then raise exception 'Ronda no válida'; end if;
  if rd.status = 'revealed' then return json_build_object('ok', false, 'reason', 'already'); end if;

  if p_guessed and rd.status = 'active'
     and rd.deadline is not null and clock_timestamp() <= rd.deadline + interval '1 second' then
    v_elapsed := greatest(0, least(45000, (extract(epoch from clock_timestamp() - rd.started_at) * 1000)::int));
    v_pts := taboo_points(rd.difficulty, v_elapsed);
    insert into answers(round_id, room_id, participant_id, is_correct, points, elapsed_ms)
    select rd.id, rd.room_id, m.participant_id, true, v_pts, v_elapsed
      from team_members m where m.team_id = rd.team_id
    on conflict do nothing;
    get diagnostics v_n = row_count;
  end if;

  perform reveal_round(p_round, true);
  return json_build_object('ok', true, 'points', v_pts, 'members', v_n, 'elapsed_ms', v_elapsed);
end $$;

-- SUBASTA BÍBLICA -------------------------------------------------------
-- Elige el celular que apuesta por el equipo: alguien conectado, al azar.
create or replace function public.pick_auction_controller(p_room uuid, p_team uuid) returns uuid
language sql volatile security definer set search_path = public as $$
  select m.participant_id
    from team_members m
    left join lateral (select max(pt.last_seen) as seen from player_tokens pt
                        where pt.room_id = p_room and pt.participant_id = m.participant_id) x on true
   where m.team_id = p_team
   order by (x.seen > clock_timestamp() - interval '30 seconds') desc nulls last, random()
   limit 1;
$$;

-- Forma equipos de 3 o 4 con los que están en la sala (o usa los que ya hay),
-- da a todos el mismo saldo y elige el celular controlador de cada equipo.
create or replace function public.start_auction(p_room uuid, p_rounds int default 8, p_reshuffle boolean default true)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_old uuid; v_count int; v_teams int; tm teams;
begin
  if not is_admin() then raise exception 'No autorizado'; end if;
  if not exists (select 1 from rooms where id = p_room and status = 'open') then
    raise exception 'La sala no está abierta';
  end if;
  if exists (select 1 from auctions where room_id = p_room and status = 'running') then
    raise exception 'Ya hay una Subasta Bíblica en curso en esta sala';
  end if;
  for v_old in select id from rounds where room_id = p_room and status <> 'revealed' loop
    perform reveal_round(v_old, true);
  end loop;

  if p_reshuffle or not exists (select 1 from teams where room_id = p_room) then
    select count(*) into v_count from room_players where room_id = p_room;
    -- Equipos de 3 o 4: 10 personas → 4 + 3 + 3.
    v_teams := greatest(2, ceil(v_count / 4.0)::int);
    perform assign_teams(p_room, v_teams);
  end if;
  if (select count(distinct m.team_id) from team_members m where m.room_id = p_room) < 2 then
    raise exception 'Se necesitan al menos 2 equipos con integrantes';
  end if;

  insert into auctions(room_id, rounds_total, initial_balance)
  values (p_room, greatest(1, least(30, coalesce(p_rounds, 8))), 300)
  returning id into v_id;

  for tm in select t.* from teams t
             where t.room_id = p_room
               and exists (select 1 from team_members m where m.team_id = t.id)
             order by t.seq loop
    insert into auction_teams(auction_id, team_id, name, seq, balance, controller_id)
    values (v_id, tm.id, tm.name, tm.seq, 300, pick_auction_controller(p_room, tm.id));
  end loop;

  update rooms set current_round_id = null, view = 'round' where id = p_room;
  return v_id;
end $$;

-- Nueva ronda: se anuncia solo la categoría y el nivel. La pregunta queda
-- guardada aparte y no se copia a rounds.prompt hasta cerrar las apuestas.
-- p_difficulty null = nivel al azar.
create or replace function public.start_auction_round(p_room uuid, p_difficulty text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare au auctions; v_seq int; v_id uuid; v_old uuid; v_played int; v_last text; q auction_questions;
begin
  if not is_admin() then raise exception 'No autorizado'; end if;
  select * into au from auctions where room_id = p_room and status = 'running';
  if not found then raise exception 'Primero inicia la Subasta Bíblica'; end if;
  select count(*) into v_played from rounds where auction_id = au.id and prompt is not null;
  if v_played >= au.rounds_total then
    raise exception 'Ya se jugaron las % rondas. Pulsa «Terminar subasta».', au.rounds_total;
  end if;
  for v_old in select id from rounds where room_id = p_room and status <> 'revealed' loop
    perform reveal_round(v_old, true);
  end loop;

  select category into v_last from rounds where auction_id = au.id order by seq desc limit 1;
  -- Categoría distinta a la anterior y, si se puede, una que aún no haya salido.
  select * into q from auction_questions it
   where (p_difficulty is null or it.difficulty = p_difficulty)
     and not exists (select 1 from rounds r where r.room_id = p_room and r.item_id = it.id)
   order by (it.category = v_last) nulls first,
            (select count(*) from rounds r where r.auction_id = au.id and r.category = it.category),
            random()
   limit 1;
  if not found then
    raise exception 'Ya no quedan preguntas de subasta%', coalesce(' de nivel ' || p_difficulty, '');
  end if;

  select coalesce(max(seq), 0) + 1 into v_seq from rounds where room_id = p_room;
  insert into rounds(room_id, game, difficulty, item_id, seq, status, auction_id, category, started_at, deadline)
  values (p_room, 'auction', q.difficulty, q.id, v_seq, 'pending', au.id, q.category,
          clock_timestamp(), clock_timestamp() + interval '30 seconds')
  returning id into v_id;

  update rooms set current_round_id = v_id, view = 'round' where id = p_room;
  return v_id;
end $$;

-- Cierra las apuestas y muestra la pregunta a todos a la vez.
-- Quien no apostó a tiempo queda con la apuesta mínima.
-- p_force = false → solo si ya se venció el tiempo o todos apostaron.
create or replace function public.close_auction_bids(p_round uuid, p_force boolean default false) returns boolean
language plpgsql security definer set search_path = public as $$
declare rd rounds; v_question text;
begin
  if not is_admin() then raise exception 'No autorizado'; end if;
  select * into rd from rounds where id = p_round and game = 'auction' for update;
  if not found then raise exception 'Ronda no válida'; end if;
  if rd.status <> 'pending' then return rd.status = 'active'; end if;
  if not p_force and clock_timestamp() < rd.deadline and exists (
    select 1 from auction_teams at
     where at.auction_id = rd.auction_id
       and not exists (select 1 from auction_bids b where b.round_id = rd.id and b.auction_team_id = at.id)
  ) then
    return false;
  end if;

  insert into auction_bids(round_id, auction_team_id, amount, auto)
  select rd.id, at.id, 20, true from auction_teams at where at.auction_id = rd.auction_id
  on conflict do nothing;

  select question into v_question from auction_questions where id = rd.item_id;
  update rounds set status = 'active', prompt = v_question,
                    started_at = clock_timestamp(), deadline = clock_timestamp() + interval '40 seconds'
   where id = rd.id;
  return true;
end $$;

-- Termina la subasta: el saldo ganado (lo que quedó por encima del inicial) se
-- asigna igual a cada integrante del equipo y entra al ranking de la sala y al histórico.
create or replace function public.finish_auction(p_room uuid) returns json
language plpgsql security definer set search_path = public as $$
declare au auctions; v_old uuid; v_last uuid; v_n int := 0;
begin
  if not is_admin() then raise exception 'No autorizado'; end if;
  select * into au from auctions where room_id = p_room and status = 'running' for update;
  if not found then return json_build_object('ok', false, 'reason', 'not_running'); end if;
  for v_old in select id from rounds where auction_id = au.id and status <> 'revealed' loop
    perform reveal_round(v_old, true);
  end loop;

  -- Los puntos se cuelgan de la última ronda jugada, así cuentan en room_scoreboard y global_scoreboard.
  select id into v_last from rounds where auction_id = au.id and prompt is not null order by seq desc limit 1;
  if v_last is not null then
    insert into answers(round_id, room_id, participant_id, is_correct, points)
    select v_last, p_room, m.participant_id,
           at.balance > au.initial_balance, greatest(0, at.balance - au.initial_balance)
      from auction_teams at
      join team_members m on m.team_id = at.team_id
     where at.auction_id = au.id
    on conflict do nothing;
    get diagnostics v_n = row_count;
    update rooms set current_round_id = v_last, view = 'round' where id = p_room;
  end if;

  update auctions set status = 'finished', finished_at = clock_timestamp() where id = au.id;
  return json_build_object('ok', true, 'members', v_n);
end $$;

-- LÍNEA DEL TIEMPO HUMANA ----------------------------------------------
-- Reparte en privado una tarjeta a cada integrante: cada equipo recibe tantos
-- acontecimientos del set como personas tiene, elegidos al azar, así dos equipos
-- casi nunca tienen las mismas tarjetas. Equipos de 4 o más: si la sala aún no tiene
-- equipos, los forma; si alguien entró después del reparto, lo suma al equipo más chico.
create or replace function public.start_timeline_round(p_room uuid, p_difficulty text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_seq int; v_id uuid; v_old uuid; st timeline_sets; v_count int; v_bad text; tm teams; v_k int;
        v_p uuid; v_max int; v_teams int;
begin
  if not is_admin() then raise exception 'No autorizado'; end if;
  if not exists (select 1 from rooms where id = p_room and status = 'open') then
    raise exception 'La sala no está abierta';
  end if;
  if exists (select 1 from auctions where room_id = p_room and status = 'running') then
    raise exception 'Hay una Subasta Bíblica en curso. Termínala antes de cambiar de juego.';
  end if;
  for v_old in select id from rounds where room_id = p_room and status <> 'revealed' loop
    perform reveal_round(v_old, true);
  end loop;

  select count(*) into v_count from room_players where room_id = p_room;
  if v_count < 2 then raise exception 'Se necesitan al menos 2 participantes dentro de la sala'; end if;
  if not exists (select 1 from team_members where room_id = p_room) then
    -- Grupos de 4 o más: 10 personas → 5 + 5; 7 personas → un solo equipo de 7.
    perform assign_teams(p_room, greatest(1, v_count / 4));
  end if;
  -- Nadie se queda sin equipo: quien llegó después del reparto va al equipo más chico.
  for v_p in select rp.participant_id from room_players rp
              where rp.room_id = p_room
                and not exists (select 1 from team_members m where m.room_id = p_room and m.participant_id = rp.participant_id)
              order by rp.joined_at loop
    insert into team_members(team_id, room_id, participant_id)
    select t.id, p_room, v_p from teams t
     where t.room_id = p_room
     order by (select count(*) from team_members m where m.team_id = t.id), t.seq
     limit 1;
  end loop;

  -- Mínimo 4 por equipo (salvo que en toda la sala haya menos de 4 y jueguen en uno solo).
  select count(*) into v_teams from teams t
   where t.room_id = p_room and exists (select 1 from team_members m where m.team_id = t.id);
  select string_agg(t.name || ' (' || x.n || ')', ', ' order by t.seq) into v_bad
    from teams t cross join lateral (select count(*) as n from team_members m where m.team_id = t.id) x
   where t.room_id = p_room and x.n between 1 and 3 and v_teams > 1;
  if v_bad is not null then
    raise exception 'Cada equipo necesita al menos 4 integrantes (revisa: %). Pulsa «Formar equipos de 4 o más».', v_bad;
  end if;

  -- Cada integrante recibe una tarjeta: la línea debe tener al menos tantas como el equipo más grande.
  select max(x.n) into v_max from teams t
   cross join lateral (select count(*) as n from team_members m where m.team_id = t.id) x
   where t.room_id = p_room;
  select * into st from timeline_sets ts
   where ts.difficulty = p_difficulty
     and array_length(ts.events, 1) >= v_max
     and not exists (select 1 from rounds r where r.room_id = p_room and r.item_id = ts.id)
   order by random() limit 1;
  if not found then
    raise exception 'Ya no quedan líneas del tiempo de nivel % con al menos % acontecimientos (hay un equipo de %). Agrega más en el banco o usa otro nivel.',
      p_difficulty, v_max, v_max;
  end if;

  select coalesce(max(seq), 0) + 1 into v_seq from rounds where room_id = p_room;
  insert into rounds(room_id, game, difficulty, item_id, seq, category, started_at, deadline)
  values (p_room, 'timeline', st.difficulty, st.id, v_seq, st.title,
          clock_timestamp(), clock_timestamp() + interval '120 seconds')
  returning id into v_id;

  for tm in select t.* from teams t
             where t.room_id = p_room and exists (select 1 from team_members m where m.team_id = t.id)
             order by t.seq loop
    select count(*) into v_k from team_members where team_id = tm.id;
    with pos as (
      select p, row_number() over (order by random()) as rn
        from (select p from generate_series(1, array_length(st.events, 1)) p order by random() limit v_k) x
    ), mem as (
      select participant_id, row_number() over (order by random()) as rn
        from team_members where team_id = tm.id
    )
    insert into timeline_cards(round_id, team_id, participant_id, event, pos)
    select v_id, tm.id, mem.participant_id, st.events[pos.p], pos.p
      from mem join pos on pos.rn = mem.rn;
    insert into timeline_results(round_id, team_id) values (v_id, tm.id);
  end loop;

  update rooms set current_round_id = v_id, view = 'round' where id = p_room;
  return v_id;
end $$;

create or replace function public.set_room_view(p_room uuid, p_view text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'No autorizado'; end if;
  update rooms set view = p_view where id = p_room;
end $$;

create or replace function public.close_room(p_room uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_old uuid;
begin
  if not is_admin() then raise exception 'No autorizado'; end if;
  -- Una subasta sin terminar se liquida para que sus integrantes no pierdan el resultado.
  perform finish_auction(p_room);
  for v_old in select id from rounds where room_id = p_room and status <> 'revealed' loop
    perform reveal_round(v_old, true);
  end loop;
  update rooms set status = 'closed', view = 'podium' where id = p_room;
  delete from room_codes where room_id = p_room;
end $$;

create or replace function public.release_player(p_room uuid, p_participant uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'No autorizado'; end if;
  delete from room_players where room_id = p_room and participant_id = p_participant;
end $$;

create or replace function public.room_players_status(p_room uuid)
returns table(participant_id uuid, name text, joined_at timestamptz, last_seen timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'No autorizado'; end if;
  return query
    select rp.participant_id, p.name, rp.joined_at, max(t.last_seen)
      from room_players rp
      join participants p on p.id = rp.participant_id
      left join player_tokens t on t.room_id = rp.room_id and t.participant_id = rp.participant_id
     where rp.room_id = p_room
     group by rp.participant_id, p.name, rp.joined_at
     order by p.name;
end $$;

-- ---------------------------------------------------------------------
-- FUNCIONES PÚBLICAS (participantes)
-- ---------------------------------------------------------------------

-- Tabla de posiciones (solo cuenta rondas ya reveladas). p_game: null | 'emoji' | 'quiz'
create or replace function public.room_scoreboard(p_room uuid, p_game text default null)
returns table(participant_id uuid, name text, points int, correct int, rank int)
language sql stable security definer set search_path = public as $$
  with s as (
    select rp.participant_id, p.name,
           coalesce(sum(a.points) filter (where rd.status = 'revealed' and (p_game is null or rd.game = p_game)), 0)::int as pts,
           count(a.id) filter (where a.is_correct and rd.status = 'revealed' and (p_game is null or rd.game = p_game))::int as ok
      from room_players rp
      join participants p on p.id = rp.participant_id
      left join answers a on a.room_id = rp.room_id and a.participant_id = rp.participant_id
      left join rounds rd on rd.id = a.round_id
     where rp.room_id = p_room
     group by rp.participant_id, p.name
  )
  select participant_id, name, pts, ok, (rank() over (order by pts desc))::int
    from s order by pts desc, name;
$$;

-- Tabla por equipos (Tabú y Línea del Tiempo). Los puntos del equipo son los
-- de la ronda, no la suma de lo que recibió cada integrante.
create or replace function public.room_team_scoreboard(p_room uuid)
returns table(team_id uuid, name text, seq int, members int, points int, wins int, rank int)
language sql stable security definer set search_path = public as $$
  with per_round as (
    select rd.id as round_id, rd.team_id as tid, coalesce(max(a.points), 0) as pts
      from rounds rd
      left join answers a on a.round_id = rd.id
     where rd.room_id = p_room and rd.game = 'taboo' and rd.status = 'revealed'
     group by rd.id, rd.team_id
    union all
    select tr.round_id, tr.team_id, tr.points
      from timeline_results tr join rounds rd on rd.id = tr.round_id
     where rd.room_id = p_room and rd.status = 'revealed'
  ), s as (
    select t.id, t.name, t.seq,
           (select count(*) from team_members m where m.team_id = t.id)::int as members,
           coalesce((select sum(pr.pts) from per_round pr where pr.tid = t.id), 0)::int as pts,
           (select count(*) from per_round pr where pr.tid = t.id and pr.pts > 0)::int as wins
      from teams t where t.room_id = p_room
  )
  select id, name, seq, members, pts, wins, (rank() over (order by pts desc))::int
    from s order by pts desc, seq;
$$;

-- Acumulado histórico por persona: suma todo lo ganado en cualquier sala marcada
-- como «cuenta para el histórico», sin importar si sigue abierta o si la persona
-- ya no está dentro. p_game: null | 'emoji' | 'quiz' | 'taboo' | 'cipher' | 'auction' | 'timeline'
create or replace function public.global_scoreboard(p_game text default null)
returns table(participant_id uuid, name text, points int, correct int, rooms int, rank int)
language sql stable security definer set search_path = public as $$
  with played as (
    select a.participant_id, a.room_id, a.points, a.is_correct
      from answers a
      join rounds rd on rd.id = a.round_id
      join rooms  rm on rm.id = a.room_id
     where rd.status = 'revealed'
       and rm.counts_for_history
       and (p_game is null or rd.game = p_game)
  ), s as (
    select p.id, p.name,
           coalesce(sum(x.points), 0)::int              as pts,
           count(x.*) filter (where x.is_correct)::int  as ok,
           count(distinct x.room_id)::int               as salas
      from participants p
      left join played x on x.participant_id = p.id
     group by p.id, p.name
  )
  select id, name, pts, ok, salas, (rank() over (order by pts desc))::int
    from s order by pts desc, name;
$$;

create or replace function public.lookup_room(p_code text) returns json
language plpgsql stable security definer set search_path = public as $$
declare r rooms;
begin
  select rooms.* into r from room_codes c join rooms on rooms.id = c.room_id
   where c.code = trim(p_code) and rooms.status = 'open';
  if not found then return null; end if;
  return json_build_object(
    'id', r.id, 'name', r.name,
    'participants', coalesce((
      select json_agg(json_build_object('id', p.id, 'name', p.name, 'taken', rp.participant_id is not null) order by p.name)
        from participants p
        left join room_players rp on rp.participant_id = p.id and rp.room_id = r.id), '[]'::json));
end $$;

create or replace function public.join_room(p_code text, p_participant uuid) returns json
language plpgsql security definer set search_path = public as $$
declare v_room uuid; v_token uuid;
begin
  select c.room_id into v_room from room_codes c join rooms r on r.id = c.room_id
   where c.code = trim(p_code) and r.status = 'open';
  if v_room is null then raise exception 'Código de sala inválido'; end if;
  if not exists (select 1 from participants where id = p_participant) then
    raise exception 'Participante no encontrado';
  end if;
  if exists (select 1 from room_players where room_id = v_room and participant_id = p_participant) then
    raise exception 'Ese nombre ya ingresó desde otro dispositivo. Pide al administrador que lo libere.';
  end if;
  insert into room_players(room_id, participant_id) values (v_room, p_participant);
  insert into player_tokens(room_id, participant_id) values (v_room, p_participant) returning token into v_token;
  return json_build_object('token', v_token, 'room_id', v_room);
end $$;

create or replace function public.player_state(p_token uuid) returns json
language plpgsql security definer set search_path = public as $$
declare
  t player_tokens; r rooms; rd rounds; a answers;
  v_points int; v_rank int; v_players int; v_attempts int := 0; v_show boolean;
  v_team json; v_secret json; v_round_team json; v_describer text; v_mine boolean := false;
  v_cipher json; v_verse json;
  au auctions; atm auction_teams; b auction_bids; v_auction json;
  v_timeline json; v_tl_team uuid; tr timeline_results;
begin
  select * into t from player_tokens where token = p_token;
  if not found then return null; end if;
  update player_tokens set last_seen = clock_timestamp()
   where token = p_token and last_seen < clock_timestamp() - interval '5 seconds';

  select * into r from rooms where id = t.room_id;
  select * into rd from rounds where id = r.current_round_id;

  select s.points, s.rank into v_points, v_rank
    from room_scoreboard(t.room_id) s where s.participant_id = t.participant_id;
  select count(*) into v_players from room_players where room_id = t.room_id;

  if rd.id is not null then
    select * into a from answers
     where round_id = rd.id and participant_id = t.participant_id
     order by is_correct desc, created_at desc limit 1;
    select count(*) into v_attempts from answers where round_id = rd.id and participant_id = t.participant_id;
  end if;
  -- El código se confirma al instante; el versículo y la respuesta, al revelar.
  v_show := rd.game in ('emoji','cipher') or rd.status = 'revealed';

  if rd.id is not null and rd.game = 'cipher' then
    select json_build_object('kind', ci.kind, 'puzzle', ci.puzzle, 'hint', ci.hint)
      into v_cipher from cipher_items ci where ci.id = rd.item_id;
    -- La consigna del versículo delata la respuesta: solo va a quien ya descifró.
    if a.is_correct or rd.status = 'revealed' then
      select json_build_object(
               'prompt', ci.verse_prompt,
               'reference', case when rd.status = 'revealed'
                 then ci.verse_book || ' ' || ci.verse_chapter || ':' || ci.verse_from
                      || case when ci.verse_to is not null then '-' || ci.verse_to else '' end end)
        into v_verse from cipher_items ci where ci.id = rd.item_id;
    end if;
  end if;

  select json_build_object('id', tm.id, 'name', tm.name, 'seq', tm.seq,
           'members', (select coalesce(json_agg(p.name order by p.name), '[]'::json)
                         from team_members m2 join participants p on p.id = m2.participant_id
                        where m2.team_id = tm.id)) into v_team
    from team_members m join teams tm on tm.id = m.team_id
   where m.room_id = t.room_id and m.participant_id = t.participant_id;

  -- Línea del Tiempo: cada quien ve solo su tarjeta. El orden de su equipo, al acertar;
  -- la cronología completa, al revelar.
  if rd.id is not null and rd.game = 'timeline' then
    select c.team_id into v_tl_team from timeline_cards c where c.round_id = rd.id and c.participant_id = t.participant_id;
    if v_tl_team is not null then
      select * into tr from timeline_results x where x.round_id = rd.id and x.team_id = v_tl_team;
    end if;
    select json_build_object(
      'card', (select c.event from timeline_cards c where c.round_id = rd.id and c.participant_id = t.participant_id),
      'teammates', (select coalesce(json_agg(json_build_object('id', p.id, 'name', p.name) order by p.name), '[]'::json)
                      from timeline_cards c join participants p on p.id = c.participant_id
                     where c.round_id = rd.id and c.team_id = v_tl_team),
      'result', case when tr.round_id is null then null else json_build_object(
        'attempts', tr.attempts, 'wrong', tr.wrong, 'solved', tr.solved_at is not null,
        'place', tr.place, 'points', tr.points, 'elapsed_ms', tr.elapsed_ms,
        'retry_at', case when tr.solved_at is null and tr.last_try_at is not null
                         then tr.last_try_at + interval '8 seconds' end) end,
      'team_order', case when tr.solved_at is not null or rd.status = 'revealed' then
        (select json_agg(json_build_object('name', p.name, 'event', c.event) order by c.pos)
           from timeline_cards c join participants p on p.id = c.participant_id
          where c.round_id = rd.id and c.team_id = v_tl_team) end,
      'solution', case when rd.status = 'revealed' then
        (select json_build_object('events', ts.events, 'explanation', ts.explanation)
           from timeline_sets ts where ts.id = rd.item_id) end,
      'teams_total', (select count(*) from timeline_results x where x.round_id = rd.id),
      'teams_solved', (select count(*) from timeline_results x where x.round_id = rd.id and x.solved_at is not null)
    ) into v_timeline;
  end if;

  if rd.id is not null and rd.game = 'taboo' then
    select json_build_object('id', tm.id, 'name', tm.name, 'seq', tm.seq) into v_round_team
      from teams tm where tm.id = rd.team_id;
    select p.name into v_describer from participants p where p.id = rd.describer_id;
    v_mine := exists (select 1 from team_members m
                       where m.team_id = rd.team_id and m.participant_id = t.participant_id);
    -- La palabra solo viaja al celular de quien describe (o a todos al revelar).
    if t.participant_id = rd.describer_id or rd.status = 'revealed' then
      select json_build_object('word', ti.word, 'forbidden', ti.forbidden, 'reference', ti.reference)
        into v_secret from taboo_items ti where ti.id = rd.item_id;
    end if;
  end if;

  -- Subasta: la que está en curso, o la que terminó en la ronda que se está mostrando.
  select * into au from auctions
   where room_id = t.room_id and (status = 'running' or id = rd.auction_id)
   order by created_at desc limit 1;
  if au.id is not null then
    atm := auction_team_of(au.id, t.participant_id);
    if rd.auction_id = au.id and atm.id is not null then
      select * into b from auction_bids where round_id = rd.id and auction_team_id = atm.id;
    end if;
    v_auction := json_build_object(
      'id', au.id, 'status', au.status, 'rounds_total', au.rounds_total,
      'initial_balance', au.initial_balance,
      'rounds_played', (select count(*) from rounds x where x.auction_id = au.id and x.prompt is not null),
      'teams_total', (select count(*) from auction_teams x where x.auction_id = au.id),
      'teams_bid', case when rd.auction_id = au.id
                   then (select count(*) from auction_bids x where x.round_id = rd.id) else 0 end,
      'teams_answered', case when rd.auction_id = au.id
                   then (select count(*) from auction_bids x where x.round_id = rd.id and x.answered_at is not null) else 0 end,
      'reference', case when rd.auction_id = au.id and rd.status = 'revealed'
                   then (select q.reference from auction_questions q where q.id = rd.item_id) end,
      'team', case when atm.id is null then null else json_build_object(
        'id', atm.id, 'name', atm.name, 'seq', atm.seq, 'balance', atm.balance,
        'max_bid', auction_max_bid(atm.balance),
        'controller_id', atm.controller_id,
        'controller_name', (select name from participants where id = atm.controller_id),
        'controller_online', exists (select 1 from player_tokens pt
                                      where pt.room_id = t.room_id and pt.participant_id = atm.controller_id
                                        and pt.last_seen > clock_timestamp() - interval '20 seconds'),
        'i_control', atm.controller_id = t.participant_id,
        'members', (select coalesce(json_agg(p.name order by p.name), '[]'::json)
                      from team_members m join participants p on p.id = m.participant_id
                     where m.team_id = atm.team_id),
        'rank', (select 1 + count(*) from auction_teams x where x.auction_id = au.id and x.balance > atm.balance),
        'gain', greatest(0, atm.balance - au.initial_balance)) end,
      -- La apuesta propia; la corrección solo se conoce al revelar.
      'bid', case when b.round_id is null then null else json_build_object(
        'amount', b.amount, 'auto', b.auto, 'answer_text', b.answer_text,
        'answered', b.answered_at is not null,
        'is_correct', case when rd.status = 'revealed' then coalesce(b.is_correct, false) end,
        'delta', b.delta, 'balance_after', b.balance_after) end,
      'standings', (select coalesce(json_agg(json_build_object('name', x.name, 'seq', x.seq, 'balance', x.balance)
                                             order by x.balance desc, x.seq), '[]'::json)
                      from auction_teams x where x.auction_id = au.id)
    );
  end if;

  return json_build_object(
    'server_now', clock_timestamp(),
    'room', json_build_object('id', r.id, 'name', r.name, 'status', r.status, 'view', r.view),
    'me', json_build_object(
      'participant_id', t.participant_id,
      'name', (select name from participants where id = t.participant_id),
      'points', coalesce(v_points, 0), 'rank', v_rank, 'players', v_players,
      'team', v_team),
    'round', case when rd.id is null then null else json_build_object(
      'id', rd.id, 'game', rd.game, 'difficulty', rd.difficulty, 'seq', rd.seq, 'status', rd.status,
      'clues_total', rd.clues_total, 'clues_revealed', rd.clues_revealed,
      'prompt', rd.prompt, 'options', rd.options,
      'started_at', rd.started_at, 'deadline', rd.deadline,
      'answer_text', rd.answer_text, 'correct_index', rd.correct_index,
      'team', v_round_team, 'describer_id', rd.describer_id, 'describer_name', v_describer,
      'my_turn', v_mine, 'i_describe', rd.describer_id = t.participant_id,
      'secret', v_secret, 'cipher', v_cipher, 'verse', v_verse,
      'auction_id', rd.auction_id, 'category', rd.category) end,
    'auction', v_auction,
    'timeline', v_timeline,
    'my_answer', case when a.id is null then null else json_build_object(
      'choice', a.choice, 'answer_text', a.answer_text,
      'is_correct', case when v_show then a.is_correct end,
      'points', case when v_show then a.points end,
      'clue_number', a.clue_number,
      'verse_ok', a.verse_ok, 'verse_points', a.verse_points, 'verse_tries', a.verse_tries,
      'verse_deadline', case when a.is_correct then a.created_at + interval '60 seconds' end,
      'attempts', v_attempts) end
  );
end $$;

create or replace function public.submit_emoji(p_token uuid, p_round uuid, p_text text) returns json
language plpgsql security definer set search_path = public as $$
declare
  t player_tokens; rd rounds; e emoji_items; v_ok boolean; v_pts int; v_attempts int; v_text text;
begin
  select * into t from player_tokens where token = p_token;
  if not found then raise exception 'Sesión inválida'; end if;
  select * into rd from rounds where id = p_round and room_id = t.room_id and game = 'emoji';
  if not found then raise exception 'Ronda no válida'; end if;

  if rd.status <> 'active' or (select current_round_id from rooms where id = t.room_id) is distinct from rd.id then
    return json_build_object('ok', false, 'reason', 'closed');
  end if;
  if rd.deadline is not null and clock_timestamp() > rd.deadline + interval '1 second' then
    return json_build_object('ok', false, 'reason', 'timeout');
  end if;
  if exists (select 1 from answers where round_id = rd.id and participant_id = t.participant_id and is_correct) then
    return json_build_object('ok', true, 'correct', true, 'already', true);
  end if;
  select count(*) into v_attempts from answers where round_id = rd.id and participant_id = t.participant_id;
  if v_attempts >= 15 then return json_build_object('ok', false, 'reason', 'max_attempts'); end if;

  v_text := left(trim(coalesce(p_text, '')), 80);
  if v_text = '' then return json_build_object('ok', false, 'reason', 'empty'); end if;

  select * into e from emoji_items where id = rd.item_id;
  v_ok := answer_matches(v_text, array_prepend(e.answer, e.aliases));
  v_pts := case when v_ok then emoji_points(rd.difficulty, rd.clues_revealed) else 0 end;

  insert into answers(round_id, room_id, participant_id, answer_text, is_correct, points, clue_number, elapsed_ms)
  values (rd.id, t.room_id, t.participant_id, v_text, v_ok, v_pts, rd.clues_revealed,
          (extract(epoch from clock_timestamp() - rd.started_at) * 1000)::int)
  on conflict do nothing;

  return json_build_object('ok', true, 'correct', v_ok, 'points', v_pts, 'clue', rd.clues_revealed);
end $$;

create or replace function public.submit_quiz(p_token uuid, p_round uuid, p_choice int) returns json
language plpgsql security definer set search_path = public as $$
declare
  t player_tokens; rd rounds; v_correct int; v_ok boolean; v_pts int; v_elapsed int; v_id uuid;
begin
  select * into t from player_tokens where token = p_token;
  if not found then raise exception 'Sesión inválida'; end if;
  select * into rd from rounds where id = p_round and room_id = t.room_id and game = 'quiz';
  if not found then raise exception 'Ronda no válida'; end if;

  if rd.status <> 'active' or (select current_round_id from rooms where id = t.room_id) is distinct from rd.id then
    return json_build_object('ok', false, 'reason', 'closed');
  end if;
  if clock_timestamp() < rd.started_at then return json_build_object('ok', false, 'reason', 'not_started'); end if;
  -- 1 segundo de tolerancia por la latencia de red
  if clock_timestamp() > rd.deadline + interval '1 second' then
    return json_build_object('ok', false, 'reason', 'timeout');
  end if;
  if p_choice is null or p_choice < 0 or p_choice >= array_length(rd.options, 1) then
    raise exception 'Opción inválida';
  end if;

  v_elapsed := least(20000, (extract(epoch from clock_timestamp() - rd.started_at) * 1000)::int);
  select correct_index into v_correct from quiz_questions where id = rd.item_id;
  v_ok := p_choice = v_correct;
  v_pts := case when v_ok then quiz_points(rd.difficulty, v_elapsed) else 0 end;

  insert into answers(round_id, room_id, participant_id, choice, is_correct, points, elapsed_ms)
  values (rd.id, t.room_id, t.participant_id, p_choice, v_ok, v_pts, v_elapsed)
  on conflict do nothing
  returning id into v_id;

  if v_id is null then return json_build_object('ok', false, 'reason', 'already'); end if;
  return json_build_object('ok', true);
end $$;

-- CÓDIGO SECRETO — 1ª fase: descifrar el código.
create or replace function public.submit_cipher(p_token uuid, p_round uuid, p_text text) returns json
language plpgsql security definer set search_path = public as $$
declare
  t player_tokens; rd rounds; ci cipher_items; v_ok boolean; v_pts int;
  v_attempts int; v_text text; v_elapsed int;
begin
  select * into t from player_tokens where token = p_token;
  if not found then raise exception 'Sesión inválida'; end if;
  select * into rd from rounds where id = p_round and room_id = t.room_id and game = 'cipher';
  if not found then raise exception 'Ronda no válida'; end if;

  if rd.status <> 'active' or (select current_round_id from rooms where id = t.room_id) is distinct from rd.id then
    return json_build_object('ok', false, 'reason', 'closed');
  end if;
  if clock_timestamp() > rd.deadline + interval '1 second' then
    return json_build_object('ok', false, 'reason', 'timeout');
  end if;
  if exists (select 1 from answers where round_id = rd.id and participant_id = t.participant_id and is_correct) then
    return json_build_object('ok', true, 'correct', true, 'already', true);
  end if;
  select count(*) into v_attempts from answers where round_id = rd.id and participant_id = t.participant_id;
  if v_attempts >= 12 then return json_build_object('ok', false, 'reason', 'max_attempts'); end if;

  v_text := left(trim(coalesce(p_text, '')), 80);
  if v_text = '' then return json_build_object('ok', false, 'reason', 'empty'); end if;

  select * into ci from cipher_items where id = rd.item_id;
  v_ok := answer_matches(v_text, array_prepend(ci.answer, ci.aliases));
  v_elapsed := greatest(0, (extract(epoch from clock_timestamp() - rd.started_at) * 1000)::int);
  v_pts := case when v_ok then cipher_points(rd.difficulty, v_elapsed) else 0 end;

  insert into answers(round_id, room_id, participant_id, answer_text, is_correct, points, elapsed_ms)
  values (rd.id, t.room_id, t.participant_id, v_text, v_ok, v_pts, v_elapsed)
  on conflict do nothing;

  return json_build_object('ok', true, 'correct', v_ok, 'points', v_pts);
end $$;

-- CÓDIGO SECRETO — 2ª fase: confirmar en la Biblia. Cada quien tiene 60 s
-- desde que acertó el código, no desde que empezó la ronda.
create or replace function public.submit_verse(p_token uuid, p_round uuid,
  p_book text, p_chapter int, p_verse int) returns json
language plpgsql security definer set search_path = public as $$
declare
  t player_tokens; rd rounds; ci cipher_items; a answers; v_ok boolean; v_pts int; v_elapsed int;
begin
  select * into t from player_tokens where token = p_token;
  if not found then raise exception 'Sesión inválida'; end if;
  select * into rd from rounds where id = p_round and room_id = t.room_id and game = 'cipher';
  if not found then raise exception 'Ronda no válida'; end if;
  if rd.status = 'revealed' then return json_build_object('ok', false, 'reason', 'closed'); end if;

  select * into a from answers
   where round_id = rd.id and participant_id = t.participant_id and is_correct;
  if not found then return json_build_object('ok', false, 'reason', 'not_solved'); end if;
  if a.verse_ok is not null then return json_build_object('ok', false, 'reason', 'already'); end if;
  if clock_timestamp() > a.created_at + interval '61 seconds' then
    return json_build_object('ok', false, 'reason', 'timeout');
  end if;
  if a.verse_tries >= 5 then return json_build_object('ok', false, 'reason', 'max_attempts'); end if;
  if p_chapter is null or p_verse is null or p_chapter < 1 or p_verse < 1 then
    return json_build_object('ok', false, 'reason', 'empty');
  end if;

  select * into ci from cipher_items where id = rd.item_id;
  v_ok := norm_text(p_book) = norm_text(ci.verse_book)
      and p_chapter = ci.verse_chapter
      and p_verse between ci.verse_from and coalesce(ci.verse_to, ci.verse_from);

  if not v_ok then
    update answers set verse_tries = verse_tries + 1 where id = a.id;
    return json_build_object('ok', true, 'correct', false, 'tries', a.verse_tries + 1);
  end if;

  v_elapsed := greatest(0, (extract(epoch from clock_timestamp() - a.created_at) * 1000)::int);
  v_pts := verse_points(rd.difficulty, v_elapsed);
  update answers set verse_ok = true, verse_points = v_pts, verse_tries = verse_tries + 1,
                     verse_text = left(trim(coalesce(p_book,'')), 40) || ' ' || p_chapter || ':' || p_verse,
                     points = points + v_pts
   where id = a.id;

  return json_build_object('ok', true, 'correct', true, 'points', v_pts);
end $$;

-- LÍNEA DEL TIEMPO — un integrante envía el orden en que están parados.
-- Solo se dice si es correcto o no, nunca qué posiciones fallan. Tras un error hay
-- 8 s de espera y como máximo 6 errores, para que no se pueda probar a lo bruto.
create or replace function public.submit_timeline(p_token uuid, p_round uuid, p_order uuid[]) returns json
language plpgsql security definer set search_path = public as $$
declare
  t player_tokens; rd rounds; v_team uuid; tr timeline_results; v_pos int[]; v_holders int;
  v_ok boolean; v_place int; v_pts int; v_elapsed int;
begin
  select * into t from player_tokens where token = p_token;
  if not found then raise exception 'Sesión inválida'; end if;
  -- for update: dos equipos que aciertan a la vez no pueden quedar ambos en 1er lugar.
  select * into rd from rounds where id = p_round and room_id = t.room_id and game = 'timeline' for update;
  if not found then raise exception 'Ronda no válida'; end if;
  if rd.status <> 'active' or (select current_round_id from rooms where id = t.room_id) is distinct from rd.id then
    return json_build_object('ok', false, 'reason', 'closed');
  end if;
  if clock_timestamp() > rd.deadline + interval '2 seconds' then
    return json_build_object('ok', false, 'reason', 'timeout');
  end if;

  select team_id into v_team from timeline_cards where round_id = rd.id and participant_id = t.participant_id;
  if v_team is null then return json_build_object('ok', false, 'reason', 'no_card'); end if;
  select * into tr from timeline_results where round_id = rd.id and team_id = v_team;
  if tr.solved_at is not null then return json_build_object('ok', true, 'correct', true, 'already', true); end if;
  if tr.wrong >= 6 then return json_build_object('ok', false, 'reason', 'max_attempts'); end if;
  if tr.last_try_at is not null and clock_timestamp() < tr.last_try_at + interval '8 seconds' then
    return json_build_object('ok', false, 'reason', 'cooldown');
  end if;

  -- El orden debe tener a cada integrante con tarjeta exactamente una vez.
  select count(*) into v_holders from timeline_cards where round_id = rd.id and team_id = v_team;
  select array_agg(c.pos order by o.idx) into v_pos
    from unnest(p_order) with ordinality o(pid, idx)
    join timeline_cards c on c.round_id = rd.id and c.team_id = v_team and c.participant_id = o.pid;
  if coalesce(array_length(p_order, 1), 0) <> v_holders
     or coalesce(array_length(v_pos, 1), 0) <> v_holders
     or (select count(distinct x) from unnest(p_order) x) <> v_holders then
    return json_build_object('ok', false, 'reason', 'invalid');
  end if;
  v_ok := v_pos = (select array_agg(x order by x) from unnest(v_pos) x);

  if not v_ok then
    update timeline_results set attempts = attempts + 1, wrong = wrong + 1, last_try_at = clock_timestamp()
     where round_id = rd.id and team_id = v_team;
    return json_build_object('ok', true, 'correct', false, 'wrong', tr.wrong + 1);
  end if;

  select 1 + count(*) into v_place from timeline_results where round_id = rd.id and solved_at is not null;
  v_pts := timeline_points(rd.difficulty, v_place, tr.wrong);
  v_elapsed := greatest(0, (extract(epoch from clock_timestamp() - rd.started_at) * 1000)::int);
  update timeline_results set attempts = attempts + 1, last_try_at = clock_timestamp(), solved_at = clock_timestamp(),
                              elapsed_ms = v_elapsed, place = v_place, points = v_pts
   where round_id = rd.id and team_id = v_team;
  -- Los puntos son de todo el equipo: cada integrante que recibió tarjeta suma lo mismo.
  insert into answers(round_id, room_id, participant_id, is_correct, points, elapsed_ms)
  select rd.id, rd.room_id, c.participant_id, true, v_pts, v_elapsed
    from timeline_cards c where c.round_id = rd.id and c.team_id = v_team
  on conflict do nothing;
  return json_build_object('ok', true, 'correct', true, 'place', v_place, 'points', v_pts);
end $$;

-- SUBASTA — equipo del participante en la subasta de esa ronda (null si no tiene).
create or replace function public.auction_team_of(p_auction uuid, p_participant uuid) returns auction_teams
language sql stable security definer set search_path = public as $$
  select at.* from auction_teams at
    join team_members m on m.team_id = at.team_id and m.participant_id = p_participant
   where at.auction_id = p_auction
   limit 1;
$$;

-- SUBASTA — el controlador confirma la apuesta. No se puede cambiar después.
create or replace function public.submit_auction_bid(p_token uuid, p_round uuid, p_amount int) returns json
language plpgsql security definer set search_path = public as $$
declare t player_tokens; rd rounds; at auction_teams; v_ok boolean;
begin
  select * into t from player_tokens where token = p_token;
  if not found then raise exception 'Sesión inválida'; end if;
  -- for share: espera a que termine un cierre de apuestas simultáneo.
  select * into rd from rounds where id = p_round and room_id = t.room_id and game = 'auction' for share;
  if not found then raise exception 'Ronda no válida'; end if;
  if rd.status <> 'pending' or (select current_round_id from rooms where id = t.room_id) is distinct from rd.id then
    return json_build_object('ok', false, 'reason', 'closed');
  end if;
  if clock_timestamp() > rd.deadline + interval '1 second' then
    return json_build_object('ok', false, 'reason', 'timeout');
  end if;
  at := auction_team_of(rd.auction_id, t.participant_id);
  if at.id is null then return json_build_object('ok', false, 'reason', 'no_team'); end if;
  if at.controller_id is distinct from t.participant_id then
    return json_build_object('ok', false, 'reason', 'not_controller');
  end if;
  if p_amount is null or p_amount < 20 or p_amount > auction_max_bid(at.balance) then
    return json_build_object('ok', false, 'reason', 'range', 'max', auction_max_bid(at.balance));
  end if;

  insert into auction_bids(round_id, auction_team_id, amount)
  values (rd.id, at.id, p_amount)
  on conflict do nothing
  returning true into v_ok;
  if v_ok is null then return json_build_object('ok', false, 'reason', 'already'); end if;
  return json_build_object('ok', true);
end $$;

-- SUBASTA — el controlador envía la única respuesta del equipo.
-- No se dice si acertó hasta revelar, para que nadie la sople a otros equipos.
create or replace function public.submit_auction_answer(p_token uuid, p_round uuid, p_text text) returns json
language plpgsql security definer set search_path = public as $$
declare t player_tokens; rd rounds; at auction_teams; q auction_questions; v_text text;
begin
  select * into t from player_tokens where token = p_token;
  if not found then raise exception 'Sesión inválida'; end if;
  select * into rd from rounds where id = p_round and room_id = t.room_id and game = 'auction' for share;
  if not found then raise exception 'Ronda no válida'; end if;
  if rd.status <> 'active' or (select current_round_id from rooms where id = t.room_id) is distinct from rd.id then
    return json_build_object('ok', false, 'reason', 'closed');
  end if;
  if clock_timestamp() > rd.deadline + interval '1 second' then
    return json_build_object('ok', false, 'reason', 'timeout');
  end if;
  at := auction_team_of(rd.auction_id, t.participant_id);
  if at.id is null then return json_build_object('ok', false, 'reason', 'no_team'); end if;
  if at.controller_id is distinct from t.participant_id then
    return json_build_object('ok', false, 'reason', 'not_controller');
  end if;
  v_text := left(trim(coalesce(p_text, '')), 80);
  if v_text = '' then return json_build_object('ok', false, 'reason', 'empty'); end if;

  select * into q from auction_questions where id = rd.item_id;
  update auction_bids
     set answer_text = v_text,
         is_correct  = answer_matches(v_text, array_prepend(q.answer, q.aliases)),
         answered_at = clock_timestamp()
   where round_id = rd.id and auction_team_id = at.id and answered_at is null;
  if not found then return json_build_object('ok', false, 'reason', 'already'); end if;
  return json_build_object('ok', true);
end $$;

-- SUBASTA — si el celular controlador se desconecta, otro integrante toma el control.
create or replace function public.claim_auction_control(p_token uuid) returns json
language plpgsql security definer set search_path = public as $$
declare t player_tokens; au auctions; at auction_teams;
begin
  select * into t from player_tokens where token = p_token;
  if not found then raise exception 'Sesión inválida'; end if;
  select * into au from auctions where room_id = t.room_id and status = 'running';
  if not found then return json_build_object('ok', false, 'reason', 'not_running'); end if;
  at := auction_team_of(au.id, t.participant_id);
  if at.id is null then return json_build_object('ok', false, 'reason', 'no_team'); end if;
  if at.controller_id = t.participant_id then return json_build_object('ok', true); end if;
  if exists (select 1 from player_tokens pt
              where pt.room_id = t.room_id and pt.participant_id = at.controller_id
                and pt.last_seen > clock_timestamp() - interval '20 seconds') then
    return json_build_object('ok', false, 'reason', 'controller_online');
  end if;
  update auction_teams set controller_id = t.participant_id where id = at.id;
  return json_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------
-- SEGURIDAD (RLS)
-- ---------------------------------------------------------------------

alter table public.admins         enable row level security;
alter table public.participants   enable row level security;
alter table public.emoji_items    enable row level security;
alter table public.quiz_questions enable row level security;
alter table public.rooms          enable row level security;
alter table public.room_codes     enable row level security;
alter table public.room_players   enable row level security;
alter table public.player_tokens  enable row level security;
alter table public.rounds         enable row level security;
alter table public.answers        enable row level security;
alter table public.taboo_items    enable row level security;
alter table public.cipher_items   enable row level security;
alter table public.teams          enable row level security;
alter table public.team_members   enable row level security;
alter table public.auction_questions enable row level security;
alter table public.auctions       enable row level security;
alter table public.auction_teams  enable row level security;
alter table public.auction_bids   enable row level security;
alter table public.timeline_sets  enable row level security;
alter table public.timeline_cards enable row level security;
alter table public.timeline_results enable row level security;

drop policy if exists admins_self on public.admins;
create policy admins_self on public.admins for select to authenticated using (user_id = auth.uid());

drop policy if exists participants_read on public.participants;
create policy participants_read on public.participants for select to anon, authenticated using (true);
drop policy if exists participants_admin on public.participants;
create policy participants_admin on public.participants for all to authenticated using (is_admin()) with check (is_admin());

drop policy if exists emoji_admin on public.emoji_items;
create policy emoji_admin on public.emoji_items for all to authenticated using (is_admin()) with check (is_admin());

drop policy if exists quiz_admin on public.quiz_questions;
create policy quiz_admin on public.quiz_questions for all to authenticated using (is_admin()) with check (is_admin());

drop policy if exists cipher_admin on public.cipher_items;
create policy cipher_admin on public.cipher_items for all to authenticated using (is_admin()) with check (is_admin());

drop policy if exists taboo_admin on public.taboo_items;
create policy taboo_admin on public.taboo_items for all to authenticated using (is_admin()) with check (is_admin());

drop policy if exists teams_read on public.teams;
create policy teams_read on public.teams for select to anon, authenticated using (true);
drop policy if exists teams_admin on public.teams;
create policy teams_admin on public.teams for all to authenticated using (is_admin()) with check (is_admin());

drop policy if exists team_members_read on public.team_members;
create policy team_members_read on public.team_members for select to anon, authenticated using (true);
drop policy if exists team_members_admin on public.team_members;
create policy team_members_admin on public.team_members for all to authenticated using (is_admin()) with check (is_admin());

drop policy if exists auction_questions_admin on public.auction_questions;
create policy auction_questions_admin on public.auction_questions for all to authenticated using (is_admin()) with check (is_admin());

-- Saldos y equipos de la subasta son públicos; las apuestas y respuestas no.
drop policy if exists auctions_read on public.auctions;
create policy auctions_read on public.auctions for select to anon, authenticated using (true);
drop policy if exists auctions_admin on public.auctions;
create policy auctions_admin on public.auctions for all to authenticated using (is_admin()) with check (is_admin());

drop policy if exists auction_teams_read on public.auction_teams;
create policy auction_teams_read on public.auction_teams for select to anon, authenticated using (true);
drop policy if exists auction_teams_admin on public.auction_teams;
create policy auction_teams_admin on public.auction_teams for all to authenticated using (is_admin()) with check (is_admin());

drop policy if exists auction_bids_admin on public.auction_bids;
create policy auction_bids_admin on public.auction_bids for all to authenticated using (is_admin()) with check (is_admin());

-- Línea del Tiempo: tarjetas e intentos solo por funciones (player_state) o el admin.
drop policy if exists timeline_sets_admin on public.timeline_sets;
create policy timeline_sets_admin on public.timeline_sets for all to authenticated using (is_admin()) with check (is_admin());
drop policy if exists timeline_cards_admin on public.timeline_cards;
create policy timeline_cards_admin on public.timeline_cards for all to authenticated using (is_admin()) with check (is_admin());
drop policy if exists timeline_results_admin on public.timeline_results;
create policy timeline_results_admin on public.timeline_results for all to authenticated using (is_admin()) with check (is_admin());

drop policy if exists rooms_read on public.rooms;
create policy rooms_read on public.rooms for select to anon, authenticated using (true);
drop policy if exists rooms_admin on public.rooms;
create policy rooms_admin on public.rooms for all to authenticated using (is_admin()) with check (is_admin());

drop policy if exists room_codes_admin on public.room_codes;
create policy room_codes_admin on public.room_codes for all to authenticated using (is_admin()) with check (is_admin());

drop policy if exists room_players_read on public.room_players;
create policy room_players_read on public.room_players for select to anon, authenticated using (true);
drop policy if exists room_players_admin on public.room_players;
create policy room_players_admin on public.room_players for all to authenticated using (is_admin()) with check (is_admin());

drop policy if exists rounds_read on public.rounds;
create policy rounds_read on public.rounds for select to anon, authenticated using (true);
drop policy if exists rounds_admin on public.rounds;
create policy rounds_admin on public.rounds for all to authenticated using (is_admin()) with check (is_admin());

drop policy if exists answers_admin on public.answers;
create policy answers_admin on public.answers for all to authenticated using (is_admin()) with check (is_admin());
-- player_tokens: sin políticas → solo accesible desde funciones security definer

grant usage on schema public to anon, authenticated;
grant select on public.participants, public.rooms, public.room_players, public.rounds,
  public.teams, public.team_members, public.auctions, public.auction_teams to anon;
grant select, insert, update, delete on
  public.participants, public.emoji_items, public.quiz_questions, public.taboo_items,
  public.cipher_items, public.rooms,
  public.room_codes, public.room_players, public.rounds, public.answers,
  public.teams, public.team_members,
  public.auction_questions, public.auctions, public.auction_teams, public.auction_bids,
  public.timeline_sets, public.timeline_cards, public.timeline_results to authenticated;
grant select on public.admins to authenticated;
revoke all on public.player_tokens from anon, authenticated;

revoke execute on function public.create_room(text), public.reveal_round(uuid, boolean), public.start_round(uuid, text, text),
  public.reveal_clue(uuid), public.set_room_view(uuid, text), public.close_room(uuid),
  public.release_player(uuid, uuid), public.room_players_status(uuid), public.claim_admin(),
  public.assign_teams(uuid, int), public.set_team(uuid, uuid, uuid), public.rename_team(uuid, text),
  public.start_taboo_round(uuid, text, uuid), public.start_taboo_timer(uuid),
  public.stop_taboo(uuid, boolean),
  public.start_auction(uuid, int, boolean), public.start_auction_round(uuid, text),
  public.close_auction_bids(uuid, boolean), public.finish_auction(uuid),
  public.start_timeline_round(uuid, text) from anon, public;
-- Internas: solo se llaman desde otras funciones.
revoke execute on function public.settle_auction_round(uuid), public.pick_auction_controller(uuid, uuid)
  from anon, authenticated, public;
grant execute on function public.create_room(text), public.reveal_round(uuid, boolean), public.start_round(uuid, text, text),
  public.reveal_clue(uuid), public.set_room_view(uuid, text), public.close_room(uuid),
  public.release_player(uuid, uuid), public.room_players_status(uuid), public.claim_admin(),
  public.assign_teams(uuid, int), public.set_team(uuid, uuid, uuid), public.rename_team(uuid, text),
  public.start_taboo_round(uuid, text, uuid), public.start_taboo_timer(uuid),
  public.stop_taboo(uuid, boolean),
  public.start_auction(uuid, int, boolean), public.start_auction_round(uuid, text),
  public.close_auction_bids(uuid, boolean), public.finish_auction(uuid),
  public.start_timeline_round(uuid, text) to authenticated;
grant execute on function public.server_now(), public.room_scoreboard(uuid, text), public.lookup_room(text),
  public.join_room(text, uuid), public.player_state(uuid), public.submit_emoji(uuid, uuid, text),
  public.submit_quiz(uuid, uuid, int), public.is_admin(),
  public.submit_cipher(uuid, uuid, text), public.submit_verse(uuid, uuid, text, int, int),
  public.room_team_scoreboard(uuid), public.room_teams(uuid),
  public.global_scoreboard(text),
  public.submit_auction_bid(uuid, uuid, int), public.submit_auction_answer(uuid, uuid, text),
  public.claim_auction_control(uuid), public.submit_timeline(uuid, uuid, uuid[]) to anon, authenticated;

-- ---------------------------------------------------------------------
-- REALTIME
-- ---------------------------------------------------------------------
do $$
declare tbl text;
begin
  foreach tbl in array array['rooms','rounds','room_players','answers','teams','team_members',
                           'auctions','auction_teams','auction_bids','timeline_results'] loop
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = tbl) then
      execute format('alter publication supabase_realtime add table public.%I', tbl);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- BANCO INICIAL (solo si las tablas están vacías)
-- ---------------------------------------------------------------------
do $$ begin
if not exists (select 1 from public.emoji_items) then
insert into public.emoji_items (difficulty, clues, answer, aliases, reference) values
-- FÁCIL
('facil', array['🌈','🌧️','🐘🦒','🚢'], 'Noé', array['noe','arca de noe','el arca','diluvio'], 'Génesis 6–9'),
('facil', array['🧺','🔥🌿','🌊','📜'], 'Moisés', array['moises','cruce del mar rojo','mar rojo'], 'Éxodo 2–20'),
('facil', array['🐑','🎶','🪨','👑'], 'David', array['rey david','david y goliat'], '1 Samuel 16–17'),
('facil', array['🏙️','⛈️','🌊','🐋'], 'Jonás', array['jonas','jonas y el gran pez','jonas y la ballena'], 'Jonás 1–4'),
('facil', array['🍯','🦁','🏛️','💇‍♂️'], 'Sansón', array['sanson','samson'], 'Jueces 13–16'),
('facil', array['🌳','🍎','🐍','👫'], 'Adán y Eva', array['adan','eva','jardin del eden','eden'], 'Génesis 2–3'),
('facil', array['🙏','👑','🕳️','🦁'], 'Daniel', array['daniel en el foso de los leones','foso de los leones'], 'Daniel 6'),
('facil', array['🎣','🔑','🌊🚶','🐓'], 'Pedro', array['simon pedro','simon','cefas'], 'Mateo 14; 16; 26'),
('facil', array['⭐','🐑','🐫','👶'], 'Nacimiento de Jesús', array['jesus','nacimiento','navidad','pesebre','belen','niño jesus'], 'Lucas 2; Mateo 2'),
('facil', array['🏜️','⭐','👴👶','🐏'], 'Abraham', array['abram'], 'Génesis 12–22'),
('facil', array['💭','🕳️','🌾','🧥🌈'], 'José (hijo de Jacob)', array['jose','jose hijo de jacob','jose el soñador'], 'Génesis 37–50'),
('facil', array['💰','🤏','🌳','🏠'], 'Zaqueo', array['zaqueo'], 'Lucas 19:1-10'),
-- INTERMEDIO
('intermedio', array['🍷','📜','🙏','👸'], 'Ester', array['esther','reina ester'], 'Ester 1–10'),
('intermedio', array['🏜️','🦗','🍯','💧'], 'Juan el Bautista', array['juan bautista','bautista','juan'], 'Mateo 3'),
('intermedio', array['👵','🚶‍♀️','🌾','💍'], 'Rut', array['ruth'], 'Rut 1–4'),
('intermedio', array['🐦','🍞','🔥','🌪️'], 'Elías', array['elias','profeta elias'], '1 Reyes 17–18; 2 Reyes 2'),
('intermedio', array['🎺','🚶‍♂️','🔁','🧱'], 'Josué (caída de Jericó)', array['josue','jerico','muros de jerico','murallas de jerico','caida de jerico'], 'Josué 6'),
('intermedio', array['🐑','💧','🏺','3️⃣0️⃣0️⃣'], 'Gedeón', array['gedeon'], 'Jueces 6–7'),
('intermedio', array['😢','🪨','4️⃣','🚶‍♂️'], 'Lázaro', array['lazaro','resurreccion de lazaro'], 'Juan 11'),
('intermedio', array['🛏️','🌙','👂','🗣️'], 'Samuel', array['niño samuel'], '1 Samuel 3'),
('intermedio', array['✉️','⛓️','🐴','💡'], 'Pablo', array['saulo','saulo de tarso','pablo de tarso','apostol pablo'], 'Hechos 9'),
('intermedio', array['💎','🏛️','👶⚔️','🧠'], 'Salomón', array['salomon','rey salomon'], '1 Reyes 3–8'),
('intermedio', array['🛣️','🤕','🚶🚶','🐴'], 'El buen samaritano', array['buen samaritano','samaritano','parabola del buen samaritano'], 'Lucas 10:25-37'),
('intermedio', array['💰','🐖','🏠','🤗'], 'El hijo pródigo', array['hijo prodigo','prodigo','parabola del hijo prodigo'], 'Lucas 15:11-32'),
-- DIFÍCIL
('dificil', array['🍷','😔','🧱','🏙️'], 'Nehemías', array['nehemias'], 'Nehemías 1–6'),
('dificil', array['💰','👼','🐴','🗣️'], 'Balaam', array['balaam y la burra','burra de balaam'], 'Números 22'),
('dificil', array['🧥','🫒','🐻','🪓'], 'Eliseo', array['eliseo','profeta eliseo'], '2 Reyes 2–6'),
('dificil', array['⛺','🥛','😴','🔨'], 'Jael', array['jael'], 'Jueces 4'),
('dificil', array['⚔️','🤒','🏞️','7️⃣'], 'Naamán', array['naaman'], '2 Reyes 5'),
('dificil', array['👨‍👦‍👦','🍲','🤼','🪜'], 'Jacob', array['israel'], 'Génesis 25–32'),
('dificil', array['🌴','⚖️','⚔️','👩'], 'Débora', array['debora','jueza debora','profetisa debora'], 'Jueces 4–5'),
('dificil', array['🏡','💰','🤥','⚰️'], 'Ananías y Safira', array['ananias','safira'], 'Hechos 5:1-11'),
('dificil', array['👑','🩼','🍽️','🤝'], 'Mefiboset', array['mefiboset','meribaal'], '2 Samuel 9'),
('dificil', array['🕯️','🪟','😴','⬇️'], 'Eutico', array['eutico','eutiquio'], 'Hechos 20:7-12'),
('dificil', array['🏠','🕵️🕵️','🧵','🔴'], 'Rahab', array['rajab'], 'Josué 2'),
('dificil', array['👑','🗿','🔥','🐂'], 'Nabucodonosor', array['rey nabucodonosor'], 'Daniel 2–4');
end if;

if not exists (select 1 from public.quiz_questions) then
insert into public.quiz_questions (difficulty, question, options, correct_index, reference) values
-- FÁCIL
('facil', '¿Quién construyó el arca?', array['Moisés','Noé','Abraham','David'], 1, 'Génesis 6'),
('facil', '¿Cuántos días y noches llovió durante el diluvio?', array['7','12','100','40'], 3, 'Génesis 7:12'),
('facil', '¿Quién derrotó al gigante Goliat?', array['David','Saúl','Sansón','Josué'], 0, '1 Samuel 17'),
('facil', '¿Cuál es el primer libro de la Biblia?', array['Éxodo','Mateo','Génesis','Salmos'], 2, 'Génesis 1'),
('facil', '¿En qué ciudad nació Jesús?', array['Nazaret','Belén','Jerusalén','Capernaúm'], 1, 'Mateo 2:1'),
('facil', '¿Quién fue tragado por un gran pez?', array['Elías','Pedro','Jonás','Daniel'], 2, 'Jonás 1:17'),
('facil', '¿Cuántos apóstoles escogió Jesús?', array['12','10','7','70'], 0, 'Lucas 6:13'),
('facil', '¿Quién fue echado al foso de los leones?', array['José','Pablo','Samuel','Daniel'], 3, 'Daniel 6'),
('facil', '¿Quién traicionó a Jesús?', array['Pedro','Judas Iscariote','Tomás','Juan'], 1, 'Mateo 26:14-16'),
('facil', '¿Qué creó Dios el primer día?', array['La luz','Los animales','El hombre','Las estrellas'], 0, 'Génesis 1:3-5'),
('facil', '¿Quién guió al pueblo de Israel para salir de Egipto?', array['Aarón','Josué','Moisés','Abraham'], 2, 'Éxodo 12–14'),
('facil', '¿Cómo se llamaba la madre de Jesús?', array['Marta','Isabel','Ana','María'], 3, 'Lucas 1:26-31'),
('facil', '¿Cuál es el último libro de la Biblia?', array['Apocalipsis','Judas','Malaquías','Hechos'], 0, 'Apocalipsis'),
('facil', '¿Cuántos mandamientos recibió Moisés en el monte Sinaí?', array['5','10','7','12'], 1, 'Éxodo 20'),
('facil', '¿Quién negó a Jesús tres veces?', array['Juan','Judas','Pedro','Santiago'], 2, 'Lucas 22:54-62'),
-- INTERMEDIO
('intermedio', '¿Cuántos libros tiene la Biblia (Reina-Valera)?', array['73','39','66','27'], 2, 'Canon bíblico'),
('intermedio', '¿Quién fue el primer rey de Israel?', array['Saúl','David','Salomón','Samuel'], 0, '1 Samuel 10'),
('intermedio', '¿En qué río fue bautizado Jesús?', array['Nilo','Jordán','Éufrates','Tigris'], 1, 'Mateo 3:13'),
('intermedio', 'Según el evangelio de Juan, ¿cuál fue el primer milagro de Jesús?', array['Sanar a un ciego','Caminar sobre el agua','Resucitar a Lázaro','Convertir el agua en vino'], 3, 'Juan 2:1-11'),
('intermedio', '¿Cuántos años anduvo Israel por el desierto?', array['12','70','40','400'], 2, 'Números 14:33'),
('intermedio', '¿Cómo se llamaba el hermano de Moisés?', array['Aarón','Caleb','Josué','Leví'], 0, 'Éxodo 4:14'),
('intermedio', '¿Qué libro viene justo después de los cuatro evangelios?', array['Romanos','Hechos','Gálatas','Apocalipsis'], 1, 'Nuevo Testamento'),
('intermedio', '¿Qué salmo comienza con "Jehová es mi pastor; nada me faltará"?', array['Salmo 1','Salmo 91','Salmo 119','Salmo 23'], 3, 'Salmo 23:1'),
('intermedio', '¿Quién fue el padre de Juan el Bautista?', array['José','Zacarías','Elí','Simeón'], 1, 'Lucas 1:5-13'),
('intermedio', '¿A qué ciudad envió Dios a Jonás a predicar?', array['Babilonia','Sodoma','Nínive','Tarsis'], 2, 'Jonás 1:2'),
('intermedio', '¿Cómo se llamaba la esposa de Abraham?', array['Sara','Rebeca','Raquel','Lea'], 0, 'Génesis 17:15'),
('intermedio', '¿Con cuántos panes y peces alimentó Jesús a los cinco mil?', array['7 panes y 3 peces','2 panes y 5 peces','12 panes y 2 peces','5 panes y 2 peces'], 3, 'Mateo 14:17-21'),
('intermedio', '¿Quién le cortó la oreja al siervo del sumo sacerdote?', array['Juan','Pedro','Andrés','Judas'], 1, 'Juan 18:10'),
('intermedio', '¿Qué profeta subió al cielo en un torbellino?', array['Elías','Eliseo','Isaías','Jeremías'], 0, '2 Reyes 2:11'),
('intermedio', '¿En qué monte recibió Moisés los Diez Mandamientos?', array['Carmelo','Sion','Sinaí','Monte de los Olivos'], 2, 'Éxodo 19–20'),
-- DIFÍCIL
('dificil', '¿Quién es la persona más longeva mencionada en la Biblia?', array['Adán','Noé','Set','Matusalén'], 3, 'Génesis 5:27'),
('dificil', '¿Cuál es el libro más corto del Antiguo Testamento?', array['Abdías','Hageo','Jonás','Nahúm'], 0, 'Abdías'),
('dificil', '¿Cuántos años reinó David en total?', array['20','33','40','50'], 2, '2 Samuel 5:4'),
('dificil', '¿Cómo se llamaba la esposa de Moisés?', array['Miriam','Séfora','Débora','Rut'], 1, 'Éxodo 2:21'),
('dificil', '¿Cómo se llamaba el padre de Sansón?', array['Elcana','Isaí','Manoa','Jefté'], 2, 'Jueces 13:2, 24'),
('dificil', '¿Qué rey vio la escritura en la pared: "Mene, Mene, Tekel, Uparsin"?', array['Nabucodonosor','Darío','Ciro','Belsasar'], 3, 'Daniel 5'),
('dificil', '¿Qué rey de Persia permitió a los judíos volver a reconstruir el templo?', array['Ciro','Artajerjes','Asuero','Darío'], 0, 'Esdras 1:1-3'),
('dificil', '¿Con cuántos hombres venció Gedeón a los madianitas?', array['1.000','300','10.000','32.000'], 1, 'Jueces 7:7'),
('dificil', '¿Quién fue escogido para reemplazar a Judas Iscariote?', array['Bernabé','Silas','Matías','Esteban'], 2, 'Hechos 1:26'),
('dificil', '¿Quién fue el primer mártir cristiano?', array['Santiago','Pedro','Felipe','Esteban'], 3, 'Hechos 7'),
('dificil', '¿En qué isla estaba Juan cuando recibió las visiones del Apocalipsis?', array['Patmos','Creta','Malta','Chipre'], 0, 'Apocalipsis 1:9'),
('dificil', '¿Cómo se llamaba el siervo de Eliseo que quedó leproso?', array['Naamán','Giezi','Abdías','Baruc'], 1, '2 Reyes 5:20-27'),
('dificil', '¿Quién fue la madre del profeta Samuel?', array['Penina','Noemí','Ana','Elisabet'], 2, '1 Samuel 1:20'),
('dificil', '¿Qué edad tenía Abraham cuando nació Isaac?', array['75','86','99','100'], 3, 'Génesis 21:5'),
('dificil', '¿Qué juez de Israel hizo un voto que afectó a su hija?', array['Jefté','Gedeón','Sansón','Aod'], 0, 'Jueces 11:30-40');
end if;
end $$;

do $$ begin
if not exists (select 1 from public.taboo_items) then
insert into public.taboo_items (difficulty, word, forbidden, reference) values
-- FÁCIL
('facil', 'El arca de Noé', array['noé','diluvio','animales','lluvia','barco'], 'Génesis 6–9'),
('facil', 'David y Goliat', array['honda','piedra','gigante','filisteo','frente'], '1 Samuel 17'),
('facil', 'La última cena', array['pan','vino','discípulos','mesa','jesús'], 'Lucas 22:14-20'),
('facil', 'La zarza ardiente', array['moisés','fuego','arbusto','horeb','arder'], 'Éxodo 3'),
('facil', 'Jonás y el gran pez', array['ballena','nínive','tragar','mar','tres días'], 'Jonás 1–2'),
('facil', 'El pesebre', array['belén','jesús','nacimiento','establo','paja'], 'Lucas 2:7'),
('facil', 'Daniel en el foso de los leones', array['leones','foso','oración','darío','fieras'], 'Daniel 6'),
('facil', 'El arco iris', array['noé','promesa','colores','lluvia','cielo'], 'Génesis 9:13'),
('facil', 'Adán y Eva', array['edén','fruto','serpiente','costilla','jardín'], 'Génesis 2–3'),
('facil', 'Los Diez Mandamientos', array['moisés','sinaí','tablas','ley','diez'], 'Éxodo 20'),
('facil', 'El maná', array['desierto','pan','cielo','israelitas','comida'], 'Éxodo 16'),
('facil', 'La cruz', array['jesús','calvario','madero','crucificar','clavos'], 'Juan 19:17-18'),
-- INTERMEDIO
('intermedio', 'La torre de Babel', array['idiomas','lenguas','babel','construir','confusión'], 'Génesis 11:1-9'),
('intermedio', 'Sansón y Dalila', array['cabello','fuerza','filisteos','tijeras','columnas'], 'Jueces 16'),
('intermedio', 'La reina Ester', array['persia','judíos','amán','rey','asuero'], 'Ester 1–10'),
('intermedio', 'El buen samaritano', array['camino','herido','ayudar','jericó','vendas'], 'Lucas 10:25-37'),
('intermedio', 'Los muros de Jericó', array['trompetas','josué','vueltas','murallas','caer'], 'Josué 6'),
('intermedio', 'La multiplicación de los panes', array['peces','cinco mil','milagro','canastas','multitud'], 'Juan 6:1-14'),
('intermedio', 'El hijo pródigo', array['padre','herencia','cerdos','regresar','fiesta'], 'Lucas 15:11-32'),
('intermedio', 'La escalera de Jacob', array['sueño','ángeles','cielo','betel','piedra'], 'Génesis 28:10-22'),
('intermedio', 'Elías en el monte Carmelo', array['fuego','baal','altar','profetas','lluvia'], '1 Reyes 18'),
('intermedio', 'El bautismo de Jesús', array['juan','jordán','agua','paloma','río'], 'Mateo 3:13-17'),
('intermedio', 'La transfiguración', array['monte','moisés','elías','resplandor','nube'], 'Mateo 17:1-8'),
('intermedio', 'Rut y Noemí', array['moab','espigas','booz','suegra','cosecha'], 'Rut 1–4'),
-- DIFÍCIL
('dificil', 'Nehemías', array['muro','jerusalén','copero','reconstruir','artajerjes'], 'Nehemías 1–6'),
('dificil', 'El becerro de oro', array['aarón','ídolo','sinaí','oro','adorar'], 'Éxodo 32'),
('dificil', 'La burra de Balaam', array['ángel','hablar','animal','camino','espada'], 'Números 22:21-35'),
('dificil', 'El valle de los huesos secos', array['ezequiel','visión','huesos','vida','profetizar'], 'Ezequiel 37:1-14'),
('dificil', 'Melquisedec', array['sacerdote','salem','pan','abraham','diezmo'], 'Génesis 14:18-20'),
('dificil', 'La escritura en la pared', array['belsasar','mano','banquete','daniel','dedos'], 'Daniel 5'),
('dificil', 'Pentecostés', array['espíritu','lenguas','fuego','apóstoles','viento'], 'Hechos 2'),
('dificil', 'La serpiente de bronce', array['moisés','desierto','mirar','mordedura','asta'], 'Números 21:4-9'),
('dificil', 'El arca del pacto', array['querubines','oro','tablas','sagrada','cofre'], 'Éxodo 25:10-22'),
('dificil', 'Gedeón y los trescientos', array['madianitas','antorchas','trompetas','cántaros','vellón'], 'Jueces 7'),
('dificil', 'El cordero pascual', array['sangre','puerta','egipto','muerte','ángel'], 'Éxodo 12'),
('dificil', 'La conversión de Saulo', array['damasco','luz','ceguera','camino','ananías'], 'Hechos 9:1-19');
end if;
end $$;

do $$ begin
if not exists (select 1 from public.cipher_items) then
insert into public.cipher_items (difficulty, kind, puzzle, hint, answer, aliases, verse_prompt, verse_book, verse_chapter, verse_from) values
-- FÁCIL
('facil','numeros','10 - 15 - 14 - 1 - 19','A = 1, B = 2, C = 3… hasta Z = 26','Jonás','{jonas}',
 'Encuentra el versículo donde Jehová prepara un gran pez para que se trague a Jonás.','Jonás',1,17),
('facil','reverso','SESIOM','Léelo de derecha a izquierda.','Moisés','{moises}',
 'Encuentra el versículo donde la zarza arde en fuego y no se consume.','Éxodo',3,2),
('facil','acertijo','«Mis hermanos me vendieron y terminé en Egipto.»','Piensa en un personaje del Génesis.','José','{jose,jose hijo de jacob}',
 'Encuentra el versículo donde sus hermanos lo venden por veinte piezas de plata.','Génesis',37,28),
('facil','numeros','4 - 1 - 22 - 9 - 4','A = 1, B = 2, C = 3… hasta Z = 26','David','{rey david}',
 'Encuentra el versículo donde vence al filisteo con una honda y una piedra.','1 Samuel',17,50),
('facil','reverso','EON','Léelo de derecha a izquierda.','Noé','{noe}',
 'Encuentra el versículo donde el arca reposa sobre los montes de Ararat.','Génesis',8,4),
('facil','acertijo','«Me echaron al foso de los leones por seguir orando a mi Dios.»','Piensa en un profeta en Babilonia.','Daniel','{}',
 'Encuentra el versículo donde dice que Dios envió su ángel y cerró la boca de los leones.','Daniel',6,22),
('facil','anagrama','NADA','Son las mismas letras, en otro orden.','Adán','{adan}',
 'Encuentra el versículo donde Dios forma al hombre del polvo de la tierra.','Génesis',2,7),
('facil','numeros','16 - 5 - 4 - 18 - 15','A = 1, B = 2, C = 3… hasta Z = 26','Pedro','{simon pedro,cefas}',
 'Encuentra el versículo donde Jesús dice: «Tú eres Pedro, y sobre esta roca edificaré mi iglesia».','Mateo',16,18),
('facil','acertijo','«Mi fuerza vivía en mi cabello.»','Piensa en un juez de Israel.','Sansón','{sanson}',
 'Encuentra el versículo donde le rapan las siete guedejas de su cabeza.','Jueces',16,19),
('facil','reverso','NELEB','Léelo de derecha a izquierda.','Belén','{belen}',
 'Encuentra el versículo que anuncia que de Belén Efrata saldrá el que será Señor en Israel.','Miqueas',5,2),
('facil','numeros','1 - 2 - 18 - 1 - 8 - 1 - 13','A = 1, B = 2, C = 3… hasta Z = 26','Abraham','{abram}',
 'Encuentra el versículo donde creyó a Jehová y le fue contado por justicia.','Génesis',15,6),
('facil','acertijo','«Era bajito, así que me subí a un árbol para ver a Jesús.»','Piensa en un cobrador de impuestos.','Zaqueo','{}',
 'Encuentra el versículo donde Jesús le dice que se dé prisa y descienda.','Lucas',19,5),
-- INTERMEDIO
('intermedio','desplazado','FMJBT','Cada letra está una posición adelante en el alfabeto. Retrocede una.','Elías','{elias}',
 'Encuentra el versículo donde sube al cielo en un torbellino.','2 Reyes',2,11),
('intermedio','anagrama','RESTE','Son las mismas letras, en otro orden.','Ester','{esther,reina ester}',
 'Encuentra el versículo donde le dicen: «¿Y quién sabe si para esta hora has llegado al reino?».','Ester',4,14),
('intermedio','frase','TIERRA · LA · Y · LOS · CREÓ · DIOS · CIELOS · EN · EL · PRINCIPIO','Ordena las palabras para formar la frase.','En el principio creó Dios los cielos y la tierra','{en el principio creo dios los cielos y la tierra}',
 'Encuentra el versículo exacto donde está escrita esa frase.','Génesis',1,1),
('intermedio','numeros','14 - 5 - 8 - 5 - 13 - 9 - 1 - 19','A = 1, B = 2, C = 3… hasta Z = 26','Nehemías','{nehemias}',
 'Encuentra el versículo que dice en cuántos días se terminó el muro.','Nehemías',6,15),
('intermedio','acertijo','«Mientras dormía vi una escalera que llegaba hasta el cielo.»','Piensa en un patriarca del Génesis.','Jacob','{}',
 'Encuentra el versículo donde sueña con la escalera y los ángeles.','Génesis',28,12),
('intermedio','anagrama','BORDEA','Son las mismas letras, en otro orden.','Débora','{debora}',
 'Encuentra el versículo que la presenta como profetisa que juzgaba a Israel.','Jueces',4,4),
('intermedio','desplazado','TBMPNPO','Cada letra está una posición adelante en el alfabeto. Retrocede una.','Salomón','{salomon,rey salomon}',
 'Encuentra el versículo donde pide un corazón entendido para juzgar al pueblo.','1 Reyes',3,9),
('intermedio','acertijo','«Miré hacia atrás y quedé convertida en estatua de sal.»','Piensa en el relato de Sodoma.','La mujer de Lot','{mujer de lot,esposa de lot}',
 'Encuentra el versículo donde se convierte en estatua de sal.','Génesis',19,26),
('intermedio','sin_vocales','P _ B L _','Le faltan las vocales.','Pablo','{saulo,saulo de tarso,pablo de tarso}',
 'Encuentra el versículo donde una voz le pregunta: «Saulo, Saulo, ¿por qué me persigues?».','Hechos',9,4),
('intermedio','sin_vocales','J _ R _ C _','Le faltan las vocales.','Jericó','{jerico}',
 'Encuentra el versículo donde el muro se derrumba y el pueblo toma la ciudad.','Josué',6,20),
('intermedio','numeros','12 - 1 - 26 - 1 - 18 - 15','A = 1, B = 2, C = 3… hasta Z = 26','Lázaro','{lazaro}',
 'Encuentra el versículo donde Jesús clama: «¡Lázaro, ven fuera!».','Juan',11,43),
('intermedio','frase','SAL · VOSOTROS · LA · SOIS · TIERRA · DE · LA','Ordena las palabras para formar la frase.','Vosotros sois la sal de la tierra','{sois la sal de la tierra,la sal de la tierra}',
 'Encuentra el versículo exacto donde está escrita esa frase.','Mateo',5,13),
-- DIFÍCIL
('dificil','desplazado','OGNSWKUGFGE','Cada letra está dos posiciones adelante en el alfabeto. Retrocede dos.','Melquisedec','{melquisedech}',
 'Encuentra el versículo que lo presenta como rey de Salem y sacerdote del Dios Altísimo.','Génesis',14,18),
('dificil','anagrama','ELOISE','Son las mismas letras, en otro orden.','Eliseo','{profeta eliseo}',
 'Encuentra el versículo donde hace flotar el hierro que había caído al agua.','2 Reyes',6,6),
('dificil','acertijo','«Mi burra habló para salvarme la vida.»','Piensa en el libro de Números.','Balaam','{}',
 'Encuentra el versículo donde la asna abre la boca y le habla.','Números',22,28),
('dificil','sin_vocales','H _ B _ C _ C','Le faltan las vocales.','Habacuc','{}',
 'Encuentra el versículo que dice que el justo por su fe vivirá.','Habacuc',2,4),
('dificil','numeros','5 - 26 - 5 - 17 - 21 - 9 - 5 - 12','A = 1, B = 2, C = 3… hasta Z = 26','Ezequiel','{}',
 'Encuentra el versículo donde se le manda profetizar a los huesos secos.','Ezequiel',37,4),
('dificil','frase','PALABRA · ES · MIS · LÁMPARA · A · TU · PIES','Ordena las palabras para formar la frase.','Lámpara es a mis pies tu palabra','{lampara es a mis pies tu palabra}',
 'Encuentra el versículo exacto donde está escrita esa frase.','Salmos',119,105),
('dificil','acertijo','«Me llamaron el discípulo amado y escribí desde una isla.»','Piensa en el autor del Apocalipsis.','Juan','{juan el apostol,apostol juan}',
 'Encuentra el versículo donde dice que estaba en la isla llamada Patmos.','Apocalipsis',1,9),
('dificil','reverso','LEUMAS','Léelo de derecha a izquierda.','Samuel','{profeta samuel}',
 'Encuentra el versículo donde responde: «Habla, porque tu siervo oye».','1 Samuel',3,10),
('dificil','anagrama','DENEGO','Son las mismas letras, en otro orden.','Gedeón','{gedeon}',
 'Encuentra el versículo donde Jehová reduce el ejército a trescientos hombres.','Jueces',7,7),
('dificil','desplazado','UJNPUFP','Cada letra está una posición adelante en el alfabeto. Retrocede una.','Timoteo','{}',
 'Encuentra el versículo donde le dicen que ninguno tenga en poco su juventud.','1 Timoteo',4,12),
('dificil','sin_vocales','S _ F _ N _ _ S','Le faltan las vocales.','Sofonías','{sofonias}',
 'Encuentra el versículo que dice que Jehová está en medio de ti, poderoso, y él salvará.','Sofonías',3,17),
('dificil','numeros','5 - 19 - 20 - 5 - 2 - 1 - 14','A = 1, B = 2, C = 3… hasta Z = 26','Esteban','{}',
 'Encuentra el versículo donde pide: «Señor, no les tomes en cuenta este pecado».','Hechos',7,60);
end if;
end $$;

do $$ begin
if not exists (select 1 from public.auction_questions) then
insert into public.auction_questions (category, difficulty, question, answer, aliases, reference) values
-- PERSONAJES DEL ANTIGUO TESTAMENTO
('Personajes del Antiguo Testamento','facil','¿Quién fue vendido por sus hermanos y llegó a gobernar en Egipto?','José','{jose hijo de jacob}','Génesis 37–41'),
('Personajes del Antiguo Testamento','facil','¿Cómo se llamaba el hermano que mató a Abel?','Caín','{cain}','Génesis 4:8'),
('Personajes del Antiguo Testamento','intermedio','¿Qué hijo de Jacob propuso vender a José en lugar de matarlo?','Judá','{juda}','Génesis 37:26-27'),
('Personajes del Antiguo Testamento','intermedio','¿Cómo se llamaba el suegro de Moisés, sacerdote de Madián?','Jetro','{reuel,ragüel,raguel}','Éxodo 3:1; 18:1'),
('Personajes del Antiguo Testamento','dificil','¿Quién caminó con Dios y desapareció porque Dios se lo llevó?','Enoc','{henoc,enoch}','Génesis 5:24'),
('Personajes del Antiguo Testamento','dificil','¿Qué espía, junto con Josué, trajo un buen informe de la tierra prometida?','Caleb','{}','Números 13:30; 14:6-9'),
-- PROFETAS
('Profetas','facil','¿Qué profeta subió al cielo en un torbellino?','Elías','{elias}','2 Reyes 2:11'),
('Profetas','facil','¿A qué profeta envió Dios a predicar a Nínive?','Jonás','{jonas}','Jonás 1:1-2'),
('Profetas','intermedio','¿Qué profeta pidió una doble porción del espíritu de Elías?','Eliseo','{}','2 Reyes 2:9'),
('Profetas','intermedio','¿Qué profeta vio en visión un valle lleno de huesos secos?','Ezequiel','{}','Ezequiel 37:1-14'),
('Profetas','dificil','¿Qué profeta se casó con Gomer por mandato de Dios?','Oseas','{}','Oseas 1:2-3'),
('Profetas','dificil','¿Qué profeta era pastor de Tecoa y recogía higos silvestres?','Amós','{amos}','Amós 1:1; 7:14'),
-- LUGARES BÍBLICOS
('Lugares bíblicos','facil','¿En qué huerto puso Dios a Adán y Eva?','Edén','{eden,jardin del eden,huerto del eden}','Génesis 2:8'),
('Lugares bíblicos','facil','¿Qué ciudad amurallada cayó cuando el pueblo tocó las trompetas y gritó?','Jericó','{jerico}','Josué 6:20'),
('Lugares bíblicos','intermedio','¿En qué monte recibió Moisés los Diez Mandamientos?','Sinaí','{sinai,monte sinai,horeb}','Éxodo 19–20'),
('Lugares bíblicos','intermedio','¿En qué río se zambulló Naamán siete veces para ser sanado?','Jordán','{jordan,rio jordan}','2 Reyes 5:14'),
('Lugares bíblicos','dificil','¿En qué monte desafió Elías a los profetas de Baal?','Carmelo','{monte carmelo}','1 Reyes 18:19-20'),
('Lugares bíblicos','dificil','¿En qué ciudad llamaron cristianos a los discípulos por primera vez?','Antioquía','{antioquia}','Hechos 11:26'),
-- NUEVO TESTAMENTO
('Nuevo Testamento','facil','¿Quién bautizó a Jesús en el río Jordán?','Juan el Bautista','{juan bautista,bautista,juan}','Mateo 3:13'),
('Nuevo Testamento','facil','¿Qué discípulo no creyó en la resurrección hasta ver las heridas de Jesús?','Tomás','{tomas,dídimo,didimo}','Juan 20:24-29'),
('Nuevo Testamento','intermedio','¿Qué fariseo visitó a Jesús de noche?','Nicodemo','{}','Juan 3:1-2'),
('Nuevo Testamento','intermedio','¿Quién fue elegido para ocupar el lugar de Judas entre los doce?','Matías','{matias}','Hechos 1:26'),
('Nuevo Testamento','dificil','¿Cómo se llamaba el mago de Samaria que quiso comprar con dinero el don del Espíritu Santo?','Simón','{simon el mago,simon mago}','Hechos 8:9-24'),
('Nuevo Testamento','dificil','¿Qué discípula de Jope, llena de buenas obras, fue resucitada por Pedro?','Tabita','{dorcas}','Hechos 9:36-41'),
-- ¿QUIÉN LO DIJO?
('¿Quién lo dijo?','facil','«Heme aquí, envíame a mí.»','Isaías','{isaias}','Isaías 6:8'),
('¿Quién lo dijo?','facil','«Habla, porque tu siervo oye.»','Samuel','{}','1 Samuel 3:10'),
('¿Quién lo dijo?','intermedio','«¿Soy yo acaso guarda de mi hermano?»','Caín','{cain}','Génesis 4:9'),
('¿Quién lo dijo?','intermedio','«Tu pueblo será mi pueblo, y tu Dios mi Dios.»','Rut','{ruth}','Rut 1:16'),
('¿Quién lo dijo?','dificil','«Si perezco, que perezca.»','Ester','{esther,reina ester}','Ester 4:16'),
('¿Quién lo dijo?','dificil','«Por poco me persuades a ser cristiano.»','Agripa','{rey agripa,herodes agripa}','Hechos 26:28'),
-- REYES
('Reyes','facil','¿Qué rey pidió a Dios sabiduría para gobernar al pueblo?','Salomón','{salomon}','1 Reyes 3:9'),
('Reyes','facil','¿Qué rey, que antes cuidaba ovejas, escribió muchos de los Salmos?','David','{rey david}','1 Samuel 16:11-13'),
('Reyes','intermedio','¿Qué rey de Babilonia soñó con una gran estatua?','Nabucodonosor','{}','Daniel 2:31'),
('Reyes','intermedio','¿Qué rey de Israel se casó con Jezabel?','Acab','{ajab}','1 Reyes 16:30-31'),
('Reyes','dificil','¿Qué rey de Judá oró enfermo y Dios le añadió quince años de vida?','Ezequías','{ezequias}','2 Reyes 20:1-6'),
('Reyes','dificil','¿Qué rey comenzó a reinar a los ocho años y halló el libro de la ley en el templo?','Josías','{josias}','2 Reyes 22:1-8'),
-- MILAGROS
('Milagros','facil','¿Qué hizo Jesús en su primer milagro, en unas bodas en Caná?','Convirtió el agua en vino','{agua en vino,convertir el agua en vino,el agua en vino}','Juan 2:1-11'),
('Milagros','facil','¿Cuántos panes usó Jesús para alimentar a los cinco mil?','Cinco','{5,cinco panes,5 panes}','Mateo 14:17-21'),
('Milagros','intermedio','¿A quién resucitó Jesús cuando llevaba cuatro días en el sepulcro?','Lázaro','{lazaro}','Juan 11:39-44'),
('Milagros','intermedio','¿Qué profeta hizo flotar el hierro de un hacha?','Eliseo','{}','2 Reyes 6:5-7'),
('Milagros','dificil','¿Sobre qué ciudad mandó Josué que se detuviera el sol?','Gabaón','{gabaon}','Josué 10:12-13'),
('Milagros','dificil','¿Qué ciego de Jericó gritó «Hijo de David, ten misericordia de mí» y recibió la vista?','Bartimeo','{ciego bartimeo}','Marcos 10:46-52'),
-- PARÁBOLAS DE JESÚS
('Parábolas de Jesús','facil','¿Qué buscó el pastor que dejó a las noventa y nueve en el desierto?','Una oveja','{oveja,oveja perdida,la oveja perdida}','Lucas 15:4'),
('Parábolas de Jesús','facil','¿Cómo se conoce al hijo que pidió su herencia y la malgastó lejos de casa?','El hijo pródigo','{hijo prodigo,prodigo,hijo menor}','Lucas 15:11-32'),
('Parábolas de Jesús','intermedio','En la parábola del sembrador, ¿qué es la semilla?','La palabra de Dios','{palabra,la palabra}','Lucas 8:11'),
('Parábolas de Jesús','intermedio','En la parábola de las diez vírgenes, ¿cuántas eran prudentes?','Cinco','{5}','Mateo 25:2'),
('Parábolas de Jesús','dificil','En la parábola de los talentos, ¿qué hizo el siervo que recibió un solo talento?','Lo enterró','{enterro,lo escondio,lo escondio en la tierra,lo escondio bajo tierra,lo enterro en la tierra}','Mateo 25:18'),
('Parábolas de Jesús','dificil','¿Cómo se llamaba el mendigo de la parábola del rico?','Lázaro','{lazaro}','Lucas 16:20'),
-- MUJERES DE LA BIBLIA
('Mujeres de la Biblia','facil','¿Cómo se llamaba la primera mujer?','Eva','{}','Génesis 3:20'),
('Mujeres de la Biblia','facil','¿Cómo se llamaba la esposa de Abraham?','Sara','{sarai}','Génesis 17:15'),
('Mujeres de la Biblia','intermedio','¿Qué mujer escondió a los espías en Jericó?','Rahab','{rajab}','Josué 2:1-6'),
('Mujeres de la Biblia','intermedio','¿Qué hermana de Moisés cantó con pandero después de cruzar el mar Rojo?','María','{maria,miriam}','Éxodo 15:20'),
('Mujeres de la Biblia','dificil','¿Qué vendedora de púrpura, de Tiatira, creyó al oír a Pablo?','Lidia','{}','Hechos 16:14'),
('Mujeres de la Biblia','dificil','¿Qué profetisa anciana habló del niño Jesús en el templo?','Ana','{profetisa ana}','Lucas 2:36-38'),
-- NÚMEROS EN LA BIBLIA
('Números en la Biblia','facil','¿En cuántos días creó Dios todo antes de descansar?','Seis','{6,seis dias,6 dias}','Génesis 1:31–2:2'),
('Números en la Biblia','facil','¿Cuántas tribus formaban el pueblo de Israel?','Doce','{12,doce tribus}','Génesis 49:28'),
('Números en la Biblia','intermedio','¿Cuántos días estuvo Jonás en el vientre del gran pez?','Tres','{3,tres dias,3 dias}','Jonás 1:17'),
('Números en la Biblia','intermedio','¿Cuántas veces dijo Jesús que hay que perdonar al hermano?','Setenta veces siete','{70 veces 7,490,setenta veces 7}','Mateo 18:22'),
('Números en la Biblia','dificil','¿Cuántos años vivió Matusalén?','969','{novecientos sesenta y nueve}','Génesis 5:27'),
('Números en la Biblia','dificil','¿Con cuántos hombres venció Gedeón a los madianitas?','300','{trescientos,300 hombres}','Jueces 7:7'),
-- LIBROS DE LA BIBLIA
('Libros de la Biblia','facil','¿Qué libro de la Biblia tiene 150 capítulos?','Salmos','{los salmos,salmo}','Salmos'),
('Libros de la Biblia','facil','¿Qué libro cuenta la creación del mundo?','Génesis','{genesis}','Génesis 1'),
('Libros de la Biblia','intermedio','¿Qué libro cuenta cómo nació y creció la iglesia después de la ascensión de Jesús?','Hechos','{hechos de los apostoles}','Hechos 1–28'),
('Libros de la Biblia','intermedio','¿Qué libro cuenta cómo una reina judía salvó a su pueblo en Persia?','Ester','{esther}','Ester 1–10'),
('Libros de la Biblia','dificil','¿Cuál es el libro más corto del Antiguo Testamento?','Abdías','{abdias}','Abdías 1'),
('Libros de la Biblia','dificil','¿Qué carta escribió Pablo para pedir que recibieran de vuelta al esclavo Onésimo?','Filemón','{filemon}','Filemón 1:10-17');
end if;
end $$;

do $$ begin
if not exists (select 1 from public.timeline_sets) then
insert into public.timeline_sets (difficulty, title, events, explanation) values
-- FÁCIL: acontecimientos muy separados en el tiempo
('facil','Personajes del Antiguo Testamento',
 array['Adán','Noé','Abraham','Moisés','Josué','David','Elías','Daniel'],
 'Adán es el primer hombre (Génesis 2). Noé vive el diluvio (Génesis 6) y Abraham es llamado después (Génesis 12). Siglos más tarde Moisés saca a Israel de Egipto y Josué lo lleva a Canaán. David es rey; Elías profetiza en tiempos de Acab, y Daniel vive el exilio en Babilonia.'),
('facil','Grandes acontecimientos del Antiguo Testamento',
 array['La creación','El diluvio','La torre de Babel','El éxodo de Egipto','David derrota a Goliat','Daniel en el foso de los leones'],
 'Génesis 1, 7 y 11; Éxodo 12–14; 1 Samuel 17; Daniel 6. De los orígenes al exilio en Babilonia.'),
('facil','La vida de Jesús',
 array['Nacimiento de Jesús','Jesús a los 12 años en el templo','Bautismo de Jesús','Las tentaciones en el desierto','Alimentación de los cinco mil','Entrada triunfal en Jerusalén','Crucifixión','Resurrección'],
 'Lucas 2:7, Lucas 2:42, Mateo 3:13, Mateo 4:1, Juan 6:10, Juan 12:12-13, Mateo 27:35 y Mateo 28:6. Su ministerio público empieza con el bautismo y termina en Jerusalén.'),
('facil','La vida de Moisés',
 array['Moisés en una canasta en el río','Moisés huye a Madián','La zarza ardiente','Las diez plagas','El cruce del mar Rojo','El maná cae del cielo','Los Diez Mandamientos','Moisés envía a los doce espías'],
 'Éxodo 2:3, 2:15, 3:2, 7–11, 14, 16 y 20; Números 13. Primero huye de Egipto; Dios lo llama en la zarza y regresa a liberar al pueblo.'),
('facil','La historia de José',
 array['José recibe la túnica de colores','Sus hermanos lo venden','José en la cárcel','José interpreta los sueños del faraón','José gobierna Egipto','Jacob y su familia llegan a Egipto'],
 'Génesis 37:3, 37:28, 39:20, 41:25, 41:41 y 46:6.'),
('facil','Los días de la creación',
 array['La luz','La expansión que separa las aguas','La tierra seca y las plantas','El sol, la luna y las estrellas','Los peces y las aves','Los animales terrestres y el ser humano'],
 'Génesis 1: del día primero al sexto.'),
('facil','La vida de David',
 array['Samuel unge a David','David vence a Goliat','David huye de Saúl','David es rey sobre todo Israel','David lleva el arca a Jerusalén','Salomón hereda el trono'],
 '1 Samuel 16, 17 y 19; 2 Samuel 5 y 6; 1 Reyes 1.'),
('facil','La última semana de Jesús',
 array['Entrada triunfal en Jerusalén','La última cena','Oración en Getsemaní','Juicio ante Pilato','Crucifixión','La tumba vacía'],
 'Mateo 21, 26 y 27; Mateo 28:6. Del domingo de la entrada al domingo de la resurrección.'),
-- INTERMEDIO
('intermedio','De Josué a Salomón',
 array['Josué','Débora','Gedeón','Sansón','Samuel','Saúl','David','Salomón'],
 'Josué conquista Canaán. Débora (Jueces 4), Gedeón (Jueces 6) y Sansón (Jueces 13) son jueces. Samuel es el último juez y unge a Saúl, el primer rey, y luego a David. Salomón reina después de David.'),
('intermedio','Los patriarcas y sus sucesores',
 array['Abraham','Isaac','Jacob','José','Moisés','Josué'],
 'Abraham es padre de Isaac, Isaac de Jacob y Jacob de José (Génesis). Siglos después Moisés saca al pueblo de Egipto, y Josué lo sucede y entra a Canaán.'),
('intermedio','Profetas',
 array['Elías','Eliseo','Isaías','Jeremías','Daniel','Malaquías'],
 'Elías y su sucesor Eliseo profetizan en tiempos de Acab. Isaías, en tiempos de Ezequías. Jeremías, antes de la caída de Jerusalén. Daniel, en el exilio. Malaquías cierra el Antiguo Testamento.'),
('intermedio','De Egipto al desierto',
 array['La Pascua en Egipto','El cruce del mar Rojo','El maná cae del cielo','Los Diez Mandamientos','El becerro de oro','Los doce espías'],
 'Éxodo 12, 14, 16, 20 y 32; Números 13.'),
('intermedio','La iglesia en Hechos',
 array['Ascensión de Jesús','Pentecostés','Sanidad del cojo en la puerta la Hermosa','Muerte de Esteban','Conversión de Saulo','Pedro en casa de Cornelio','Un ángel libra a Pedro de la cárcel','Concilio de Jerusalén'],
 'Hechos 1, 2, 3, 7, 9, 10, 12 y 15.'),
('intermedio','Señales en el evangelio de Juan',
 array['El agua convertida en vino','Sanidad del hijo del oficial del rey','Alimentación de los cinco mil','Jesús camina sobre el mar','Sanidad del ciego de nacimiento','Resurrección de Lázaro'],
 'Juan 2, 4, 6:1-14, 6:16-21, 9 y 11. Juan dice que las dos primeras fueron la primera y la segunda señal.'),
('intermedio','Reyes de Israel y Judá',
 array['Saúl','David','Salomón','Roboam','Acab','Ezequías'],
 'Saúl, David y Salomón reinan sobre todo Israel. Con Roboam el reino se divide. Acab reina en el norte; Ezequías, en Judá, más de un siglo después.'),
('intermedio','La vida de Pablo',
 array['Cuida la ropa de los que apedrean a Esteban','Conversión camino a Damasco','Primer viaje misionero con Bernabé','Visión del varón macedonio','Arrestado en el templo de Jerusalén','Naufragio rumbo a Roma'],
 'Hechos 7:58, 9:3, 13:2, 16:9, 21:30 y 27:41.'),
-- DIFÍCIL: acontecimientos muy cercanos entre sí
('dificil','La noche del juicio de Jesús',
 array['Oración en Getsemaní','El beso de Judas','Jesús ante el sumo sacerdote','Jesús ante Pilato','Jesús ante Herodes','Barrabás queda libre'],
 'Lucas 22:39-48 y 22:54; 23:1, 23:7 y 23:18-25. Pilato lo envía a Herodes, que lo devuelve a Pilato.'),
('dificil','Las plagas de Egipto',
 array['El agua se convierte en sangre','Las ranas','Las moscas','El granizo','Las langostas','Las tinieblas'],
 'Éxodo 7:20, 8:6, 8:24, 9:23, 10:13 y 10:22. Son la 1ª, 2ª, 4ª, 7ª, 8ª y 9ª plaga.'),
('dificil','Reyes de Judá',
 array['Roboam','Asa','Josafat','Uzías','Acaz','Ezequías','Josías','Sedequías'],
 'Roboam es el primer rey de Judá tras la división y Sedequías el último antes de la caída de Jerusalén. Isaías tuvo su visión el año en que murió Uzías (Isaías 6:1), y Acaz fue el padre de Ezequías.'),
('dificil','Jueces de Israel',
 array['Otoniel','Aod','Samgar','Débora','Gedeón','Abimelec','Jefté','Sansón'],
 'Jueces 3:9, 3:15, 3:31, 4:4, 6:11, 9:1, 11:1 y 13:24. Abimelec, hijo de Gedeón, se hizo rey tras la muerte de su padre.'),
('dificil','Los primeros días de la iglesia',
 array['Matías es elegido apóstol','Pentecostés','Sanidad del cojo en la puerta la Hermosa','Ananías y Safira','Elección de los siete','Muerte de Esteban'],
 'Hechos 1:26, 2, 3, 5, 6 y 7.'),
('dificil','El regreso del exilio',
 array['Babilonia destruye Jerusalén','Decreto de Ciro','Se termina el segundo templo','Ester es reina en Persia','Esdras llega a Jerusalén','Nehemías reconstruye los muros'],
 '2 Reyes 25; Esdras 1 y 6:15; Ester 2:17; Esdras 7:8 y Nehemías 6:15. Ester vive en tiempos de Asuero (Jerjes), antes que Esdras y Nehemías (Artajerjes).'),
('dificil','Elías y Eliseo',
 array['Los cuervos alimentan a Elías','Elías resucita al hijo de la viuda','Fuego del cielo en el monte Carmelo','Elías oye un silbo apacible en Horeb','Elías sube al cielo en un torbellino','Eliseo sana a Naamán'],
 '1 Reyes 17:6, 17:22, 18:38 y 19:12; 2 Reyes 2:11 y 5:14.'),
('dificil','Abraham y su descendencia',
 array['Dios llama a Abraham','Abraham y Lot se separan','Destrucción de Sodoma','Nace Isaac','Abraham ofrece a Isaac en Moriah','Jacob recibe la bendición de Isaac'],
 'Génesis 12, 13, 19, 21, 22 y 27.');
end if;
end $$;
