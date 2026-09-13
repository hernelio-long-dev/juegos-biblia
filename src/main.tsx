import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'
import App from './App.tsx'
import { missingConfig } from './lib/supabase'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {missingConfig ? (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-6 text-center">
        <div className="text-5xl">⚙️</div>
        <h1 className="mt-4 font-display text-2xl font-bold">Falta configurar Supabase</h1>
        <p className="mt-2 text-indigo-200">
          La app se compiló sin <code>VITE_SUPABASE_URL</code> y <code>VITE_SUPABASE_PUBLISHABLE_KEY</code>.
          Revisa el archivo <code>.env.production</code> y vuelve a desplegar.
        </p>
      </main>
    ) : (
      <BrowserRouter>
        <App />
      </BrowserRouter>
    )}
  </StrictMode>,
)
