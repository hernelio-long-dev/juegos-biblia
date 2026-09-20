import { useMemo, useState } from 'react'
import { ErrorBox } from '../../components/ui'
import { errorMessage, supabase } from '../../lib/supabase'
import { teamStyle, type PlayerStatus, type Team } from '../../lib/types'

/** Número de equipos sugerido: grupos de 4 a 6 personas, mínimo 2 equipos. */
export function suggestedTeams(players: number): number {
  return Math.max(2, Math.min(6, Math.round(players / 5) || 2))
}

export default function TeamsDrawer({ roomId, teams, players, onClose, onChanged }: {
  roomId: string
  teams: Team[]
  players: PlayerStatus[]
  onClose: () => void
  onChanged: () => Promise<void> | void
}) {
  const [count, setCount] = useState(() => (teams.length || suggestedTeams(players.length)))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const teamOf = useMemo(() => {
    const map = new Map<string, Team>()
    for (const t of teams) for (const m of t.members) map.set(m.id, t)
    return map
  }, [teams])
  const loose = players.filter((p) => !teamOf.has(p.participant_id))

  async function run(fn: () => PromiseLike<{ error: unknown }>) {
    setBusy(true)
    setError('')
    const { error } = await fn()
    setBusy(false)
    if (error) setError(errorMessage(error))
    await onChanged()
  }

  async function assign() {
    const again = teams.length > 0
    if (again && !confirm('¿Rehacer los equipos? Se reparte todo de nuevo al azar. Los puntos ya ganados se conservan.')) return
    run(() => supabase.rpc('assign_teams', { p_room: roomId, p_teams: count }))
  }

  function rename(t: Team) {
    const name = prompt('Nuevo nombre del equipo', t.name)
    if (name && name.trim() && name !== t.name) run(() => supabase.rpc('rename_team', { p_team: t.id, p_name: name }))
  }

  function move(participantId: string, teamId: string) {
    run(() => supabase.rpc('set_team', { p_room: roomId, p_participant: participantId, p_team: teamId || null }))
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onClose}>
      <aside className="flex h-full w-full max-w-md flex-col bg-indigo-950 p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-display text-2xl font-bold">🤝 Equipos</h2>
          <button className="btn-ghost px-3 py-1" onClick={onClose} aria-label="Cerrar">✕</button>
        </div>
        <p className="text-sm text-indigo-200">
          Se usan solo en Tabú bíblico. El sistema reparte al azar a los {players.length} que están en la sala,
          en grupos del mismo tamaño.
        </p>

        <div className="mt-4 flex items-end gap-2">
          <div>
            <label className="label" htmlFor="team-count">¿Cuántos equipos?</label>
            <input
              id="team-count"
              type="number"
              className="input w-28 py-2"
              min={2}
              max={6}
              value={count}
              onChange={(e) => setCount(Math.max(2, Math.min(6, Number(e.target.value) || 2)))}
            />
          </div>
          <button className="btn-primary flex-1 py-2.5" onClick={assign} disabled={busy || players.length < 2}>
            {teams.length ? '🔀 Rehacer equipos' : '🎲 Repartir equipos'}
          </button>
        </div>
        {players.length < 2 && <p className="mt-2 text-sm text-amber-200">Necesitas al menos 2 participantes dentro de la sala.</p>}
        {teams.length === 0 && players.length >= 2 && (
          <p className="mt-2 text-sm text-indigo-300">Sugerencia para {players.length} personas: {suggestedTeams(players.length)} equipos.</p>
        )}

        <div className="mt-3"><ErrorBox>{error}</ErrorBox></div>

        <div className="mt-3 flex-1 space-y-4 overflow-y-auto">
          {teams.map((t) => {
            const style = teamStyle(t.seq)
            return (
              <div key={t.id} className="rounded-2xl bg-white/5 p-3">
                <div className="flex items-center gap-2">
                  <span className={`h-3 w-3 shrink-0 rounded-full ${style.bg}`} />
                  <h3 className="flex-1 truncate font-display text-lg font-bold">{t.name}</h3>
                  <span className="text-sm text-indigo-300">{t.members.length}</span>
                  <button className="btn-ghost px-2 py-1 text-xs" onClick={() => rename(t)} disabled={busy}>✏️</button>
                </div>
                <ul className="mt-2 space-y-1">
                  {t.members.map((m) => (
                    <li key={m.id} className="flex items-center gap-2">
                      <span className="flex-1 truncate text-sm">{m.name}</span>
                      <select
                        className="input w-auto py-1 text-xs"
                        value={t.id}
                        disabled={busy}
                        onChange={(e) => move(m.id, e.target.value)}
                        aria-label={`Cambiar de equipo a ${m.name}`}
                      >
                        {teams.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                      </select>
                    </li>
                  ))}
                  {t.members.length === 0 && <li className="py-2 text-center text-sm text-indigo-300">Sin integrantes</li>}
                </ul>
              </div>
            )
          })}

          {loose.length > 0 && teams.length > 0 && (
            <div className="rounded-2xl border border-amber-400/40 bg-amber-400/10 p-3">
              <h3 className="font-display text-lg font-bold text-amber-200">Sin equipo ({loose.length})</h3>
              <p className="text-xs text-amber-100/80">Entraron después del reparto. Asígnalos o vuelve a repartir.</p>
              <ul className="mt-2 space-y-1">
                {loose.map((p) => (
                  <li key={p.participant_id} className="flex items-center gap-2">
                    <span className="flex-1 truncate text-sm">{p.name}</span>
                    <select
                      className="input w-auto py-1 text-xs"
                      value=""
                      disabled={busy}
                      onChange={(e) => move(p.participant_id, e.target.value)}
                      aria-label={`Asignar equipo a ${p.name}`}
                    >
                      <option value="">Elegir…</option>
                      {teams.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {teams.length === 0 && (
            <p className="py-10 text-center text-indigo-200">Todavía no hay equipos. Reparte arriba para poder jugar Tabú.</p>
          )}
        </div>
      </aside>
    </div>
  )
}
