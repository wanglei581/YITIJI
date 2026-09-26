// 招聘会共享工作台 · 稿面真值表
//
// 视觉与文案真值：docs/design/kiosk-redesign-2026-08/28-jobfair-enhanced.html
// 稿的文件头写明「084 / 085 / 086 / 087 / 090 / 091 / 092 / 093 共用一个青序流光宿主」，
// 下面四张表就是那份宿主在 JS 末尾声明的 HEAD / BACK / PILL / DEFAULT_STATE，逐字搬过来。
//
// 不要手改这里的字符串。`verify:fair-workbench-qx` 会重新从稿的 HTML 里解析这四张表
// 并逐条对账——改了稿不改这里、或改了这里不改稿，都会当场红。
// 稿里没有 PILL 条目的那几个默认态（detail:detail / companies:list / map:index /
// materials:list / stats:ready）落 FAIR_DEFAULT_PILL，即稿顶栏胶囊的初始文案。
//
// 唯一的例外是 FAIR_PILL_GAPS：稿**没有建模**、但真实后端会出现的状态。
// 它不是「想加就加」的口子，理由与门禁写在那张表上面。

export type FairScreen =
  | 'list'
  | 'checkin'
  | 'detail'
  | 'companies'
  | 'map'
  | 'materials'
  | 'visit-plan'
  | 'stats'

/** 顶栏状态胶囊语气。稿里空字符串＝中性，映射到 QxPageFrame 的 unknown。 */
export type FairPillTone = 'ok' | 'warn' | 'bad' | 'unknown'

export interface FairPill {
  tone: FairPillTone
  label: string
}

/** 稿 HEAD：每个 screen 的 h1 与一句话说明。 */
export const FAIR_HEAD: Record<FairScreen, readonly [string, string]> = {
  list: ['招聘会', '只展示已审核发布、来源完整的官方与第三方场次；预约在来源平台完成。'],
  checkin: ['到场指引', '本机不做签到，也拿不到签到结果；这一页只帮你找凭证、讲清路线。'],
  detail: ['招聘会详情', '时间、地点与来源三要素由主办方发布，本机不代预约。'],
  companies: ['参展企业', '名单由主办方提供；本机不代收简历，也不在平台内投递。'],
  map: ['展位分布', '有主办方给的图或展位号才显示；本机不画推荐路线。'],
  materials: ['活动物料', '下载链接临时有效；打印价格以现场公示与系统报价为准。'],
  'visit-plan': ['参会准备清单', '需要你确认本人简历，并有这场真实的参展上下文。'],
  stats: ['现场统计', '数值由主办方回传，本机不估算、不推算。'],
}

/** 稿 BACK：顶栏返回键的落点路由与无障碍名。`:id` 在运行时替换成真实 fairId。 */
export const FAIR_BACK: Record<FairScreen, readonly [string, string]> = {
  list: ['/fairs-service', '返回招聘会服务'],
  checkin: ['/job-fairs', '返回场次列表'],
  detail: ['/job-fairs', '返回场次列表'],
  companies: ['/job-fairs/:id', '返回招聘会详情'],
  map: ['/job-fairs/:id', '返回招聘会详情'],
  materials: ['/job-fairs/:id', '返回招聘会详情'],
  'visit-plan': ['/job-fairs/:id', '返回招聘会详情'],
  stats: ['/job-fairs/:id', '返回招聘会详情'],
}

