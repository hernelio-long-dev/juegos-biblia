import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { DifficultyChip, ErrorBox, Spinner } from '../../components/ui'
import { cipherMaxPoints } from '../../lib/scoring'
import { errorMessage, supabase } from '../../lib/supabase'
import {
  BIBLE_BOOKS, CIPHER_KIND_LABEL, CIPHER_KINDS, CIPHER_SECONDS, DIFFICULTIES, DIFFICULTY_LABEL,
  VERSE_SECONDS, type CipherItem, type CipherKind, type Difficulty,
} from '../../lib/types'
import { DifficultyFilter } from './QuizBankTab'

const EMPTY = {
  id: '', difficulty: 'facil' as Difficulty, kind: 'numeros' as CipherKind,
  puzzle: '', hint: '', answer: '', aliases: '',
  verse_prompt: '', verse_book: 'Génesis', verse_chapter: '1', verse_from: '1', verse_to: '',
}

const PLACEHOLDER: Record<CipherKind, { puzzle: string; hint: string }> = {
  numeros: { puzzle: '10 - 15 - 14 - 1 - 19', hint: 'A = 1, B = 2, C = 3… hasta Z = 26' },
  reverso: { puzzle: 'SESIOM', hint: 'Léelo de derecha a izquierda.' },
  anagrama: { puzzle: 'NADA', hint: 'Son las mismas letras, en otro orden.' },
  desplazado: { puzzle: 'FMJBT', hint: 'Cada letra está una posición adelante. Retrocede una.' },
  sin_vocales: { puzzle: 'P _ B L _', hint: 'Le faltan las vocales.' },
  acertijo: { puzzle: '«Mis hermanos me vendieron y terminé en Egipto.»', hint: 'Piensa en el Génesis.' },
  frase: { puzzle: 'TIERRA · LA · Y · LOS · CREÓ · DIOS · CIELOS · EN · EL · PRINCIPIO', hint: 'Ordena las palabras.' },
}

