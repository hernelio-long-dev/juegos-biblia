import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { CountdownRing, DifficultyChip } from '../../components/ui'
import { secondsLeft } from '../../lib/clock'
import { celebrate } from '../../lib/fx'
import { useLiveRefresh } from '../../lib/realtime'
import { auctionTeamCount } from '../../lib/scoring'
import { supabase } from '../../lib/supabase'
import {
  AUCTION_ANSWER_SECONDS, AUCTION_BID_SECONDS, AUCTION_MAX_BID, AUCTION_MIN_BID, AUCTION_START_BALANCE,
  DIFFICULTIES, DIFFICULTY_LABEL, DIFFICULTY_MULTIPLIER, teamStyle,
  type Auction, type AuctionBid, type AuctionQuestion, type AuctionTeam, type Difficulty, type PlayerStatus,
  type Round, type Team,
} from '../../lib/types'

type Run = (fn: () => PromiseLike<{ error: unknown }>) => Promise<void>

const MEDALS = ['🥇', '🥈', '🥉']

/**
 * Datos y acciones de la Subasta Bíblica para la consola: la subasta más reciente
 * de la sala, el saldo de cada equipo y las apuestas de la ronda actual.
 * También cierra solo las apuestas y la ronda cuando se vence el tiempo.
 */
export function useAuction(roomId: string, round: Round | null, now: number, run: Run, onChange: () => void) {
  const [auction, setAuction] = useState<Auction | null>(null)
  const [teams, setTeams] = useState<AuctionTeam[]>([])
  const [rounds, setRounds] = useState<{ id: string; prompt: string | null }[]>([])
  const [bids, setBids] = useState<AuctionBid[]>([])
  const [item, setItem] = useState<AuctionQuestion | null>(null)

  const load = useCallback(async () => {
    const { data: a } = await supabase.from('auctions').select('*').eq('room_id', roomId)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    setAuction(a as Auction | null)
    if (!a) {
      setTeams([])
      setRounds([])
      return
    }
    const [{ data: t }, { data: r }] = await Promise.all([
      supabase.from('auction_teams').select('*').eq('auction_id', a.id).order('seq'),
      supabase.from('rounds').select('id, prompt').eq('auction_id', a.id).order('seq'),
    ])
    if (t) setTeams(t as AuctionTeam[])
    if (r) setRounds(r)
  }, [roomId])

  const roundId = round?.game === 'auction' ? round.id : null
  const loadBids = useCallback(async () => {
    if (!roundId) return setBids([])
    const { data } = await supabase.from('auction_bids').select('*').eq('round_id', roundId)
    if (data) setBids(data as AuctionBid[])
  }, [roundId])

  // Los saldos cambian al revelar, así que se recarga con cada cambio de estado de la ronda.
  useEffect(() => { load() }, [load, round?.id, round?.status])
  useEffect(() => { loadBids() }, [loadBids, round?.status])

  // La pregunta y la respuesta: solo el admin las lee, y la pantalla solo las pinta cuando toca.
  const itemId = round?.game === 'auction' ? round.item_id : null
  useEffect(() => {
    if (!itemId) return setItem(null)
    supabase.from('auction_questions').select('*').eq('id', itemId).single()
      .then(({ data }) => setItem(data as AuctionQuestion))
  }, [itemId])

  useLiveRefresh(`auction-${roomId}`, [{ table: 'auctions', filter: `room_id=eq.${roomId}` }], load, 8000)
  const auctionId = auction?.id ?? null
  useLiveRefresh(auctionId ? `auction-teams-${auctionId}` : null,
    [{ table: 'auction_teams', filter: `auction_id=eq.${auctionId}` }], load, 0)
  useLiveRefresh(roundId ? `bids-${roundId}` : null,
    [{ table: 'auction_bids', filter: `round_id=eq.${roundId}` }], loadBids, 2500)

  const running = auction?.status === 'running' ? auction : null
  const played = rounds.filter((r) => r.prompt !== null).length
  // Al cambiar de ronda, `bids` puede traer aún las de la anterior.
  const roundBids = useMemo(() => bids.filter((b) => b.round_id === roundId), [bids, roundId])

  // ------------------------------------------------------------ automatismos
  const autoKey = useRef<string | null>(null)
  useEffect(() => {
    if (!round || round.game !== 'auction' || round.status === 'revealed') return
    const key = `${round.id}-${round.status}`
    if (autoKey.current === key) return
    const timeOver = round.deadline !== null && now > new Date(round.deadline).getTime() + 1000
    const retry = () => setTimeout(() => { if (autoKey.current === key) autoKey.current = null }, 2000)

    if (round.status === 'pending' && timeOver) {
      // Se venció el tiempo de apostar: quien no apostó queda con la mínima y sale la pregunta.
      autoKey.current = key
      supabase.rpc('close_auction_bids', { p_round: round.id, p_force: false }).then(({ data }) => {
        if (data === false) retry()
        onChange()
      })
    } else if (round.status === 'active') {
      const everyone = teams.length > 0 && teams.every((t) => roundBids.some((b) => b.auction_team_id === t.id && b.answered_at))
      if (!everyone && !timeOver) return
      autoKey.current = key
      const id = round.id
      setTimeout(() => {
        supabase.rpc('reveal_round', { p_round: id, p_force: false }).then(({ data }) => {
          if (data === false) retry()
          onChange()
        })
      }, everyone && !timeOver ? 1200 : 0)
    }
  }, [now, round, teams, roundBids, onChange])

  // ------------------------------------------------------------ acciones
  const start = useCallback(async (roundsTotal: number, reshuffle: boolean) => {
    await run(() => supabase.rpc('start_auction', { p_room: roomId, p_rounds: roundsTotal, p_reshuffle: reshuffle }))
    load()
  }, [run, roomId, load])

  const next = useCallback(async (difficulty: Difficulty | null) => {
    if (!running) return
    if (round?.game === 'auction' && round.status !== 'revealed') return // primero termina la ronda en curso
    await run(() => supabase.rpc('start_auction_round', { p_room: roomId, p_difficulty: difficulty }))
    load()
  }, [running, round, run, roomId, load])

  const closeBids = useCallback(() => {
    if (round?.game === 'auction' && round.status === 'pending') {
      run(() => supabase.rpc('close_auction_bids', { p_round: round.id, p_force: true }))
    }
  }, [round, run])

  const finish = useCallback(async () => {
    if (!running) return
    const left = running.rounds_total - played
    const msg = left > 0
      ? `Faltan ${left} rondas. ¿Terminar la subasta ya? El saldo ganado de cada equipo se suma a cada integrante.`
      : '¿Terminar la subasta? El saldo ganado de cada equipo se suma a cada uno de sus integrantes.'
    if (!confirm(msg)) return
    await run(() => supabase.rpc('finish_auction', { p_room: roomId }))
    load()
  }, [running, played, run, roomId, load])

  return { auction, running, teams, played, rounds, roundBids, item, start, next, closeBids, finish }
}

