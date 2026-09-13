import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { Brand, ErrorBox, Spinner } from '../components/ui'
import { clearPlayerSession, getPlayerSession, setPlayerSession } from '../lib/player'
import { errorMessage, playerClient, requestTimeout } from '../lib/supabase'

interface LookupResult {
  id: string
  name: string
  participants: { id: string; name: string; taken: boolean }[]
}

export default function Home() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [digits, setDigits] = useState<string[]>(() => {
    const c = (params.get('codigo') ?? '').replace(/\D/g, '').slice(0, 4)
    return [0, 1, 2, 3].map((i) => c[i] ?? '')
  })
  const [room, setRoom] = useState<LookupResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [chosen, setChosen] = useState<{ id: string; name: string } | null>(null)
  const [existing, setExisting] = useState<{ roomName: string; name: string } | null>(null)
  const inputs = useRef<(HTMLInputElement | null)[]>([])
  const code = digits.join('')

  // ¿Ya estaba jugando en este dispositivo?
  useEffect(() => {
    const s = getPlayerSession()
    if (!s) return
    playerClient.rpc('player_state', { p_token: s.token }).abortSignal(requestTimeout()).then(({ data }) => {
      if (data && data.room.status === 'open') setExisting({ roomName: data.room.name, name: data.me.name })
      else if (!data) clearPlayerSession()
    })
  }, [])

  async function lookup(c = code) {
    if (c.length !== 4) return
    setLoading(true)
    setError('')
    const { data, error } = await playerClient.rpc('lookup_room', { p_code: c }).abortSignal(requestTimeout())
    setLoading(false)
    if (error) return setError(errorMessage(error))
    if (!data) return setError('No encontramos una sala abierta con ese código.')
    setRoom(data as LookupResult)
  }

  useEffect(() => {
    if (code.length === 4 && params.get('codigo')) lookup(code)
  }, [])

  function setDigit(i: number, value: string) {
    const clean = value.replace(/\D/g, '')
    if (clean.length > 1) {
      // pegado
      const next = clean.slice(0, 4).split('')
      const filled = [0, 1, 2, 3].map((k) => next[k] ?? '')
      setDigits(filled)
      inputs.current[Math.min(next.length, 3)]?.focus()
      if (next.length >= 4) lookup(filled.join(''))
      return
    }
    const next = [...digits]
    next[i] = clean
    setDigits(next)
    if (clean && i < 3) inputs.current[i + 1]?.focus()
    if (clean && i === 3 && next.join('').length === 4) lookup(next.join(''))
  }

  async function join() {
    if (!room || !chosen) return
    setLoading(true)
    setError('')
    const { data, error } = await playerClient.rpc('join_room', { p_code: code, p_participant: chosen.id })
    setLoading(false)
    if (error) {
      setChosen(null)
      lookup()
      return setError(errorMessage(error))
    }
    setPlayerSession({ token: data.token, roomId: data.room_id, code })
    navigate('/jugar')
  }

  const filtered = useMemo(() => {
    if (!room) return []
    const q = search.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    return room.participants.filter((p) =>
      p.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(q))
  }, [room, search])

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pb-8 pt-[max(1.5rem,env(safe-area-inset-top))]">
      <header className="mb-8"><Brand /></header>

      {existing && !room && (
        <div className="card mb-6 animate-rise p-5">
          <p className="text-indigo-100">
            Ya estás en <b>{existing.roomName}</b> como <b>{existing.name}</b>.
          </p>
          <button className="btn-primary mt-4 w-full" onClick={() => navigate('/jugar')}>Volver a la sala</button>
        </div>
      )}

      {!room ? (
        <section className="card animate-rise p-6">
          <h1 className="font-display text-3xl font-bold">Entrar a una sala</h1>
          <p className="mt-1 text-indigo-200">Escribe el código de 4 dígitos que aparece en la pantalla.</p>
          <form
            className="mt-6"
            onSubmit={(e) => { e.preventDefault(); lookup() }}
          >
            <div className="flex justify-between gap-3">
              {digits.map((d, i) => (
                <input
                  key={i}
                  ref={(el) => { inputs.current[i] = el }}
                  value={d}
                  onChange={(e) => setDigit(i, e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Backspace' && !d && i > 0) inputs.current[i - 1]?.focus() }}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  aria-label={`Dígito ${i + 1}`}
                  className="h-20 w-full rounded-2xl border-2 border-white/15 bg-white/10 text-center font-display text-4xl font-bold outline-none focus:border-amber-300"
                  autoFocus={i === 0}
                />
              ))}
            </div>
            <div className="mt-4"><ErrorBox>{error}</ErrorBox></div>
            <button className="btn-primary mt-4 w-full py-4 text-lg" disabled={code.length !== 4 || loading}>
              {loading ? 'Buscando…' : 'Continuar'}
            </button>
          </form>
        </section>
      ) : (
        <section className="card flex min-h-0 flex-1 animate-rise flex-col p-6">
          <button className="btn-ghost -ml-3 self-start px-3 py-1 text-sm" onClick={() => { setRoom(null); setChosen(null); setError('') }}>
            ← Cambiar código
          </button>
          <h1 className="mt-2 font-display text-3xl font-bold">{room.name}</h1>
          <p className="text-indigo-200">¿Quién eres? Toca tu nombre.</p>
          <input className="input mt-4" placeholder="Buscar mi nombre…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="mt-3"><ErrorBox>{error}</ErrorBox></div>
          {loading && !chosen ? <Spinner /> : (
            <ul className="mt-3 grid max-h-[50dvh] gap-2 overflow-y-auto pr-1">
              {filtered.map((p) => (
                <li key={p.id}>
                  <button
                    disabled={p.taken}
                    onClick={() => setChosen(p)}
                    aria-pressed={chosen?.id === p.id}
                    className={`btn w-full justify-between text-left text-lg ${chosen?.id === p.id ? 'bg-white/15 ring-2 ring-amber-300' : 'bg-white/10 hover:bg-white/20'}`}
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-sm ${chosen?.id === p.id ? 'border-amber-300 bg-amber-300 text-indigo-950' : 'border-white/30'}`}>
                        {chosen?.id === p.id ? '✓' : ''}
                      </span>
                      <span className="truncate">{p.name}</span>
                    </span>
                    {p.taken && <span className="text-xs font-semibold">ya ingresó</span>}
                  </button>
                </li>
              ))}
              {filtered.length === 0 && (
                <li className="py-6 text-center text-indigo-200">
                  No aparece tu nombre. Pídele al administrador que te registre.
                </li>
              )}
            </ul>
          )}
          {chosen && (
            <div className="mt-auto animate-rise border-t border-white/10 pt-4">
              <p className="mb-2 text-center text-sm text-indigo-200">¿Confirmas que eres <b className="text-white">{chosen.name}</b>?</p>
              <button className="btn-primary w-full py-4 text-lg" onClick={join} disabled={loading}>
                {loading ? 'Entrando…' : 'Entrar a la sala →'}
              </button>
            </div>
          )}
        </section>
      )}

      <footer className="mt-auto pt-8 text-center">
        <Link to="/admin" className="text-sm text-indigo-300/70 hover:text-indigo-100">Acceso administrador</Link>
      </footer>
    </main>
  )
}
