import { useEffect } from 'react'
import { usePublicBrand } from './services/api/publicBrand'
import { RouterProvider } from 'react-router-dom'
import { RefreshProvider } from '@ai-job-print/refresh'
import { adminRouter } from './routes'

export default function App() {
  const { brandName } = usePublicBrand()
  useEffect(() => { document.title = `管理员后台 - ${brandName}` }, [brandName])
  return (
    <RefreshProvider>
      <RouterProvider router={adminRouter} />
    </RefreshProvider>
  )
}
