import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { DifficultyChip, ErrorBox, Spinner } from '../../components/ui'
import { errorMessage, supabase } from '../../lib/supabase'
import {
  AUCTION_CATEGORIES, AUCTION_MAX_BID, AUCTION_MIN_BID, AUCTION_START_BALANCE, DIFFICULTIES, DIFFICULTY_LABEL,
  type AuctionQuestion, type Difficulty,
} from '../../lib/types'
import { DifficultyFilter } from './QuizBankTab'

const EMPTY = {
  id: '', category: AUCTION_CATEGORIES[0], difficulty: 'facil' as Difficulty,
  question: '', answer: '', aliases: '', reference: '',
}

export default function AuctionBankTab() {
  const [items, setItems] = useState<AuctionQuestion[] | null>(null)
  const [filter, setFilter] = useState<Difficulty | 'all'>('all')
  const [category, setCategory] = useState('')
  const [form, setForm] = useState(EMPTY)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('auction_questions').select('*').order('category').order('difficulty')
    if (error) return setError(errorMessage(error))
    setItems(data as AuctionQuestion[])
  }, [])
  useEffect(() => { load() }, [load])

  async function save(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const row = {
      category: form.category.trim(),
      difficulty: form.difficulty,
      question: form.question.trim(),
      answer: form.answer.trim(),
      aliases: form.aliases.split(',').map((s) => s.trim()).filter(Boolean),
      reference: form.reference.trim() || null,
    }
    const { error } = form.id
      ? await supabase.from('auction_questions').update(row).eq('id', form.id)
      : await supabase.from('auction_questions').insert(row)
    setBusy(false)
    if (error) return setError(errorMessage(error))
    setForm({ ...EMPTY, category: row.category, difficulty: row.difficulty })
    setOpen(false)
    load()
  }

  function edit(it: AuctionQuestion) {
    setForm({
      id: it.id, category: it.category, difficulty: it.difficulty, question: it.question,
      answer: it.answer, aliases: it.aliases.join(', '), reference: it.reference ?? '',
    })
    setOpen(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function remove(it: AuctionQuestion) {
    if (!confirm(`¿Eliminar "${it.question}" del banco?`)) return
    const { error } = await supabase.from('auction_questions').delete().eq('id', it.id)
    if (error) return setError(errorMessage(error))
    load()
  }

  const categories = [...new Set([...AUCTION_CATEGORIES, ...(items ?? []).map((i) => i.category)])].sort((a, b) => a.localeCompare(b, 'es'))
  const inCategory = (items ?? []).filter((i) => !category || i.category === category)
  const visible = inCategory.filter((i) => filter === 'all' || i.difficulty === filter)

  return (
    <div className="space-y-5">
      <div className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl font-bold">🔨 Subasta bíblica</h2>
            <p className="text-sm text-indigo-200">
              Por equipos de 3 o 4. Antes de ver la pregunta, cada equipo solo conoce la <b>categoría</b> y el nivel,
              y apuesta de {AUCTION_MIN_BID} a {AUCTION_MAX_BID} de su saldo (todos empiezan con {AUCTION_START_BALANCE}).
              Acertar paga lo apostado ×1, ×1.5 o ×2 según el nivel; fallar lo resta. Al final, lo que cada equipo ganó
              por encima del saldo inicial se suma a <b>cada</b> integrante.
            </p>
          </div>
          {!open && <button className="btn-primary" onClick={() => { setForm(EMPTY); setOpen(true) }}>+ Agregar</button>}
        </div>

        {open && (
          <form onSubmit={save} className="mt-5 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="acat">Categoría</label>
              <input id="acat" className="input" list="auction-categories" value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })} maxLength={60} required />
              <datalist id="auction-categories">
                {categories.map((c) => <option key={c} value={c} />)}
              </datalist>
              <p className="mt-1 text-xs text-indigo-300">Elige una de la lista o escribe una nueva.</p>
            </div>
            <div>
              <label className="label" htmlFor="adiff">Nivel</label>
              <select id="adiff" className="input" value={form.difficulty} onChange={(e) => setForm({ ...form, difficulty: e.target.value as Difficulty })}>
                {DIFFICULTIES.map((d) => <option key={d} value={d}>{DIFFICULTY_LABEL[d]}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="label" htmlFor="aq">Pregunta</label>
              <input id="aq" className="input text-lg" placeholder="¿Qué rey pidió a Dios sabiduría para gobernar al pueblo?"
                value={form.question} onChange={(e) => setForm({ ...form, question: e.target.value })} required />
            </div>
            <div>
              <label className="label" htmlFor="aans">Respuesta</label>
              <input id="aans" className="input" placeholder="Salomón" value={form.answer}
                onChange={(e) => setForm({ ...form, answer: e.target.value })} required />
            </div>
            <div>
              <label className="label" htmlFor="aali">Otras respuestas válidas (separadas por coma)</label>
              <input id="aali" className="input" placeholder="rey salomón" value={form.aliases}
                onChange={(e) => setForm({ ...form, aliases: e.target.value })} />
            </div>
            <p className="-mt-2 text-xs text-indigo-300 sm:col-span-2">
              Se ignoran tildes, mayúsculas y errores leves. Pide respuestas cortas: un nombre, un lugar o un número.
            </p>
            <div className="sm:col-span-2">
              <label className="label" htmlFor="aref">Cita bíblica (opcional)</label>
              <input id="aref" className="input" placeholder="1 Reyes 3:9" value={form.reference}
                onChange={(e) => setForm({ ...form, reference: e.target.value })} />
            </div>
            <div className="sm:col-span-2"><ErrorBox>{error}</ErrorBox></div>
            <div className="flex gap-2 sm:col-span-2">
              <button className="btn-primary flex-1" disabled={busy}>{busy ? 'Guardando…' : form.id ? 'Guardar cambios' : 'Agregar al banco'}</button>
              <button type="button" className="btn-secondary" onClick={() => { setOpen(false); setForm(EMPTY); setError('') }}>Cancelar</button>
            </div>
          </form>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <DifficultyFilter value={filter} onChange={setFilter} counts={inCategory} />
        <select className="input ml-auto w-auto py-2 text-sm" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Filtrar por categoría">
          <option value="">Todas las categorías</option>
          {categories.map((c) => (
            <option key={c} value={c}>{c} ({(items ?? []).filter((i) => i.category === c).length})</option>
          ))}
        </select>
      </div>
      {!open && <ErrorBox>{error}</ErrorBox>}

      {!items ? <Spinner /> : (
        <ul className="grid gap-3 md:grid-cols-2">
          {visible.map((it) => (
            <li key={it.id} className="card flex flex-col p-4">
              <div className="flex items-center gap-2">
                <span className="chip bg-white/10 text-xs">{it.category}</span>
                <DifficultyChip difficulty={it.difficulty} />
                <div className="ml-auto flex">
                  <button className="btn-ghost px-2 py-1" onClick={() => edit(it)} aria-label="Editar">✏️</button>
                  <button className="btn-ghost px-2 py-1" onClick={() => remove(it)} aria-label="Eliminar">🗑️</button>
                </div>
              </div>
              <p className="mt-2 font-bold">{it.question}</p>
              <p className="mt-1 font-display text-lg font-bold text-amber-200">{it.answer}</p>
              {it.aliases.length > 0 && <p className="text-xs text-indigo-300">También: {it.aliases.join(', ')}</p>}
              {it.reference && <div className="mt-auto pt-2 text-xs text-indigo-300">📖 {it.reference}</div>}
            </li>
          ))}
          {visible.length === 0 && <li className="card p-8 text-center text-indigo-200 md:col-span-2">No hay preguntas con ese filtro.</li>}
        </ul>
      )}
    </div>
  )
}
