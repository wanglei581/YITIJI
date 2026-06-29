import { RouterProvider } from 'react-router-dom'
import { RefreshProvider } from '@ai-job-print/refresh'
import { partnerRouter } from './routes'

export default function App() {
  return (
    <RefreshProvider>
      <RouterProvider router={partnerRouter} />
    </RefreshProvider>
  )
}
