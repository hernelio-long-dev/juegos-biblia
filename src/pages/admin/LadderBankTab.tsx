import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { ErrorBox, Spinner } from '../../components/ui'
import { ladderPoints } from '../../lib/scoring'
import { errorMessage, supabase } from '../../lib/supabase'
import {
  BIBLE_BOOKS, LADDER_CHECKPOINTS, LADDER_TIER_LABEL, LADDER_TIER_SECONDS, OPTION_STYLES,
  type LadderAnswerType, type LadderChallenge,
} from '../../lib/types'

const TYPE_LABEL: Record<LadderAnswerType, string> = {
  text: 'Respuesta escrita',
  choice: 'Opción múltiple',
  reference: 'Referencia bíblica',
}

const KINDS = ['Personaje', 'Acertijo', 'Código', 'Palabra desordenada', 'Completa la frase', 'Pregunta', 'Ordenar', 'Lugar', 'Referencia', 'Varios pasos']

const EMPTY = {
  id: '', tier: 1, kind: 'Personaje', prompt: '', hint: '', answer_type: 'text' as LadderAnswerType,
  answer: '', aliases: '', options: ['', '', '', ''], correct: 0,
  verse_book: 'Génesis', verse_chapter: '1', verse_from: '1', verse_to: '',
}

