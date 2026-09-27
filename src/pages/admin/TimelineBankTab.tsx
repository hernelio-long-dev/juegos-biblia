import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { DifficultyChip, ErrorBox, Spinner } from '../../components/ui'
import { timelinePoints } from '../../lib/scoring'
import { errorMessage, supabase } from '../../lib/supabase'
import {
  DIFFICULTIES, DIFFICULTY_LABEL, TIMELINE_MAX_WRONG, TIMELINE_SECONDS, type Difficulty, type TimelineSet,
} from '../../lib/types'
import { DifficultyFilter } from './QuizBankTab'

const EMPTY = { id: '', difficulty: 'facil' as Difficulty, title: '', events: '', explanation: '' }

export default function TimelineBankTab() {
  const [items, setItems] = useState<TimelineSet[] | null>(null)
  const [filter, setFilter] = useState<Difficulty | 'all'>('all')
  const [form, setForm] = useState(EMPTY)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('timeline_sets').select('*').order('difficulty').order('title')
    if (error) return setError(errorMessage(error))
    setItems(data as TimelineSet[])
  }, [])
  useEffect(() => { load() }, [load])

  const events = form.events.split('\n').map((s) => s.trim()).filter(Boolean)

  async function save(e: FormEvent) {
    e.preventDefault()
    if (events.length < 4 || events.length > 8) return setError('Escribe entre 4 y 8 acontecimientos, uno por línea.')
    if (new Set(events.map((x) => x.toLowerCase())).size !== events.length) return setError('Hay acontecimientos repetidos.')
    setBusy(true)
    setError('')
    const row = {
      difficulty: form.difficulty,
      title: form.title.trim(),
      events,
      explanation: form.explanation.trim() || null,
    }
    const { error } = form.id
      ? await supabase.from('timeline_sets').update(row).eq('id', form.id)
      : await supabase.from('timeline_sets').insert(row)
    setBusy(false)
    if (error) return setError(errorMessage(error))
    setForm(EMPTY)
    setOpen(false)
    load()
  }

  function edit(it: TimelineSet) {
    setForm({ id: it.id, difficulty: it.difficulty, title: it.title, events: it.events.join('\n'), explanation: it.explanation ?? '' })
    setOpen(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function remove(it: TimelineSet) {
    if (!confirm(`¿Eliminar "${it.title}" del banco?`)) return
    const { error } = await supabase.from('timeline_sets').delete().eq('id', it.id)
    if (error) return setError(errorMessage(error))
    load()
  }

  const visible = (items ?? []).filter((i) => filter === 'all' || i.difficulty === filter)

  return (
    <div className="space-y-5">
      <div className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl font-bold">🧍 Línea del tiempo humana</h2>
            <p className="text-sm text-indigo-200">
              Por equipos de 4 o más. Cada integrante recibe en secreto un acontecimiento de la lista y el equipo
              se pone en fila en orden cronológico. Tienen {TIMELINE_SECONDS / 60} minutos y hasta {TIMELINE_MAX_WRONG} errores.
              El que termina primero gana más: {timelinePoints('facil', 1)} · {timelinePoints('facil', 2)} ·{' '}
              {timelinePoints('facil', 3)} · {timelinePoints('facil', 4)} (fácil; ×1.5 intermedio, ×2 difícil), menos 10 por error,
              para <b>cada</b> integrante.
            </p>
          </div>
          {!open && <button className="btn-primary" onClick={() => { setForm(EMPTY); setOpen(true) }}>+ Agregar</button>}
        </div>

        {open && (
          <form onSubmit={save} className="mt-5 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="tltitle">Tema de la ronda</label>
              <input id="tltitle" className="input text-lg" placeholder="Personajes del Antiguo Testamento" maxLength={80}
                value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
            </div>
            <div>
              <label className="label" htmlFor="tldiff">Nivel</label>
              <select id="tldiff" className="input" value={form.difficulty} onChange={(e) => setForm({ ...form, difficulty: e.target.value as Difficulty })}>
                {DIFFICULTIES.map((d) => <option key={d} value={d}>{DIFFICULTY_LABEL[d]}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="label" htmlFor="tlevents">Acontecimientos en orden cronológico, del más antiguo al más reciente (uno por línea, de 4 a 8)</label>
              <textarea id="tlevents" className="input min-h-44 font-mono text-sm" placeholder={'Noé\nAbraham\nMoisés\nDavid\nDaniel'}
                value={form.events} onChange={(e) => setForm({ ...form, events: e.target.value })} required />
              <p className="mt-1 text-xs text-indigo-300">
                {events.length} acontecimientos. Cada integrante recibe uno, así que la línea necesita al menos tantos
                como el equipo más grande; con 7 u 8 sirve para cualquier equipo y cada uno recibe una combinación distinta.
                En el nivel difícil conviene que estén muy cerca en el tiempo.
              </p>
            </div>
            <div className="sm:col-span-2">
              <label className="label" htmlFor="tlexp">Explicación que se muestra al revelar (opcional)</label>
              <textarea id="tlexp" className="input min-h-20" placeholder="Génesis 6, 12; Éxodo 3…"
                value={form.explanation} onChange={(e) => setForm({ ...form, explanation: e.target.value })} />
            </div>
            <div className="sm:col-span-2"><ErrorBox>{error}</ErrorBox></div>
            <div className="flex gap-2 sm:col-span-2">
              <button className="btn-primary flex-1" disabled={busy}>{busy ? 'Guardando…' : form.id ? 'Guardar cambios' : 'Agregar al banco'}</button>
              <button type="button" className="btn-secondary" onClick={() => { setOpen(false); setForm(EMPTY); setError('') }}>Cancelar</button>
            </div>
          </form>
        )}
      </div>

      <DifficultyFilter value={filter} onChange={setFilter} counts={items ?? []} />
      {!open && <ErrorBox>{error}</ErrorBox>}

      {!items ? <Spinner /> : (
        <ul className="grid gap-3 md:grid-cols-2">
          {visible.map((it) => (
            <li key={it.id} className="card flex flex-col p-4">
              <div className="flex items-center justify-between">
                <DifficultyChip difficulty={it.difficulty} />
                <div className="flex">
                  <button className="btn-ghost px-2 py-1" onClick={() => edit(it)} aria-label="Editar">✏️</button>
                  <button className="btn-ghost px-2 py-1" onClick={() => remove(it)} aria-label="Eliminar">🗑️</button>
                </div>
              </div>
              <div className="mt-2 font-display text-lg font-bold text-amber-200">{it.title}</div>
              <ol className="mt-2 space-y-1 text-sm">
                {it.events.map((e, i) => (
                  <li key={i} className="flex gap-2 rounded-lg bg-white/5 px-2 py-1">
                    <span className="w-4 text-right text-indigo-300">{i + 1}</span>{e}
                  </li>
                ))}
              </ol>
              {it.explanation && <p className="mt-auto pt-2 text-xs text-indigo-300">📖 {it.explanation}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
