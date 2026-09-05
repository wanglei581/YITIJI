import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { UnhandledRejectionBanner } from './UnhandledRejectionBanner'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <UnhandledRejectionBanner />
    <App />
  </StrictMode>,
)
