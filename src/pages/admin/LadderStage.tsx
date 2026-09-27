import { useCallback, useEffect, useRef, useState } from 'react'
import { useLiveRefresh } from '../../lib/realtime'
import { ladderPoints, ladderValue } from '../../lib/scoring'
import { supabase } from '../../lib/supabase'
import {
  GAME_LABEL, LADDER_CHECKPOINTS, LADDER_LEVELS, LADDER_LIVES,
  type LadderBoard, type LadderRow, type LadderState, type Round,
} from '../../lib/types'

const STATE_LABEL: Record<LadderState, string> = {
  deciding: '🤔 Decidiendo',
  playing: '🧗 Resolviendo',
  failed: '❌ Falló',
  retired: '🔒 Se retiró',
  eliminated: '💀 Eliminado',
  summit: '🏆 ¡En la cima!',
}

const FINAL: LadderState[] = ['retired', 'eliminated', 'summit']

/**
 * Escalera para la consola: el progreso de todos (sin respuestas). Al consultarlo, el
 * servidor vence los desafíos sin contestar. Cuando todos llegan a un estado final se cierra sola.
 */
export function useLadder(roomId: string, round: Round | null, onChange: () => void) {
  const [board, setBoard] = useState<LadderBoard | null>(null)
  const active = round?.game === 'ladder'
  const roundId = active ? round.id : null

  const load = useCallback(async () => {
    if (!roundId) return setBoard(null)
    const { data } = await supabase.rpc('ladder_board', { p_room: roomId })
    if (data) setBoard(data as LadderBoard)
  }, [roomId, roundId])
  useEffect(() => { load() }, [load, round?.status])
  const ladderId = board?.id ?? null
  useLiveRefresh(ladderId ? `ladder-${ladderId}` : null,
    [{ table: 'ladder_players', filter: `ladder_id=eq.${ladderId}` }], load, 2000)

  const closed = useRef<string | null>(null)
  useEffect(() => {
    if (!round || round.game !== 'ladder' || round.status !== 'active' || !board || board.round_id !== round.id) return
    if (board.players.length === 0 || !board.players.every((p) => FINAL.includes(p.state))) return
    if (closed.current === round.id) return
    closed.current = round.id
    const id = round.id
    // Sin p_force: el servidor comprueba que de verdad nadie siga jugando.
    setTimeout(() => {
      supabase.rpc('reveal_round', { p_round: id, p_force: false }).then(({ data }) => {
        if (data === false) setTimeout(() => { if (closed.current === id) closed.current = null }, 2000)
        onChange()
      })
    }, 2500)
  }, [round, board, onChange])

  return board
}

function Hearts({ lives }: { lives: number }) {
  return (
    <span className="tracking-tight" aria-label={`${lives} salvavidas`}>
      {Array.from({ length: LADDER_LIVES }, (_, i) => (i < lives ? '❤️' : '🖤')).join('')}
    </span>
  )
}

export function LadderStage({ board, round }: { board: LadderBoard | null; round: Round }) {
  const finished = round.status === 'revealed'
  const players = board?.players ?? []
  const done = players.filter((p) => FINAL.includes(p.state)).length
  const top = players.filter((p) => p.state === 'summit').length

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <span className="font-display text-2xl font-bold">🪜 {GAME_LABEL.ladder}</span>
        <span className="chip ml-auto bg-white/10 px-4 py-2 text-lg">
          {finished ? '🏁 Terminó' : `${players.length - done} siguen subiendo · ${done} terminaron`}
          {top > 0 && ` · 🏆 ${top} en la cima`}
        </span>
      </div>

      {finished ? (
        <LadderFinal players={players} />
      ) : (
        <div className="grid flex-1 gap-6 lg:grid-cols-[minmax(0,1fr)_16rem]">
          <ul className="grid content-start gap-2 sm:grid-cols-2">
            {players.map((p, i) => <ClimberRow key={p.participant_id} p={p} i={i} />)}
            {players.length === 0 && <li className="py-10 text-center text-indigo-200">Esperando a los participantes…</li>}
          </ul>
          <Rungs players={players} />
        </div>
      )}
    </div>
  )
}

function ClimberRow({ p, i }: { p: LadderRow; i: number }) {
  const over = FINAL.includes(p.state)
  const level = over ? (p.result_level ?? p.passed) : p.passed
  return (
    <li style={{ animationDelay: `${Math.min(i, 20) * 30}ms` }}
      className={`animate-rise flex items-center gap-3 rounded-2xl px-4 py-2.5
        ${p.state === 'summit' ? 'bg-amber-400/25 ring-2 ring-amber-300' : over ? 'bg-white/[0.04] opacity-70' : 'bg-white/[0.08]'}`}>
      <span className="w-14 shrink-0 text-center font-display text-3xl font-bold tabular-nums text-amber-300">{level}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xl font-bold">{p.name}</div>
        <div className="text-sm text-indigo-200">
          {STATE_LABEL[p.state]}
          {p.checkpoint > 0 && !over && <span className="ml-2">· 🔒 {p.checkpoint}</span>}
        </div>
      </div>
      <Hearts lives={p.lives} />
    </li>
  )
}

/** La escalera: cuántos van en cada nivel, con los checkpoints marcados. */
function Rungs({ players }: { players: LadderRow[] }) {
  const levels = Array.from({ length: LADDER_LEVELS }, (_, i) => LADDER_LEVELS - i)
  return (
    <ol className="hidden flex-col gap-1 lg:flex">
      {levels.map((lvl) => {
        const here = players.filter((p) => p.passed === lvl).length
        const cp = LADDER_CHECKPOINTS.includes(lvl)
        return (
          <li key={lvl} className={`flex items-center gap-2 rounded-lg px-3 py-0.5 text-sm ${here ? 'bg-amber-400/20' : 'bg-white/[0.04]'}`}>
            <span className="w-6 text-right font-display font-bold text-indigo-200">{lvl}</span>
            <span className="flex-1 text-xs tabular-nums text-indigo-300">{ladderValue(lvl).toLocaleString('es')}</span>
            {cp && <span title="Checkpoint">🔒</span>}
            {here > 0 && <span className="font-bold text-amber-200">🧗 {here}</span>}
          </li>
        )
      })}
    </ol>
  )
}

function LadderFinal({ players }: { players: LadderRow[] }) {
  const sorted = [...players].sort((a, b) => (b.result_level ?? 0) - (a.result_level ?? 0) || a.name.localeCompare(b.name))
  return (
    <div className="mx-auto w-full max-w-5xl">
      <h1 className="mb-2 text-center font-display text-5xl font-bold">🏁 Resultado de la Escalera</h1>
      <p className="mb-6 text-center text-xl text-indigo-200">El valor alcanzado se convierte en puntos del campeonato.</p>
      <ol className="grid gap-2 sm:grid-cols-2">
        {sorted.map((p) => {
          const lvl = p.result_level ?? 0
          return (
            <li key={p.participant_id} className={`flex items-center gap-3 rounded-2xl px-4 py-3 ${p.state === 'summit' ? 'bg-amber-400/25 ring-2 ring-amber-300' : 'bg-white/[0.07]'}`}>
              <span className="w-12 text-center font-display text-2xl font-bold text-indigo-200">N{lvl}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xl font-bold">{p.name}</div>
                <div className="text-sm text-indigo-300">{STATE_LABEL[p.state]} · valor {ladderValue(lvl).toLocaleString('es')}</div>
              </div>
              <span className="font-display text-2xl font-bold text-amber-300">+{p.points ?? ladderPoints(lvl)}</span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
