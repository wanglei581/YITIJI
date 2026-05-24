import { RouterProvider } from 'react-router-dom'
import { adminRouter } from './routes'

export default function App() {
  return <RouterProvider router={adminRouter} />
}
