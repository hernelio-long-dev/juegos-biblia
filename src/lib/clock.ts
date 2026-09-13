import { useEffect, useState } from 'react'
import { playerClient, requestTimeout } from './supabase'

// Diferencia entre el reloj del servidor y el del dispositivo, para que todos vean el mismo temporizador.
let offsetMs = 0

export function serverNow(): number {
  return Date.now() + offsetMs
}

export async function syncClock(): Promise<void> {
  const t0 = Date.now()
  const { data, error } = await playerClient.rpc('server_now').abortSignal(requestTimeout(5000))
  const t1 = Date.now()
  if (error || !data) return
  offsetMs = new Date(data as string).getTime() - (t0 + t1) / 2
}

export function useServerNow(intervalMs = 250): number {
  const [now, setNow] = useState(serverNow)
  useEffect(() => {
    const id = setInterval(() => setNow(serverNow()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

export function useClockSync(): void {
  useEffect(() => {
    syncClock()
    const id = setInterval(syncClock, 60_000)
    return () => clearInterval(id)
  }, [])
}

export function secondsLeft(deadline: string | null, now: number): number | null {
  if (!deadline) return null
  return Math.max(0, Math.ceil((new Date(deadline).getTime() - now) / 1000))
}
