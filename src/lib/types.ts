export type Difficulty = 'facil' | 'intermedio' | 'dificil'
export type Game = 'emoji' | 'quiz'
export type RoomView = 'lobby' | 'round' | 'leaderboard' | 'podium'

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

export const GAME_LABEL: Record<Game, string> = {
  emoji: 'Adivina con emojis',
  quiz: 'Selección múltiple',
}

export const QUIZ_SECONDS = 20
export const EMOJI_FINAL_SECONDS = 30

// Deben coincidir con emoji_points / quiz_points en supabase/schema.sql
export const EMOJI_TIERS = [100, 70, 50, 30]
export const DIFFICULTY_MULTIPLIER: Record<Difficulty, number> = { facil: 1, intermedio: 1.5, dificil: 2 }
export const QUIZ_BASE: Record<Difficulty, number> = { facil: 50, intermedio: 75, dificil: 100 }

export interface Room {
  id: string
  name: string
  status: 'open' | 'closed'
  view: RoomView
  current_round_id: string | null
  created_at: string
}

export interface Round {
  id: string
  room_id: string
  game: Game
  difficulty: Difficulty
  item_id: string
  seq: number
  status: 'active' | 'revealed'
  clues_total: number | null
  clues_revealed: number
  prompt: string | null
  options: string[] | null
  started_at: string
  deadline: string | null
  answer_text: string | null
  correct_index: number | null
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
  me: { participant_id: string; name: string; points: number; rank: number | null; players: number }
  round: Omit<Round, 'room_id' | 'item_id'> | null
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