export type AuctionData = ReturnType<typeof useAuction>

/** Número de la ronda dentro de la subasta (las anuladas no cuentan). */
function roundNumber(data: AuctionData, round: Round): number {
  const settled = data.rounds.filter((r) => r.prompt !== null)
  const i = settled.findIndex((r) => r.id === round.id)
  return i >= 0 ? i + 1 : settled.length + 1
}

// ============================================================ CONTROLES

export function AuctionLauncher({ data, round, difficulty, setDifficulty, mix, setMix, remaining, busy, players, roomTeams }: {
  data: AuctionData
  round: Round | null
  difficulty: Difficulty
  setDifficulty: (d: Difficulty) => void
  mix: boolean
  setMix: (v: boolean) => void
  remaining: Record<Difficulty, number> | null
  busy: boolean
  players: number
  roomTeams: number
}) {
  const [total, setTotal] = useState(8)
  const [keepTeams, setKeepTeams] = useState(false)
  const { running, played } = data

  if (!running) {
    const n = auctionTeamCount(players)
    return (
      <>
        <label className="flex items-center gap-2 px-2 text-sm text-indigo-200">
          Rondas
          <select className="input w-auto py-2 text-sm" value={total} onChange={(e) => setTotal(Number(e.target.value))}>
            {[5, 6, 8, 10, 12].map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </label>
        {roomTeams >= 2 && (
          <label className="flex cursor-pointer items-center gap-2 px-2 text-sm text-indigo-200">
            <input type="checkbox" className="h-4 w-4 accent-amber-400" checked={keepTeams} onChange={(e) => setKeepTeams(e.target.checked)} />
            Usar los {roomTeams} equipos actuales
          </label>
        )}
        <button className="btn-primary px-5 py-2" onClick={() => data.start(total, !keepTeams)} disabled={busy || players < 2}
          title={keepTeams ? undefined : `${players} personas → ${n} equipos de 3 o 4`}>
          🔨 {keepTeams ? 'Iniciar subasta' : `Formar ${n} equipos e iniciar`}
        </button>
      </>
    )
  }

  const inProgress = round?.game === 'auction' && round.status !== 'revealed'
  const done = played >= running.rounds_total
  const left = remaining ? (mix ? DIFFICULTIES.reduce((n, d) => n + remaining[d], 0) : remaining[difficulty]) : 0
  return (
    <>
      <button onClick={() => setMix(true)}
        className={`btn px-3 py-2 text-sm ${mix ? 'bg-white text-indigo-950' : 'bg-transparent text-indigo-200 hover:bg-white/10'}`}>
        🎲 Mixta
      </button>
      {DIFFICULTIES.map((d) => (
        <button key={d} onClick={() => { setMix(false); setDifficulty(d) }}
          className={`btn px-3 py-2 text-sm ${!mix && difficulty === d ? 'bg-white text-indigo-950' : 'bg-transparent text-indigo-200 hover:bg-white/10'}`}>
          {DIFFICULTY_LABEL[d]} <span className="opacity-60">{remaining?.[d] ?? '–'}</span>
        </button>
      ))}
      {done ? (
        <button className="btn-primary px-5 py-2" onClick={data.finish} disabled={busy || inProgress}>🏁 Ver resultado final</button>
      ) : (
        <>
          <button className="btn-primary px-5 py-2" onClick={() => data.next(mix ? null : difficulty)}
            disabled={busy || inProgress || left === 0} title="Espacio">
            ▶ Ronda {played + (inProgress ? 0 : 1)} de {running.rounds_total}
          </button>
          <button className="btn-ghost px-3 py-2 text-sm" onClick={data.finish} disabled={busy}>🏁 Terminar</button>
        </>
      )}
    </>
  )
}

// ============================================================ ESCENARIOS

function Rules() {
  return (
    <div className="mx-auto grid max-w-4xl gap-3 text-center text-lg text-indigo-100 sm:grid-cols-3">
      <p className="rounded-2xl bg-white/5 px-4 py-3">💰 Todos empiezan con <b className="text-amber-300">{AUCTION_START_BALANCE}</b></p>
      <p className="rounded-2xl bg-white/5 px-4 py-3">🔨 Apuesta de <b>{AUCTION_MIN_BID}</b> a <b>{AUCTION_MAX_BID}</b> por ronda</p>
      <p className="rounded-2xl bg-white/5 px-4 py-3">✅ Acertar paga ×1 · ×1.5 · ×2 según el nivel · ❌ fallar resta lo apostado</p>
    </div>
  )
}

/** Antes de la primera ronda: cada equipo con sus integrantes y su celular controlador. */
export function AuctionTeamsStage({ data, roomTeams, players, now }: {
  data: AuctionData; roomTeams: Team[]; players: PlayerStatus[]; now: number
}) {
  const online = (id: string | null) => {
    const p = players.find((x) => x.participant_id === id)
    return !!p?.last_seen && now - new Date(p.last_seen).getTime() < 20_000
  }
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-8">
      <div className="text-center">
        <h1 className="font-display text-5xl font-bold">🔨 Subasta bíblica</h1>
        <p className="mt-2 text-2xl text-indigo-200">Busca a tu equipo. El celular marcado con 📱 apuesta y responde por todos.</p>
      </div>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {data.teams.map((t, i) => {
          const style = teamStyle(t.seq)
          const members = roomTeams.find((x) => x.id === t.team_id)?.members ?? []
          return (
            <li key={t.id} className="animate-rise card overflow-hidden" style={{ animationDelay: `${i * 80}ms` }}>
              <div className={`flex items-center justify-between px-5 py-3 ${style.bg}`}>
                <span className="font-display text-2xl font-bold text-white">{t.name}</span>
                <span className="font-display text-2xl font-bold text-white/90">💰 {t.balance}</span>
              </div>
              <ul className="space-y-1.5 px-5 py-4 text-xl">
                {members.map((m) => (
                  <li key={m.id} className={`flex items-center gap-2 ${m.id === t.controller_id ? 'font-bold text-amber-200' : ''}`}>
                    <span className="w-7">{m.id === t.controller_id ? '📱' : '·'}</span>
                    <span className="flex-1 truncate">{m.name}</span>
                    {m.id === t.controller_id && (
                      <span className={`h-2.5 w-2.5 rounded-full ${online(m.id) ? 'bg-emerald-400' : 'bg-white/25'}`} />
                    )}
                  </li>
                ))}
              </ul>
            </li>
          )
        })}
      </ul>
      <Rules />
    </div>
  )
}

