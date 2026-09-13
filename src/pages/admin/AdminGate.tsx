import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router'
import type { Session } from '@supabase/supabase-js'
import { Brand, ErrorBox, Spinner } from '../../components/ui'
import { errorMessage, supabase } from '../../lib/supabase'

export default function AdminGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null)
  const userId = session?.user.id

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!userId) { setIsAdmin(null); return }
    supabase.rpc('claim_admin').then(({ data, error }) => setIsAdmin(!error && data === true))
  }, [userId])

  if (session === undefined || (session && isAdmin === null)) {
    return <div className="flex min-h-dvh items-center justify-center"><Spinner label="Verificando acceso…" /></div>
  }
  if (!session) return <Login />
  if (!isAdmin) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5">
        <div className="card p-6 text-center">
          <div className="text-5xl">🔒</div>
          <h1 className="mt-3 font-display text-2xl font-bold">Sin permisos de administrador</h1>
          <p className="mt-2 text-indigo-200">La cuenta <b>{session.user.email}</b> no es administradora de esta competencia.</p>
          <button className="btn-secondary mt-6 w-full" onClick={() => supabase.auth.signOut()}>Cerrar sesión</button>
        </div>
      </main>
    )
  }
  return <>{children}</>
}

function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setLoading(false)
    if (error) {
      const msg = errorMessage(error)
      setError(/invalid login/i.test(msg) ? 'Correo o contraseña incorrectos.'
        : /not confirmed/i.test(msg) ? 'El correo aún no está confirmado.' : msg)
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-8">
      <div className="mb-8"><Brand /></div>
      <form onSubmit={submit} className="card animate-rise space-y-4 p-6">
        <h1 className="font-display text-3xl font-bold">Administrador</h1>
        <div>
          <label className="label" htmlFor="email">Correo</label>
          <input id="email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
        </div>
        <div>
          <label className="label" htmlFor="password">Contraseña</label>
          <input id="password" type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </div>
        <ErrorBox>{error}</ErrorBox>
        <button className="btn-primary w-full py-4" disabled={loading}>{loading ? 'Ingresando…' : 'Ingresar'}</button>
        <p className="text-xs text-indigo-300/80">
          La primera cuenta que inicie sesión queda registrada como administradora.
        </p>
      </form>
      <Link to="/" className="mt-6 text-center text-sm text-indigo-300/70 hover:text-indigo-100">← Volver</Link>
    </main>
  )
}
