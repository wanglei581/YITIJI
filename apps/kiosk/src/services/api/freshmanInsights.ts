// ============================================================
// Freshman Insights Service — 新生大数据（聚合统计）
//
// 本期无后端，返回一组合理的 mock 聚合数据用于一体机看板演示。
// 仅聚合统计，绝不含任何个人身份信息（compliance-boundary.md §九 / CLAUDE.md §2）。
//
// 后续接真实迎新/教务聚合接口时，只需把 getFreshmanInsights 内部替换为 HTTP 拉取
//（例如 GET /terminals/:id/freshman-insights，保持返回 FreshmanInsights 形状即可），
// 页面无需改动。
// ============================================================

/** 报到总览（聚合计数；报到率由 checkedIn/total 计算，不单独存）。 */
export interface FreshmanOverview {
  /** 新生总数 */
  total: number
  /** 已报到人数 */
  checkedIn: number
  /** 今日报到人数 */
  todayCheckedIn: number
}

/** 男女人数（聚合，不含个人信息）。 */
export interface GenderSplit {
  male: number
  female: number
}

/** 年龄分布桶。 */
export interface AgeBucket {
  label: string
  count: number
}

/** 专业聚合统计。 */
export interface MajorStat {
  name: string
  count: number
}

/** 生源地聚合统计。 */
export interface OriginStat {
  region: string
  count: number
}

/** 学院报到进度（报到率由 checkedIn/total 计算）。 */
export interface CollegeProgress {
  name: string
  checkedIn: number
  total: number
}

/** 新生大数据聚合视图（只读、仅聚合，不含任何个人信息）。 */
export interface FreshmanInsights {
  /** 数据更新时间（展示用字符串） */
  updatedAt: string
  /** 是否示例/演示数据（本期 true；接真实接口后由后端返回 false） */
  isMock: boolean
  overview: FreshmanOverview
  gender: GenderSplit
  /** 17 / 18 / 19 / 20+ 四桶，合计 = overview.total */
  ageDistribution: AgeBucket[]
  /** 热门专业 TOP5（按人数降序） */
  topMajors: MajorStat[]
  /** 生源地排行（按人数降序，含"其他省份"兜底，合计 = overview.total） */
  origins: OriginStat[]
  /** 学院报到进度（合计 = overview.total / overview.checkedIn） */
  colleges: CollegeProgress[]
}

// 一组内部自洽的示例数据：性别 / 年龄 / 生源地三组各自合计 = 4860；
// 学院 total 合计 = 4860、checkedIn 合计 = 3925（与 overview 一致）。
const MOCK_FRESHMAN_INSIGHTS: FreshmanInsights = {
  updatedAt: '2026-06-08 09:42',
  isMock: true,
  overview: { total: 4860, checkedIn: 3925, todayCheckedIn: 612 },
  gender: { male: 2576, female: 2284 },
  ageDistribution: [
    { label: '17 岁', count: 486 },
    { label: '18 岁', count: 2430 },
    { label: '19 岁', count: 1458 },
    { label: '20 岁及以上', count: 486 },
  ],
  topMajors: [
    { name: '计算机科学与技术', count: 412 },
    { name: '临床医学', count: 386 },
    { name: '会计学', count: 351 },
    { name: '电气工程及其自动化', count: 318 },
    { name: '汉语言文学', count: 296 },
  ],
  origins: [
    { region: '省内', count: 3124 },
    { region: '河南', count: 412 },
    { region: '河北', count: 318 },
    { region: '江苏', count: 276 },
    { region: '安徽', count: 198 },
    { region: '其他省份', count: 532 },
  ],
  colleges: [
    { name: '计算机学院', checkedIn: 689, total: 812 },
    { name: '经济管理学院', checkedIn: 761, total: 945 },
    { name: '医学院', checkedIn: 558, total: 736 },
    { name: '机械工程学院', checkedIn: 571, total: 689 },
    { name: '外国语学院', checkedIn: 432, total: 524 },
    { name: '文学院', checkedIn: 468, total: 583 },
    { name: '艺术学院', checkedIn: 446, total: 571 },
  ],
}

/**
 * 拉取新生大数据聚合视图。
 *
 * 本期返回 mock；后续替换为真实接口（保持 FreshmanInsights 形状即可，调用方无需改动）。
 */
export async function getFreshmanInsights(): Promise<FreshmanInsights> {
  return MOCK_FRESHMAN_INSIGHTS
}
