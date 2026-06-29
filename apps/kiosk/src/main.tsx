import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { RefreshProvider } from '@ai-job-print/refresh'
import './index.css'
import { kioskRouter } from './routes'
import { AuthProvider } from './auth/AuthContext'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <RefreshProvider>
        <RouterProvider router={kioskRouter} />
      </RefreshProvider>
    </AuthProvider>
  </StrictMode>,
)