/** 稿 PILL：`screen:state` → [tone, 文案]。稿里 tone 为空字符串的记作 unknown。 */
export const FAIR_PILL: Record<string, FairPill> = {
  'list:ready': { tone: 'ok', label: '已返回场次；继续按真实字段展示' },
  'list:loading': { tone: 'unknown', label: '正在取场次名单' },
  'list:empty': { tone: 'unknown', label: '近期没有已发布的场次' },
  'list:favorites-empty': { tone: 'unknown', label: '还没有收藏的场次' },
  'list:error': { tone: 'bad', label: '场次名单这次没取到' },
  'checkin:guide': { tone: 'warn', label: '本机不做签到，只给到场指引' },
  'checkin:qr': { tone: 'ok', label: '来源入场码已就绪' },
  'checkin:empty': { tone: 'unknown', label: '暂无开放入场二维码的场次' },
  'checkin:error': { tone: 'bad', label: '入场入口列表这次没取到' },
  'detail:loading': { tone: 'unknown', label: '正在取这场的详情' },
  'detail:ended': { tone: 'warn', label: '这场已经结束' },
  'detail:unpublished': { tone: 'bad', label: '已被来源方下架' },
  'detail:error': { tone: 'bad', label: '详情这次没取到' },
  'companies:loading': { tone: 'unknown', label: '正在取参展名单' },
  'companies:empty': { tone: 'unknown', label: '主办方还没有提供名单' },
  'companies:error': { tone: 'bad', label: '参展名单没取到' },
  'map:empty': { tone: 'unknown', label: '没有展位图或展位索引' },
  'map:error': { tone: 'bad', label: '展位信息没取到' },
  'materials:empty': { tone: 'unknown', label: '这场还没有可下载的物料' },
  'materials:expired': { tone: 'warn', label: '物料链接已过期' },
  'materials:print-failed': { tone: 'bad', label: '这次打印没有成功' },
  'visit-plan:missing-context': { tone: 'warn', label: '缺少简历或参展上下文' },
  'visit-plan:generating': { tone: 'unknown', label: '已提交，等结果返回' },
  'visit-plan:ready': { tone: 'ok', label: '清单已经生成' },
  'visit-plan:ai-unavailable': { tone: 'warn', label: 'AI 不可用，浏览与打印不受影响' },
  'visit-plan:failed': { tone: 'bad', label: '本次生成失败' },
  'stats:empty': { tone: 'unknown', label: '主办方还没有回传统计' },
  'stats:error': { tone: 'bad', label: '统计数据没取到' },
}

/** 稿顶栏胶囊的初始文案。PILL 没登记的默认态用它，不留空、也不默认「正常」。 */
export const FAIR_DEFAULT_PILL: FairPill = { tone: 'unknown', label: '场次与参展名单由主办方发布' }

/**
 * 稿**没有建模**、但真实后端确实会出现的状态。
 *
 * 为什么必须单独一张表，而不是补进 FAIR_PILL：FAIR_PILL 是稿的转录面，
 * `verify:fair-workbench-qx` 对它做的是**逐条相等**对账（多一条少一条都红）。
 * 把稿里没有的键塞进去，等于把那条对账降级成「包含」，转录漂移就再也拦不住了。
 *
 * 这张表的纪律（由同一条门禁断言）：
 *   ① 键必须与稿的 VIEWS **不相交** —— 不允许用它覆写稿已经画过的状态；
 *   ② 整张表必须**逐字等于**门禁里那份登记清单 —— 加一条就得动门禁，动了就会被 review 看见；
 *   ③ 每一条都要在下面写清楚「稿为什么缺它」「不补会对用户说出哪句假话」。
 *
 * 补这张表之前先想：是不是页面自己把两件事混成一个状态了？三条里有两条就是这么来的。
 */
export const FAIR_PILL_GAPS: Record<string, FairPill> = {
  // 稿给 materials 只画了 list / empty / expired / print-failed —— 它把「取不到」
  // 和「链接过期」当成了同一件事。实测 GET /materials 返回 500 时页面落 expired，
  // 于是对用户说「限时签名链接超时失效，重新获取一次即可，内容不变」：
  // 服务端 500 时这三句话每一句都是假的（没有过期、重取也不会好、内容取不到）。
  'materials:error': { tone: 'bad', label: '活动物料这次没取到' },
  // 稿给 visit-plan 画的 missing-context 指的是「没有本人简历上下文」。
  // 但「有 taskId、只是还没生成过清单」也会落进去（GET latest 返回 404
  // FAIR_VISIT_PLAN_NOT_FOUND 是这条链路最常见的应答），页面于是显示
  // 「还没有选简历」并把唯一出口指向选简历——生成入口从此不可达。
  'visit-plan:idle': { tone: 'unknown', label: '简历已确认，还没有生成过清单' },
  // 读上次结果失败（5xx / 断网 / 超时）既不是 missing-context（简历在），
  // 也不是 failed（稿的 failed 说的是「本次生成失败」，而这次根本没生成）。
  // 合并到任一边都会让顶栏说一句与实际发生的事不符的话。
  'visit-plan:load-failed': { tone: 'bad', label: '上次的清单没取到' },
}

