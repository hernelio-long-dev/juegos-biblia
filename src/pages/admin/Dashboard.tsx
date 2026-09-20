import { useSearchParams, Link } from 'react-router'
import { Brand } from '../../components/ui'
import { supabase } from '../../lib/supabase'
import RoomsTab from './RoomsTab'
import ParticipantsTab from './ParticipantsTab'
import EmojiBankTab from './EmojiBankTab'
import QuizBankTab from './QuizBankTab'
import TabooBankTab from './TabooBankTab'
import HistoryTab from './HistoryTab'
import CipherBankTab from './CipherBankTab'

const TABS = [
  { id: 'salas', label: 'Salas', icon: '🏠' },
  { id: 'historico', label: 'Histórico', icon: '🏅' },
  { id: 'participantes', label: 'Participantes', icon: '👥' },
  { id: 'emojis', label: 'Banco de emojis', icon: '😀' },
  { id: 'preguntas', label: 'Banco de preguntas', icon: '❓' },
  { id: 'taboo', label: 'Banco de Tabú', icon: '🤫' },
  { id: 'codigo', label: 'Banco de códigos', icon: '🔐' },
] as const

export default function AdminDashboard() {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') ?? 'salas'

  return (
    <div className="mx-auto min-h-dvh max-w-5xl px-4 pb-10 pt-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <Link to="/admin"><Brand small /></Link>
        <button className="btn-ghost text-sm" onClick={() => supabase.auth.signOut()}>Cerrar sesión</button>
      </header>

      <nav className="mt-6 flex gap-2 overflow-x-auto pb-1" aria-label="Secciones">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setParams({ tab: t.id })}
            className={`btn shrink-0 px-4 py-2.5 ${tab === t.id ? 'bg-amber-400 text-indigo-950' : 'bg-white/10 hover:bg-white/20'}`}
            aria-current={tab === t.id ? 'page' : undefined}
          >
            <span>{t.icon}</span> {t.label}
          </button>
        ))}
      </nav>

      <div className="mt-6">
        {tab === 'salas' && <RoomsTab />}
        {tab === 'historico' && <HistoryTab />}
        {tab === 'participantes' && <ParticipantsTab />}
        {tab === 'emojis' && <EmojiBankTab />}
        {tab === 'preguntas' && <QuizBankTab />}
        {tab === 'taboo' && <TabooBankTab />}
        {tab === 'codigo' && <CipherBankTab />}
      </div>
    </div>
  )
}
