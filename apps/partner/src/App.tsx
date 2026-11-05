import { useEffect } from 'react'
import { usePublicBrand } from './services/api/publicBrand'
import { RouterProvider } from 'react-router-dom'
import { RefreshProvider } from '@ai-job-print/refresh'
import { partnerRouter } from './routes'

export default function App() {
  const { brandName } = usePublicBrand()
  useEffect(() => { document.title = `合作机构后台 - ${brandName}` }, [brandName])
  return (
    <RefreshProvider>
      <RouterProvider router={partnerRouter} />
    </RefreshProvider>
  )
}