/** Una ronda: categoría → apuestas → pregunta → respuestas → resultado. */
export function AuctionRoundStage({ data, round, roomTeams, peek, now }: {
  data: AuctionData; round: Round; roomTeams: Team[]; peek: boolean; now: number
}) {
  const { auction, teams, roundBids: bids, item } = data
  const pending = round.status === 'pending'
  const revealed = round.status === 'revealed'
  const cancelled = revealed && round.prompt === null
  const left = secondsLeft(round.deadline, now) ?? 0
  const bidOf = (id: string) => bids.find((b) => b.auction_team_id === id)
  const allBid = teams.length > 0 && teams.every((t) => bidOf(t.id))
  const answered = bids.filter((b) => b.answered_at).length
  const mult = DIFFICULTY_MULTIPLIER[round.difficulty]

  const winners = bids.filter((b) => b.is_correct).length
  const prev = useRef(round.status)
  useEffect(() => {
    if (prev.current !== 'revealed' && revealed && winners > 0) celebrate()
    prev.current = round.status
  }, [round.status, revealed, winners])

  if (auction?.status === 'finished' && data.rounds.filter((r) => r.prompt !== null).at(-1)?.id === round.id) {
    return <AuctionFinal auction={auction} teams={teams} roomTeams={roomTeams} />
  }

  const sorted = revealed ? [...teams].sort((a, b) => b.balance - a.balance || a.seq - b.seq) : teams

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <span className="font-display text-2xl font-bold">
          Ronda {roundNumber(data, round)} <span className="text-indigo-300">de {auction?.rounds_total}</span>
        </span>
        <span className="chip bg-white/10 text-base">🔨 Subasta bíblica</span>
        <DifficultyChip difficulty={round.difficulty} />
        <div className="ml-auto">
          {pending && <span className="chip bg-amber-400/20 px-4 py-2 text-lg text-amber-100">💰 {bids.length} de {teams.length} apostaron</span>}
          {round.status === 'active' && <span className="chip bg-white/10 px-4 py-2 text-lg">📨 {answered} de {teams.length} respondieron</span>}
        </div>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-8 text-center">
        {pending || cancelled ? (
          <div className="animate-pop">
            <p className="text-2xl uppercase tracking-wider text-indigo-300">Categoría</p>
            <p className="font-display text-6xl font-bold text-amber-300 sm:text-7xl">{round.category}</p>
            <p className="mt-4 font-display text-3xl text-indigo-100">
              Dificultad: <b>{DIFFICULTY_LABEL[round.difficulty]}</b>
              <span className="text-indigo-300"> · acertar paga ×{mult}</span>
            </p>
          </div>
        ) : (
          <div>
            <p className="text-xl uppercase tracking-wider text-indigo-300">{round.category}</p>
            <h1 className="mt-2 font-display text-4xl font-bold leading-tight sm:text-5xl lg:text-6xl">{round.prompt}</h1>
          </div>
        )}

        {cancelled ? (
          <p className="font-display text-3xl text-indigo-200">Ronda anulada: se cerró antes de mostrar la pregunta. Nadie ganó ni perdió.</p>
        ) : pending ? (
          <div className="flex flex-wrap items-center justify-center gap-8">
            <CountdownRing seconds={left} total={AUCTION_BID_SECONDS} size={160} />
            <p className="font-display text-4xl font-bold text-indigo-100">
              {allBid ? '¡Todos apostaron!' : left > 0 ? '¿Cuánto se atreven a apostar?' : '⏰ ¡Tiempo!'}
            </p>
          </div>
        ) : revealed ? (
          <div className="animate-rise">
            <p className="text-2xl text-indigo-200">Respuesta correcta</p>
            <p className="font-display text-6xl font-bold text-amber-300 sm:text-7xl">{round.answer_text}</p>
            {item?.reference && <p className="mt-2 text-xl text-indigo-200">📖 {item.reference}</p>}
          </div>
        ) : (
          <div className="flex items-center gap-6">
            <CountdownRing seconds={left} total={AUCTION_ANSWER_SECONDS} size={150} />
            <p className="font-display text-3xl font-bold text-indigo-100">{left > 0 ? '¡Escriban su respuesta!' : '⏰ ¡Tiempo!'}</p>
          </div>
        )}

        {peek && !revealed && item && (
          <div className="rounded-2xl border border-amber-400/40 bg-amber-400/10 px-5 py-3 text-left">
            <p className="text-xs font-bold uppercase tracking-wider text-amber-200">Solo para el administrador</p>
            {pending && <p className="text-amber-100/80">{item.question}</p>}
            <p className="font-display text-2xl font-bold text-amber-100">{item.answer}</p>
          </div>
        )}

        <ul className="grid w-full gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map((t) => (
            <TeamCard key={t.id} team={t} bid={bidOf(t.id)} round={round} showAmount={!pending || allBid} />
          ))}
        </ul>
      </div>
    </div>
  )
}

