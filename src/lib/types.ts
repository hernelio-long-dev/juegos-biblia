export type Difficulty = 'facil' | 'intermedio' | 'dificil'
export type Game = 'emoji' | 'quiz' | 'taboo'
export type RoomView = 'lobby' | 'round' | 'leaderboard' | 'podium'
export type RoundStatus = 'pending' | 'active' | 'revealed'

export const DIFFICULTIES: Difficulty[] = ['facil', 'intermedio', 'dificil']

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  facil: 'Fácil',
  intermedio: 'Intermedio',
  dificil: 'Difícil',
}

export const DIFFICULTY_STYLE: Record<Difficulty, string> = {
  facil: 'bg-emerald-400/20 text-emerald-200',
  intermedio: 'bg-sky-400/20 text-sky-200',
  dificil: 'bg-rose-400/20 text-rose-200',
}

export const GAMES: Game[] = ['emoji', 'quiz', 'taboo']

export const GAME_LABEL: Record<Game, string> = {
  emoji: 'Adivina con emojis',
  quiz: 'Selección múltiple',
  taboo: 'Tabú bíblico',
}

export const GAME_ICON: Record<Game, string> = { emoji: '😀', quiz: '❓', taboo: '🤫' }

export const QUIZ_SECONDS = 20
export const EMOJI_FINAL_SECONDS = 30
export const TABOO_SECONDS = 45

// Deben coincidir con emoji_points / quiz_points / taboo_points en supabase/schema.sql
export const EMOJI_TIERS = [100, 70, 50, 30]
export const DIFFICULTY_MULTIPLIER: Record<Difficulty, number> = { facil: 1, intermedio: 1.5, dificil: 2 }
export const QUIZ_BASE: Record<Difficulty, number> = { facil: 50, intermedio: 75, dificil: 100 }
export const TABOO_BASE = 30
export const TABOO_PER_SECOND = 1.5

/** Colores de los equipos de Tabú, por número de equipo. */
export const TEAM_STYLES = [
  { bg: 'bg-rose-500', soft: 'bg-rose-500/20 text-rose-100', text: 'text-rose-300' },
  { bg: 'bg-sky-500', soft: 'bg-sky-500/20 text-sky-100', text: 'text-sky-300' },
  { bg: 'bg-emerald-500', soft: 'bg-emerald-500/20 text-emerald-100', text: 'text-emerald-300' },
  { bg: 'bg-amber-500', soft: 'bg-amber-500/20 text-amber-100', text: 'text-amber-300' },
  { bg: 'bg-violet-500', soft: 'bg-violet-500/20 text-violet-100', text: 'text-violet-300' },
  { bg: 'bg-teal-500', soft: 'bg-teal-500/20 text-teal-100', text: 'text-teal-300' },
]

export const teamStyle = (seq: number) => TEAM_STYLES[(seq - 1) % TEAM_STYLES.length]

export interface Room {
  id: string
  name: string
  status: 'open' | 'closed'
  view: RoomView
  current_round_id: string | null
  /** Si está apagado, los puntos de esta sala no entran al ranking histórico. */
  counts_for_history: boolean
  created_at: string
}

export interface Round {
  id: string
  room_id: string
  game: Game
  difficulty: Difficulty
  item_id: string
  seq: number
  status: RoundStatus
  clues_total: number | null
  clues_revealed: number
  prompt: string | null
  options: string[] | null
  team_id: string | null
  describer_id: string | null
  started_at: string
  deadline: string | null
  answer_text: string | null
  correct_index: number | null
}

/** Fila de room_players_status: quién está en la sala y desde cuándo. */
export interface PlayerStatus {
  participant_id: string
  name: string
  joined_at: string
  last_seen: string | null
}

export interface TabooItem {
  id: string
  difficulty: Difficulty
  word: string
  forbidden: string[]
  reference: string | null
}

export interface TeamMember {
  id: string
  name: string
}

export interface Team {
  id: string
  name: string
  seq: number
  members: TeamMember[]
}

export interface TeamScoreRow {
  team_id: string
  name: string
  seq: number
  members: number
  points: number
  wins: number
  rank: number
}

export interface Participant {
  id: string
  name: string
  created_at: string
}

export interface EmojiItem {
  id: string
  difficulty: Difficulty
  clues: string[]
  answer: string
  aliases: string[]
  reference: string | null
}

export interface QuizQuestion {
  id: string
  difficulty: Difficulty
  question: string
  options: string[]
  correct_index: number
  reference: string | null
}

export interface ScoreRow {
  participant_id: string
  name: string
  points: number
  correct: number
  rank: number
}

/** Fila de global_scoreboard: el acumulado de una persona en todas las salas. */
export interface GlobalScoreRow {
  participant_id: string
  name: string
  points: number
  correct: number
  rooms: number
  rank: number
}

export interface AnswerRow {
  id: string
  round_id: string
  participant_id: string
  answer_text: string | null
  choice: number | null
  is_correct: boolean
  points: number
  clue_number: number | null
  elapsed_ms: number | null
  created_at: string
}

export interface PlayerState {
  server_now: string
  room: { id: string; name: string; status: 'open' | 'closed'; view: RoomView }
  me: {
    participant_id: string
    name: string
    points: number
    rank: number | null
    players: number
    team: { id: string; name: string; seq: number } | null
  }
  round: (Omit<Round, 'room_id' | 'item_id'> & {
    team: { id: string; name: string; seq: number } | null
    describer_name: string | null
    my_turn: boolean
    i_describe: boolean
    /** Solo llega al celular de quien describe, o a todos cuando se revela. */
    secret: { word: string; forbidden: string[]; reference: string | null } | null
  }) | null
  my_answer: {
    choice: number | null
    answer_text: string | null
    is_correct: boolean | null
    points: number | null
    clue_number: number | null
    attempts: number
  } | null
}

export const OPTION_STYLES = [
  { bg: 'bg-rose-500', ring: 'ring-rose-300', shape: '▲' },
  { bg: 'bg-sky-500', ring: 'ring-sky-300', shape: '◆' },
  { bg: 'bg-amber-500', ring: 'ring-amber-200', shape: '●' },
  { bg: 'bg-emerald-500', ring: 'ring-emerald-300', shape: '■' },
]
