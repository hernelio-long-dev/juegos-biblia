import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router'
import { Spinner } from './components/ui'
import Home from './pages/Home'
import Play from './pages/Play'

const AdminGate = lazy(() => import('./pages/admin/AdminGate'))
const AdminDashboard = lazy(() => import('./pages/admin/Dashboard'))
const RoomConsole = lazy(() => import('./pages/admin/RoomConsole'))

export default function App() {
  return (
    <Suspense fallback={<div className="flex min-h-dvh items-center justify-center"><Spinner /></div>}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/jugar" element={<Play />} />
        <Route path="/admin" element={<AdminGate><AdminDashboard /></AdminGate>} />
        <Route path="/admin/sala/:roomId" element={<AdminGate><RoomConsole /></AdminGate>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}
