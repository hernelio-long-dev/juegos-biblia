import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { CountdownRing, DifficultyChip, ErrorBox, Spinner } from '../components/ui'
import { secondsLeft, useClockSync, useServerNow } from '../lib/clock'
import { celebrate, vibrate } from '../lib/fx'
import { clearPlayerSession, getPlayerSession } from '../lib/player'
import { useLiveRefresh } from '../lib/realtime'
import { emojiPoints } from '../lib/scoring'
import { errorMessage, playerClient, requestTimeout } from '../lib/supabase'
import {
  EMOJI_FINAL_SECONDS, GAME_LABEL, OPTION_STYLES, QUIZ_SECONDS, TABOO_SECONDS, teamStyle,
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
  ], refresh, 3000, playerClient)

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

  const { room, me, round } = state
  const finished = room.status === 'closed' || room.view === 'podium'

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
        ) : room.view === 'round' && round ? (
          round.game === 'emoji'
            ? <EmojiPlay key={round.id} state={state} round={round} token={token} now={now} refresh={refresh} />
            : round.game === 'taboo'
              ? <TabooPlay key={round.id} state={state} round={round} now={now} />
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
