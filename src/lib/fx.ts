import confetti from 'canvas-confetti'

export function celebrate(big = false) {
  const colors = ['#fbbf24', '#fde68a', '#818cf8', '#34d399', '#f472b6']
  if (!big) {
    confetti({ particleCount: 90, spread: 75, origin: { y: 0.7 }, colors })
    return
  }
  const end = Date.now() + 2500
  const frame = () => {
    confetti({ particleCount: 6, angle: 60, spread: 60, origin: { x: 0 }, colors })
    confetti({ particleCount: 6, angle: 120, spread: 60, origin: { x: 1 }, colors })
    if (Date.now() < end) requestAnimationFrame(frame)
  }
  frame()
}

export function vibrate(pattern: number | number[]) {
  try { navigator.vibrate?.(pattern) } catch { /* no soportado */ }
}
