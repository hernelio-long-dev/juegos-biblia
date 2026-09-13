const KEY = 'cb_player'

export interface PlayerSession {
  token: string
  roomId: string
  code: string
}

export function getPlayerSession(): PlayerSession | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as PlayerSession) : null
  } catch {
    return null
  }
}

export function setPlayerSession(session: PlayerSession): void {
  localStorage.setItem(KEY, JSON.stringify(session))
}

export function clearPlayerSession(): void {
  localStorage.removeItem(KEY)
}
