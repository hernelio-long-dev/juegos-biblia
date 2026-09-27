import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { CountdownRing, DifficultyChip, ErrorBox, Spinner } from '../components/ui'
import { secondsLeft, useClockSync, useServerNow } from '../lib/clock'
import { celebrate, vibrate } from '../lib/fx'
import { clearPlayerSession, getPlayerSession } from '../lib/player'
import { useLiveRefresh } from '../lib/realtime'
import { auctionGain, emojiPoints } from '../lib/scoring'
import { errorMessage, playerClient, requestTimeout } from '../lib/supabase'
import {
  AUCTION_ANSWER_SECONDS, AUCTION_BID_SECONDS, AUCTION_MIN_BID, BIBLE_BOOKS, CIPHER_KIND_LABEL, CIPHER_SECONDS,
  DIFFICULTY_LABEL, DIFFICULTY_MULTIPLIER, EMOJI_FINAL_SECONDS, GAME_LABEL, OPTION_STYLES,
  QUIZ_SECONDS, TABOO_SECONDS, VERSE_SECONDS, teamStyle,
  type PlayerState,
} from '../lib/types'

type Round = NonNullable<PlayerState['round']>

export default function Play() {
  const navigate = useNavigate()
  const token = getPlayerSession()?.token ?? null
  const [state, setState] = useState<PlayerState | null>(null)
  useClockSync()
  const now = useServerNow()

  const requestSeq = useRef(0)
  const appliedSeq = useRef(0)
  const refresh = useCallback(async () => {
    if (!token) return
    const id = ++requestSeq.current
    const { data, error } = await playerClient.rpc('player_state', { p_token: token }).abortSignal(requestTimeout())
    if (error) return // sin conexión: se mantiene el último estado
    if (id < appliedSeq.current) return // ya se mostró una respuesta más reciente
    appliedSeq.current = id
    if (!data) {
      clearPlayerSession()
      navigate('/', { replace: true })
      return
    }
    setState(data as PlayerState)
  }, [token, navigate])

  useEffect(() => {
    if (!token) navigate('/', { replace: true })
    else refresh()
  }, [token, refresh, navigate])

  // Mientras no haya cargado, reintenta cada 2 s (por si la primera petición falló o se colgó).
  const [slow, setSlow] = useState(false)
  const loaded = state !== null
  useEffect(() => {
    if (loaded || !token) return
    const retry = setInterval(refresh, 2000)
    const warn = setTimeout(() => setSlow(true), 8000)
    return () => { clearInterval(retry); clearTimeout(warn) }
  }, [loaded, token, refresh])

  const roomId = state?.room.id ?? null
  useLiveRefresh(roomId, [
    { table: 'rounds', filter: `room_id=eq.${roomId}` },
    { table: 'rooms', filter: `id=eq.${roomId}` },
    { table: 'team_members', filter: `room_id=eq.${roomId}` },
    { table: 'auctions', filter: `room_id=eq.${roomId}` },
  ], refresh, 3000, playerClient)
  const auctionId = state?.auction?.id ?? null
  useLiveRefresh(auctionId ? `auction-${auctionId}` : null,
    [{ table: 'auction_teams', filter: `auction_id=eq.${auctionId}` }], refresh, 0, playerClient)

  useWakeLock()

  if (!state || !token) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
        <Spinner label="Conectando a la sala…" />
        {slow && (
          <div className="animate-rise">
            <p className="text-indigo-200">Está tardando más de lo normal. Revisa tu conexión a internet.</p>
            <button className="btn-secondary mt-4" onClick={() => window.location.reload()}>Reintentar</button>
          </div>
        )}
      </div>
    )
  }

  const { room, me, round, auction } = state
  const finished = room.status === 'closed' || room.view === 'podium'
  // Subasta recién iniciada: todavía no hay ronda, se presenta el equipo.
  const auctionTeams = room.view === 'round' && auction?.status === 'running' && (!round || round.auction_id !== auction.id)

  function leave() {
    if (!confirm('¿Salir de la sala? Necesitarás que el administrador te libere para volver a entrar con tu nombre.')) return
    clearPlayerSession()
    navigate('/', { replace: true })
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]">
      <header className="card flex items-center gap-3 px-4 py-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-amber-400 font-display text-xl font-bold text-indigo-950">
          {me.name.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-bold">{me.name}</div>
          {me.team ? (
            <span className={`chip mt-0.5 px-2 py-0 text-xs ${teamStyle(me.team.seq).soft}`}>{me.team.name}</span>
          ) : (
            <div className="truncate text-xs text-indigo-200">{room.name}</div>
          )}
        </div>
        <div className="text-right">
          <div className="font-display text-2xl font-bold leading-none text-amber-300 tabular-nums">{me.points}</div>
          <div className="text-xs text-indigo-200">{me.rank ? `#${me.rank} de ${me.players}` : 'puntos'}</div>
        </div>
      </header>

      <section className="flex flex-1 flex-col justify-center py-6">
        {finished ? (
          <FinalCard state={state} />
        ) : room.view === 'leaderboard' ? (
          <InfoCard emoji="📊" title="Tabla de posiciones" text="Mira la pantalla principal para ver cómo van todos.">
            <RankBadge state={state} />
          </InfoCard>
        ) : auctionTeams ? (
          <AuctionTeamCard state={state} token={token} refresh={refresh} />
        ) : room.view === 'round' && round ? (
          round.game === 'auction'
            ? <AuctionPlay key={round.id} state={state} round={round} token={token} now={now} refresh={refresh} />
            : round.game === 'emoji'
            ? <EmojiPlay key={round.id} state={state} round={round} token={token} now={now} refresh={refresh} />
            : round.game === 'taboo'
              ? <TabooPlay key={round.id} state={state} round={round} now={now} />
              : round.game === 'cipher'
                ? <CipherPlay key={round.id} state={state} round={round} token={token} now={now} refresh={refresh} />
                : <QuizPlay key={round.id} state={state} round={round} token={token} now={now} refresh={refresh} />
        ) : (
          <InfoCard emoji="🙌" title={`¡Ya estás dentro, ${me.name.split(' ')[0]}!`} text="Espera a que el administrador inicie el juego. Mantén esta pantalla abierta.">
            <div className="mt-6 flex justify-center gap-2">
              {[0, 1, 2].map((i) => (
                <span key={i} className="h-3 w-3 animate-bounce rounded-full bg-amber-300" style={{ animationDelay: `${i * 150}ms` }} />
              ))}
            </div>
          </InfoCard>
        )}
      </section>

      {finished && (
        <button className="btn-ghost mx-auto text-sm" onClick={() => { clearPlayerSession(); navigate('/', { replace: true }) }}>
          Salir
        </button>
      )}
      {!finished && room.view !== 'round' && (
        <button className="btn-ghost mx-auto text-sm" onClick={leave}>Salir de la sala</button>
      )}
    </main>
  )
}

