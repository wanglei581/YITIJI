import { RouterProvider } from 'react-router-dom'
import { partnerRouter } from './routes'

export default function App() {
  return <RouterProvider router={partnerRouter} />
}
