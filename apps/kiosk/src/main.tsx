import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import './index.css'
import { kioskRouter } from './routes'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={kioskRouter} />
  </StrictMode>,
)
