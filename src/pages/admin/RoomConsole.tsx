import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import QRCode from 'qrcode'
import { Leaderboard, Podium, TeamLeaderboard } from '../../components/Leaderboard'
import { CountdownRing, DifficultyChip, ErrorBox, Spinner } from '../../components/ui'
import { secondsLeft, useClockSync, useServerNow } from '../../lib/clock'
import { celebrate } from '../../lib/fx'
import { useLiveRefresh } from '../../lib/realtime'
import { emojiPoints } from '../../lib/scoring'
import { errorMessage, supabase } from '../../lib/supabase'
import {
  CIPHER_KIND_LABEL, CIPHER_SECONDS, DIFFICULTIES, DIFFICULTY_LABEL, EMOJI_FINAL_SECONDS, GAME_ICON,
  GAME_LABEL, GAME_SHORT, GAMES, OPTION_STYLES, QUIZ_SECONDS, TABOO_SECONDS, VERSE_SECONDS, teamStyle,
  type AnswerRow, type CipherItem, type Difficulty, type EmojiItem, type Game, type PlayerStatus,
  type Room, type RoomView, type Round, type ScoreRow, type TabooItem, type Team, type TeamScoreRow,
} from '../../lib/types'
import TeamsDrawer, { suggestedTeams } from './TeamsDrawer'

type Remaining = Record<Game, Record<Difficulty, number>>
type BoardView = Game | 'teams' | null

