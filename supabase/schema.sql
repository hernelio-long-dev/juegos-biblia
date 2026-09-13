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

create table if not exists public.rooms (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  status           text not null default 'open' check (status in ('open','closed')),
  view             text not null default 'lobby' check (view in ('lobby','round','leaderboard','podium')),
  current_round_id uuid,
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

create table if not exists public.rounds (
  id             uuid primary key default gen_random_uuid(),
  room_id        uuid not null references public.rooms(id) on delete cascade,
  game           text not null check (game in ('emoji','quiz')),
  difficulty     text not null check (difficulty in ('facil','intermedio','dificil')),
  item_id        uuid not null,
  seq            int  not null,
  status         text not null default 'active' check (status in ('active','revealed')),
  clues_total    int,
  clues_revealed int  not null default 0,
  prompt         text,
  options        text[],
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
  created_at     timestamptz not null default now()
);
create index if not exists answers_room_idx on public.answers(room_id);
create index if not exists answers_round_idx on public.answers(round_id);
create unique index if not exists answers_one_correct on public.answers(round_id, participant_id) where is_correct;
create unique index if not exists answers_one_choice  on public.answers(round_id, participant_id) where choice is not null;

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

  if not p_force then
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

  update rounds r set
    status = 'revealed',
    revealed_at = clock_timestamp(),
    answer_text = case when r.game = 'emoji'
      then (select e.answer from emoji_items e where e.id = r.item_id)
      else (select q.options[q.correct_index + 1] from quiz_questions q where q.id = r.item_id) end,
    correct_index = case when r.game = 'quiz'
      then (select q.correct_index from quiz_questions q where q.id = r.item_id) end,
    clues_revealed = coalesce(r.clues_total, r.clues_revealed)
  where r.id = p_round and r.status = 'active';
  return true;
end $$;

create or replace function public.start_round(p_room uuid, p_game text, p_difficulty text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_seq int; v_id uuid; v_old uuid; e emoji_items; q quiz_questions;
begin
  if not is_admin() then raise exception 'No autorizado'; end if;
  if not exists (select 1 from rooms where id = p_room and status = 'open') then
    raise exception 'La sala no está abierta';
  end if;
  for v_old in select id from rounds where room_id = p_room and status = 'active' loop
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
  for v_old in select id from rounds where room_id = p_room and status = 'active' loop
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
  v_show := rd.game = 'emoji' or rd.status = 'revealed';

  return json_build_object(
    'server_now', clock_timestamp(),
    'room', json_build_object('id', r.id, 'name', r.name, 'status', r.status, 'view', r.view),
    'me', json_build_object(
      'participant_id', t.participant_id,
      'name', (select name from participants where id = t.participant_id),
      'points', coalesce(v_points, 0), 'rank', v_rank, 'players', v_players),
    'round', case when rd.id is null then null else json_build_object(
      'id', rd.id, 'game', rd.game, 'difficulty', rd.difficulty, 'seq', rd.seq, 'status', rd.status,
      'clues_total', rd.clues_total, 'clues_revealed', rd.clues_revealed,
      'prompt', rd.prompt, 'options', rd.options,
      'started_at', rd.started_at, 'deadline', rd.deadline,
      'answer_text', rd.answer_text, 'correct_index', rd.correct_index) end,
    'my_answer', case when a.id is null then null else json_build_object(
      'choice', a.choice, 'answer_text', a.answer_text,
      'is_correct', case when v_show then a.is_correct end,
      'points', case when v_show then a.points end,
      'clue_number', a.clue_number,
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
grant select on public.participants, public.rooms, public.room_players, public.rounds to anon;
grant select, insert, update, delete on
  public.participants, public.emoji_items, public.quiz_questions, public.rooms,
  public.room_codes, public.room_players, public.rounds, public.answers to authenticated;
grant select on public.admins to authenticated;
revoke all on public.player_tokens from anon, authenticated;

revoke execute on function public.create_room(text), public.reveal_round(uuid, boolean), public.start_round(uuid, text, text),
  public.reveal_clue(uuid), public.set_room_view(uuid, text), public.close_room(uuid),
  public.release_player(uuid, uuid), public.room_players_status(uuid), public.claim_admin() from anon, public;
grant execute on function public.create_room(text), public.reveal_round(uuid, boolean), public.start_round(uuid, text, text),
  public.reveal_clue(uuid), public.set_room_view(uuid, text), public.close_room(uuid),
  public.release_player(uuid, uuid), public.room_players_status(uuid), public.claim_admin() to authenticated;
grant execute on function public.server_now(), public.room_scoreboard(uuid, text), public.lookup_room(text),
  public.join_room(text, uuid), public.player_state(uuid), public.submit_emoji(uuid, uuid, text),
  public.submit_quiz(uuid, uuid, int), public.is_admin() to anon, authenticated;

-- ---------------------------------------------------------------------
-- REALTIME
-- ---------------------------------------------------------------------
do $$
declare tbl text;
begin
  foreach tbl in array array['rooms','rounds','room_players','answers'] loop
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
