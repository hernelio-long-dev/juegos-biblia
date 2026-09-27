import { useCallback, useEffect, useRef, useState } from 'react'
import { CountdownRing, DifficultyChip } from '../../components/ui'
import { secondsLeft } from '../../lib/clock'
import { useLiveRefresh } from '../../lib/realtime'
import { timelinePoints } from '../../lib/scoring'
import { supabase } from '../../lib/supabase'
import {
  GAME_LABEL, TIMELINE_MAX_WRONG, TIMELINE_SECONDS, teamStyle,
  type Round, type Team, type TimelineResult, type TimelineSet,
} from '../../lib/types'

/**
 * Línea del Tiempo para la consola: el set de la ronda (solo lo ve el admin),
 * el avance de cada equipo y el cierre automático cuando ya nadie puede seguir.
 */
export function useTimeline(round: Round | null, now: number, onChange: () => void) {
  const [set, setSet] = useState<TimelineSet | null>(null)
  const [results, setResults] = useState<TimelineResult[]>([])

  const roundId = round?.game === 'timeline' ? round.id : null
  const itemId = round?.game === 'timeline' ? round.item_id : null

  useEffect(() => {
    if (!itemId) return setSet(null)
    supabase.from('timeline_sets').select('*').eq('id', itemId).single().then(({ data }) => setSet(data as TimelineSet))
  }, [itemId])

  const loadResults = useCallback(async () => {
    if (!roundId) return setResults([])
    const { data } = await supabase.from('timeline_results').select('*').eq('round_id', roundId)
    if (data) setResults(data as TimelineResult[])
  }, [roundId])
  useEffect(() => { loadResults() }, [loadResults, round?.status])
  useLiveRefresh(roundId ? `timeline-${roundId}` : null,
    [{ table: 'timeline_results', filter: `round_id=eq.${roundId}` }], loadResults, 2500)

  // Al cambiar de ronda, `results` puede traer aún los de la anterior.
  const current = results.filter((r) => r.round_id === roundId)

  const autoKey = useRef<string | null>(null)
  useEffect(() => {
    if (!round || round.game !== 'timeline' || round.status !== 'active' || autoKey.current === round.id) return
    const timeOver = round.deadline !== null && now > new Date(round.deadline).getTime() + 1500
    const allDone = current.length > 0 && current.every((r) => r.solved_at || r.wrong >= TIMELINE_MAX_WRONG)
    if (!timeOver && !allDone) return
    autoKey.current = round.id
    const id = round.id
    // Sin p_force: el servidor vuelve a comprobar antes de revelar.
    setTimeout(() => {
      supabase.rpc('reveal_round', { p_round: id, p_force: false }).then(({ data }) => {
        if (data === false) setTimeout(() => { if (autoKey.current === id) autoKey.current = null }, 2000)
        onChange()
      })
    }, allDone && !timeOver ? 1500 : 0)
  }, [now, round, current, onChange])

  return { set, results: current }
}

export type TimelineData = ReturnType<typeof useTimeline>