export default function RoomConsole() {
  const { roomId = '' } = useParams()
  useClockSync()
  const now = useServerNow(200)

  const [room, setRoom] = useState<Room | null>(null)
  const [code, setCode] = useState<string | null>(null)
  const [round, setRound] = useState<Round | null>(null)
  const [emojiItem, setEmojiItem] = useState<EmojiItem | null>(null)
  const [tabooItem, setTabooItem] = useState<TabooItem | null>(null)
  const [cipherItem, setCipherItem] = useState<CipherItem | null>(null)
  const [answers, setAnswers] = useState<AnswerRow[]>([])
  const [players, setPlayers] = useState<PlayerStatus[]>([])
  const [registered, setRegistered] = useState(0)
  const [scores, setScores] = useState<ScoreRow[]>([])
  const [boardGame, setBoardGame] = useState<BoardView>(null)
  const [teams, setTeams] = useState<Team[]>([])
  const [teamScores, setTeamScores] = useState<TeamScoreRow[]>([])
  const [teamId, setTeamId] = useState<string | null>(null)
  const [remaining, setRemaining] = useState<Remaining | null>(null)
  const [game, setGame] = useState<Game>('emoji')
  const [difficulty, setDifficulty] = useState<Difficulty>('facil')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [showControls, setShowControls] = useState(true)
  const [showPlayers, setShowPlayers] = useState(false)
  const [showTeams, setShowTeams] = useState(false)
  const [peek, setPeek] = useState(false)
  const [notFound, setNotFound] = useState(false)

  // ------------------------------------------------------------ carga de datos
  const loadRoom = useCallback(async () => {
    const [{ data: r, error: e1 }, { data: c }] = await Promise.all([
      supabase.from('rooms').select('*').eq('id', roomId).maybeSingle(),
      supabase.from('room_codes').select('code').eq('room_id', roomId).maybeSingle(),
    ])
    if (e1) return setError(errorMessage(e1))
    if (!r) return setNotFound(true)
    setRoom(r as Room)
    setCode(c?.code ?? null)
    if (r.current_round_id) {
      const { data: rd } = await supabase.from('rounds').select('*').eq('id', r.current_round_id).single()
      setRound(rd as Round)
    } else {
      setRound(null)
    }
  }, [roomId])

  const loadPlayers = useCallback(async () => {
    const [{ data }, { count }] = await Promise.all([
      supabase.rpc('room_players_status', { p_room: roomId }),
      supabase.from('participants').select('id', { count: 'exact', head: true }),
    ])
    if (data) setPlayers(data as PlayerStatus[])
    setRegistered(count ?? 0)
  }, [roomId])

  const loadScores = useCallback(async () => {
    const game = boardGame === 'teams' ? null : boardGame
    const [{ data }, { data: t }] = await Promise.all([
      supabase.rpc('room_scoreboard', { p_room: roomId, p_game: game }),
      supabase.rpc('room_team_scoreboard', { p_room: roomId }),
    ])
    if (data) setScores(data as ScoreRow[])
    if (t) setTeamScores(t as TeamScoreRow[])
  }, [roomId, boardGame])

  const loadTeams = useCallback(async () => {
    const { data } = await supabase.rpc('room_teams', { p_room: roomId })
    if (!data) return
    const list = data as Team[]
    setTeams(list)
    setTeamId((cur) => (cur && list.some((t) => t.id === cur) ? cur : list[0]?.id ?? null))
  }, [roomId])

  const loadRemaining = useCallback(async () => {
    const [{ data: e }, { data: q }, { data: tb }, { data: ci }, { data: used }] = await Promise.all([
      supabase.from('emoji_items').select('id, difficulty'),
      supabase.from('quiz_questions').select('id, difficulty'),
      supabase.from('taboo_items').select('id, difficulty'),
      supabase.from('cipher_items').select('id, difficulty'),
      supabase.from('rounds').select('item_id').eq('room_id', roomId),
    ])
    const usedSet = new Set((used ?? []).map((u) => u.item_id))
    const count = (rows: { id: string; difficulty: Difficulty }[] | null) =>
      Object.fromEntries(DIFFICULTIES.map((d) => [d, (rows ?? []).filter((x) => x.difficulty === d && !usedSet.has(x.id)).length])) as Record<Difficulty, number>
    setRemaining({ emoji: count(e), quiz: count(q), taboo: count(tb), cipher: count(ci) })
  }, [roomId])

  const roundId = round?.id ?? null
  const loadAnswers = useCallback(async () => {
    if (!roundId) return setAnswers([])
    const { data } = await supabase.from('answers').select('*').eq('round_id', roundId).order('created_at')
    if (data) setAnswers(data as AnswerRow[])
  }, [roundId])

  useEffect(() => { loadRoom(); loadPlayers(); loadRemaining(); loadTeams() }, [loadRoom, loadPlayers, loadRemaining, loadTeams])
  useEffect(() => { loadAnswers() }, [loadAnswers])
  useEffect(() => { loadScores() }, [loadScores, room?.view, round?.status])

  // pistas del emoji actual (solo visibles para el admin)
  useEffect(() => {
    if (!round || round.game !== 'emoji') return setEmojiItem(null)
    if (emojiItem?.id === round.item_id) return
    supabase.from('emoji_items').select('*').eq('id', round.item_id).single().then(({ data }) => setEmojiItem(data as EmojiItem))
  }, [round, emojiItem?.id])

  // palabra de Tabú: no se pinta en la pantalla grande salvo que el admin la pida.
  useEffect(() => {
    if (!round || round.game !== 'taboo') return setTabooItem(null)
    if (tabooItem?.id === round.item_id) return
    supabase.from('taboo_items').select('*').eq('id', round.item_id).single().then(({ data }) => setTabooItem(data as TabooItem))
  }, [round, tabooItem?.id])
  // el código actual, para que el admin pueda comprobar la respuesta sin proyectarla
  useEffect(() => {
    if (!round || round.game !== 'cipher') return setCipherItem(null)
    if (cipherItem?.id === round.item_id) return
    supabase.from('cipher_items').select('*').eq('id', round.item_id).single().then(({ data }) => setCipherItem(data as CipherItem))
  }, [round, cipherItem?.id])
  useEffect(() => { setPeek(false) }, [round?.id])

  useLiveRefresh(roomId, [
    { table: 'rooms', filter: `id=eq.${roomId}` },
    { table: 'rounds', filter: `room_id=eq.${roomId}` },
  ], loadRoom, 5000)
  useLiveRefresh(`players-${roomId}`, [{ table: 'room_players' }], loadPlayers, 5000)
  useLiveRefresh(`teams-${roomId}`, [
    { table: 'teams', filter: `room_id=eq.${roomId}` },
    { table: 'team_members', filter: `room_id=eq.${roomId}` },
  ], loadTeams, 8000)
  useLiveRefresh(roundId ? `answers-${roundId}` : null, [{ table: 'answers', filter: `round_id=eq.${roundId}` }], loadAnswers, 3000)
  useLiveRefresh(room?.view === 'leaderboard' || room?.view === 'podium' ? `scores-${roomId}` : null, [{ table: 'rounds', filter: `room_id=eq.${roomId}` }], loadScores, 4000)

  // ------------------------------------------------------------ acciones
  const run = useCallback(async (fn: () => PromiseLike<{ error: unknown }>) => {
    setBusy(true)
    setError('')
    const { error } = await fn()
    setBusy(false)
    if (error) setError(errorMessage(error))
    await loadRoom()
  }, [loadRoom])

  const startRound = useCallback(async (g: Game = game, d: Difficulty = difficulty) => {
    setGame(g)
    setDifficulty(d)
    if (g === 'taboo') {
      if (!teamId) return setError('Primero arma los equipos desde «🤝 Equipos».')
      await run(() => supabase.rpc('start_taboo_round', { p_room: roomId, p_difficulty: d, p_team: teamId }))
      // el turno pasa solo al siguiente equipo
      const i = teams.findIndex((t) => t.id === teamId)
      if (i >= 0 && teams.length > 0) setTeamId(teams[(i + 1) % teams.length].id)
    } else {
      await run(() => supabase.rpc('start_round', { p_room: roomId, p_game: g, p_difficulty: d }))
    }
    loadRemaining()
  }, [game, difficulty, run, roomId, loadRemaining, teamId, teams])

  const startTaboo = useCallback(() => {
    if (round?.game === 'taboo' && round.status === 'pending') {
      run(() => supabase.rpc('start_taboo_timer', { p_round: round.id }))
    }
  }, [round, run])

  const stopTaboo = useCallback((guessed: boolean) => {
    if (round?.game === 'taboo' && round.status !== 'revealed') {
      run(() => supabase.rpc('stop_taboo', { p_round: round.id, p_guessed: guessed }))
    }
  }, [round, run])

  const reveal = useCallback(() => {
    if (round?.status === 'active') run(() => supabase.rpc('reveal_round', { p_round: round.id, p_force: true }))
  }, [round, run])

  const nextClue = useCallback(() => {
    if (round?.game === 'emoji' && round.status === 'active' && round.clues_revealed < (round.clues_total ?? 0)) {
      run(() => supabase.rpc('reveal_clue', { p_round: round.id }))
    }
  }, [round, run])

  const setView = useCallback((view: RoomView) => {
    run(() => supabase.rpc('set_room_view', { p_room: roomId, p_view: view }))
  }, [run, roomId])

  async function closeRoom() {
    if (!confirm('¿Cerrar la sala? Los participantes verán el resultado final y el código dejará de funcionar.')) return
    run(() => supabase.rpc('close_room', { p_room: roomId }))
  }

  async function release(p: PlayerStatus) {
    if (!confirm(`¿Liberar a ${p.name}? Podrá volver a entrar desde otro dispositivo (sus puntos se conservan).`)) return
    const { error } = await supabase.rpc('release_player', { p_room: roomId, p_participant: p.participant_id })
    if (error) setError(errorMessage(error))
    loadPlayers()
  }

  // ------------------------------------------------------------ automatismos
  const onlinePlayers = players.filter((p) => p.last_seen && now - new Date(p.last_seen).getTime() < 20_000).length
  // Solo respuestas de la ronda actual: al cambiar de ronda, `answers` puede traer aún las de la anterior.
  const roundAnswers = useMemo(() => answers.filter((a) => a.round_id === round?.id), [answers, round?.id])

  const autoRevealed = useRef<string | null>(null)
  useEffect(() => {
    if (!round || round.status !== 'active' || autoRevealed.current === round.id) return
    if (now < new Date(round.started_at).getTime()) return
    const correctCount = roundAnswers.filter((a) => a.is_correct).length

    // Código secreto: la 2ª fase tiene un reloj por persona, así que la ronda
    // sigue viva mientras alguien pueda descifrar o buscar su versículo.
    if (round.game === 'cipher') {
      const deadlineMs = round.deadline ? new Date(round.deadline).getTime() : 0
      const stillWorking = players.some((p) => {
        const mine = roundAnswers.filter((a) => a.participant_id === p.participant_id)
        const won = mine.find((a) => a.is_correct)
        if (won) return !won.verse_ok && now < new Date(won.created_at).getTime() + VERSE_SECONDS * 1000
        return now < deadlineMs
      })
      if (stillWorking) return
    }

    const timeOver = round.game === 'cipher'
      ? round.deadline !== null && now > new Date(round.deadline).getTime() + (VERSE_SECONDS + 1) * 1000
      : round.deadline !== null && now > new Date(round.deadline).getTime() + 1500
    // En Tabú solo manda el cronómetro: el admin decide si acertaron.
    const everyone = players.length > 0 && round.game !== 'taboo' && (
      round.game === 'quiz' ? roundAnswers.length >= players.length : correctCount >= players.length
    )
    if (timeOver || everyone || round.game === 'cipher') {
      autoRevealed.current = round.id
      const id = round.id
      // Sin p_force: el servidor vuelve a comprobar el tiempo y las respuestas antes de revelar.
      setTimeout(() => {
        supabase.rpc('reveal_round', { p_round: id, p_force: false }).then(({ data }) => {
          if (data === false) setTimeout(() => { if (autoRevealed.current === id) autoRevealed.current = null }, 2000) // aún no correspondía; reintenta en 2 s
          loadRoom()
        })
      }, everyone && !timeOver ? 1200 : 0)
    }
  }, [now, round, roundAnswers, players, loadRoom])

  const prevStatus = useRef<string | null>(null)
  useEffect(() => {
    const key = `${round?.id}-${round?.status}`
    if (prevStatus.current && prevStatus.current !== key && round?.status === 'revealed' && roundAnswers.some((a) => a.is_correct)) celebrate()
    prevStatus.current = key
  }, [round?.id, round?.status, roundAnswers])

  useEffect(() => { if (room?.view === 'podium') celebrate(true) }, [room?.view])

  // atajos de teclado para el proyector
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.target as HTMLElement).closest('input, textarea, select')) return
      if (e.key === 'h' || e.key === 'H') setShowControls((s) => !s)
      else if (e.key === 'f' || e.key === 'F') toggleFullscreen()
      else if (e.key === 't' || e.key === 'T') setView(room?.view === 'leaderboard' ? 'round' : 'leaderboard')
      else if (e.key === 'r' || e.key === 'R') reveal()
      else if (e.key === 'Enter' && round?.game === 'taboo' && round.status === 'active') {
        e.preventDefault()
        stopTaboo(true)
      }
      else if (e.key === ' ' || e.key === 'ArrowRight') {
        e.preventDefault()
        if (round?.status === 'active' && round.game === 'emoji') nextClue()
        else if (round?.game === 'taboo' && round.status === 'pending') startTaboo()
        else if (room?.view !== 'podium') startRound()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [room?.view, round, nextClue, reveal, setView, startRound, startTaboo, stopTaboo])

  if (notFound) {
    return <div className="p-10 text-center">Sala no encontrada. <Link className="text-amber-300 underline" to="/admin">Volver</Link></div>
  }
  if (!room) return <div className="flex min-h-dvh items-center justify-center"><Spinner label="Cargando sala…" /></div>

  const closed = room.status === 'closed'
  const view: RoomView = closed ? 'podium' : room.view === 'round' && !round ? 'lobby' : room.view

  return (
    <div className="flex min-h-dvh flex-col">
      {/* barra superior */}
      <header className="flex flex-wrap items-center gap-3 border-b border-white/10 bg-night/60 px-4 py-2 backdrop-blur">
        <Link to="/admin" className="btn-ghost px-2 py-1" aria-label="Volver al panel">←</Link>
        <img src="/logo.svg" alt="" className="h-8 w-8" />
        <div className="min-w-0 flex-1">
          <div className="truncate font-display text-lg font-bold leading-tight">{room.name}</div>
          <div className="text-xs text-indigo-200">{window.location.host}</div>
        </div>
        {code && !closed && (
          <div className="flex items-center gap-2 rounded-2xl bg-amber-400 px-4 py-1 text-indigo-950">
            <span className="text-xs font-bold uppercase">Código</span>
            <span className="font-display text-3xl font-bold tracking-[0.2em]">{code}</span>
          </div>
        )}
        <button className="btn-secondary px-3 py-2" onClick={() => setShowPlayers(true)}>
          👥 {players.length}
        </button>
        <button className="btn-secondary px-3 py-2" onClick={() => setShowTeams(true)} title="Equipos de Tabú">
          🤝 {teams.length || '—'}
        </button>
        <button className="btn-secondary hidden px-3 py-2 sm:inline-flex" onClick={toggleFullscreen} title="Pantalla completa (F)">⛶</button>
      </header>

      {/* escenario */}
      <main className="flex flex-1 flex-col px-4 py-6 sm:px-8">
        {view === 'lobby' && <LobbyStage code={code} players={players} registered={registered} now={now} />}
        {view === 'round' && round && round.game === 'emoji' && (
          <EmojiStage round={round} item={emojiItem} answers={roundAnswers} players={players} now={now} />
        )}
        {view === 'round' && round && round.game === 'quiz' && (
          <QuizStage round={round} answers={roundAnswers} players={players} now={now} />
        )}
        {view === 'round' && round && round.game === 'taboo' && (
          <TabooStage round={round} item={peek ? tabooItem : null} teams={teams} scores={teamScores} answers={roundAnswers} now={now} />
        )}
        {view === 'round' && round && round.game === 'cipher' && (
          <CipherStage round={round} item={cipherItem} peek={peek} answers={roundAnswers} players={players} now={now} />
        )}
        {view === 'leaderboard' && (
          <div className="mx-auto w-full max-w-5xl">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
              <h1 className="font-display text-4xl font-bold sm:text-5xl">📊 Tabla de posiciones</h1>
              <div className="flex flex-wrap gap-2">
                {([null, 'emoji', 'quiz', 'taboo', 'teams'] as const).map((g) => (
                  <button key={g ?? 'all'} onClick={() => setBoardGame(g)}
                    className={`btn px-4 py-2 ${boardGame === g ? 'bg-white text-indigo-950' : 'bg-white/10'}`}>
                    {g === null ? 'General' : g === 'teams' ? '🤝 Equipos' : GAME_LABEL[g]}
                  </button>
                ))}
              </div>
            </div>
            {boardGame === 'teams' ? <TeamLeaderboard rows={teamScores} big /> : <Leaderboard rows={scores} big />}
          </div>
        )}
        {view === 'podium' && (
          <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col justify-center">
            <h1 className="mb-10 text-center font-display text-5xl font-bold">🏆 ¡Felicidades!</h1>
            <Podium rows={scores} />
            {scores.length > 3 && <div className="mt-8"><Leaderboard rows={scores.slice(3, 13)} /></div>}
          </div>
        )}
      </main>

      {/* controles */}
      {showControls ? (
        <footer className="sticky bottom-0 border-t border-white/10 bg-night/85 px-4 py-3 backdrop-blur">
          <div className="mx-auto flex max-w-7xl flex-col gap-3">
            <ErrorBox>{error}</ErrorBox>
            {closed ? (
              <div className="flex items-center justify-between gap-3">
                <p className="text-indigo-200">Sala cerrada.</p>
                <Link to="/admin" className="btn-secondary">Volver al panel</Link>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                {/* contexto de ronda */}
                {view === 'round' && round?.status === 'active' && round.game === 'emoji' && (
                  <button className="btn-primary px-6 text-lg" onClick={nextClue} disabled={busy || round.clues_revealed >= (round.clues_total ?? 0)}>
                    👉 Siguiente pista ({round.clues_revealed}/{round.clues_total})
                  </button>
                )}
                {view === 'round' && round?.game === 'taboo' && round.status === 'pending' && (
                  <button className="btn-primary px-6 text-lg" onClick={startTaboo} disabled={busy} title="Espacio">
                    ▶ Iniciar {TABOO_SECONDS} s
                  </button>
                )}
                {view === 'round' && round?.game === 'taboo' && round.status === 'active' && (
                  <>
                    <button className="btn bg-emerald-500 px-6 text-lg text-white hover:bg-emerald-400" onClick={() => stopTaboo(true)} disabled={busy} title="Enter">
                      ✅ ¡Adivinaron!
                    </button>
                    <button className="btn-secondary" onClick={() => stopTaboo(false)} disabled={busy}>⏹️ No adivinaron</button>
                  </>
                )}
                {view === 'round' && round && round.status !== 'revealed' && (round.game === 'taboo' || round.game === 'cipher') && (
                  <button className="btn-ghost px-3 py-2 text-sm" onClick={() => setPeek((p) => !p)}>
                    {peek ? '🙈 Ocultar respuesta' : '👁️ Ver respuesta'}
                  </button>
                )}
                {view === 'round' && round?.status === 'active' && round.game !== 'taboo' && (
                  <button className="btn-secondary" onClick={reveal} disabled={busy}>👁️ Revelar respuesta</button>
                )}

                {/* lanzador */}
                <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-white/5 p-1.5">
                  {GAMES.map((g) => (
                    <button key={g} onClick={() => setGame(g)}
                      className={`btn px-3 py-2 text-sm ${game === g ? 'bg-indigo-500 text-white' : 'bg-transparent text-indigo-200 hover:bg-white/10'}`}>
                      {GAME_ICON[g]} {GAME_SHORT[g]}
                    </button>
                  ))}
                  <span className="mx-1 h-6 w-px bg-white/15" />
                  {DIFFICULTIES.map((d) => (
                    <button key={d} onClick={() => setDifficulty(d)}
                      className={`btn px-3 py-2 text-sm ${difficulty === d ? 'bg-white text-indigo-950' : 'bg-transparent text-indigo-200 hover:bg-white/10'}`}>
                      {DIFFICULTY_LABEL[d]} <span className="opacity-60">{remaining?.[game][d] ?? '–'}</span>
                    </button>
                  ))}
                  {game === 'taboo' && (
                    <>
                      <span className="mx-1 h-6 w-px bg-white/15" />
                      <select
                        className="input w-auto py-2 text-sm"
                        value={teamId ?? ''}
                        onChange={(e) => setTeamId(e.target.value || null)}
                        aria-label="Equipo que juega"
                      >
                        {teams.length === 0 && <option value="">Sin equipos</option>}
                        {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    </>
                  )}
                  <button
                    className={`${round?.status === 'active' ? 'btn-secondary' : 'btn-primary'} px-5 py-2`}
                    onClick={() => startRound()}
                    disabled={busy || !remaining || remaining[game][difficulty] === 0 || (game === 'taboo' && !teamId)}
                    title="Espacio"
                  >
                    ▶ {view === 'round' && round ? 'Siguiente ronda' : 'Iniciar juego'}
                  </button>
                </div>

                {/* vistas */}
                <div className="ml-auto flex flex-wrap gap-2">
                  {view !== 'lobby' && view !== 'round' && round && (
                    <button className="btn-secondary px-3 py-2 text-sm" onClick={() => setView('round')}>🎮 Ronda</button>
                  )}
                  <button className="btn-secondary px-3 py-2 text-sm" onClick={() => setView('lobby')} disabled={view === 'lobby'}>🏠 Espera</button>
                  <button className="btn-secondary px-3 py-2 text-sm" onClick={() => setView('leaderboard')} disabled={view === 'leaderboard'}>📊 Tabla</button>
                  {view === 'podium' ? (
                    <button className="btn-danger px-3 py-2 text-sm" onClick={closeRoom}>🔒 Cerrar sala</button>
                  ) : (
                    <button className="btn-secondary px-3 py-2 text-sm" onClick={() => setView('podium')}>🏆 Podio final</button>
                  )}
                  <button className="btn-ghost px-3 py-2 text-sm" onClick={() => setShowControls(false)} title="Ocultar controles (H)">▾</button>
                </div>
              </div>
            )}
            {game === 'taboo' && teams.length === 0 && (
              <p className="text-sm text-amber-200">
                Tabú necesita equipos. Pulsa <b>🤝</b> arriba y reparte a los {players.length} de la sala
                {players.length >= 2 && <> (sugerencia: {suggestedTeams(players.length)} equipos)</>}.
              </p>
            )}
            {view === 'lobby' && !closed && players.length > 0 && (
              <p className="text-sm text-indigo-300">
                {registered > 0 && players.length / registered >= 0.5
                  ? '✅ La mayoría ya está conectada: puedes iniciar el juego.'
                  : `Esperando participantes… (${onlinePlayers} en línea)`}
                <span className="ml-2 hidden opacity-70 md:inline">Atajos: Espacio = siguiente · Enter = ¡adivinaron! · R = revelar · T = tabla · H = ocultar · F = pantalla completa</span>
              </p>
            )}
          </div>
        </footer>
      ) : (
        <button className="fixed bottom-3 right-3 rounded-full bg-white/10 px-3 py-2 text-sm opacity-40 hover:opacity-100" onClick={() => setShowControls(true)}>
          ▴ Controles
        </button>
      )}

      {showPlayers && (
        <PlayersDrawer players={players} registered={registered} now={now} onClose={() => setShowPlayers(false)} onRelease={release} />
      )}
      {showTeams && (
        <TeamsDrawer roomId={roomId} teams={teams} players={players} onClose={() => setShowTeams(false)} onChanged={loadTeams} />
      )}
    </div>
  )
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
  else document.documentElement.requestFullscreen().catch(() => {})
}