export default function CipherBankTab() {
  const [items, setItems] = useState<CipherItem[] | null>(null)
  const [filter, setFilter] = useState<Difficulty | 'all'>('all')
  const [form, setForm] = useState(EMPTY)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('cipher_items').select('*').order('difficulty').order('answer')
    if (error) return setError(errorMessage(error))
    setItems(data as CipherItem[])
  }, [])
  useEffect(() => { load() }, [load])

  async function save(e: FormEvent) {
    e.preventDefault()
    const chapter = Number(form.verse_chapter)
    const from = Number(form.verse_from)
    const to = form.verse_to.trim() ? Number(form.verse_to) : null
    if (!chapter || !from) return setError('Indica el capítulo y el versículo de la confirmación bíblica.')
    if (to !== null && to < from) return setError('El versículo final no puede ser menor que el inicial.')
    setBusy(true)
    setError('')
    const row = {
      difficulty: form.difficulty,
      kind: form.kind,
      puzzle: form.puzzle.trim(),
      hint: form.hint.trim() || null,
      answer: form.answer.trim(),
      aliases: form.aliases.split(',').map((s) => s.trim()).filter(Boolean),
      verse_prompt: form.verse_prompt.trim(),
      verse_book: form.verse_book,
      verse_chapter: chapter,
      verse_from: from,
      verse_to: to,
    }
    const { error } = form.id
      ? await supabase.from('cipher_items').update(row).eq('id', form.id)
      : await supabase.from('cipher_items').insert(row)
    setBusy(false)
    if (error) return setError(errorMessage(error))
    setForm(EMPTY)
    setOpen(false)
    load()
  }

  function edit(it: CipherItem) {
    setForm({
      id: it.id, difficulty: it.difficulty, kind: it.kind, puzzle: it.puzzle, hint: it.hint ?? '',
      answer: it.answer, aliases: it.aliases.join(', '), verse_prompt: it.verse_prompt,
      verse_book: it.verse_book, verse_chapter: String(it.verse_chapter),
      verse_from: String(it.verse_from), verse_to: it.verse_to ? String(it.verse_to) : '',
    })
    setOpen(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function remove(it: CipherItem) {
    if (!confirm(`¿Eliminar el código de "${it.answer}" del banco?`)) return
    const { error } = await supabase.from('cipher_items').delete().eq('id', it.id)
    if (error) return setError(errorMessage(error))
    load()
  }

  const visible = (items ?? []).filter((i) => filter === 'all' || i.difficulty === filter)
  const ref = (it: CipherItem) =>
    `${it.verse_book} ${it.verse_chapter}:${it.verse_from}${it.verse_to ? `-${it.verse_to}` : ''}`

  return (
    <div className="space-y-5">
      <div className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl font-bold">Código secreto bíblico</h2>
            <p className="text-sm text-indigo-200">
              Individual y en dos fases: {CIPHER_SECONDS} s para descifrar el código y, al acertar,
              otros {VERSE_SECONDS} s (reloj propio de cada uno) para encontrar el versículo.
              Máximo por ronda: {cipherMaxPoints('facil')} fácil · {cipherMaxPoints('intermedio')} intermedio
              · {cipherMaxPoints('dificil')} difícil. Se recomiendan unas 10 rondas.
            </p>
          </div>
          {!open && <button className="btn-primary" onClick={() => { setForm(EMPTY); setOpen(true) }}>+ Agregar</button>}
        </div>

        {open && (
          <form onSubmit={save} className="mt-5 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="kind">Tipo de código</label>
              <select id="kind" className="input" value={form.kind}
                onChange={(e) => setForm({ ...form, kind: e.target.value as CipherKind })}>
                {CIPHER_KINDS.map((k) => <option key={k} value={k}>{CIPHER_KIND_LABEL[k]}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="cdiff">Nivel</label>
              <select id="cdiff" className="input" value={form.difficulty}
                onChange={(e) => setForm({ ...form, difficulty: e.target.value as Difficulty })}>
                {DIFFICULTIES.map((d) => <option key={d} value={d}>{DIFFICULTY_LABEL[d]}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="label" htmlFor="puzzle">Código que se muestra</label>
              <input id="puzzle" className="input text-lg" placeholder={PLACEHOLDER[form.kind].puzzle}
                value={form.puzzle} onChange={(e) => setForm({ ...form, puzzle: e.target.value })} required />
            </div>
            <div className="sm:col-span-2">
              <label className="label" htmlFor="hint">Pista (opcional pero recomendada)</label>
              <input id="hint" className="input" placeholder={PLACEHOLDER[form.kind].hint}
                value={form.hint} onChange={(e) => setForm({ ...form, hint: e.target.value })} />
            </div>
            <div>
              <label className="label" htmlFor="canswer">Respuesta del código</label>
              <input id="canswer" className="input" placeholder="Jonás" value={form.answer}
                onChange={(e) => setForm({ ...form, answer: e.target.value })} required />
            </div>
            <div>
              <label className="label" htmlFor="caliases">Otras respuestas válidas (coma)</label>
              <input id="caliases" className="input" placeholder="jonas" value={form.aliases}
                onChange={(e) => setForm({ ...form, aliases: e.target.value })} />
            </div>

            <fieldset className="rounded-2xl bg-white/5 p-4 sm:col-span-2">
              <legend className="label px-1">📖 Confirmación bíblica</legend>
              <label className="label" htmlFor="vprompt">Consigna (solo la ve quien ya descifró)</label>
              <textarea id="vprompt" className="input min-h-16"
                placeholder="Encuentra el versículo donde Jehová prepara un gran pez para que se trague a Jonás."
                value={form.verse_prompt} onChange={(e) => setForm({ ...form, verse_prompt: e.target.value })} required />
              <div className="mt-3 grid gap-3 sm:grid-cols-4">
                <div className="sm:col-span-2">
                  <label className="label" htmlFor="vbook">Libro</label>
                  <select id="vbook" className="input" value={form.verse_book}
                    onChange={(e) => setForm({ ...form, verse_book: e.target.value })}>
                    {BIBLE_BOOKS.map((b) => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="vchap">Capítulo</label>
                  <input id="vchap" className="input" type="number" min={1} value={form.verse_chapter}
                    onChange={(e) => setForm({ ...form, verse_chapter: e.target.value })} required />
                </div>
                <div>
                  <label className="label" htmlFor="vfrom">Versículo</label>
                  <input id="vfrom" className="input" type="number" min={1} value={form.verse_from}
                    onChange={(e) => setForm({ ...form, verse_from: e.target.value })} required />
                </div>
              </div>
              <div className="mt-3">
                <label className="label" htmlFor="vto">Hasta el versículo (opcional, para aceptar un rango)</label>
                <input id="vto" className="input sm:w-40" type="number" min={1} placeholder="—" value={form.verse_to}
                  onChange={(e) => setForm({ ...form, verse_to: e.target.value })} />
              </div>
            </fieldset>

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
        <ul className="grid gap-3 sm:grid-cols-2">
          {visible.map((it) => (
            <li key={it.id} className="card flex flex-col p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex flex-wrap gap-1.5">
                  <DifficultyChip difficulty={it.difficulty} />
                  <span className="chip bg-white/10 text-indigo-200">{CIPHER_KIND_LABEL[it.kind]}</span>
                </div>
                <div className="flex shrink-0">
                  <button className="btn-ghost px-2 py-1" onClick={() => edit(it)} aria-label="Editar">✏️</button>
                  <button className="btn-ghost px-2 py-1" onClick={() => remove(it)} aria-label="Eliminar">🗑️</button>
                </div>
              </div>
              <div className="mt-3 break-words font-display text-xl font-bold text-amber-200">{it.puzzle}</div>
              {it.hint && <div className="mt-1 text-xs text-indigo-300">💡 {it.hint}</div>}
              <div className="mt-3 border-t border-white/10 pt-2">
                <div className="font-bold">→ {it.answer}</div>
                {it.aliases.length > 0 && <div className="text-xs text-indigo-300">También: {it.aliases.join(', ')}</div>}
              </div>
              <div className="mt-2 text-sm text-indigo-200">{it.verse_prompt}</div>
              <div className="mt-auto pt-2 text-xs font-bold text-emerald-200">📖 {ref(it)}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