export function TimelineStage({ data, round, teams, peek, now }: {
  data: TimelineData; round: Round; teams: Team[]; peek: boolean; now: number
}) {
  const { set, results } = data
  const revealed = round.status === 'revealed'
  const left = secondsLeft(round.deadline, now) ?? 0
  const solved = results.filter((r) => r.solved_at).length

  // Primero los que ya terminaron, por lugar; luego el resto por número de equipo.
  const rows = results
    .map((r) => ({ r, team: teams.find((t) => t.id === r.team_id) }))
    .sort((a, b) => (a.r.place ?? 99) - (b.r.place ?? 99) || (a.team?.seq ?? 0) - (b.team?.seq ?? 0))

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <span className="font-display text-2xl font-bold">Ronda {round.seq}</span>
        <span className="chip bg-white/10 text-base">{GAME_LABEL.timeline}</span>
        <DifficultyChip difficulty={round.difficulty} />
        <span className="chip ml-auto bg-emerald-500/20 px-4 py-2 text-lg text-emerald-100">
          ✅ {solved} de {results.length} equipos
        </span>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-8 text-center">
        <div>
          <p className="text-xl font-bold uppercase tracking-[0.3em] text-indigo-300">Línea del tiempo humana</p>
          <p className="mt-2 font-display text-5xl font-bold text-amber-300 sm:text-6xl">“{round.category}”</p>
          {!revealed && (
            <p className="mt-3 font-display text-2xl text-indigo-100 sm:text-3xl">
              Organicen a su equipo desde el más antiguo hasta el más reciente.
            </p>
          )}
        </div>

        {revealed ? (
          set && (
            <div className="animate-rise w-full">
              <ol className="flex flex-wrap items-center justify-center gap-2 sm:gap-3">
                {set.events.map((e, i) => (
                  <li key={i} className="flex items-center gap-2 sm:gap-3">
                    <span className="rounded-2xl bg-amber-400 px-4 py-3 font-display text-xl font-bold text-indigo-950 sm:text-2xl">
                      <span className="mr-2 opacity-60">{i + 1}</span>{e}
                    </span>
                    {i < set.events.length - 1 && <span className="font-display text-3xl text-amber-300">→</span>}
                  </li>
                ))}
              </ol>
              {set.explanation && (
                <p className="mx-auto mt-6 max-w-4xl rounded-2xl bg-white/5 px-6 py-4 text-xl text-indigo-100">📖 {set.explanation}</p>
              )}
            </div>
          )
        ) : (
          <div className="flex items-center gap-6">
            <CountdownRing seconds={left} total={TIMELINE_SECONDS} size={180} />
            <p className="max-w-md text-left font-display text-2xl text-indigo-100">
              {left > 0 ? 'Hablen, descubran qué tarjeta tiene cada uno y pónganse en fila.' : '⏰ ¡Tiempo!'}
            </p>
          </div>
        )}

        {peek && !revealed && set && (
          <div className="rounded-2xl border border-amber-400/40 bg-amber-400/10 px-5 py-3 text-left">
            <p className="text-xs font-bold uppercase tracking-wider text-amber-200">Solo para el administrador</p>
            <p className="font-display text-lg font-bold text-amber-100">{set.events.join(' → ')}</p>
          </div>
        )}

        <ul className="grid w-full gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map(({ r, team }) => {
            const style = teamStyle(team?.seq ?? 1)
            const out = !r.solved_at && r.wrong >= TIMELINE_MAX_WRONG
            return (
              <li key={r.team_id}
                className={`animate-rise flex items-center gap-3 rounded-2xl px-4 py-3 text-left
                  ${r.solved_at ? 'bg-emerald-500/15 ring-2 ring-emerald-400/70' : 'bg-white/[0.07]'}`}>
                <span className={`h-10 w-2 shrink-0 rounded-full ${style.bg}`} />
                <div className="min-w-0 flex-1">
                  <div className={`truncate font-display text-2xl font-bold ${style.text}`}>{team?.name ?? 'Equipo'}</div>
                  <div className="text-lg text-indigo-100">
                    {r.solved_at
                      ? `✅ ${r.place}º lugar · ${((r.elapsed_ms ?? 0) / 1000).toFixed(0)} s`
                      : out ? '🔒 Sin intentos'
                        : revealed ? '⏰ No alcanzó'
                          : r.wrong > 0 ? `⚠️ ${r.wrong} ${r.wrong === 1 ? 'intento fallido' : 'intentos fallidos'}`
                            : '🧍 Organizándose…'}
                  </div>
                </div>
                {r.solved_at && <span className="font-display text-3xl font-bold text-amber-300">+{r.points}</span>}
              </li>
            )
          })}
        </ul>

        {!revealed && (
          <p className="text-lg text-indigo-300">
            1º {timelinePoints(round.difficulty, 1)} · 2º {timelinePoints(round.difficulty, 2)} ·
            3º {timelinePoints(round.difficulty, 3)} · después {timelinePoints(round.difficulty, 4)} pts para cada integrante
            · −{timelinePoints(round.difficulty, 1) - timelinePoints(round.difficulty, 1, 1)} por cada intento fallido
          </p>
        )}
      </div>
    </div>
  )
}
