import { teamStyle, type ScoreRow, type TeamScoreRow } from '../lib/types'

const MEDALS = ['🥇', '🥈', '🥉']

/** Tabla por equipos (Tabú bíblico). */
export function TeamLeaderboard({ rows, big = false }: { rows: TeamScoreRow[]; big?: boolean }) {
  if (rows.length === 0) {
    return <p className="py-8 text-center text-indigo-200">Todavía no hay equipos. Ármalos desde «🤝 Equipos».</p>
  }
  return (
    <ol className="grid gap-3 sm:grid-cols-2">
      {rows.map((row, i) => {
        const style = teamStyle(row.seq)
        const top = row.rank === 1 && row.points > 0
        return (
          <li
            key={row.team_id}
            style={{ animationDelay: `${Math.min(i, 10) * 60}ms` }}
            className={`animate-rise flex items-center gap-4 rounded-2xl px-5 ${big ? 'py-5' : 'py-3'}
              ${top ? 'bg-white/15 ring-2 ring-amber-300' : 'bg-white/[0.06]'}`}
          >
            <span className={`flex shrink-0 items-center justify-center rounded-2xl font-display font-bold text-white
              ${style.bg} ${big ? 'h-14 w-14 text-3xl' : 'h-10 w-10 text-xl'}`}>
              {row.seq}
            </span>
            <div className="min-w-0 flex-1">
              <div className={`truncate font-display font-bold ${big ? 'text-3xl' : 'text-lg'}`}>{row.name}</div>
              <div className="text-xs text-indigo-300">
                {row.members} {row.members === 1 ? 'integrante' : 'integrantes'} · {row.wins} {row.wins === 1 ? 'acierto' : 'aciertos'}
              </div>
            </div>
            <span className={`font-display font-bold tabular-nums text-amber-300 ${big ? 'text-4xl' : 'text-2xl'}`}>
              {row.points}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

export function Leaderboard({ rows, big = false, highlightId, limit }: {
  rows: ScoreRow[]
  big?: boolean
  highlightId?: string
  limit?: number
}) {
  const list = limit ? rows.slice(0, limit) : rows
  if (list.length === 0) {
    return <p className="py-8 text-center text-indigo-200">Aún no hay participantes en la sala.</p>
  }
  return (
    <ol className={`grid gap-2 ${big && list.length > 10 ? 'lg:grid-cols-2' : ''}`}>
      {list.map((row, i) => {
        const top = row.rank <= 3 && row.points > 0
        return (
          <li
            key={row.participant_id}
            style={{ animationDelay: `${Math.min(i, 20) * 40}ms` }}
            className={`animate-rise flex items-center gap-3 rounded-2xl px-4 ${big ? 'py-3 text-2xl' : 'py-2.5 text-base'}
              ${row.participant_id === highlightId ? 'bg-amber-400 text-indigo-950' : top ? 'bg-white/15' : 'bg-white/[0.06]'}`}
          >
            <span className={`w-10 text-center font-display font-bold ${big ? 'text-3xl' : 'text-xl'}`}>
              {top ? MEDALS[row.rank - 1] : row.rank}
            </span>
            <span className="flex-1 truncate font-bold">{row.name}</span>
            <span className={`text-sm opacity-70 ${big ? 'hidden sm:inline' : 'hidden'}`}>{row.correct} ✓</span>
            <span className="font-display font-bold tabular-nums">{row.points}</span>
          </li>
        )
      })}
    </ol>
  )
}

export function Podium({ rows }: { rows: ScoreRow[] }) {
  const [first, second, third] = rows
  const step = (row: ScoreRow | undefined, place: number, height: string, color: string) => (
    <div className="flex w-1/3 max-w-60 flex-col items-center gap-3">
      {row ? (
        <>
          <div className="animate-pop text-5xl sm:text-6xl" style={{ animationDelay: `${(3 - place) * 350}ms` }}>
            {MEDALS[place - 1]}
          </div>
          <div className="w-full truncate text-center font-display text-xl font-bold sm:text-3xl">{row.name}</div>
          <div className="font-display text-lg text-amber-200 sm:text-2xl">{row.points} pts</div>
        </>
      ) : <div className="h-24" />}
      <div className={`w-full rounded-t-3xl ${color} ${height} flex items-start justify-center pt-4 font-display text-4xl font-bold text-indigo-950/70`}>
        {place}
      </div>
    </div>
  )
  return (
    <div className="flex items-end justify-center gap-3 sm:gap-6">
      {step(second, 2, 'h-32 sm:h-44', 'bg-slate-300')}
      {step(first, 1, 'h-44 sm:h-64', 'bg-amber-400')}
      {step(third, 3, 'h-24 sm:h-32', 'bg-orange-400')}
    </div>
  )
}
