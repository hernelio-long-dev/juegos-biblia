import { useEffect, useRef } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from './supabase'

export interface TableWatch {
  table: string
  filter?: string
}

/**
 * Se suscribe a cambios de Postgres (Supabase Realtime) y además consulta
 * periódicamente como respaldo por si la conexión en vivo se interrumpe.
 */
export function useLiveRefresh(
  key: string | null,
  watches: TableWatch[],
  onChange: () => void,
  pollMs = 3000,
  client: SupabaseClient = supabase,
) {
  const cb = useRef(onChange)
  useEffect(() => { cb.current = onChange }, [onChange])
  const watchKey = JSON.stringify(watches)

  useEffect(() => {
    if (!key) return
    const fire = () => cb.current()
    let channel = client.channel(`live-${key}-${Math.random().toString(36).slice(2)}`)
    for (const w of JSON.parse(watchKey) as TableWatch[]) {
      channel = channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: w.table, ...(w.filter ? { filter: w.filter } : {}) },
        fire,
      )
    }
    channel.subscribe()
    const poll = pollMs > 0 ? setInterval(fire, pollMs) : undefined
    const onVisible = () => { if (document.visibilityState === 'visible') fire() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', fire)
    return () => {
      client.removeChannel(channel)
      if (poll) clearInterval(poll)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', fire)
    }
  }, [key, watchKey, pollMs, client])
}
