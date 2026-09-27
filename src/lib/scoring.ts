import {
  AUCTION_MAX_BID, AUCTION_MIN_BID, CIPHER_BASE, LADDER_CHECKPOINTS, LADDER_TIER_SECONDS, TIMELINE_MIN_POINTS, TIMELINE_PLACE_POINTS, TIMELINE_WRONG_PENALTY, CIPHER_PER_SECOND, CIPHER_SECONDS, DIFFICULTY_MULTIPLIER, EMOJI_TIERS, QUIZ_BASE,
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
export function smallTeamCount(players: number): number {
  return Math.max(2, Math.ceil(players / 4))
}

/** Línea del Tiempo: equipos de 4 o más (10 → 5 + 5; 7 → uno de 7). Debe coincidir con start_timeline_round. */
export function timelineTeamCount(players: number): number {
  return Math.max(1, Math.floor(players / 4))
}

/** Debe coincidir con timeline_points en supabase/schema.sql. */
export function timelinePoints(difficulty: Difficulty, place: number, wrong = 0): number {
  const base = TIMELINE_PLACE_POINTS[Math.min(Math.max(place, 1), TIMELINE_PLACE_POINTS.length) - 1]
  return Math.round(Math.max(TIMELINE_MIN_POINTS, base - TIMELINE_WRONG_PENALTY * wrong) * DIFFICULTY_MULTIPLIER[difficulty])
}

/** Escalera: valor interno. 3 en el nivel 1 y se duplica (6, 12, 24… 1 572 864). Coincide con ladder_value. */
export function ladderValue(level: number): number {
  return level <= 0 ? 0 : 3 * 2 ** (level - 1)
}

/** Escalera: puntos de campeonato, 15 por nivel + un bono que crece ~50,8 % por nivel hasta 3700 (cima = 4000). Coincide con ladder_points. */
export function ladderPoints(level: number): number {
  return level <= 0 ? 0 : 15 * level + Math.round(3700 ** (level / 20))
}

/** Último checkpoint superado (0 si ninguno). Coincide con ladder_checkpoint. */
export function ladderCheckpoint(passed: number): number {
  return Math.max(0, ...LADDER_CHECKPOINTS.filter((c) => c <= passed))
}

export function ladderTier(level: number): number {
  return Math.min(4, Math.ceil(level / 5))
}

/** Segundos para responder un desafío de ese nivel. Coincide con ladder_seconds. */
export function ladderSeconds(level: number): number {
  return LADDER_TIER_SECONDS[ladderTier(level)]
}