// ============================================================ ESCENARIOS

function LobbyStage({ code, players, registered, now }: { code: string | null; players: PlayerStatus[]; registered: number; now: number }) {
  const [qr, setQr] = useState('')
  const url = code ? `${window.location.origin}/?codigo=${code}` : ''
  useEffect(() => {
    if (!url) return
    QRCode.toDataURL(url, { margin: 1, width: 480, color: { dark: '#0f0a2e', light: '#ffffff' } }).then(setQr).catch(() => {})
  }, [url])
  const pct = registered ? Math.min(100, Math.round((players.length / registered) * 100)) : 0

  return (
    <div className="mx-auto grid w-full max-w-7xl flex-1 items-center gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <section className="card flex flex-col items-center p-8 text-center">
        <p className="text-xl text-indigo-200">Entra desde tu celular a</p>
        <p className="font-display text-3xl font-bold text-white">{window.location.host}</p>
        <p className="mt-4 text-xl text-indigo-200">con el código</p>
        <div className="mt-2 flex gap-3">
          {(code ?? '----').split('').map((d, i) => (
            <span key={i} className="flex h-24 w-20 items-center justify-center rounded-2xl bg-amber-400 font-display text-7xl font-bold text-indigo-950 shadow-lg shadow-amber-500/30 sm:h-32 sm:w-24 sm:text-8xl">
              {d}
            </span>
          ))}
        </div>
        {qr && <img src={qr} alt="Código QR para entrar a la sala" className="mt-6 h-48 w-48 rounded-2xl bg-white p-2 sm:h-56 sm:w-56" />}
      </section>

      <section className="flex h-full flex-col">
        <div className="flex items-end justify-between gap-4">
          <h2 className="font-display text-4xl font-bold">Participantes</h2>
          <p className="font-display text-3xl"><span className="text-amber-300">{players.length}</span><span className="text-indigo-300"> / {registered}</span></p>
        </div>
        <div className="mt-3 h-3 overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-amber-300 transition-all duration-700" style={{ width: `${pct}%` }} />
        </div>
        {players.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center py-12 text-indigo-200">
            <div className="animate-bounce text-6xl">📱</div>
            <p className="mt-4 text-xl">Esperando a que entren los participantes…</p>
          </div>
        ) : (
          <ul className="mt-6 flex flex-wrap content-start gap-3">
            {players.map((p) => {
              const online = p.last_seen && now - new Date(p.last_seen).getTime() < 20_000
              return (
                <li key={p.participant_id} className="animate-pop flex items-center gap-2 rounded-full bg-white/10 py-2 pl-2 pr-5 text-xl font-bold">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-500 font-display">{p.name.charAt(0).toUpperCase()}</span>
                  {p.name}
                  <span className={`h-2.5 w-2.5 rounded-full ${online ? 'bg-emerald-400' : 'bg-white/25'}`} />
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}

function StageHeader({ round, right }: { round: Round; right?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-center gap-3">
      <span className="font-display text-2xl font-bold">Ronda {round.seq}</span>
      <span className="chip bg-white/10 text-base">{GAME_LABEL[round.game]}</span>
      <DifficultyChip difficulty={round.difficulty} />
      <div className="ml-auto">{right}</div>
    </div>
  )
}

function EmojiStage({ round, item, answers, players, now }: {
  round: Round; item: EmojiItem | null; answers: AnswerRow[]; players: PlayerStatus[]; now: number
}) {
  const revealed = round.status === 'revealed'
  const total = round.clues_total ?? item?.clues.length ?? 0
  const left = secondsLeft(round.deadline, now)
  const names = useMemo(() => new Map(players.map((p) => [p.participant_id, p.name])), [players])
  const winners = answers.filter((a) => a.is_correct).sort((a, b) => b.points - a.points || (a.elapsed_ms ?? 0) - (b.elapsed_ms ?? 0))

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col">
      <StageHeader round={round} right={
        <span className="chip bg-emerald-500/20 text-lg text-emerald-100">✅ {winners.length} de {players.length} acertaron</span>
      } />

      <div className="flex flex-1 flex-col items-center justify-center gap-8">
        {!revealed && <p className="text-center font-display text-3xl text-indigo-200">¿Qué personaje o historia bíblica es?</p>}

        <div className="flex flex-wrap items-stretch justify-center gap-4 sm:gap-6">
          {Array.from({ length: total }).map((_, i) => {
            const shown = revealed || i < round.clues_revealed
            return (
              <div key={i} className="flex flex-col items-center gap-2">
                <div className={`flex h-32 w-32 items-center justify-center rounded-3xl sm:h-44 sm:w-44 lg:h-52 lg:w-52
                  ${shown ? 'bg-white/10 ring-2 ring-white/20' : 'border-2 border-dashed border-white/20 bg-white/[0.03]'}`}>
                  {shown && item ? (
                    <span key={`${round.id}-${i}`} className="animate-pop text-7xl sm:text-8xl lg:text-9xl">{item.clues[i]}</span>
                  ) : (
                    <span className="font-display text-6xl text-white/20">?</span>
                  )}
                </div>
                <span className={`text-sm font-bold ${i === round.clues_revealed - 1 && !revealed ? 'text-amber-300' : 'text-indigo-300'}`}>
                  {emojiPoints(round.difficulty, i + 1)} pts
                </span>
              </div>
            )
          })}
        </div>

        {revealed ? (
          <div className="animate-rise text-center">
            <p className="text-2xl text-indigo-200">La respuesta es</p>
            <p className="font-display text-6xl font-bold text-amber-300 sm:text-7xl">{round.answer_text}</p>
            {item?.reference && <p className="mt-2 text-xl text-indigo-200">📖 {item.reference}</p>}
          </div>
        ) : left !== null ? (
          <div className="flex items-center gap-4">
            <CountdownRing seconds={left} total={EMOJI_FINAL_SECONDS} size={120} />
            <p className="font-display text-3xl font-bold text-rose-200">{left > 0 ? '¡Últimos segundos!' : '¡Tiempo!'}</p>
          </div>
        ) : null}

        {winners.length > 0 && (
          <ul className="flex max-w-5xl flex-wrap justify-center gap-2">
            {winners.map((a) => (
              <li key={a.id} className="animate-pop chip bg-emerald-500/25 px-4 py-2 text-lg text-emerald-50">
                {names.get(a.participant_id) ?? '—'} <b className="text-amber-200">+{a.points}</b>
                <span className="text-xs opacity-70">({a.clue_number} {a.clue_number === 1 ? 'emoji' : 'emojis'})</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function QuizStage({ round, answers, players, now }: { round: Round; answers: AnswerRow[]; players: PlayerStatus[]; now: number }) {
  const revealed = round.status === 'revealed'
  const startMs = new Date(round.started_at).getTime()
  const beforeStart = now < startMs
  const left = secondsLeft(round.deadline, now) ?? 0
  const options = round.options ?? []
  const names = useMemo(() => new Map(players.map((p) => [p.participant_id, p.name])), [players])
  const counts = options.map((_, i) => answers.filter((a) => a.choice === i).length)
  const maxCount = Math.max(1, ...counts)
  const fastest = answers.filter((a) => a.is_correct).sort((a, b) => (a.elapsed_ms ?? 0) - (b.elapsed_ms ?? 0)).slice(0, 5)

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col">
      <StageHeader round={round} right={
        <span className="chip bg-white/10 text-lg">📨 {answers.length} de {players.length} respondieron</span>
      } />

      <div className="flex flex-1 flex-col justify-center gap-8">
        <div className="flex items-center gap-6">
          <h1 className="flex-1 font-display text-4xl font-bold leading-tight sm:text-5xl lg:text-6xl">{round.prompt}</h1>
          {!revealed && (beforeStart ? (
            <div className="text-center">
              <p className="font-display text-xl text-amber-200">¡Prepárate!</p>
              <div key={Math.ceil((startMs - now) / 1000)} className="animate-pop font-display text-8xl font-bold text-amber-300">
                {Math.ceil((startMs - now) / 1000)}
              </div>
            </div>
          ) : (
            <CountdownRing seconds={left} total={QUIZ_SECONDS} size={150} />
          ))}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {options.map((opt, i) => {
            const s = OPTION_STYLES[i]
            const isCorrect = revealed && round.correct_index === i
            return (
              <div key={i}
                className={`relative flex min-h-24 items-center gap-4 overflow-hidden rounded-3xl px-6 py-4 text-3xl font-bold transition-all duration-500 lg:min-h-32 lg:text-4xl
                  ${s.bg} ${revealed && !isCorrect ? 'opacity-30 grayscale-[40%]' : ''} ${isCorrect ? 'scale-[1.02] ring-8 ring-white' : ''}`}>
                {revealed && (
                  <div className="absolute inset-y-0 left-0 bg-black/20 transition-all duration-700" style={{ width: `${(counts[i] / maxCount) * 100}%` }} />
                )}
                <span className="relative text-4xl">{s.shape}</span>
                <span className="relative flex-1">{opt}</span>
                {revealed && <span className="relative font-display text-3xl">{counts[i]}</span>}
                {isCorrect && <span className="relative text-5xl">✓</span>}
              </div>
            )
          })}
        </div>

        {revealed && fastest.length > 0 && (
          <div className="animate-rise flex flex-wrap items-center justify-center gap-2">
            <span className="font-display text-2xl text-amber-200">⚡ Más rápidos:</span>
            {fastest.map((a) => (
              <span key={a.id} className="chip bg-emerald-500/25 px-4 py-2 text-lg">
                {names.get(a.participant_id) ?? '—'} <b className="text-amber-200">+{a.points}</b>
                <span className="text-xs opacity-70">{((a.elapsed_ms ?? 0) / 1000).toFixed(1)} s</span>
              </span>
            ))}
          </div>
        )}
        {revealed && fastest.length === 0 && (
          <p className="text-center font-display text-3xl text-indigo-200">Nadie acertó esta vez 😮</p>
        )}
      </div>
    </div>
  )
}

function CipherStage({ round, item, peek, answers, players, now }: {
  round: Round; item: CipherItem | null; peek: boolean; answers: AnswerRow[]; players: PlayerStatus[]; now: number
}) {
  const revealed = round.status === 'revealed'
  const codeLeft = secondsLeft(round.deadline, now) ?? 0
  const solved = answers.filter((a) => a.is_correct)
  const withVerse = solved.filter((a) => a.verse_ok)
  // La 2ª fase es individual: sigue abierta mientras alguien tenga su reloj corriendo.
  const searching = solved.filter(
    (a) => !a.verse_ok && now < new Date(a.created_at).getTime() + VERSE_SECONDS * 1000,
  ).length

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col">
      <StageHeader round={round} right={
        <div className="flex gap-2">
          <span className="chip bg-emerald-500/20 px-4 py-2 text-lg text-emerald-100">🔓 {solved.length} de {players.length}</span>
          <span className="chip bg-sky-500/20 px-4 py-2 text-lg text-sky-100">📖 {withVerse.length}</span>
        </div>
      } />

      <div className="flex flex-1 flex-col items-center justify-center gap-8 text-center">
        {revealed ? (
          <div className="animate-rise">
            <p className="text-2xl text-indigo-200">El código era</p>
            <p className="font-display text-6xl font-bold text-amber-300 sm:text-7xl">{round.answer_text}</p>
            {item && (
              <p className="mt-6 font-display text-3xl text-indigo-100">
                📖 {item.verse_book} {item.verse_chapter}:{item.verse_from}
                {item.verse_to ? `-${item.verse_to}` : ''}
              </p>
            )}
            <p className="mt-6 text-2xl text-indigo-200">
              {solved.length} descifraron el código · {withVerse.length} encontraron el versículo
            </p>
          </div>
        ) : (
          <>
            <p className="text-xl uppercase tracking-wider text-indigo-300">
              🔐 {item ? CIPHER_KIND_LABEL[item.kind] : 'Código secreto'}
            </p>
            <p className="break-words font-display text-6xl font-bold leading-tight text-amber-200 sm:text-7xl lg:text-8xl">
              {item?.puzzle}
            </p>
            {item?.hint && (
              <p className="rounded-2xl bg-white/10 px-8 py-4 font-display text-3xl text-indigo-100">💡 {item.hint}</p>
            )}

            {codeLeft > 0 ? (
              <div className="flex flex-wrap items-center justify-center gap-8">
                <CountdownRing seconds={codeLeft} total={CIPHER_SECONDS} size={180} />
                <p className="font-display text-3xl font-bold text-indigo-100">¡Descifren el código!</p>
              </div>
            ) : (
              <p className="font-display text-4xl font-bold text-indigo-100">
                {searching > 0
                  ? `⏰ Se acabó el tiempo del código · ${searching} ${searching === 1 ? 'sigue buscando' : 'siguen buscando'} el versículo`
                  : '⏰ ¡Tiempo!'}
              </p>
            )}

            {peek && item && (
              <div className="rounded-2xl border border-amber-400/40 bg-amber-400/10 px-5 py-3 text-left">
                <p className="text-xs font-bold uppercase tracking-wider text-amber-200">Solo para el administrador</p>
                <p className="font-display text-2xl font-bold text-amber-100">{item.answer}</p>
                <p className="text-sm text-amber-100/70">
                  📖 {item.verse_book} {item.verse_chapter}:{item.verse_from}{item.verse_to ? `-${item.verse_to}` : ''}
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function TabooStage({ round, item, teams, scores, answers, now }: {
  round: Round; item: TabooItem | null; teams: Team[]; scores: TeamScoreRow[]; answers: AnswerRow[]; now: number
}) {
  const team = teams.find((t) => t.id === round.team_id)
  const style = teamStyle(team?.seq ?? 1)
  const describer = team?.members.find((m) => m.id === round.describer_id)
  const pending = round.status === 'pending'
  const revealed = round.status === 'revealed'
  const left = secondsLeft(round.deadline, now) ?? TABOO_SECONDS
  const won = answers.find((a) => a.is_correct)
  const usedSeconds = won?.elapsed_ms != null ? won.elapsed_ms / 1000 : null

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col">
      <StageHeader round={round} right={
        <span className={`chip px-4 py-2 text-lg ${style.soft}`}>🤝 {team?.name ?? 'Equipo'}</span>
      } />

      <div className="flex flex-1 flex-col items-center justify-center gap-8 text-center">
        {revealed ? (
          <div className="animate-rise">
            <p className="text-2xl text-indigo-200">La palabra era</p>
            <p className="font-display text-6xl font-bold text-amber-300 sm:text-7xl">{round.answer_text}</p>
            {won ? (
              <p className="mt-6 font-display text-3xl font-bold text-emerald-200 sm:text-4xl">
                🎉 {team?.name} la adivinó en {usedSeconds?.toFixed(1)} s · +{won.points} pts para cada integrante
              </p>
            ) : (
              <p className="mt-6 font-display text-3xl text-indigo-200 sm:text-4xl">⏰ Se acabaron los {TABOO_SECONDS} s · 0 puntos</p>
            )}
          </div>
        ) : (
          <>
            <div>
              <p className="text-2xl text-indigo-200">Describe</p>
              <p className={`font-display text-6xl font-bold sm:text-7xl ${style.text}`}>{describer?.name ?? '—'}</p>
              <p className="mt-2 text-2xl text-indigo-200">
                {pending ? 'Está leyendo su palabra en el celular…' : `Adivina ${team?.name ?? 'su equipo'}`}
              </p>
            </div>

            {pending ? (
              <div className="animate-pop rounded-3xl bg-white/5 px-10 py-8">
                <p className="font-display text-4xl font-bold text-amber-300">🤫 ¡Prepárense!</p>
                <p className="mt-3 max-w-2xl text-xl text-indigo-200">
                  No puede decir la palabra ni las prohibidas, ni deletrear, ni hacer señas.
                  Solo responde su equipo; los demás escuchan en silencio.
                </p>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-center gap-8">
                <CountdownRing seconds={left} total={TABOO_SECONDS} size={220} />
                <p className="font-display text-4xl font-bold text-indigo-100">
                  {left > 0 ? '¡Griten la respuesta!' : '¡Tiempo!'}
                </p>
              </div>
            )}

            {item && (
              <div className="rounded-2xl border border-amber-400/40 bg-amber-400/10 px-5 py-3 text-left">
                <p className="text-xs font-bold uppercase tracking-wider text-amber-200">Solo para el administrador</p>
                <p className="font-display text-2xl font-bold text-amber-100">{item.word}</p>
                <p className="text-sm text-amber-100/70">🚫 {item.forbidden.join(' · ')}</p>
              </div>
            )}
          </>
        )}

        {scores.length > 0 && (
          <ul className="flex flex-wrap justify-center gap-3">
            {scores.map((t) => (
              <li key={t.team_id} className={`chip px-4 py-2 text-lg ${teamStyle(t.seq).soft} ${t.team_id === round.team_id ? 'ring-2 ring-white/60' : ''}`}>
                {t.name} <b className="text-amber-200">{t.points}</b>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function PlayersDrawer({ players, registered, now, onClose, onRelease }: {
  players: PlayerStatus[]; registered: number; now: number; onClose: () => void; onRelease: (p: PlayerStatus) => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onClose}>
      <aside className="flex h-full w-full max-w-sm flex-col bg-indigo-950 p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-display text-2xl font-bold">En la sala</h2>
          <button className="btn-ghost px-3 py-1" onClick={onClose} aria-label="Cerrar">✕</button>
        </div>
        <p className="text-sm text-indigo-200">{players.length} de {registered} registrados</p>
        <ul className="mt-4 flex-1 divide-y divide-white/10 overflow-y-auto">
          {players.map((p) => {
            const online = p.last_seen && now - new Date(p.last_seen).getTime() < 20_000
            return (
              <li key={p.participant_id} className="flex items-center gap-3 py-2.5">
                <span className={`h-2.5 w-2.5 rounded-full ${online ? 'bg-emerald-400' : 'bg-white/25'}`} title={online ? 'En línea' : 'Desconectado'} />
                <span className="flex-1 truncate font-semibold">{p.name}</span>
                <button className="btn-ghost px-2 py-1 text-xs" onClick={() => onRelease(p)}>Liberar</button>
              </li>
            )
          })}
          {players.length === 0 && <li className="py-8 text-center text-indigo-200">Nadie ha entrado todavía.</li>}
        </ul>
        <p className="mt-3 text-xs text-indigo-300">«Liberar» permite que alguien vuelva a entrar desde otro celular sin perder sus puntos.</p>
      </aside>
    </div>
  )
}
