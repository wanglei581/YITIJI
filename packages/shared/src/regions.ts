// ============================================================
// 全国行政区划工具（省 / 市 / 区）。
//
// 数据源：china-division（dist/pca.json，{省: {市: [区...]}}，约 47KB）。
// 供 Kiosk 地区筛选、Admin/Partner 企业资料录入统一使用。
// 直辖市在数据源中以「市辖区」作为市级占位；录入页展示时跳过该冗余层级。
// ============================================================

import pcaRaw from 'china-division/dist/pca.json'

const PCA = pcaRaw as Record<string, Record<string, string[]>>

/** 全部省/直辖市/自治区（数据源不含台港澳）。 */
export const PROVINCES: string[] = Object.keys(PCA)

export function citiesOf(province: string): string[] {
  return Object.keys(PCA[province] ?? {})
}

export function districtsOf(province: string, city: string): string[] {
  return PCA[province]?.[city] ?? []
}

/** 直辖市判定：市级仅一个「市辖区」占位（北京/天津/上海/重庆）。 */
export function isMunicipality(province: string): boolean {
  const cs = citiesOf(province)
  return cs.length === 1 && cs[0] === '市辖区'
}

/** 规范化地名：去掉常见行政尾缀，便于把“青岛”匹配到“青岛市”。 */
function normalize(name: string): string {
  return name
    .trim()
    .replace(/(特别行政区|自治区|自治州|自治县|省直辖县级行政区划|地区|盟|省|市|区|县)$/u, '')
}

// 市规范名 → {省, 市}（含直辖市：用省短名指向其市辖区）。
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

/** 把城市名归位到 {省, 市}；无法识别返回 undefined。 */
export function resolveRegionCity(city: string | undefined | null): { province: string; city: string } | undefined {
  if (!city) return undefined
  return CITY_INDEX.get(normalize(city))
}

export function resolveRegionProvince(province: string | undefined | null): string | undefined {
  if (!province) return undefined
  const raw = province.trim()
  if (PCA[raw]) return raw
  const key = normalize(raw)
  return PROVINCES.find((p) => normalize(p) === key)
}

export function resolveRegionDistrict(
  province: string | undefined | null,
  city: string | undefined | null,
  district: string | undefined | null,
): string | undefined {
  if (!province || !city || !district) return undefined
  const raw = district.trim()
  const options = districtsOf(province, city)
  if (options.includes(raw)) return raw
  const key = normalize(raw)
  return options.find((d) => normalize(d) === key)
}

export interface RegionSelection {
  province?: string
  city?: string
  district?: string
}

/**
 * 兼容历史自由文本地区：尽量转成字典规范名，无法识别时保留原值。
 * 用于后台编辑旧数据，避免已有值在级联 select 中被隐藏或误清空。
 */
export function resolveRegionSelection(sel: RegionSelection): RegionSelection {
  const rawProvince = sel.province?.trim() ?? ''
  const rawCity = sel.city?.trim() ?? ''
  const rawDistrict = sel.district?.trim() ?? ''
  const cityResolved = resolveRegionCity(rawCity)
  const province = resolveRegionProvince(rawProvince) ?? cityResolved?.province ?? rawProvince
  let city = rawCity
  let district = rawDistrict

  if (province && isMunicipality(province)) {
    city = ''
    district = resolveRegionDistrict(province, '市辖区', district) ?? district
    return { province, city, district }
  }

  if (province && city) {
    city = citiesOf(province).find((c) => c === city || normalize(c) === normalize(city))
      ?? (cityResolved?.province === province ? cityResolved.city : city)
  }
  if (province && city && district) {
    district = resolveRegionDistrict(province, city, district) ?? district
  }
  return { province, city, district }
}

/** 兼容招聘会旧命名。 */
export const resolveFairRegion = resolveRegionCity

/** 从详细地址解析出区/县（取第一个 XX区/县/新区/经开区/高新区）。 */
export function districtOf(address: string | undefined | null): string | undefined {
  if (!address) return undefined
  const m = address.match(/([一-龥]{1,6}?(?:经济技术开发区|高新技术产业开发区|经开区|高新区|新区|区|县))/)
  return m ? m[1] : undefined
}

export interface RegionFairLike {
  city?: string
  address?: string
}

/** 判断一场招聘会是否匹配当前地区选择（未选的层级视为「全部」）。 */
export function matchesRegion(fair: RegionFairLike, sel: RegionSelection): boolean {
  if (!sel.province && !sel.city && !sel.district) return true
  const r = resolveFairRegion(fair.city)
  if (sel.province && r?.province !== sel.province) return false
  if (sel.city && r?.city !== sel.city) return false
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
