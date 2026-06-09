// ============================================================
// 招聘会地区（省 / 市 / 区）筛选 —— 基于全国行政区划数据
//
// 数据源：china-division（dist/pca.json，{省: {市: [区...]}}，约 47KB）。
// 覆盖全国 31 省/直辖市/自治区的市与区县，供 RegionPicker 级联选择。
//
// 招聘会数据只带 city（市名，可能省略"市"后缀），可选 address（含区/县）。
// 故按规范化名建立「市 → {省, 市}」索引，把招聘会归位到省/市；区由 address 文本匹配。
// ============================================================

import pcaRaw from 'china-division/dist/pca.json'

const PCA = pcaRaw as Record<string, Record<string, string[]>>

/** 全部省/直辖市/自治区（含台港澳之外的 31 个；数据源不含台港澳） */
export const PROVINCES: string[] = Object.keys(PCA)

export function citiesOf(province: string): string[] {
  return Object.keys(PCA[province] ?? {})
}

export function districtsOf(province: string, city: string): string[] {
  return PCA[province]?.[city] ?? []
}

/** 直辖市判定：市级仅一个「市辖区」占位（北京/天津/上海/重庆）。选择时跳过冗余市级。 */
export function isMunicipality(province: string): boolean {
  const cs = citiesOf(province)
  return cs.length === 1 && cs[0] === '市辖区'
}

/** 规范化地名：去掉常见行政尾缀，便于把"青岛"匹配到"青岛市"。 */
function normalize(name: string): string {
  return name
    .trim()
    .replace(/(特别行政区|自治区|自治州|自治县|省直辖县级行政区划|地区|盟|省|市|区|县)$/u, '')
}

// 市规范名 → {省, 市}（含直辖市：用省短名指向其市辖区）
const CITY_INDEX = new Map<string, { province: string; city: string }>()
for (const province of PROVINCES) {
  const cities = citiesOf(province)
  for (const city of cities) {
    const key = normalize(city)
    if (key && !CITY_INDEX.has(key)) CITY_INDEX.set(key, { province, city })
  }
  if (isMunicipality(province)) {
    const key = normalize(province)
    if (key) CITY_INDEX.set(key, { province, city: cities[0] })
  }
}

/** 把招聘会的 city 归位到 {省, 市}；无法识别 → undefined。 */
export function resolveFairRegion(city: string | undefined | null): { province: string; city: string } | undefined {
  if (!city) return undefined
  return CITY_INDEX.get(normalize(city))
}

/** 从详细地址解析出区/县（取第一个 XX区/县/新区/经开区/高新区）。无 → undefined。 */
export function districtOf(address: string | undefined | null): string | undefined {
  if (!address) return undefined
  const m = address.match(/([一-龥]{1,6}?(?:经济技术开发区|高新技术产业开发区|经开区|高新区|新区|区|县))/)
  return m ? m[1] : undefined
}

export interface RegionFairLike {
  city?: string
  address?: string
}

export interface RegionSelection {
  province?: string
  city?: string
  district?: string
}

/** 判断一场招聘会是否匹配当前地区选择（未选的层级视为「全部」）。 */
export function matchesRegion(fair: RegionFairLike, sel: RegionSelection): boolean {
  if (!sel.province && !sel.city && !sel.district) return true
  const r = resolveFairRegion(fair.city)
  if (sel.province && r?.province !== sel.province) return false
  if (sel.city && r?.city !== sel.city) return false
  // 招聘会无独立区字段 → 用地址文本匹配区名（去掉尾缀后包含即可）
  if (sel.district) {
    const d = sel.district.replace(/(区|县)$/u, '')
    if (!fair.address || !fair.address.includes(d)) return false
  }
  return true
}

/** 把选择拼成可读标签（按钮回显用）。 */
export function regionLabel(sel: RegionSelection): string {
  if (sel.district) return sel.district
  if (sel.city && sel.city !== '市辖区') return sel.city
  if (sel.province) return sel.province
  return '全部地区'
}
