import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string

if (!url || !key) {
  throw new Error('Faltan VITE_SUPABASE_URL o VITE_SUPABASE_PUBLISHABLE_KEY en el archivo .env')
}

export const supabase = createClient(url, key)

// Cliente para participantes: sin sesión de usuario, así no espera ni compite
// con la sesión del admin si ambos están abiertos en el mismo navegador.
export const playerClient = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'cb-player-auth' },
})

/** Corta la petición si tarda demasiado, para poder reintentar. */
export const requestTimeout = (ms = 8000) => AbortSignal.timeout(ms)

export function errorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message)
  return 'Ocurrió un error inesperado'
}