function TeamCard({ team, bid, round, showAmount }: { team: AuctionTeam; bid?: AuctionBid; round: Round; showAmount: boolean }) {
  const style = teamStyle(team.seq)
  const revealed = round.status === 'revealed'
  const settled = revealed && bid?.delta != null
  const ring = settled ? (bid.is_correct ? 'ring-2 ring-emerald-400' : 'ring-2 ring-rose-400/70') : ''

  let status: ReactNode
  if (round.status === 'pending') {
    status = bid
      ? <span className="text-emerald-200">✅ Apostó{showAmount && <b className="ml-1 text-amber-200">{bid.amount}</b>}</span>
      : <span className="text-indigo-300">⏳ Pensando…</span>
  } else if (!revealed) {
    status = (
      <>
        <span>🔨 <b className="text-amber-200">{bid?.amount ?? '—'}</b>{bid?.auto && <span className="text-xs text-indigo-300"> (mínima)</span>}</span>
        <span className={bid?.answered_at ? 'text-emerald-200' : 'text-indigo-300'}>{bid?.answered_at ? '✅ Respondió' : '✍️ Escribiendo…'}</span>
      </>
    )
  } else if (settled) {
    status = (
      <>
        <span className="min-w-0 truncate">{bid.is_correct ? '✅' : '❌'} {bid.answer_text ? `«${bid.answer_text}»` : 'Sin respuesta'}</span>
        <b className={bid.is_correct ? 'text-emerald-300' : 'text-rose-300'}>{bid.delta! >= 0 ? `+${bid.delta}` : `−${-bid.delta!}`}</b>
      </>
    )
  }

  return (
    <li className={`animate-rise flex items-center gap-3 rounded-2xl bg-white/[0.07] px-4 py-3 text-left ${ring}`}>
      <span className={`h-10 w-2 shrink-0 rounded-full ${style.bg}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className={`truncate font-display text-2xl font-bold ${style.text}`}>{team.name}</span>
          <span className="font-display text-2xl font-bold tabular-nums">💰 {team.balance}</span>
        </div>
        <div className="flex items-center justify-between gap-2 text-lg">{status}</div>
      </div>
    </li>
  )
}

function AuctionFinal({ auction, teams, roomTeams }: { auction: Auction; teams: AuctionTeam[]; roomTeams: Team[] }) {
  const sorted = [...teams].sort((a, b) => b.balance - a.balance || a.seq - b.seq)
  useEffect(() => { celebrate(true) }, [])
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center gap-6">
      <div className="text-center">
        <h1 className="font-display text-5xl font-bold">🏁 Resultado de la subasta</h1>
        <p className="mt-2 text-xl text-indigo-200">
          Cada integrante recibe lo que su equipo ganó por encima de los {auction.initial_balance} iniciales.
        </p>
      </div>
      <ol className="grid gap-3">
        {sorted.map((t, i) => {
          const style = teamStyle(t.seq)
          const gain = Math.max(0, t.balance - auction.initial_balance)
          const members = roomTeams.find((x) => x.id === t.team_id)?.members ?? []
          return (
            <li key={t.id} style={{ animationDelay: `${i * 90}ms` }}
              className={`animate-rise flex items-center gap-4 rounded-2xl px-5 py-4 ${i === 0 ? 'bg-white/15 ring-2 ring-amber-300' : 'bg-white/[0.06]'}`}>
              <span className="w-12 text-center font-display text-4xl font-bold">{MEDALS[i] ?? i + 1}</span>
              <span className={`h-12 w-2 shrink-0 rounded-full ${style.bg}`} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-display text-3xl font-bold">{t.name}</div>
                <div className="truncate text-sm text-indigo-300">{members.map((m) => m.name).join(' · ')}</div>
              </div>
              <div className="text-right">
                <div className="font-display text-3xl font-bold tabular-nums">💰 {t.balance}</div>
                <div className={`font-bold ${gain > 0 ? 'text-emerald-300' : 'text-indigo-300'}`}>
                  {gain > 0 ? `+${gain} pts c/u` : 'sin ganancia'}
                </div>
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
