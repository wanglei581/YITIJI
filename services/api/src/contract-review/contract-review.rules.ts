export const CONTRACT_RULE_PACK_VERSION = 'cn-labor-p0-v1'

export interface ContractRuleBasis {
  readonly url: string
  readonly effectiveFrom: '2013-07-01'
}

const MOHRSS_LABOR_CONTRACT_LAW_URL =
  'https://www.mohrss.gov.cn/xxgk2020/fdzdgknr/zcfg/fl/202011/t20201102_394622_wap.html'

const basisEntries = [9, 19, 20, 22, 23, 24, 25].map(
  (article) =>
    [
      `labor-contract-law:${article}`,
      Object.freeze({
        url: MOHRSS_LABOR_CONTRACT_LAW_URL,
        effectiveFrom: '2013-07-01' as const,
      }),
    ] as const,
)

const basisMap = new Map<string, ContractRuleBasis>(basisEntries)

function rejectBasisMutation(): never {
  throw new TypeError('READONLY_RULE_BASIS')
}

/** Closure-backed facade: iteration exposes frozen values, never the mutable backing Map. */
const basisFacade = {
  get size(): number {
    return basisMap.size
  },
  get(key: string): ContractRuleBasis | undefined {
    return basisMap.get(key)
  },
  has(key: string): boolean {
    return basisMap.has(key)
  },
  entries(): MapIterator<[string, ContractRuleBasis]> {
    return basisMap.entries()
  },
  keys(): MapIterator<string> {
    return basisMap.keys()
  },
  values(): MapIterator<ContractRuleBasis> {
    return basisMap.values()
  },
  forEach(
    callbackfn: (value: ContractRuleBasis, key: string, map: ReadonlyMap<string, ContractRuleBasis>) => void,
    thisArg?: unknown,
  ): void {
    for (const [key, value] of basisMap) callbackfn.call(thisArg, value, key, BASIS_ALLOWLIST)
  },
  [Symbol.iterator](): MapIterator<[string, ContractRuleBasis]> {
    return basisMap.entries()
  },
  set: rejectBasisMutation,
  delete: rejectBasisMutation,
  clear: rejectBasisMutation,
}

export const BASIS_ALLOWLIST: ReadonlyMap<string, ContractRuleBasis> = Object.freeze(basisFacade)
