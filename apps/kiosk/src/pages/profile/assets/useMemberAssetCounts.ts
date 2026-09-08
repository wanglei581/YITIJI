import { useEffect, useRef, useState } from 'react'
import { getMyAiRecords, getMyDocuments, getMyResumes } from '../../../services/api/memberAssets'
import { getMyBenefits, getMyFavorites } from '../../../services/api/memberFavorites'
import { getMyPrintOrders } from '../../../services/api/memberPrintOrders'

const OVERVIEW_PAGE_SIZE = 1

interface PageTotal {
  total: number
}

export interface MemberAssetCounts {
  resumes: number | null
  documents: number | null
  orders: number | null
  favorites: number | null
  benefits: number | null
  ai: number | null
}

const EMPTY_COUNTS: MemberAssetCounts = {
  resumes: null,
  documents: null,
  orders: null,
  favorites: null,
  benefits: null,
  ai: null,
}

function settledTotal(result: PromiseSettledResult<PageTotal>): number | null {
  return result.status === 'fulfilled' ? result.value.total : null
}

export function useMemberAssetCounts(isLoggedIn: boolean, getToken: () => string | null, refreshKey = 0) {
  const [counts, setCounts] = useState<MemberAssetCounts>(EMPTY_COUNTS)
  const [loading, setLoading] = useState(false)
  const requestGen = useRef(0)

  useEffect(() => {
    if (!isLoggedIn) {
      requestGen.current += 1
      setCounts(EMPTY_COUNTS)
      setLoading(false)
      return
    }

    const token = getToken()
    if (!token) {
      requestGen.current += 1
      setCounts(EMPTY_COUNTS)
      setLoading(false)
      return
    }

    const gen = ++requestGen.current
    setLoading(true)
    setCounts(EMPTY_COUNTS)

    Promise.allSettled([
      getMyResumes(token, { pageSize: OVERVIEW_PAGE_SIZE }),
      getMyDocuments(token, { pageSize: OVERVIEW_PAGE_SIZE }),
      getMyPrintOrders(token, { pageSize: OVERVIEW_PAGE_SIZE }),
      getMyFavorites(token, undefined, { pageSize: OVERVIEW_PAGE_SIZE }),
      getMyBenefits(token, { pageSize: OVERVIEW_PAGE_SIZE }),
      getMyAiRecords(token, { pageSize: OVERVIEW_PAGE_SIZE }),
    ]).then(([resumes, documents, orders, favorites, benefits, ai]) => {
      if (gen !== requestGen.current) return
      setCounts({
        resumes: settledTotal(resumes),
        documents: settledTotal(documents),
        orders: settledTotal(orders),
        favorites: settledTotal(favorites),
        benefits: settledTotal(benefits),
        ai: settledTotal(ai),
      })
    }).finally(() => {
      if (gen === requestGen.current) setLoading(false)
    })
  }, [isLoggedIn, getToken, refreshKey])

  const allMissing = Object.values(counts).every((value) => value === null)
  const allZero = Object.values(counts).every((value) => value === 0)

  return { counts, loading, allMissing, allZero }
}
