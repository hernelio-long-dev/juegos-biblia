import { DIFFICULTY_MULTIPLIER, EMOJI_TIERS, QUIZ_BASE, type Difficulty } from './types'

export function emojiPoints(difficulty: Difficulty, clue: number): number {
  const base = EMOJI_TIERS[Math.min(Math.max(clue, 1), EMOJI_TIERS.length) - 1]
  return Math.round(base * DIFFICULTY_MULTIPLIER[difficulty])
}

export function quizMaxPoints(difficulty: Difficulty): number {
  return QUIZ_BASE[difficulty] + 20
}