function InfoCard({ emoji, title, text, children }: { emoji: string; title: string; text: string; children?: ReactNode }) {
  return (
    <div className="card animate-rise p-8 text-center">
      <div className="animate-pop text-6xl">{emoji}</div>
      <h2 className="mt-4 font-display text-3xl font-bold">{title}</h2>
      <p className="mt-2 text-indigo-200">{text}</p>
      {children}
    </div>
  )
}

function RankBadge({ state }: { state: PlayerState }) {
  return (
    <div className="mx-auto mt-6 inline-flex items-center gap-6 rounded-2xl bg-white/10 px-6 py-4">
      <div><div className="font-display text-4xl font-bold text-amber-300">#{state.me.rank ?? '-'}</div><div className="text-xs text-indigo-200">posición</div></div>
      <div><div className="font-display text-4xl font-bold">{state.me.points}</div><div className="text-xs text-indigo-200">puntos</div></div>
    </div>
  )
}

function FinalCard({ state }: { state: PlayerState }) {
  const rank = state.me.rank ?? 99
  const podium = rank <= 3 && state.me.points > 0
  useEffect(() => { if (podium) celebrate(true) }, [podium])
  return (
    <InfoCard
      emoji={podium ? ['🥇', '🥈', '🥉'][rank - 1] : '🎉'}
      title={podium ? '¡Estás en el podio!' : '¡Competencia terminada!'}
      text="Gracias por participar. «Lámpara es a mis pies tu palabra» — Salmo 119:105"
    >
      <RankBadge state={state} />
    </InfoCard>
  )
}

function RoundHeader({ round, extra }: { round: Round; extra?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <span className="chip bg-white/10 text-indigo-100">Ronda {round.seq}</span>
      <span className="chip bg-white/10 text-indigo-100">{GAME_LABEL[round.game]}</span>
      <DifficultyChip difficulty={round.difficulty} />
      {extra}
    </div>
  )
}

interface PlayProps {
  state: PlayerState
  round: Round
  token: string
  now: number
  refresh: () => Promise<void>
}

// ---------------------------------------------------------------- EMOJIS
function EmojiPlay({ state, round, token, now, refresh }: PlayProps) {
  const my = state.my_answer
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [wrong, setWrong] = useState(0)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const left = secondsLeft(round.deadline, now)
  const timeUp = left === 0
  const correct = my?.is_correct === true
  const pointsNow = emojiPoints(round.difficulty, round.clues_revealed)

  const prevClues = useRef(round.clues_revealed)
  useEffect(() => {
    if (round.clues_revealed !== prevClues.current) {
      prevClues.current = round.clues_revealed
      vibrate(60)
    }
  }, [round.clues_revealed])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!text.trim() || sending) return
    setSending(true)
    setError('')
    const { data, error } = await playerClient.rpc('submit_emoji', { p_token: token, p_round: round.id, p_text: text })
    setSending(false)
    if (error) return setError(errorMessage(error))
    if (data.ok && data.correct) {
      celebrate()
      vibrate([80, 40, 80])
    } else if (data.ok) {
      setWrong((w) => w + 1)
      setText('')
      vibrate(200)
      inputRef.current?.focus()
    } else {
      const reasons: Record<string, string> = {
        timeout: 'Se acabó el tiempo.',
        closed: 'La ronda ya terminó.',
        max_attempts: 'Llegaste al máximo de intentos en esta ronda.',
        empty: 'Escribe una respuesta.',
      }
      setError(reasons[data.reason] ?? 'No se pudo enviar.')
    }
    refresh()
  }

  if (round.status === 'revealed') {
    return (
      <div className="card animate-rise p-6 text-center">
        <RoundHeader round={round} />
        <p className="text-indigo-200">La respuesta era</p>
        <p className="mt-1 font-display text-4xl font-bold text-amber-300">{round.answer_text}</p>
        <ResultBanner correct={correct} points={my?.points ?? 0} answered={!!my}
          detail={correct && my?.clue_number ? `con ${my.clue_number} ${my.clue_number === 1 ? 'emoji' : 'emojis'}` : undefined} />
      </div>
    )
  }

  if (correct) {
    return (
      <div className="card animate-rise p-8 text-center">
        <RoundHeader round={round} />
        <div className="animate-pop text-7xl">✅</div>
        <h2 className="mt-3 font-display text-4xl font-bold">¡Correcto!</h2>
        <p className="mt-2 text-2xl font-bold text-amber-300">+{my?.points} puntos</p>
        <p className="mt-1 text-indigo-200">Lo adivinaste con {my?.clue_number} {my?.clue_number === 1 ? 'emoji' : 'emojis'}.</p>
        <p className="mt-6 text-sm text-indigo-300">Espera a que termine la ronda.</p>
      </div>
    )
  }

  if (timeUp) {
    return (
      <div className="card animate-rise p-8 text-center">
        <RoundHeader round={round} />
        <div className="text-7xl">⏰</div>
        <h2 className="mt-3 font-display text-3xl font-bold">Se acabó el tiempo</h2>
        <p className="mt-2 text-indigo-200">0 puntos en esta ronda. ¡Vamos por la siguiente!</p>
      </div>
    )
  }

  return (
    <div className="card animate-rise p-6">
      <RoundHeader round={round} />
      <div className="flex items-center gap-4">
        <div className="flex-1">
          <p className="text-sm uppercase tracking-wider text-indigo-200">Mira la pantalla</p>
          <p className="font-display text-3xl font-bold">
            Pista {round.clues_revealed} <span className="text-indigo-300">de {round.clues_total}</span>
          </p>
          <p className="mt-1 text-amber-200">Si aciertas ahora: <b>{pointsNow} pts</b></p>
        </div>
        {left !== null && <CountdownRing seconds={left} total={EMOJI_FINAL_SECONDS} size={88} />}
      </div>
      {left !== null && (
        <p className="mt-3 rounded-xl bg-rose-500/20 px-3 py-2 text-center text-sm font-bold text-rose-100">
          ¡Ya salieron todas las pistas! Últimos {EMOJI_FINAL_SECONDS} segundos
        </p>
      )}

      <form onSubmit={submit} className="mt-6">
        <label htmlFor="answer" className="label">¿Qué personaje o historia es?</label>
        <input
          id="answer"
          ref={inputRef}
          key={wrong}
          className={`input py-4 text-xl ${wrong ? 'animate-shake' : ''}`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Escribe tu respuesta…"
          maxLength={80}
          autoComplete="off"
          autoCapitalize="words"
          enterKeyHint="send"
          autoFocus
        />
        {wrong > 0 && !error && (
          <p className="mt-2 text-rose-200">❌ No es correcto, intenta otra vez. ({wrong} {wrong === 1 ? 'intento' : 'intentos'})</p>
        )}
        <div className="mt-2"><ErrorBox>{error}</ErrorBox></div>
        <button className="btn-primary mt-4 w-full py-4 text-lg" disabled={!text.trim() || sending}>
          {sending ? 'Enviando…' : 'Enviar respuesta'}
        </button>
      </form>
    </div>
  )
}

