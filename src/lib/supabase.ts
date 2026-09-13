import { createClient } from '@supabase/supabase-js'

const envUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const envKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

/** true si la app se compiló sin las variables de Supabase (se muestra un aviso en lugar de una pantalla vacía). */
export const missingConfig = !envUrl || !envKey
if (missingConfig) {
  console.error('Faltan VITE_SUPABASE_URL o VITE_SUPABASE_PUBLISHABLE_KEY al compilar (.env / .env.production)')
}

// Valores de relleno solo para que createClient no falle; la app no se renderiza sin configuración.
const url = envUrl || 'https://config-faltante.supabase.co'
const key = envKey || 'config-faltante'

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
