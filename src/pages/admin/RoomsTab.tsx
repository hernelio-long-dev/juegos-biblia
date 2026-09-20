import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { ErrorBox, Spinner } from '../../components/ui'
import { errorMessage, supabase } from '../../lib/supabase'
import type { Room } from '../../lib/types'

type RoomRow = Room & {
  room_codes: { code: string } | { code: string }[] | null
  room_players: { count: number }[]
}

function codeOf(r: RoomRow): string | null {
  const c = r.room_codes
  if (!c) return null
  return Array.isArray(c) ? c[0]?.code ?? null : c.code
}

export default function RoomsTab() {
  const navigate = useNavigate()
  const [rooms, setRooms] = useState<RoomRow[] | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('rooms')
      .select('*, room_codes(code), room_players(count)')
      .order('created_at', { ascending: false })
    if (error) return setError(errorMessage(error))
    setRooms(data as RoomRow[])
  }, [])

  useEffect(() => { load() }, [load])

  async function create(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const { data, error } = await supabase.rpc('create_room', { p_name: name || 'Sala' })
    setBusy(false)
    if (error) return setError(errorMessage(error))
    setName('')
    navigate(`/admin/sala/${data.id}`)
  }

  async function toggleHistory(room: RoomRow) {
    const next = !room.counts_for_history
    if (!next && !confirm(`¿Excluir "${room.name}" del ranking histórico? Sus puntos dejan de sumar en el acumulado, pero no se borra nada y puedes volver a incluirla cuando quieras.`)) return
    const { error } = await supabase.from('rooms').update({ counts_for_history: next }).eq('id', room.id)
    if (error) return setError(errorMessage(error))
    load()
  }

  async function remove(room: RoomRow) {
    if (!confirm(`¿Eliminar la sala "${room.name}" y todos sus puntajes? Esta acción no se puede deshacer.`)) return
    const { error } = await supabase.from('rooms').delete().eq('id', room.id)
    if (error) return setError(errorMessage(error))
    load()
  }

  return (
    <div className="space-y-6">
      <form onSubmit={create} className="card flex flex-col gap-3 p-5 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label className="label" htmlFor="room-name">Nueva sala</label>
          <input id="room-name" className="input" placeholder="Ej. Jóvenes — Sábado 20 de septiembre" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </div>
        <button className="btn-primary" disabled={busy}>{busy ? 'Creando…' : '+ Crear sala'}</button>
      </form>
      <p className="-mt-3 text-sm text-indigo-300">
        El sistema genera automáticamente un código de 4 dígitos para que los participantes entren.
        Toda sala suma al <b>ranking histórico</b>; desmarca una para dejarla fuera (útil en ensayos o pruebas).
      </p>

      <ErrorBox>{error}</ErrorBox>

      {!rooms ? <Spinner /> : rooms.length === 0 ? (
        <p className="card p-8 text-center text-indigo-200">Todavía no hay salas. Crea la primera arriba.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {rooms.map((r) => {
            const code = codeOf(r)
            const players = r.room_players?.[0]?.count ?? 0
            return (
              <li key={r.id} className="card flex flex-col gap-4 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate font-display text-xl font-bold">{r.name}</h3>
                    <p className="text-sm text-indigo-200">
                      {new Date(r.created_at).toLocaleDateString('es', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}
                      {' · '}{players} {players === 1 ? 'participante' : 'participantes'}
                    </p>
                  </div>
                  {r.status === 'open' && code ? (
                    <div className="rounded-2xl bg-amber-400 px-3 py-1 text-center text-indigo-950">
                      <div className="text-[10px] font-bold uppercase">Código</div>
                      <div className="font-display text-2xl font-bold tracking-widest">{code}</div>
                    </div>
                  ) : (
                    <span className="chip bg-white/10 text-indigo-200">Cerrada</span>
                  )}
                </div>
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-amber-400"
                    checked={r.counts_for_history}
                    onChange={() => toggleHistory(r)}
                  />
                  <span className={r.counts_for_history ? 'text-indigo-200' : 'text-amber-200'}>
                    {r.counts_for_history ? '🏅 Cuenta para el histórico' : '🚫 Excluida del histórico'}
                  </span>
                </label>
                <div className="flex gap-2">
                  <button className="btn-primary flex-1" onClick={() => navigate(`/admin/sala/${r.id}`)}>
                    {r.status === 'open' ? 'Abrir consola' : 'Ver resultados'}
                  </button>
                  <button className="btn-secondary" onClick={() => remove(r)} aria-label="Eliminar sala">🗑️</button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