// ---------------------------------------------------------------- SELECCIÓN MÚLTIPLE
function QuizPlay({ state, round, token, now, refresh }: PlayProps) {
  const my = state.my_answer
  const [picked, setPicked] = useState<number | null>(null)
  const [error, setError] = useState('')
  const choice = my?.choice ?? picked
  const startMs = new Date(round.started_at).getTime()
  const beforeStart = now < startMs
  const left = secondsLeft(round.deadline, now) ?? 0
  const options = round.options ?? []
  const revealed = round.status === 'revealed'

  useEffect(() => {
    if (revealed && my?.is_correct) celebrate()
  }, [revealed, my?.is_correct])

  async function answer(i: number) {
    if (choice !== null || left === 0 || beforeStart) return
    setPicked(i)
    vibrate(40)
    const { data, error } = await playerClient.rpc('submit_quiz', { p_token: token, p_round: round.id, p_choice: i })
    if (error) {
      setPicked(null)
      return setError(errorMessage(error))
    }
    if (!data.ok && data.reason !== 'already') {
      setPicked(null)
      setError(data.reason === 'timeout' ? 'Se acabó el tiempo.' : 'La pregunta ya terminó.')
    }
    refresh()
  }

  if (beforeStart && !revealed) {
    const n = Math.ceil((startMs - now) / 1000)
    return (
      <div className="card animate-rise p-10 text-center">
        <RoundHeader round={round} />
        <p className="font-display text-3xl font-bold">¡Prepárate!</p>
        <div key={n} className="animate-pop mt-4 font-display text-9xl font-bold text-amber-300">{n}</div>
      </div>
    )
  }

  return (
    <div className="animate-rise">
      <div className="card p-5">
        <RoundHeader round={round} extra={!revealed && <span className="ml-auto"><CountdownRing seconds={left} total={QUIZ_SECONDS} size={56} /></span>} />
        <h2 className="font-display text-2xl font-bold leading-snug">{round.prompt}</h2>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {options.map((opt, i) => {
          const s = OPTION_STYLES[i]
          const isChoice = choice === i
          const isCorrect = revealed && round.correct_index === i
          const dim = (choice !== null && !isChoice && !revealed) || (revealed && !isCorrect)
          return (
            <button
              key={i}
              onClick={() => answer(i)}
              disabled={choice !== null || left === 0 || revealed}
              className={`btn min-h-20 justify-start px-4 text-left text-lg text-white ${s.bg}
                ${dim ? 'opacity-35' : ''} ${isChoice ? `ring-4 ${s.ring} ring-offset-2 ring-offset-night` : ''}
                ${isCorrect ? 'ring-4 ring-white ring-offset-2 ring-offset-night' : ''} disabled:opacity-100`}
            >
              <span className="text-2xl">{s.shape}</span>
              <span className="flex-1">{opt}</span>
              {isCorrect && <span className="text-2xl">✓</span>}
              {revealed && isChoice && !isCorrect && <span className="text-2xl">✗</span>}
            </button>
          )
        })}
      </div>

      <div className="mt-4"><ErrorBox>{error}</ErrorBox></div>

      {revealed ? (
        <div className="card mt-4 p-5 text-center">
          <ResultBanner correct={my?.is_correct === true} points={my?.points ?? 0} answered={my !== null}
            detail={my?.is_correct ? 'Respuesta correcta' : undefined} />
        </div>
      ) : choice !== null ? (
        <p className="mt-4 text-center font-bold text-indigo-100">✓ Respuesta enviada. Espera el resultado…</p>
      ) : left === 0 ? (
        <p className="mt-4 text-center font-bold text-rose-200">⏰ Tiempo terminado</p>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------- CÓDIGO SECRETO BÍBLICO
function CipherPlay({ state, round, token, now, refresh }: PlayProps) {
  const my = state.my_answer
  const solved = my?.is_correct === true
  const cipher = round.cipher
  const codeLeft = secondsLeft(round.deadline, now)
  const verseLeft = secondsLeft(my?.verse_deadline ?? null, now)
  const revealed = round.status === 'revealed'

  if (revealed) {
    const codePts = (my?.points ?? 0) - (my?.verse_points ?? 0)
    return (
      <div className="card animate-rise p-6 text-center">
        <RoundHeader round={round} />
        <p className="text-indigo-200">El código era</p>
        <p className="mt-1 font-display text-4xl font-bold text-amber-300">{round.answer_text}</p>
        {round.verse?.reference && (
          <p className="mt-3 text-lg text-indigo-100">📖 {round.verse.reference}</p>
        )}
        <div className={`mt-5 rounded-2xl px-4 py-4 ${solved ? 'bg-emerald-500/20' : 'bg-white/10'}`}>
          {solved ? (
            <>
              <p className="font-display text-2xl font-bold">🎉 ¡+{my?.points} puntos!</p>
              <p className="mt-1 text-sm text-indigo-200">
                {codePts} por descifrar
                {my?.verse_ok ? ` · +${my.verse_points} por encontrar el versículo` : ' · sin bono bíblico'}
              </p>
            </>
          ) : (
            <p className="font-display text-2xl font-bold">😅 Esta vez no lo descifraste</p>
          )}
        </div>
      </div>
    )
  }

  // 2ª fase: ya descifró, ahora busca el versículo con su propio reloj.
  if (solved) {
    if (my?.verse_ok) {
      return (
        <div className="card animate-rise p-8 text-center">
          <RoundHeader round={round} />
          <div className="animate-pop text-7xl">📖</div>
          <h2 className="mt-3 font-display text-3xl font-bold">¡Versículo encontrado!</h2>
          <p className="mt-2 text-2xl font-bold text-amber-300">+{my.verse_points} puntos de bono</p>
          <p className="mt-1 text-indigo-200">Llevas {my.points} en esta ronda.</p>
          <p className="mt-6 text-sm text-indigo-300">Espera a que termine la ronda.</p>
        </div>
      )
    }
    return (
      <VerseSearch
        round={round} token={token} refresh={refresh}
        left={verseLeft ?? 0} tries={my?.verse_tries ?? 0} codePoints={my?.points ?? 0}
      />
    )
  }

  if (codeLeft === 0) {
    return (
      <div className="card animate-rise p-8 text-center">
        <RoundHeader round={round} />
        <div className="text-7xl">⏰</div>
        <h2 className="mt-3 font-display text-3xl font-bold">Se acabó el tiempo</h2>
        <p className="mt-2 text-indigo-200">No alcanzaste a descifrarlo. ¡Vamos por el siguiente código!</p>
      </div>
    )
  }

  return (
    <CodeSolve round={round} token={token} refresh={refresh} left={codeLeft ?? CIPHER_SECONDS} cipher={cipher} />
  )
}

/** 1ª fase: descifrar el código. */
function CodeSolve({ round, token, refresh, left, cipher }: {
  round: Round; token: string; refresh: () => Promise<void>; left: number
  cipher: NonNullable<Round['cipher']> | null
}) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [wrong, setWrong] = useState(0)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!text.trim() || sending) return
    setSending(true)
    setError('')
    const { data, error } = await playerClient.rpc('submit_cipher', { p_token: token, p_round: round.id, p_text: text })
    setSending(false)
    if (error) return setError(errorMessage(error))
    if (data.ok && data.correct) {
      celebrate()
      vibrate([80, 40, 80])
    } else if (data.ok) {
      setWrong((w) => w + 1)
      setText('')
      vibrate(200)
      inputRef.current?.focus()
    } else {
      const reasons: Record<string, string> = {
        timeout: 'Se acabó el tiempo.',
        closed: 'La ronda ya terminó.',
        max_attempts: 'Llegaste al máximo de intentos.',
        empty: 'Escribe una respuesta.',
      }
      setError(reasons[data.reason] ?? 'No se pudo enviar.')
    }
    refresh()
  }

  return (
    <div className="card animate-rise p-6">
      <RoundHeader round={round} extra={<span className="ml-auto"><CountdownRing seconds={left} total={CIPHER_SECONDS} size={56} /></span>} />

      <p className="text-sm uppercase tracking-wider text-indigo-200">
        🔐 {cipher ? CIPHER_KIND_LABEL[cipher.kind] : 'Código secreto'}
      </p>
      <p className="mt-3 break-words text-center font-display text-3xl font-bold leading-snug text-amber-200">
        {cipher?.puzzle}
      </p>
      {cipher?.hint && (
        <p className="mt-4 rounded-xl bg-white/10 px-3 py-2 text-center text-sm text-indigo-100">
          💡 {cipher.hint}
        </p>
      )}

      <form onSubmit={submit} className="mt-6">
        <label htmlFor="code" className="label">¿Qué dice el código?</label>
        <input
          id="code"
          ref={inputRef}
          key={wrong}
          className={`input py-4 text-xl ${wrong ? 'animate-shake' : ''}`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Escribe la respuesta…"
          maxLength={80}
          autoComplete="off"
          autoCapitalize="words"
          enterKeyHint="send"
          autoFocus
        />
        {wrong > 0 && !error && (
          <p className="mt-2 text-rose-200">❌ No es correcto, sigue intentando. ({wrong} {wrong === 1 ? 'intento' : 'intentos'})</p>
        )}
        <div className="mt-2"><ErrorBox>{error}</ErrorBox></div>
        <button className="btn-primary mt-4 w-full py-4 text-lg" disabled={!text.trim() || sending}>
          {sending ? 'Enviando…' : 'Enviar respuesta'}
        </button>
      </form>
    </div>
  )
}

/** 2ª fase: confirmar en la Biblia. */
function VerseSearch({ round, token, refresh, left, tries, codePoints }: {
  round: Round; token: string; refresh: () => Promise<void>; left: number; tries: number; codePoints: number
}) {
  const [book, setBook] = useState('')
  const [chapter, setChapter] = useState('')
  const [verse, setVerse] = useState('')
  const [sending, setSending] = useState(false)
  const [wrong, setWrong] = useState(0)
  const [error, setError] = useState('')
  const timeUp = left === 0

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!book || !chapter || !verse || sending) return
    setSending(true)
    setError('')
    const { data, error } = await playerClient.rpc('submit_verse', {
      p_token: token, p_round: round.id, p_book: book,
      p_chapter: Number(chapter), p_verse: Number(verse),
    })
    setSending(false)
    if (error) return setError(errorMessage(error))
    if (data.ok && data.correct) {
      celebrate()
      vibrate([80, 40, 80])
    } else if (data.ok) {
      setWrong((w) => w + 1)
      vibrate(200)
    } else {
      const reasons: Record<string, string> = {
        timeout: 'Se acabó el tiempo para buscar el versículo.',
        closed: 'La ronda ya terminó.',
        already: 'Ya respondiste esta parte.',
        not_solved: 'Primero tienes que descifrar el código.',
        max_attempts: 'Llegaste al máximo de intentos.',
        empty: 'Completa el capítulo y el versículo.',
      }
      setError(reasons[data.reason] ?? 'No se pudo enviar.')
    }
    refresh()
  }

  return (
    <div className="card animate-rise p-6">
      <RoundHeader round={round} extra={<span className="ml-auto"><CountdownRing seconds={left} total={VERSE_SECONDS} size={56} /></span>} />

      <div className="rounded-2xl bg-emerald-500/20 px-4 py-3 text-center">
        <p className="font-display text-xl font-bold text-emerald-100">✅ ¡Código descifrado! +{codePoints}</p>
      </div>

      <p className="mt-5 text-sm uppercase tracking-wider text-indigo-200">📖 Ahora búscalo en tu Biblia</p>
      <p className="mt-2 font-display text-xl font-bold leading-snug">{round.verse?.prompt}</p>

      {timeUp ? (
        <p className="mt-6 rounded-2xl bg-white/10 px-4 py-4 text-center font-bold text-rose-200">
          ⏰ Se acabó el tiempo del bono. Conservas tus {codePoints} puntos.
        </p>
      ) : (
        <form onSubmit={submit} className="mt-5">
          <label className="label" htmlFor="book">Libro</label>
          <select id="book" className="input py-3 text-lg" value={book} onChange={(e) => setBook(e.target.value)} required>
            <option value="">Elige el libro…</option>
            {BIBLE_BOOKS.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="chapter">Capítulo</label>
              <input id="chapter" className="input py-3 text-center text-xl" type="number" inputMode="numeric"
                min={1} max={150} value={chapter} onChange={(e) => setChapter(e.target.value)} required />
            </div>
            <div>
              <label className="label" htmlFor="verse">Versículo</label>
              <input id="verse" className="input py-3 text-center text-xl" type="number" inputMode="numeric"
                min={1} max={200} value={verse} onChange={(e) => setVerse(e.target.value)} required />
            </div>
          </div>
          {wrong > 0 && !error && (
            <p className="mt-3 text-rose-200">
              ❌ Esa no es la referencia. Te quedan {Math.max(0, 5 - tries)} {5 - tries === 1 ? 'intento' : 'intentos'}.
            </p>
          )}
          <div className="mt-2"><ErrorBox>{error}</ErrorBox></div>
          <button className="btn-primary mt-4 w-full py-4 text-lg" disabled={!book || !chapter || !verse || sending}>
            {sending ? 'Enviando…' : 'Confirmar referencia'}
          </button>
          <p className="mt-3 text-center text-xs text-indigo-300">
            Si no la encuentras a tiempo conservas los {codePoints} puntos del código.
          </p>
        </form>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- TABÚ BÍBLICO
function TabooPlay({ state, round, now }: { state: PlayerState; round: Round; now: number }) {
  const my = state.my_answer
  const team = round.team
  const style = teamStyle(team?.seq ?? 1)
  const left = secondsLeft(round.deadline, now) ?? TABOO_SECONDS
  const running = round.status === 'active'
  const revealed = round.status === 'revealed'

  useEffect(() => { if (running) vibrate(60) }, [running])
  useEffect(() => { if (revealed && my?.is_correct) celebrate() }, [revealed, my?.is_correct])

  if (revealed) {
    return (
      <div className="card animate-rise p-6 text-center">
        <RoundHeader round={round} />
        <p className="text-indigo-200">La palabra era</p>
        <p className="mt-1 font-display text-4xl font-bold text-amber-300">{round.answer_text}</p>
        {round.secret?.reference && <p className="mt-1 text-sm text-indigo-300">📖 {round.secret.reference}</p>}
        {round.my_turn ? (
          <ResultBanner
            correct={my?.is_correct === true}
            points={my?.points ?? 0}
            answered={my !== null}
            detail={my?.is_correct ? `Todo ${team?.name} suma estos puntos` : `${team?.name} no alcanzó a adivinar`}
          />
        ) : (
          <p className="mt-5 rounded-2xl bg-white/10 px-4 py-4 text-indigo-100">
            Le tocaba a <b>{team?.name}</b>. Prepárate, tu equipo puede ser el siguiente.
          </p>
        )}
      </div>
    )
  }

  // Quien describe: solo él recibe la palabra y las prohibidas.
  if (round.i_describe && round.secret) {
    return (
      <div className="animate-rise">
        <div className="card p-5 text-center">
          <RoundHeader round={round} />
          <p className="text-sm uppercase tracking-wider text-indigo-200">Te toca describir a ti</p>
          <p className="mt-2 font-display text-5xl font-bold leading-tight text-amber-300">{round.secret.word}</p>
          <div className="mt-5 rounded-2xl bg-rose-500/15 p-4 text-left">
            <p className="text-sm font-bold uppercase tracking-wider text-rose-200">🚫 No puedes decir</p>
            <ul className="mt-2 grid grid-cols-2 gap-1.5">
              {round.secret.forbidden.map((w) => (
                <li key={w} className="rounded-xl bg-rose-500/20 px-3 py-1.5 text-center font-bold text-rose-50 line-through">{w}</li>
              ))}
            </ul>
          </div>
          <p className="mt-3 text-sm text-indigo-300">Tampoco vale deletrear, hacer señas ni decir palabras parecidas.</p>
        </div>
        <div className="card mt-4 flex items-center justify-center gap-4 p-5">
          {running ? (
            <>
              <CountdownRing seconds={left} total={TABOO_SECONDS} size={88} />
              <p className="font-display text-2xl font-bold">¡Descríbela ya!</p>
            </>
          ) : (
            <p className="text-center font-display text-xl text-indigo-200">
              🤫 Memorízala. El administrador arrancará los {TABOO_SECONDS} segundos.
            </p>
          )}
        </div>
      </div>
    )
  }

  // Resto del equipo que juega.
  if (round.my_turn) {
    return (
      <div className="card animate-rise p-8 text-center">
        <RoundHeader round={round} />
        <div className="animate-pop text-7xl">{running ? '📣' : '👂'}</div>
        <h2 className="mt-3 font-display text-3xl font-bold">
          {running ? '¡Adivina en voz alta!' : '¡Prepárate!'}
        </h2>
        <p className="mt-2 text-indigo-200">
          <b className={style.text}>{round.describer_name}</b> {running ? 'está describiendo la palabra' : 'va a describir la palabra'}.
        </p>
        {running && (
          <div className="mt-6 flex justify-center">
            <CountdownRing seconds={left} total={TABOO_SECONDS} size={120} />
          </div>
        )}
        <p className="mt-6 text-sm text-indigo-300">
          No se responde por el celular: griten la respuesta y el administrador detendrá el tiempo.
        </p>
      </div>
    )
  }

  // Los demás equipos miran.
  return (
    <InfoCard
      emoji={running ? '⏳' : '🤫'}
      title={`Le toca a ${team?.name ?? 'otro equipo'}`}
      text={running
        ? `${round.describer_name} está describiendo. Escucha en silencio: no ayudes ni respondas.`
        : `${round.describer_name} está leyendo su palabra. Tu turno llegará pronto.`}
    >
      {running && <div className="mt-6 flex justify-center"><CountdownRing seconds={left} total={TABOO_SECONDS} size={96} /></div>}
      {state.me.team && (
        <p className="mt-6 text-sm text-indigo-300">Tú juegas con <b>{state.me.team.name}</b>.</p>
      )}
    </InfoCard>
  )
}

// ---------------------------------------------------------------- SUBASTA BÍBLICA
type AuctionState = NonNullable<PlayerState['auction']>
type AuctionTeamState = NonNullable<AuctionState['team']>

const AUCTION_REASONS: Record<string, string> = {
  closed: 'Esta fase ya terminó.',
  timeout: 'Se acabó el tiempo.',
  already: 'Tu equipo ya lo envió.',
  not_controller: 'Solo el celular controlador del equipo puede hacerlo.',
  no_team: 'No estás en ningún equipo de la subasta.',
  range: 'Esa cantidad no está permitida.',
  empty: 'Escribe una respuesta.',
  controller_online: 'El controlador sigue conectado.',
}

/** Quién maneja el celular del equipo y, si se desconectó, la opción de tomar el control. */
function ControllerNote({ team, token, refresh }: { team: AuctionTeamState; token: string; refresh: () => Promise<void> }) {
  const [error, setError] = useState('')
  if (team.i_control) {
    return <p className="rounded-xl bg-amber-400/15 px-3 py-2 text-center text-sm font-bold text-amber-100">📱 Tu celular apuesta y responde por el equipo</p>
  }
  async function claim() {
    setError('')
    const { data, error } = await playerClient.rpc('claim_auction_control', { p_token: token })
    if (error) setError(errorMessage(error))
    else if (!data.ok) setError(AUCTION_REASONS[data.reason] ?? 'No se pudo.')
    refresh()
  }
  return (
    <div className="text-center text-sm text-indigo-200">
      📱 El celular de <b className="text-white">{team.controller_name ?? '—'}</b> apuesta y responde por el equipo.
      {!team.controller_online && (
        <button className="btn-secondary mt-2 w-full py-2 text-sm" onClick={claim}>Parece desconectado · Tomar el control</button>
      )}
      <div className="mt-2"><ErrorBox>{error}</ErrorBox></div>
    </div>
  )
}

function BalanceChip({ team }: { team: AuctionTeamState }) {
  return (
    <span className={`chip ml-auto px-3 ${teamStyle(team.seq).soft}`}>💰 <b className="tabular-nums">{team.balance}</b></span>
  )
}

function AuctionTeamCard({ state, token, refresh }: { state: PlayerState; token: string; refresh: () => Promise<void> }) {
  const team = state.auction?.team
  if (!team) {
    return <InfoCard emoji="🔨" title="Subasta bíblica" text="No quedaste en ningún equipo. Pide al administrador que te agregue a uno." />
  }
  const style = teamStyle(team.seq)
  return (
    <div className="card animate-rise overflow-hidden text-center">
      <div className={`px-6 py-5 ${style.bg}`}>
        <p className="text-sm font-bold uppercase tracking-wider text-white/80">🔨 Subasta bíblica · tu equipo</p>
        <h2 className="font-display text-4xl font-bold text-white">{team.name}</h2>
      </div>
      <div className="p-6">
        <ul className="flex flex-wrap justify-center gap-2">
          {team.members.map((m) => (
            <li key={m} className={`chip px-4 py-2 text-base ${m === state.me.name ? 'bg-amber-400 text-indigo-950' : 'bg-white/10'}`}>
              {m === team.controller_name && '📱 '}{m}
            </li>
          ))}
        </ul>
        <p className="mt-5 font-display text-2xl">Saldo inicial: <b className="text-amber-300">💰 {team.balance}</b></p>
        <div className="mt-4"><ControllerNote team={team} token={token} refresh={refresh} /></div>
        <p className="mt-5 text-sm text-indigo-300">
          En cada ronda verán la categoría y el nivel. Decidan juntos cuánto apostar antes de ver la pregunta.
          Acertar paga lo apostado ×1, ×1.5 o ×2 según el nivel; fallar lo resta.
        </p>
      </div>
    </div>
  )
}

function AuctionPlay({ state, round, token, now, refresh }: PlayProps) {
  const auction = state.auction
  const team = auction?.team
  const bid = auction?.bid ?? null
  const left = secondsLeft(round.deadline, now) ?? 0
  const revealed = round.status === 'revealed'

  useEffect(() => { if (round.status === 'active') vibrate(60) }, [round.status])
  useEffect(() => { if (revealed && bid?.is_correct) celebrate() }, [revealed, bid?.is_correct])

  if (!auction || !team) {
    return <InfoCard emoji="🔨" title="Subasta bíblica" text="No estás en ningún equipo de esta subasta. Mira la pantalla principal." />
  }

  if (revealed && auction.status === 'finished') return <AuctionFinalCard auction={auction} team={team} />

  if (revealed) {
    const cancelled = round.prompt === null
    return (
      <div className="card animate-rise p-6 text-center">
        <RoundHeader round={round} extra={<BalanceChip team={team} />} />
        {cancelled ? (
          <p className="rounded-2xl bg-white/10 px-4 py-4 text-indigo-100">Ronda anulada antes de mostrar la pregunta. Nadie ganó ni perdió.</p>
        ) : (
          <>
            <p className="text-indigo-200">Respuesta correcta</p>
            <p className="mt-1 font-display text-4xl font-bold text-amber-300">{round.answer_text}</p>
            {auction.reference && <p className="mt-1 text-sm text-indigo-300">📖 {auction.reference}</p>}
            <div className={`mt-5 rounded-2xl px-4 py-4 ${bid?.is_correct ? 'bg-emerald-500/20' : 'bg-rose-500/15'}`}>
              <p className="font-display text-2xl font-bold">
                {bid?.is_correct ? `🎉 ¡Acertaron! +${bid.delta}` : `😅 No acertaron · −${-(bid?.delta ?? 0)}`}
              </p>
              <p className="mt-1 text-sm text-indigo-200">
                {bid?.answer_text ? `Respondieron «${bid.answer_text}»` : 'No enviaron respuesta'} · apostaron {bid?.amount ?? '—'}
              </p>
              <p className="mt-2 font-display text-xl">Nuevo saldo: <b className="text-amber-300">💰 {team.balance}</b></p>
            </div>
            <p className="mt-4 text-sm text-indigo-300">
              Ronda {auction.rounds_played} de {auction.rounds_total} · tu equipo va #{team.rank} de {auction.teams_total}
            </p>
          </>
        )}
      </div>
    )
  }

  const mult = DIFFICULTY_MULTIPLIER[round.difficulty]

  // Fase 1: solo se conoce la categoría y el nivel.
  if (round.status === 'pending') {
    return (
      <div className="card animate-rise p-6">
        <RoundHeader round={round} extra={<BalanceChip team={team} />} />
        <div className="text-center">
          <p className="text-sm uppercase tracking-wider text-indigo-200">Categoría</p>
          <p className="font-display text-3xl font-bold leading-tight text-amber-300">{round.category}</p>
          <p className="mt-1 text-indigo-100">{DIFFICULTY_LABEL[round.difficulty]} · acertar paga <b>×{mult}</b></p>
        </div>
        <div className="my-5 flex justify-center"><CountdownRing seconds={left} total={AUCTION_BID_SECONDS} size={80} /></div>

        {bid ? (
          <div className="rounded-2xl bg-emerald-500/20 px-4 py-4 text-center">
            <p className="font-display text-2xl font-bold">🔨 Apostaron {bid.amount}</p>
            <p className="mt-1 text-sm text-indigo-100">
              Si aciertan: <b className="text-emerald-200">+{auctionGain(round.difficulty, bid.amount)}</b> ·
              si fallan: <b className="text-rose-200">−{Math.min(bid.amount, team.balance)}</b>
            </p>
            <p className="mt-3 text-sm text-indigo-300">Esperando a los demás equipos ({auction.teams_bid} de {auction.teams_total})…</p>
          </div>
        ) : left === 0 ? (
          <p className="rounded-2xl bg-white/10 px-4 py-4 text-center text-indigo-100">
            ⏰ Se acabó el tiempo. Si no apostaron, juegan con la mínima ({AUCTION_MIN_BID}).
          </p>
        ) : team.i_control ? (
          <BidForm round={round} team={team} token={token} refresh={refresh} />
        ) : (
          <p className="rounded-2xl bg-white/10 px-4 py-4 text-center font-bold text-indigo-100">
            🗣️ Conversen: ¿cuánto confían en esta categoría?
          </p>
        )}
        {!bid && <div className="mt-4"><ControllerNote team={team} token={token} refresh={refresh} /></div>}
      </div>
    )
  }

  // Fase 2: la pregunta, igual para todos.
  return (
    <div className="animate-rise">
      <div className="card p-5">
        <RoundHeader round={round} extra={<span className="ml-auto"><CountdownRing seconds={left} total={AUCTION_ANSWER_SECONDS} size={56} /></span>} />
        <p className="text-xs uppercase tracking-wider text-indigo-300">{round.category}</p>
        <h2 className="mt-1 font-display text-2xl font-bold leading-snug">{round.prompt}</h2>
        {bid && (
          <p className="mt-3 text-sm text-indigo-200">
            Apostaron <b className="text-white">{bid.amount}</b>{bid.auto && ' (mínima automática)'} ·
            acertar: <b className="text-emerald-200">+{auctionGain(round.difficulty, bid.amount)}</b> ·
            fallar: <b className="text-rose-200">−{Math.min(bid.amount, team.balance)}</b>
          </p>
        )}
      </div>

      <div className="card mt-4 p-5">
        {bid?.answered ? (
          <div className="text-center">
            <p className="text-indigo-200">Respuesta de tu equipo</p>
            <p className="mt-1 font-display text-3xl font-bold">«{bid.answer_text}»</p>
            <p className="mt-3 text-sm text-indigo-300">Esperando a los demás ({auction.teams_answered} de {auction.teams_total})…</p>
          </div>
        ) : left === 0 ? (
          <p className="text-center font-bold text-rose-200">⏰ Se acabó el tiempo</p>
        ) : team.i_control ? (
          <AuctionAnswerForm round={round} token={token} refresh={refresh} />
        ) : (
          <div>
            <p className="text-center font-display text-xl font-bold">🗣️ Pónganse de acuerdo y díctenle la respuesta</p>
            <div className="mt-3"><ControllerNote team={team} token={token} refresh={refresh} /></div>
          </div>
        )}
      </div>
    </div>
  )
}

function BidForm({ round, team, token, refresh }: { round: Round; team: AuctionTeamState; token: string; refresh: () => Promise<void> }) {
  const max = team.max_bid
  const [amount, setAmount] = useState(Math.min(max, 50))
  const [confirming, setConfirming] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const quick = [...new Set([AUCTION_MIN_BID, 50, 100, max].filter((x) => x <= max))]

  async function send() {
    setSending(true)
    setError('')
    const { data, error } = await playerClient.rpc('submit_auction_bid', { p_token: token, p_round: round.id, p_amount: amount })
    setSending(false)
    setConfirming(false)
    if (error) return setError(errorMessage(error))
    if (!data.ok) setError(AUCTION_REASONS[data.reason] ?? 'No se pudo enviar.')
    else vibrate([60, 30, 60])
    refresh()
  }

  return (
    <div>
      <p className="text-center font-display text-5xl font-bold tabular-nums text-amber-300">{amount}</p>
      <p className="text-center text-sm text-indigo-200">
        acertar <b className="text-emerald-200">+{auctionGain(round.difficulty, amount)}</b> ·
        fallar <b className="text-rose-200">−{Math.min(amount, team.balance)}</b>
      </p>
      <input
        type="range" className="mt-4 w-full accent-amber-400" aria-label="Cantidad a apostar"
        min={AUCTION_MIN_BID} max={max} step={5} value={amount} disabled={confirming}
        onChange={(e) => setAmount(Number(e.target.value))}
      />
      <div className="mt-3 grid grid-cols-4 gap-2">
        {quick.map((q) => (
          <button key={q} type="button" disabled={confirming}
            className={`btn px-2 py-2 text-sm ${amount === q ? 'bg-white text-indigo-950' : 'bg-white/10'}`}
            onClick={() => setAmount(q)}>
            {q === max ? `Máx ${q}` : q}
          </button>
        ))}
      </div>
      <div className="mt-2"><ErrorBox>{error}</ErrorBox></div>
      {confirming ? (
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button className="btn-secondary py-4" onClick={() => setConfirming(false)} disabled={sending}>Cambiar</button>
          <button className="btn-primary py-4 text-lg" onClick={send} disabled={sending}>{sending ? 'Enviando…' : `Sí, apostar ${amount}`}</button>
        </div>
      ) : (
        <button className="btn-primary mt-4 w-full py-4 text-lg" onClick={() => setConfirming(true)}>Confirmar apuesta</button>
      )}
      {confirming && <p className="mt-2 text-center text-xs text-amber-200">Después de confirmar ya no se puede cambiar.</p>}
    </div>
  )
}

function AuctionAnswerForm({ round, token, refresh }: { round: Round; token: string; refresh: () => Promise<void> }) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!text.trim() || sending) return
    setSending(true)
    setError('')
    const { data, error } = await playerClient.rpc('submit_auction_answer', { p_token: token, p_round: round.id, p_text: text })
    setSending(false)
    if (error) return setError(errorMessage(error))
    if (!data.ok) setError(AUCTION_REASONS[data.reason] ?? 'No se pudo enviar.')
    else vibrate(60)
    refresh()
  }

  return (
    <form onSubmit={submit}>
      <label htmlFor="auction-answer" className="label">Respuesta del equipo (una sola)</label>
      <input
        id="auction-answer"
        className="input py-4 text-xl"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Escribe la respuesta…"
        maxLength={80}
        autoComplete="off"
        autoCapitalize="words"
        enterKeyHint="send"
        autoFocus
      />
      <div className="mt-2"><ErrorBox>{error}</ErrorBox></div>
      <button className="btn-primary mt-4 w-full py-4 text-lg" disabled={!text.trim() || sending}>
        {sending ? 'Enviando…' : 'Enviar respuesta final'}
      </button>
    </form>
  )
}

function AuctionFinalCard({ auction, team }: { auction: AuctionState; team: AuctionTeamState }) {
  const top = team.rank === 1
  useEffect(() => { if (top) celebrate(true) }, [top])
  return (
    <div className="card animate-rise p-6 text-center">
      <div className="animate-pop text-6xl">{['🥇', '🥈', '🥉'][team.rank - 1] ?? '🏁'}</div>
      <h2 className="mt-2 font-display text-3xl font-bold">¡Terminó la subasta!</h2>
      <p className="mt-1 text-indigo-200">{team.name} quedó #{team.rank} de {auction.teams_total} con 💰 {team.balance}</p>
      <div className={`mt-5 rounded-2xl px-4 py-4 ${team.gain > 0 ? 'bg-emerald-500/20' : 'bg-white/10'}`}>
        <p className="font-display text-2xl font-bold">
          {team.gain > 0 ? `🎉 +${team.gain} puntos para ti` : 'Esta vez no hubo ganancia'}
        </p>
        <p className="mt-1 text-sm text-indigo-200">
          {team.gain > 0
            ? `Cada integrante de ${team.name} recibe lo mismo: ${team.members.join(', ')}.`
            : `El equipo no superó los ${auction.initial_balance} iniciales.`}
        </p>
      </div>
      <ol className="mt-5 space-y-1.5 text-left">
        {auction.standings.map((s, i) => (
          <li key={s.seq} className={`flex items-center gap-3 rounded-xl px-3 py-2 ${s.seq === team.seq ? 'bg-amber-400/20' : 'bg-white/5'}`}>
            <span className="w-6 text-center font-bold">{i + 1}</span>
            <span className={`h-3 w-3 rounded-full ${teamStyle(s.seq).bg}`} />
            <span className="flex-1 truncate font-bold">{s.name}</span>
            <span className="tabular-nums">💰 {s.balance}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

function ResultBanner({ correct, points, answered, detail }: { correct: boolean; points: number; answered: boolean; detail?: string }) {
  return (
    <div className={`mt-5 rounded-2xl px-4 py-4 ${correct ? 'bg-emerald-500/20' : 'bg-white/10'}`}>
      <p className="font-display text-2xl font-bold">
        {correct ? `🎉 ¡+${points} puntos!` : answered ? '😅 Esta vez no' : '⏳ No respondiste'}
      </p>
      {detail && <p className="text-sm text-indigo-200">{detail}</p>}
    </div>
  )
}

/** Evita que la pantalla del celular se apague durante el juego. */
function useWakeLock() {
  useEffect(() => {
    let lock: WakeLockSentinel | null = null
    const request = async () => {
      try {
        if ('wakeLock' in navigator && document.visibilityState === 'visible') lock = await navigator.wakeLock.request('screen')
      } catch { /* no soportado */ }
    }
    request()
    document.addEventListener('visibilitychange', request)
    return () => {
      document.removeEventListener('visibilitychange', request)
      lock?.release().catch(() => {})
    }
  }, [])
}
