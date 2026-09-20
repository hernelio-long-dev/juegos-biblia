import {
  DIFFICULTY_MULTIPLIER, EMOJI_TIERS, QUIZ_BASE, TABOO_BASE, TABOO_PER_SECOND, TABOO_SECONDS,
  type Difficulty,
} from './types'

export function emojiPoints(difficulty: Difficulty, clue: number): number {
  const base = EMOJI_TIERS[Math.min(Math.max(clue, 1), EMOJI_TIERS.length) - 1]
  return Math.round(base * DIFFICULTY_MULTIPLIER[difficulty])
}

export function quizMaxPoints(difficulty: Difficulty): number {
  return QUIZ_BASE[difficulty] + 20
}

/** Debe coincidir con taboo_points en supabase/schema.sql. */
export function tabooPoints(difficulty: Difficulty, elapsedMs: number): number {
  const spare = Math.max(0, Math.min(TABOO_SECONDS, TABOO_SECONDS - elapsedMs / 1000))
  return Math.round((TABOO_BASE + TABOO_PER_SECOND * spare) * DIFFICULTY_MULTIPLIER[difficulty])
}

export function tabooMaxPoints(difficulty: Difficulty): number {
  return tabooPoints(difficulty, 0)
}
