import type { ReactNode } from 'react'
import { DIFFICULTY_LABEL, DIFFICULTY_STYLE, type Difficulty } from '../lib/types'

export function Brand({ small = false }: { small?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <img src="/logo.svg" alt="" className={small ? 'h-9 w-9' : 'h-14 w-14'} />
      <div className="leading-tight">
        <div className={`font-display font-bold ${small ? 'text-lg' : 'text-2xl'}`}>Competencia Bíblica</div>
        {!small && <div className="text-sm text-amber-200/80">Septiembre · ¡Pon a prueba lo que sabes!</div>}
      </div>
    </div>
  )
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-10 text-indigo-200">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-white/15 border-t-amber-400" />
      {label && <p>{label}</p>}
    </div>
  )
}

export function DifficultyChip({ difficulty }: { difficulty: Difficulty }) {
  return <span className={`chip ${DIFFICULTY_STYLE[difficulty]}`}>{DIFFICULTY_LABEL[difficulty]}</span>
}

export function ErrorBox({ children }: { children: ReactNode }) {
  if (!children) return null
  return (
    <div role="alert" className="rounded-2xl border border-rose-400/40 bg-rose-500/15 px-4 py-3 text-rose-100">
      {children}
    </div>
  )
}

/** Anillo de cuenta regresiva. */
export function CountdownRing({ seconds, total, size = 96 }: { seconds: number; total: number; size?: number }) {
  const r = 42
  const c = 2 * Math.PI * r
  const pct = Math.max(0, Math.min(1, seconds / total))
  const color = seconds <= 5 ? '#fb7185' : seconds <= 10 ? '#fbbf24' : '#34d399'
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} aria-label={`${seconds} segundos`}>
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" stroke="rgb(255 255 255 / 0.12)" strokeWidth="10" />
        <circle
          cx="50" cy="50" r={r} fill="none" stroke={color} strokeWidth="10" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - pct)}
          style={{ transition: 'stroke-dashoffset 0.25s linear, stroke 0.3s' }}
        />
      </svg>
      <div
        className={`absolute inset-0 flex items-center justify-center font-display font-bold ${seconds <= 5 ? 'animate-pulse' : ''}`}
        style={{ fontSize: size * 0.36, color }}
      >
        {seconds}
      </div>
    </div>
  )
}
