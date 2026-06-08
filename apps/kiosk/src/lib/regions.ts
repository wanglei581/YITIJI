// ============================================================
// 招聘会地区（省 / 市 / 区）筛选辅助
//
// 招聘会数据自带 city（市），可选 address（含区/县）。
// 省由 city 经内置映射推导；区由 address 正则解析。
// 据此构建「省 → 市 → 区」级联树，供 RegionFilter 使用。
// ============================================================

const CITY_TO_PROVINCE: Record<string, string> = {
  北京: '北京市', 上海: '上海市', 天津: '天津市', 重庆: '重庆市',
  广州: '广东省', 深圳: '广东省', 东莞: '广东省', 佛山: '广东省', 珠海: '广东省',
  杭州: '浙江省', 宁波: '浙江省', 温州: '浙江省',
  南京: '江苏省', 苏州: '江苏省', 无锡: '江苏省',
  济南: '山东省', 青岛: '山东省', 烟台: '山东省', 潍坊: '山东省',
  成都: '四川省', 武汉: '湖北省', 西安: '陕西省', 长沙: '湖南省',
  郑州: '河南省', 合肥: '安徽省', 南昌: '江西省',
  福州: '福建省', 厦门: '福建省', 泉州: '福建省',
  沈阳: '辽宁省', 大连: '辽宁省', 哈尔滨: '黑龙江省', 长春: '吉林省',
  石家庄: '河北省', 太原: '山西省', 昆明: '云南省', 贵阳: '贵州省',
  南宁: '广西', 海口: '海南省', 兰州: '甘肃省',
}

/** 由市名推导省份；未知 → 「其他地区」。 */
export function provinceOf(city: string | undefined | null): string {
  if (!city) return '其他地区'
  return CITY_TO_PROVINCE[city.trim()] ?? '其他地区'
}

/** 从详细地址解析出区/县（取城市之后的第一个 XX区/县/新区/经开区/高新区）。无 → undefined。 */
export function districtOf(address: string | undefined | null): string | undefined {
  if (!address) return undefined
  const m = address.match(/([一-龥]{1,6}?(?:经济技术开发区|高新技术产业开发区|经开区|高新区|新区|区|县))/)
  if (!m) return undefined
  // 跳过把"XX市"误当区的情况（正则已限定结尾为区/县/新区等，城市以"市"结尾不会命中）
  return m[1]
}

export interface RegionFairLike {
  city?: string
  address?: string
}

export interface RegionTreeProvince {
  province: string
  cities: { city: string; districts: string[] }[]
}

/** 由招聘会列表构建「省 → 市 → 区」级联树（去重 + 稳定顺序）。 */
export function buildRegionTree(fairs: RegionFairLike[]): RegionTreeProvince[] {
  const provMap = new Map<string, Map<string, Set<string>>>()
  for (const f of fairs) {
    if (!f.city) continue
    const prov = provinceOf(f.city)
    const dist = districtOf(f.address)
    if (!provMap.has(prov)) provMap.set(prov, new Map())
    const cityMap = provMap.get(prov)!
    if (!cityMap.has(f.city)) cityMap.set(f.city, new Set())
    if (dist) cityMap.get(f.city)!.add(dist)
  }
  return [...provMap.entries()].map(([province, cityMap]) => ({
    province,
    cities: [...cityMap.entries()].map(([city, dset]) => ({
      city,
      districts: [...dset],
    })),
  }))
}

export interface RegionSelection {
  province?: string
  city?: string
  district?: string
}

/** 判断一场招聘会是否匹配当前地区选择（未选的层级视为「全部」）。 */
export function matchesRegion(fair: RegionFairLike, sel: RegionSelection): boolean {
  if (sel.province && provinceOf(fair.city) !== sel.province) return false
  if (sel.city && fair.city !== sel.city) return false
  if (sel.district && districtOf(fair.address) !== sel.district) return false
  return true
}