export default function LadderBankTab() {
  const [items, setItems] = useState<LadderChallenge[] | null>(null)
  const [tier, setTier] = useState<number | 0>(0)
  const [form, setForm] = useState(EMPTY)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('ladder_challenges').select('*').order('tier').order('created_at')
    if (error) return setError(errorMessage(error))
    setItems(data as LadderChallenge[])
  }, [])
  useEffect(() => { load() }, [load])

  async function save(e: FormEvent) {
    e.preventDefault()
    const base = {
      tier: form.tier, kind: form.kind.trim() || 'Pregunta', prompt: form.prompt.trim(), hint: form.hint.trim() || null,
      answer_type: form.answer_type, aliases: [] as string[], options: null as string[] | null, correct_index: null as number | null,
      verse_book: null as string | null, verse_chapter: null as number | null, verse_from: null as number | null, verse_to: null as number | null,
      answer: form.answer.trim(),
    }
    if (form.answer_type === 'text') {
      base.aliases = form.aliases.split(',').map((s) => s.trim()).filter(Boolean)
    } else if (form.answer_type === 'choice') {
      const options = form.options.map((o) => o.trim())
      if (options.some((o) => !o)) return setError('Completa las 4 opciones.')
      base.options = options
      base.correct_index = form.correct
      base.answer = options[form.correct]
    } else {
      const ch = Number(form.verse_chapter), from = Number(form.verse_from)
      const to = form.verse_to.trim() ? Number(form.verse_to) : null
      if (!ch || !from) return setError('Indica el capítulo y el versículo.')
      if (to !== null && to < from) return setError('El versículo final no puede ser menor que el inicial.')
      Object.assign(base, { verse_book: form.verse_book, verse_chapter: ch, verse_from: from, verse_to: to })
      base.answer = `${form.verse_book} ${ch}:${from}${to ? `-${to}` : ''}`
    }
    if (!base.answer) return setError('Escribe la respuesta.')
    setBusy(true)
    setError('')
    const { error } = form.id
      ? await supabase.from('ladder_challenges').update(base).eq('id', form.id)
      : await supabase.from('ladder_challenges').insert(base)
    setBusy(false)
    if (error) return setError(errorMessage(error))
    setForm({ ...EMPTY, tier: form.tier })
    setOpen(false)
    load()
  }

  function edit(it: LadderChallenge) {
    setForm({
      id: it.id, tier: it.tier, kind: it.kind, prompt: it.prompt, hint: it.hint ?? '', answer_type: it.answer_type,
      answer: it.answer_type === 'text' ? it.answer : '', aliases: it.aliases.join(', '),
      options: it.options ?? ['', '', '', ''], correct: it.correct_index ?? 0,
      verse_book: it.verse_book ?? 'Génesis', verse_chapter: String(it.verse_chapter ?? 1),
      verse_from: String(it.verse_from ?? 1), verse_to: it.verse_to ? String(it.verse_to) : '',
    })
    setOpen(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function remove(it: LadderChallenge) {
    if (!confirm(`¿Eliminar este desafío?\n\n${it.prompt}`)) return
    const { error } = await supabase.from('ladder_challenges').delete().eq('id', it.id)
    if (error) return setError(errorMessage(error))
    load()
  }

  const visible = (items ?? []).filter((i) => !tier || i.tier === tier)
  const set = (patch: Partial<typeof EMPTY>) => setForm({ ...form, ...patch })

  return (
    <div className="space-y-5">
      <div className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl font-bold">🪜 Escalera bíblica</h2>
            <p className="text-sm text-indigo-200">
              Individual, 20 niveles y 3 salvavidas. Cada nivel toma al azar un desafío de su tramo que esa persona no
              haya visto, así que conviene tener al menos 10 por tramo. Checkpoints en {LADDER_CHECKPOINTS.join(', ')}.
              Puntos del campeonato: nivel 5 → {ladderPoints(5)} · 10 → {ladderPoints(10)} · 15 → {ladderPoints(15)} · cima → {ladderPoints(20)}.
            </p>
          </div>
          {!open && <button className="btn-primary" onClick={() => { setForm(EMPTY); setOpen(true) }}>+ Agregar</button>}
        </div>

        {open && (
          <form onSubmit={save} className="mt-5 grid gap-4 sm:grid-cols-3">
            <div>
              <label className="label" htmlFor="ltier">Tramo</label>
              <select id="ltier" className="input" value={form.tier} onChange={(e) => set({ tier: Number(e.target.value) })}>
                {[1, 2, 3, 4].map((t) => <option key={t} value={t}>{LADDER_TIER_LABEL[t]} · {LADDER_TIER_SECONDS[t]} s</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="lkind">Tipo de reto</label>
              <input id="lkind" className="input" list="ladder-kinds" value={form.kind} onChange={(e) => set({ kind: e.target.value })} required />
              <datalist id="ladder-kinds">{KINDS.map((k) => <option key={k} value={k} />)}</datalist>
            </div>
            <div>
              <label className="label" htmlFor="ltype">Cómo se responde</label>
              <select id="ltype" className="input" value={form.answer_type} onChange={(e) => set({ answer_type: e.target.value as LadderAnswerType })}>
                {(Object.keys(TYPE_LABEL) as LadderAnswerType[]).map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
              </select>
            </div>
            <div className="sm:col-span-3">
              <label className="label" htmlFor="lprompt">Desafío</label>
              <textarea id="lprompt" className="input min-h-20 text-lg" value={form.prompt} onChange={(e) => set({ prompt: e.target.value })} required
                placeholder="«Derroté a un gigante con una honda y una piedra.» ¿Quién soy?" />
            </div>
            <div className="sm:col-span-3">
              <label className="label" htmlFor="lhint">Pista (opcional)</label>
              <input id="lhint" className="input" value={form.hint} onChange={(e) => set({ hint: e.target.value })} placeholder="A = 1, B = 2, C = 3…" />
            </div>

            {form.answer_type === 'text' && (
              <>
                <div>
                  <label className="label" htmlFor="lans">Respuesta</label>
                  <input id="lans" className="input" value={form.answer} onChange={(e) => set({ answer: e.target.value })} required />
                </div>
                <div className="sm:col-span-2">
                  <label className="label" htmlFor="lali">Otras respuestas válidas (separadas por coma)</label>
                  <input id="lali" className="input" value={form.aliases} onChange={(e) => set({ aliases: e.target.value })} />
                  <p className="mt-1 text-xs text-indigo-300">Se ignoran tildes y errores leves. Mejor respuestas cortas: un nombre, un lugar o un número.</p>
                </div>
              </>
            )}
            {form.answer_type === 'choice' && (
              <div className="grid gap-2 sm:col-span-3 sm:grid-cols-2">
                {form.options.map((o, i) => (
                  <label key={i} className={`flex items-center gap-2 rounded-2xl p-2 ${form.correct === i ? 'bg-emerald-500/20 ring-2 ring-emerald-400' : 'bg-white/5'}`}>
                    <input type="radio" name="lcorrect" className="h-4 w-4 accent-emerald-400" checked={form.correct === i} onChange={() => set({ correct: i })} />
                    <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${OPTION_STYLES[i].bg}`}>{OPTION_STYLES[i].shape}</span>
                    <input className="input py-2" value={o} placeholder={`Opción ${i + 1}`} aria-label={`Opción ${i + 1}`}
                      onChange={(e) => set({ options: form.options.map((x, j) => (j === i ? e.target.value : x)) })} />
                  </label>
                ))}
                <p className="text-xs text-indigo-300 sm:col-span-2">Marca la opción correcta.</p>
              </div>
            )}
            {form.answer_type === 'reference' && (
              <>
                <div>
                  <label className="label" htmlFor="lbook">Libro</label>
                  <select id="lbook" className="input" value={form.verse_book} onChange={(e) => set({ verse_book: e.target.value })}>
                    {BIBLE_BOOKS.map((b) => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-3 gap-2 sm:col-span-2">
                  <div><label className="label" htmlFor="lch">Capítulo</label>
                    <input id="lch" className="input" type="number" min={1} value={form.verse_chapter} onChange={(e) => set({ verse_chapter: e.target.value })} required /></div>
                  <div><label className="label" htmlFor="lfrom">Versículo</label>
                    <input id="lfrom" className="input" type="number" min={1} value={form.verse_from} onChange={(e) => set({ verse_from: e.target.value })} required /></div>
                  <div><label className="label" htmlFor="lto">Hasta (opcional)</label>
                    <input id="lto" className="input" type="number" min={1} value={form.verse_to} onChange={(e) => set({ verse_to: e.target.value })} /></div>
                </div>
              </>
            )}

            <div className="sm:col-span-3"><ErrorBox>{error}</ErrorBox></div>
            <div className="flex gap-2 sm:col-span-3">
              <button className="btn-primary flex-1" disabled={busy}>{busy ? 'Guardando…' : form.id ? 'Guardar cambios' : 'Agregar al banco'}</button>
              <button type="button" className="btn-secondary" onClick={() => { setOpen(false); setForm(EMPTY); setError('') }}>Cancelar</button>
            </div>
          </form>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {[0, 1, 2, 3, 4].map((t) => (
          <button key={t} onClick={() => setTier(t)}
            className={`btn px-4 py-2 text-sm ${tier === t ? 'bg-white text-indigo-950' : 'bg-white/10 hover:bg-white/20'}`}>
            {t === 0 ? 'Todos' : LADDER_TIER_LABEL[t]} <span className="opacity-60">{(items ?? []).filter((i) => !t || i.tier === t).length}</span>
          </button>
        ))}
      </div>
      {!open && <ErrorBox>{error}</ErrorBox>}

      {!items ? <Spinner /> : (
        <ul className="grid gap-3 md:grid-cols-2">
          {visible.map((it) => (
            <li key={it.id} className="card flex flex-col p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="chip bg-white/10 text-xs">{LADDER_TIER_LABEL[it.tier]}</span>
                <span className="chip bg-indigo-500/30 text-xs">{it.kind}</span>
                <span className="text-xs text-indigo-300">{TYPE_LABEL[it.answer_type]}</span>
                <div className="ml-auto flex">
                  <button className="btn-ghost px-2 py-1" onClick={() => edit(it)} aria-label="Editar">✏️</button>
                  <button className="btn-ghost px-2 py-1" onClick={() => remove(it)} aria-label="Eliminar">🗑️</button>
                </div>
              </div>
              <p className="mt-2 font-bold">{it.prompt}</p>
              {it.hint && <p className="text-xs text-indigo-300">💡 {it.hint}</p>}
              <p className="mt-2 font-display text-lg font-bold text-amber-200">✓ {it.answer}</p>
              {it.aliases.length > 0 && <p className="text-xs text-indigo-300">También: {it.aliases.join(', ')}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
