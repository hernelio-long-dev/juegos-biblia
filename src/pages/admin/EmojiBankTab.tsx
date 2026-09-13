import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { DifficultyChip, ErrorBox, Spinner } from '../../components/ui'
import { emojiPoints } from '../../lib/scoring'
import { errorMessage, supabase } from '../../lib/supabase'
import { DIFFICULTIES, DIFFICULTY_LABEL, type Difficulty, type EmojiItem } from '../../lib/types'
import { DifficultyFilter } from './QuizBankTab'

const EMPTY = { id: '', difficulty: 'facil' as Difficulty, clues: '', answer: '', aliases: '', reference: '' }

export default function EmojiBankTab() {
  const [items, setItems] = useState<EmojiItem[] | null>(null)
  const [filter, setFilter] = useState<Difficulty | 'all'>('all')
  const [form, setForm] = useState(EMPTY)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('emoji_items').select('*').order('difficulty').order('answer')
    if (error) return setError(errorMessage(error))
    setItems(data as EmojiItem[])
  }, [])
  useEffect(() => { load() }, [load])

  const clues = form.clues.split(/\s+/).filter(Boolean)

  async function save(e: FormEvent) {
    e.preventDefault()
    if (clues.length < 2 || clues.length > 6) return setError('Usa entre 2 y 6 pistas (emojis separados por espacio).')
    setBusy(true)
    setError('')
    const row = {
      difficulty: form.difficulty,
      clues,
      answer: form.answer.trim(),
      aliases: form.aliases.split(',').map((s) => s.trim()).filter(Boolean),
      reference: form.reference.trim() || null,
    }
    const { error } = form.id
      ? await supabase.from('emoji_items').update(row).eq('id', form.id)
      : await supabase.from('emoji_items').insert(row)
    setBusy(false)
    if (error) return setError(errorMessage(error))
    setForm(EMPTY)
    setOpen(false)
    load()
  }

  function edit(it: EmojiItem) {
    setForm({ id: it.id, difficulty: it.difficulty, clues: it.clues.join(' '), answer: it.answer, aliases: it.aliases.join(', '), reference: it.reference ?? '' })
    setOpen(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function remove(it: EmojiItem) {
    if (!confirm(`¿Eliminar "${it.answer}" del banco?`)) return
    const { error } = await supabase.from('emoji_items').delete().eq('id', it.id)
    if (error) return setError(errorMessage(error))
    load()
  }

  const visible = (items ?? []).filter((i) => filter === 'all' || i.difficulty === filter)

  return (
    <div className="space-y-5">
      <div className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl font-bold">Juego de emojis</h2>
            <p className="text-sm text-indigo-200">
              Puntos: 1 emoji = 100 · 2 = 70 · 3 = 50 · 4 o más = 30 — ×1 fácil, ×1.5 intermedio, ×2 difícil.
              Al mostrar la última pista hay 30 s; después, 0 puntos.
            </p>
          </div>
          {!open && <button className="btn-primary" onClick={() => { setForm(EMPTY); setOpen(true) }}>+ Agregar</button>}
        </div>

        {open && (
          <form onSubmit={save} className="mt-5 grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="label" htmlFor="clues">Pistas en orden (de la más difícil a la más fácil), separadas por espacio</label>
              <input id="clues" className="input text-2xl" placeholder="🧺 🔥🌿 🌊 📜" value={form.clues} onChange={(e) => setForm({ ...form, clues: e.target.value })} required />
              {clues.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {clues.map((c, i) => (
                    <span key={i} className="rounded-xl bg-white/10 px-3 py-1 text-center">
                      <span className="text-2xl">{c}</span>
                      <span className="block text-[10px] text-indigo-200">{emojiPoints(form.difficulty, i + 1)} pts</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label className="label" htmlFor="answer">Respuesta (personaje o historia)</label>
              <input id="answer" className="input" placeholder="Moisés" value={form.answer} onChange={(e) => setForm({ ...form, answer: e.target.value })} required />
            </div>
            <div>
              <label className="label" htmlFor="diff">Nivel</label>
              <select id="diff" className="input" value={form.difficulty} onChange={(e) => setForm({ ...form, difficulty: e.target.value as Difficulty })}>
                {DIFFICULTIES.map((d) => <option key={d} value={d}>{DIFFICULTY_LABEL[d]}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="label" htmlFor="aliases">Otras respuestas válidas (separadas por coma)</label>
              <input id="aliases" className="input" placeholder="moises, cruce del mar rojo, la zarza ardiente" value={form.aliases} onChange={(e) => setForm({ ...form, aliases: e.target.value })} />
              <p className="mt-1 text-xs text-indigo-300">No importan tildes, mayúsculas ni errores leves de ortografía.</p>
            </div>
            <div className="sm:col-span-2">
              <label className="label" htmlFor="ref">Cita bíblica (opcional)</label>
              <input id="ref" className="input" placeholder="Éxodo 2–20" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
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
              <div className="my-3 text-3xl tracking-wider">{it.clues.join(' ')}</div>
              <div className="font-display text-xl font-bold text-amber-200">{it.answer}</div>
              {it.aliases.length > 0 && <div className="mt-1 text-xs text-indigo-200">También: {it.aliases.join(', ')}</div>}
              {it.reference && <div className="mt-auto pt-2 text-xs text-indigo-300">📖 {it.reference}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
