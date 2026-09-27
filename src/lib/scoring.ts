import {
  AUCTION_MAX_BID, AUCTION_MIN_BID, CIPHER_BASE, CIPHER_PER_SECOND, CIPHER_SECONDS, DIFFICULTY_MULTIPLIER, EMOJI_TIERS, QUIZ_BASE,
  TABOO_BASE, TABOO_PER_SECOND, TABOO_SECONDS, VERSE_BASE, VERSE_PER_SECOND, VERSE_SECONDS,
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

/** Debe coincidir con cipher_points en supabase/schema.sql. */
export function cipherPoints(difficulty: Difficulty, elapsedMs: number): number {
  const spare = Math.max(0, Math.min(CIPHER_SECONDS, CIPHER_SECONDS - elapsedMs / 1000))
  return Math.round((CIPHER_BASE + CIPHER_PER_SECOND * spare) * DIFFICULTY_MULTIPLIER[difficulty])
}

/** Debe coincidir con verse_points en supabase/schema.sql. */
export function versePoints(difficulty: Difficulty, elapsedMs: number): number {
  const spare = Math.max(0, Math.min(VERSE_SECONDS, VERSE_SECONDS - elapsedMs / 1000))
  return Math.round((VERSE_BASE + VERSE_PER_SECOND * spare) * DIFFICULTY_MULTIPLIER[difficulty])
}

/** Máximo posible de una ronda completa: descifrar al instante + versículo al instante. */
export function cipherMaxPoints(difficulty: Difficulty): number {
  return cipherPoints(difficulty, 0) + versePoints(difficulty, 0)
}

/** Lo que gana un equipo que acierta. Debe coincidir con auction_gain en supabase/schema.sql. */
export function auctionGain(difficulty: Difficulty, amount: number): number {
  return Math.round(amount * DIFFICULTY_MULTIPLIER[difficulty])
}

/** Debe coincidir con auction_max_bid: hasta 150, o el saldo si es menor, pero nunca menos de la mínima. */
export function auctionMaxBid(balance: number): number {
  return Math.max(AUCTION_MIN_BID, Math.min(AUCTION_MAX_BID, balance))
}

/** Equipos de 3 o 4 (10 personas → 4 + 3 + 3). Debe coincidir con start_auction. */
export function auctionTeamCount(players: number): number {
  return Math.max(2, Math.ceil(players / 4))
}
