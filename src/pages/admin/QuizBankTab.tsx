import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { DifficultyChip, ErrorBox, Spinner } from '../../components/ui'
import { errorMessage, supabase } from '../../lib/supabase'
import { DIFFICULTIES, DIFFICULTY_LABEL, OPTION_STYLES, QUIZ_BASE, type Difficulty, type QuizQuestion } from '../../lib/types'

const EMPTY = { id: '', difficulty: 'facil' as Difficulty, question: '', options: ['', '', '', ''], correct: 0, reference: '' }

export function DifficultyFilter({ value, onChange, counts }: {
  value: Difficulty | 'all'
  onChange: (v: Difficulty | 'all') => void
  counts: { difficulty: Difficulty }[]
}) {
  const opts: (Difficulty | 'all')[] = ['all', ...DIFFICULTIES]
  return (
    <div className="flex flex-wrap gap-2">
      {opts.map((d) => {
        const n = d === 'all' ? counts.length : counts.filter((c) => c.difficulty === d).length
        return (
          <button
            key={d}
            onClick={() => onChange(d)}
            className={`btn px-4 py-2 text-sm ${value === d ? 'bg-white text-indigo-950' : 'bg-white/10 hover:bg-white/20'}`}
          >
            {d === 'all' ? 'Todos' : DIFFICULTY_LABEL[d]} <span className="opacity-60">{n}</span>
          </button>
        )
      })}
    </div>
  )
}

export default function QuizBankTab() {
  const [items, setItems] = useState<QuizQuestion[] | null>(null)
  const [filter, setFilter] = useState<Difficulty | 'all'>('all')
  const [form, setForm] = useState(EMPTY)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('quiz_questions').select('*').order('difficulty').order('created_at')
    if (error) return setError(errorMessage(error))
    setItems(data as QuizQuestion[])
  }, [])
  useEffect(() => { load() }, [load])

  async function save(e: FormEvent) {
    e.preventDefault()
    const options = form.options.map((o) => o.trim())
    if (options.some((o) => !o)) return setError('Completa las 4 opciones.')
    setBusy(true)
    setError('')
    const row = {
      difficulty: form.difficulty,
      question: form.question.trim(),
      options,
      correct_index: form.correct,
      reference: form.reference.trim() || null,
    }
    const { error } = form.id
      ? await supabase.from('quiz_questions').update(row).eq('id', form.id)
      : await supabase.from('quiz_questions').insert(row)
    setBusy(false)
    if (error) return setError(errorMessage(error))
    setForm(EMPTY)
    setOpen(false)
    load()
  }

  function edit(q: QuizQuestion) {
    const options = [...q.options, '', '', '', ''].slice(0, 4)
    setForm({ id: q.id, difficulty: q.difficulty, question: q.question, options, correct: q.correct_index, reference: q.reference ?? '' })
    setOpen(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function remove(q: QuizQuestion) {
    if (!confirm('¿Eliminar esta pregunta del banco?')) return
    const { error } = await supabase.from('quiz_questions').delete().eq('id', q.id)
    if (error) return setError(errorMessage(error))
    load()
  }

  const visible = (items ?? []).filter((i) => filter === 'all' || i.difficulty === filter)

  return (
    <div className="space-y-5">
      <div className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl font-bold">Selección múltiple</h2>
            <p className="text-sm text-indigo-200">
              20 segundos por pregunta. Correcta = {QUIZ_BASE.facil} (fácil) · {QUIZ_BASE.intermedio} (intermedio) · {QUIZ_BASE.dificil} (difícil)
              + 1 punto extra por cada segundo que sobre.
            </p>
          </div>
          {!open && <button className="btn-primary" onClick={() => { setForm(EMPTY); setOpen(true) }}>+ Agregar</button>}
        </div>

        {open && (
          <form onSubmit={save} className="mt-5 grid gap-4">
            <div>
              <label className="label" htmlFor="question">Pregunta</label>
              <textarea id="question" className="input min-h-20" value={form.question} onChange={(e) => setForm({ ...form, question: e.target.value })} required />
            </div>
            <fieldset>
              <legend className="label">Opciones — marca la correcta</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {form.options.map((opt, i) => (
                  <label key={i} className={`flex items-center gap-2 rounded-2xl p-2 ${form.correct === i ? 'bg-emerald-500/25 ring-2 ring-emerald-300' : 'bg-white/5'}`}>
                    <input type="radio" name="correct" checked={form.correct === i} onChange={() => setForm({ ...form, correct: i })} className="h-5 w-5 accent-emerald-400" />
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${OPTION_STYLES[i].bg}`}>{OPTION_STYLES[i].shape}</span>
                    <input
                      className="input py-2"
                      value={opt}
                      placeholder={`Opción ${i + 1}`}
                      onChange={(e) => {
                        const options = [...form.options]
                        options[i] = e.target.value
                        setForm({ ...form, options })
                      }}
                      required
                    />
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="qdiff">Nivel</label>
                <select id="qdiff" className="input" value={form.difficulty} onChange={(e) => setForm({ ...form, difficulty: e.target.value as Difficulty })}>
                  {DIFFICULTIES.map((d) => <option key={d} value={d}>{DIFFICULTY_LABEL[d]}</option>)}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="qref">Cita bíblica (opcional)</label>
                <input id="qref" className="input" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
              </div>
            </div>
            <ErrorBox>{error}</ErrorBox>
            <div className="flex gap-2">
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
          {visible.map((q) => (
            <li key={q.id} className="card p-4">
              <div className="flex items-center justify-between">
                <DifficultyChip difficulty={q.difficulty} />
                <div className="flex">
                  <button className="btn-ghost px-2 py-1" onClick={() => edit(q)} aria-label="Editar">✏️</button>
                  <button className="btn-ghost px-2 py-1" onClick={() => remove(q)} aria-label="Eliminar">🗑️</button>
                </div>
              </div>
              <p className="mt-2 font-bold">{q.question}</p>
              <ul className="mt-2 grid grid-cols-2 gap-1 text-sm">
                {q.options.map((o, i) => (
                  <li key={i} className={`rounded-lg px-2 py-1 ${i === q.correct_index ? 'bg-emerald-500/30 font-bold text-emerald-100' : 'bg-white/5 text-indigo-200'}`}>
                    {i === q.correct_index ? '✓ ' : ''}{o}
                  </li>
                ))}
              </ul>
              {q.reference && <div className="mt-2 text-xs text-indigo-300">📖 {q.reference}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
