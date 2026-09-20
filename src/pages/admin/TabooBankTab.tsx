import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { DifficultyChip, ErrorBox, Spinner } from '../../components/ui'
import { tabooMaxPoints } from '../../lib/scoring'
import { errorMessage, supabase } from '../../lib/supabase'
import { DIFFICULTIES, DIFFICULTY_LABEL, TABOO_SECONDS, type Difficulty, type TabooItem } from '../../lib/types'
import { DifficultyFilter } from './QuizBankTab'

const EMPTY = { id: '', difficulty: 'facil' as Difficulty, word: '', forbidden: '', reference: '' }

export default function TabooBankTab() {
  const [items, setItems] = useState<TabooItem[] | null>(null)
  const [filter, setFilter] = useState<Difficulty | 'all'>('all')
  const [form, setForm] = useState(EMPTY)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('taboo_items').select('*').order('difficulty').order('word')
    if (error) return setError(errorMessage(error))
    setItems(data as TabooItem[])
  }, [])
  useEffect(() => { load() }, [load])

  const forbidden = form.forbidden.split(',').map((s) => s.trim()).filter(Boolean)

  async function save(e: FormEvent) {
    e.preventDefault()
    if (forbidden.length < 3 || forbidden.length > 6) return setError('Escribe entre 3 y 6 palabras prohibidas, separadas por coma.')
    setBusy(true)
    setError('')
    const row = {
      difficulty: form.difficulty,
      word: form.word.trim(),
      forbidden,
      reference: form.reference.trim() || null,
    }
    const { error } = form.id
      ? await supabase.from('taboo_items').update(row).eq('id', form.id)
      : await supabase.from('taboo_items').insert(row)
    setBusy(false)
    if (error) return setError(errorMessage(error))
    setForm(EMPTY)
    setOpen(false)
    load()
  }

  function edit(it: TabooItem) {
    setForm({ id: it.id, difficulty: it.difficulty, word: it.word, forbidden: it.forbidden.join(', '), reference: it.reference ?? '' })
    setOpen(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function remove(it: TabooItem) {
    if (!confirm(`¿Eliminar "${it.word}" del banco?`)) return
    const { error } = await supabase.from('taboo_items').delete().eq('id', it.id)
    if (error) return setError(errorMessage(error))
    load()
  }

  const visible = (items ?? []).filter((i) => filter === 'all' || i.difficulty === filter)

  return (
    <div className="space-y-5">
      <div className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl font-bold">Tabú bíblico</h2>
            <p className="text-sm text-indigo-200">
              Se juega por equipos: un integrante describe la palabra sin decir las prohibidas y su equipo
              tiene {TABOO_SECONDS} segundos para adivinar. Mientras más rápido, más puntos
              (máximo {tabooMaxPoints('facil')} fácil · {tabooMaxPoints('intermedio')} intermedio · {tabooMaxPoints('dificil')} difícil).
              Los puntos se los lleva <b>cada</b> integrante del equipo.
            </p>
          </div>
          {!open && <button className="btn-primary" onClick={() => { setForm(EMPTY); setOpen(true) }}>+ Agregar</button>}
        </div>

        {open && (
          <form onSubmit={save} className="mt-5 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="word">Palabra secreta</label>
              <input id="word" className="input text-lg" placeholder="El arca de Noé" value={form.word} onChange={(e) => setForm({ ...form, word: e.target.value })} required />
            </div>
            <div>
              <label className="label" htmlFor="tdiff">Nivel</label>
              <select id="tdiff" className="input" value={form.difficulty} onChange={(e) => setForm({ ...form, difficulty: e.target.value as Difficulty })}>
                {DIFFICULTIES.map((d) => <option key={d} value={d}>{DIFFICULTY_LABEL[d]}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="label" htmlFor="forbidden">Palabras prohibidas (de 3 a 6, separadas por coma)</label>
              <input id="forbidden" className="input" placeholder="noé, diluvio, animales, lluvia, barco" value={form.forbidden} onChange={(e) => setForm({ ...form, forbidden: e.target.value })} required />
              {forbidden.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {forbidden.map((w, i) => (
                    <span key={i} className="chip bg-rose-500/20 text-rose-100 line-through">{w}</span>
                  ))}
                </div>
              )}
              <p className="mt-1 text-xs text-indigo-300">Elige las palabras más obvias: son las que dan la dificultad.</p>
            </div>
            <div className="sm:col-span-2">
              <label className="label" htmlFor="tref">Cita bíblica (opcional)</label>
              <input id="tref" className="input" placeholder="Génesis 6–9" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
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
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((it) => (
            <li key={it.id} className="card flex flex-col p-4">
              <div className="flex items-center justify-between">
                <DifficultyChip difficulty={it.difficulty} />
                <div className="flex">
                  <button className="btn-ghost px-2 py-1" onClick={() => edit(it)} aria-label="Editar">✏️</button>
                  <button className="btn-ghost px-2 py-1" onClick={() => remove(it)} aria-label="Eliminar">🗑️</button>
                </div>
              </div>
              <div className="mt-3 font-display text-xl font-bold text-amber-200">{it.word}</div>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {it.forbidden.map((w, i) => (
                  <li key={i} className="rounded-lg bg-rose-500/20 px-2 py-0.5 text-xs text-rose-100 line-through">{w}</li>
                ))}
              </ul>
              {it.reference && <div className="mt-auto pt-3 text-xs text-indigo-300">📖 {it.reference}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
