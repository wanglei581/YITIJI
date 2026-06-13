import { useEffect, useRef, useState } from 'react'
import { getMyAiRecords, getMyDocuments } from '../../../services/api/memberAssets'
import { getMyFavorites } from '../../../services/api/memberFavorites'

const OVERVIEW_PAGE_SIZE = 1

interface PageTotal {
  total: number
}

interface ProfileOverviewStats {
  aiRecords: number | null
  favorites: number | null
  documents: number | null
}

const EMPTY_STATS: ProfileOverviewStats = {
  aiRecords: null,
  favorites: null,
  documents: null,
}

function settledTotal(result: PromiseSettledResult<PageTotal>): number | null {
  return result.status === 'fulfilled' ? result.value.total : null
}

export function useMemberProfileOverview(isLoggedIn: boolean, getToken: () => string | null) {
  const [stats, setStats] = useState<ProfileOverviewStats>(EMPTY_STATS)
  const [loading, setLoading] = useState(false)
  const requestGen = useRef(0)

  useEffect(() => {
    if (!isLoggedIn) {
      requestGen.current += 1
      setStats(EMPTY_STATS)
      setLoading(false)
      return
    }

    const token = getToken()
    if (!token) {
      requestGen.current += 1
      setStats(EMPTY_STATS)
      setLoading(false)
      return
    }

    const gen = ++requestGen.current
    setLoading(true)

    // 「我的」页只展示顶部概览，不加载旧账号资产明细列表。
    Promise.allSettled([
      getMyAiRecords(token, { pageSize: OVERVIEW_PAGE_SIZE }),
      getMyFavorites(token, undefined, { pageSize: OVERVIEW_PAGE_SIZE }),
      getMyDocuments(token, { pageSize: OVERVIEW_PAGE_SIZE }),
    ])
      .then(([aiRecords, favorites, documents]) => {
        if (gen !== requestGen.current) return
        setStats({
          aiRecords: settledTotal(aiRecords),
          favorites: settledTotal(favorites),
          documents: settledTotal(documents),
        })
      })
      .finally(() => {
        if (gen === requestGen.current) setLoading(false)
      })
  }, [isLoggedIn, getToken])

  return { ...stats, loading }
}
