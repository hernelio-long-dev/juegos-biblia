import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { ErrorBox, Spinner } from '../../components/ui'
import { errorMessage, supabase } from '../../lib/supabase'
import type { Participant } from '../../lib/types'

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()

export default function ParticipantsTab() {
  const [list, setList] = useState<Participant[] | null>(null)
  const [bulk, setBulk] = useState('')
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('participants').select('*').order('name')
    if (error) return setError(errorMessage(error))
    setList(data as Participant[])
  }, [])

  useEffect(() => { load() }, [load])

  async function add(e: FormEvent) {
    e.preventDefault()
    if (!list) return
    const existing = new Set(list.map((p) => norm(p.name)))
    const names: string[] = []
    let dup = 0
    for (const line of bulk.split('\n')) {
      const name = line.trim().replace(/\s+/g, ' ')
      if (!name) continue
      if (existing.has(norm(name))) { dup++; continue }
      existing.add(norm(name))
      names.push(name.slice(0, 60))
    }
    if (names.length === 0) {
      setNotice(dup ? 'Esos nombres ya estaban registrados.' : '')
      return
    }
    setBusy(true)
    setError('')
    const { error } = await supabase.from('participants').insert(names.map((name) => ({ name })))
    setBusy(false)
    if (error) return setError(errorMessage(error))
    setBulk('')
    setNotice(`✅ ${names.length} registrado${names.length === 1 ? '' : 's'}${dup ? ` · ${dup} ya existía${dup === 1 ? '' : 'n'}` : ''}`)
    load()
  }

  async function saveEdit() {
    if (!editing || !editing.name.trim()) return
    const { error } = await supabase.from('participants').update({ name: editing.name.trim() }).eq('id', editing.id)
    if (error) return setError(/duplicate|unique/i.test(errorMessage(error)) ? 'Ya existe un participante con ese nombre.' : errorMessage(error))
    setEditing(null)
    load()
  }

  async function remove(p: Participant) {
    if (!confirm(`¿Eliminar a ${p.name}? También se borrarán sus puntajes.`)) return
    const { error } = await supabase.from('participants').delete().eq('id', p.id)
    if (error) return setError(errorMessage(error))
    load()
  }

  const filtered = useMemo(
    () => (list ?? []).filter((p) => norm(p.name).includes(norm(search))),
    [list, search],
  )

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.3fr]">
      <form onSubmit={add} className="card h-fit space-y-3 p-5">
        <h2 className="font-display text-2xl font-bold">Registrar participantes</h2>
        <label className="label" htmlFor="bulk">Escribe un nombre por línea</label>
        <textarea
          id="bulk"
          className="input min-h-44 font-mono text-base"
          placeholder={'María López\nJuan Pérez\nSofía Ramírez'}
          value={bulk}
          onChange={(e) => { setBulk(e.target.value); setNotice('') }}
        />
        <button className="btn-primary w-full" disabled={busy || !bulk.trim()}>{busy ? 'Guardando…' : 'Registrar'}</button>
        {notice && <p className="text-sm text-emerald-200">{notice}</p>}
        <ErrorBox>{error}</ErrorBox>
      </form>

      <section className="card p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-2xl font-bold">Lista</h2>
          <span className="chip bg-white/10">{list?.length ?? 0} registrados</span>
        </div>
        <input className="input mt-3" placeholder="Buscar…" value={search} onChange={(e) => setSearch(e.target.value)} />
        {!list ? <Spinner /> : (
          <ul className="mt-3 max-h-[60dvh] divide-y divide-white/10 overflow-y-auto">
            {filtered.map((p) => (
              <li key={p.id} className="flex items-center gap-2 py-2">
                {editing?.id === p.id ? (
                  <>
                    <input
                      className="input py-2"
                      value={editing.name}
                      autoFocus
                      onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                      onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditing(null) }}
                    />
                    <button className="btn-primary px-3 py-2" onClick={saveEdit}>Guardar</button>
                  </>
                ) : (
                  <>
                    <span className="flex-1 truncate font-semibold">{p.name}</span>
                    <button className="btn-ghost px-3 py-2" onClick={() => setEditing({ id: p.id, name: p.name })} aria-label={`Editar ${p.name}`}>✏️</button>
                    <button className="btn-ghost px-3 py-2" onClick={() => remove(p)} aria-label={`Eliminar ${p.name}`}>🗑️</button>
                  </>
                )}
              </li>
            ))}
            {filtered.length === 0 && <li className="py-8 text-center text-indigo-200">Sin resultados.</li>}
          </ul>
        )}
      </section>
    </div>
  )
}