/**
 * 稿里用 `<div class="scroll center">` 画的状态屏 —— 内容整体**垂直居中**。
 *
 * 1080×1920 是定高屏：空态 / 错误态这类短内容顶部对齐时，底部会露一大片死白，
 * 27 寸竖屏上非常显眼。稿对这 19 个状态给的答案就是居中；其余 14 个是内容屏，
 * 顶部对齐 + 自己的 `.qx-grow` 吸收块（列表 / 滚动区）。
 *
 * **不要改成「一律居中」**：内容屏里真正该吸收余量的是列表，一律居中会让
 * 列表上方凭空出现一条空带（2026-09-21 实测 /job-fairs 就是这样：说明文字块
 * 抢走 539px，列表又占 539px，中间裂开一道口子）。
 *
 * verify:fair-workbench-qx 直接从稿里重新解析这一集合逐条对账。
 */
export const FAIR_CENTERED_STATES: readonly string[] = [
  'list:empty',
  'list:favorites-empty',
  'list:error',
  'checkin:empty',
  'checkin:error',
  'detail:unpublished',
  'detail:error',
  'companies:empty',
  'companies:error',
  'map:empty',
  'map:error',
  'materials:empty',
  'materials:expired',
  'materials:print-failed',
  'visit-plan:generating',
  'visit-plan:ai-unavailable',
  'visit-plan:failed',
  'stats:empty',
  'stats:error',
]

/**
 * 稿没画过的缺口态（FAIR_PILL_GAPS）各自归到哪一档。每条都要说明「像稿里的哪一个」，
 * 否则下一个人只能靠猜。门禁断言这张表的键与 FAIR_PILL_GAPS 逐字一致。
 */
export const FAIR_GAP_STATE_CENTERED: Record<string, boolean> = {
  // 和稿的 materials:empty / print-failed 同属短故障屏 → 居中。
  'materials:error': true,
  // 和稿的 visit-plan:missing-context 同属「说明 + 上下文 + 出口」的内容屏 → 顶部对齐。
  'visit-plan:idle': false,
  // 和稿的 visit-plan:failed 同属短故障屏 → 居中。
  'visit-plan:load-failed': true,
}

/** 这一屏是否按稿垂直居中。 */
export function fairIsCentered(screen: FairScreen, state: string): boolean {
  const key = `${screen}:${state}`
  if (key in FAIR_GAP_STATE_CENTERED) return FAIR_GAP_STATE_CENTERED[key]
  return FAIR_CENTERED_STATES.includes(key)
}

/** 稿 DEFAULT_STATE：每个 screen 的默认 state 名，页面状态机以它为「一切正常」那一档。 */
export const FAIR_DEFAULT_STATE: Record<FairScreen, string> = {
  list: 'ready',
  checkin: 'guide',
  detail: 'detail',
  companies: 'list',
  map: 'index',
  materials: 'list',
  'visit-plan': 'missing-context',
  stats: 'ready',
}

/**
 * 稿 fairNotice()：「去之前先知道这几件事」三条。
 *
 * 放在规格表而不是某一个页面里，是因为它同时被 /job-fairs/checkin 与 /job-fairs/:id
 * 渲染——此前它 export 在 JobFairCheckinPage.tsx 上，详情页要 import 一个**页面组件模块**
 * 才能拿到这三句话，页面之间就这样互相缠上了。稿里它本来就是共用片段。
 */
export const FAIR_NOTICE_RULES = [
  '预约与到场登记由主办方和来源平台负责；本机不代预约、不做签到，也查不到登记结果。',
  '用人单位与岗位信息以主办方现场公示为准；本机不代收简历，带足纸质材料当面交给对方。',
  '现场遇到收费、押金、扣留证件，立即停止并告知工作人员。',
] as const

/** 稿底部 .truth 条：八屏共用，是本域的合规底线声明，不得按页删改。 */
export const FAIR_TRUTH_LEAD = '本机不代收简历、不代预约，也不做签到。'
export const FAIR_TRUTH_REST =
  '预约与到场登记由主办方和来源平台负责；现场遇到收费、押金、扣证件请立即告知工作人员。'
export const FAIR_TRUTH_LINK = '遇到问题'

export function fairPillOf(screen: FairScreen, state: string): FairPill {
  const key = `${screen}:${state}`
  return FAIR_PILL[key] ?? FAIR_PILL_GAPS[key] ?? FAIR_DEFAULT_PILL
}

/** 把 BACK 表里的 `:id` 换成真实 fairId；没有 fairId 时退回场次列表，不给死链。 */
export function fairBackOf(screen: FairScreen, fairId: string): { route: string; label: string } {
  const [route, label] = FAIR_BACK[screen]
  if (!route.includes(':id')) return { route, label }
  if (!fairId) return { route: '/job-fairs', label: '返回场次列表' }
  return { route: route.replace(':id', encodeURIComponent(fairId)), label }
}
