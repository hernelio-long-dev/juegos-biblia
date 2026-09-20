import { useCallback, useEffect, useState } from 'react'
import { ErrorBox, Spinner } from '../../components/ui'
import { errorMessage, supabase } from '../../lib/supabase'
import { GAME_ICON, GAME_LABEL, GAMES, type Game, type GlobalScoreRow } from '../../lib/types'

const MEDALS = ['🥇', '🥈', '🥉']

export default function HistoryTab() {
  const [rows, setRows] = useState<GlobalScoreRow[] | null>(null)
  const [counted, setCounted] = useState({ yes: 0, no: 0 })
  const [game, setGame] = useState<Game | null>(null)
  const [onlyPlayed, setOnlyPlayed] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const [{ data, error }, { data: roomRows }] = await Promise.all([
      supabase.rpc('global_scoreboard', { p_game: game }),
      supabase.from('rooms').select('counts_for_history'),
    ])
    if (error) return setError(errorMessage(error))
    setRows(data as GlobalScoreRow[])
    const all = roomRows ?? []
    setCounted({ yes: all.filter((r) => r.counts_for_history).length, no: all.filter((r) => !r.counts_for_history).length })
  }, [game])
  useEffect(() => { load() }, [load])

  const visible = (rows ?? []).filter((r) => !onlyPlayed || r.rooms > 0)
  const totalPoints = visible.reduce((n, r) => n + r.points, 0)

  return (
    <div className="space-y-5">
      <div className="card p-5">
        <h2 className="font-display text-2xl font-bold">🏅 Ranking histórico</h2>
        <p className="text-sm text-indigo-200">
          Acumulado de cada persona en todas las salas, sin importar cuántas se hayan creado ni si siguen abiertas.
          Cuentan {counted.yes} {counted.yes === 1 ? 'sala' : 'salas'}
          {counted.no > 0 && <> · {counted.no} {counted.no === 1 ? 'excluida' : 'excluidas'} del histórico</>}.
          Puedes excluir una sala desde la pestaña <b>Salas</b>.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {([null, ...GAMES] as const).map((g) => (
            <button
              key={g ?? 'all'}
              onClick={() => setGame(g)}
              className={`btn px-4 py-2 text-sm ${game === g ? 'bg-white text-indigo-950' : 'bg-white/10 hover:bg-white/20'}`}
            >
              {g === null ? 'Todos los juegos' : `${GAME_ICON[g]} ${GAME_LABEL[g]}`}
            </button>
          ))}
          <label className="ml-auto flex cursor-pointer items-center gap-2 text-sm text-indigo-200">
            <input
              type="checkbox"
              className="h-4 w-4 accent-amber-400"
              checked={onlyPlayed}
              onChange={(e) => setOnlyPlayed(e.target.checked)}
            />
            Ocultar a quienes aún no juegan
          </label>
        </div>
      </div>

      <ErrorBox>{error}</ErrorBox>

      {!rows ? <Spinner /> : visible.length === 0 ? (
        <p className="card p-8 text-center text-indigo-200">
          Todavía no hay puntajes. Juega una ronda y vuelve aquí.
        </p>
      ) : (
        <>
          <div className="card overflow-x-auto">
            <table className="w-full min-w-md text-left">
              <thead className="text-xs uppercase tracking-wider text-indigo-300">
                <tr className="border-b border-white/10">
                  <th className="px-4 py-3 text-center">#</th>
                  <th className="px-2 py-3">Participante</th>
                  <th className="px-3 py-3 text-right">Salas</th>
                  <th className="px-3 py-3 text-right">Aciertos</th>
                  <th className="px-4 py-3 text-right">Puntos</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => {
                  const top = r.rank <= 3 && r.points > 0
                  return (
                    <tr key={r.participant_id} className={`border-b border-white/5 ${top ? 'bg-white/[0.07]' : ''}`}>
                      <td className="px-4 py-3 text-center font-display text-xl font-bold">
                        {top ? MEDALS[r.rank - 1] : <span className="text-indigo-300">{r.rank}</span>}
                      </td>
                      <td className="px-2 py-3 font-bold">{r.name}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-indigo-200">{r.rooms}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-indigo-200">{r.correct}</td>
                      <td className="px-4 py-3 text-right font-display text-xl font-bold tabular-nums text-amber-300">{r.points}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="text-sm text-indigo-300">
            {visible.length} {visible.length === 1 ? 'participante' : 'participantes'} · {totalPoints} puntos repartidos en total.
          </p>
        </>
      )}
    </div>
  )
}
