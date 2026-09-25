/**
 * 大屏「未接入」原因的人类文案。
 *
 * 键是后端契约 `SCREEN_UNAVAILABLE_REASON` 的稳定取值
 * （`packages/shared/src/types/consoleScreen.ts`）。这里**刻意不 import 那个包**：
 * `packages/ui` 没有声明 `@ai-job-print/shared` 依赖，pnpm 也没有把它链进
 * `packages/ui/node_modules`，import 会直接解析不到。给 UI 包加依赖会动 lockfile，
 * 代价远大于收益。
 *
 * 漂移由门禁兜：`apps/admin/scripts/verify-console-screen-ui.mjs` 解析契约文件里
 * 的 reason 取值，断言本表**恰好**覆盖它们（多一个少一个都红）。
 *
 * 每条三段式，缺一不可：
 *   title —— 屏上那行大字，永远是「未接入」或「取数失败」，不写数字；
 *   detail —— 为什么没有。写给验收的人看，必须说清是数据层缺口还是本次故障；
 *   howTo —— 怎么才能有。没有这一句，未接入就变成了甩锅。
 */

export interface ScreenReasonCopy {
  /** 卡片主文案。取数失败与结构性缺失必须不同，样式也不同。 */
  title: string
  /** 窄格子（磁贴）里用的短称；没有就用 title。完整说明仍在悬停提示里。 */
  short?: string
  /** 为什么没有数据。 */
  detail: string
  /** 接入方式，渲染在脚注里。 */
  howTo: string
  /** true = 本次请求失败，下次刷新可能就好了；false = 数据层缺口，刷新无用。 */
  transient: boolean
}

const UNKNOWN_REASON: ScreenReasonCopy = {
  title: '未接入',
  detail: '服务端给出了一个本界面尚未登记的原因代码，因此只能如实说「没有数据」，不猜测数值。',
  howTo: '把该原因代码补进大屏文案表后再上屏。',
  transient: false,
}

export const SCREEN_REASON_COPY: Readonly<Record<string, ScreenReasonCopy>> = {
  kiosk_session_unwritten: {
    title: '未接入',
    detail:
      '会话表当前没有写入，统计不到服务人次。可替代口径是「登录会员数（去重）」，但它不含匿名使用者，与行业口径不是同一件事，因此不在此处冒名顶替。',
    howTo: '接入方式：补一体机会话写入，或改用明确命名的「登录会员数（不含匿名）」。',
    transient: false,
  },
  no_consumable_or_geo_fields: {
    title: '未接入',
    detail:
      '打印机心跳只上报状态枚举（就绪 / 缺纸 / 故障），没有硒鼓与纸张的数值余量；终端也没有经纬度字段，画不出地图。两者都不用估算值代替。',
    howTo: '接入方式：耗材余量需驱动侧补厂商接口；地图需给终端补经纬度。',
    transient: false,
  },
  review_decision_unwritten: {
    title: '未接入',
    detail:
      '审核决策表全仓没有写入，审核时间字段会被三个不同动作覆盖，用它算时长会得到偏小的假值。AI 日志与订单也没有机构字段，做不出按机构的对比。',
    howTo: '接入方式：审核动作落审核决策表并补「进入待审时间」；AI 日志与订单补机构字段。',
    transient: false,
  },
  missing_org_id_on_ai_and_orders: {
    title: '未接入',
    detail:
      '打印订单与 AI 服务日志上没有机构字段，无法按本机构切分。用内容反查当前归属只能拿到「现在归谁」，不是下单当时的快照，历史会漂移，因此不做。',
    howTo: '接入方式：订单与 AI 日志补机构字段，并在写入时固化，不做事后反查。',
    transient: false,
  },
  missing_immutable_source_org_snapshot: {
    title: '未接入',
    detail:
      '行为日志没有不可变的来源机构快照，按机构归因无从算起。用内容反查来源机构只能拿到当前归属，内容换来源机构后历史统计会漂移。',
    howTo: '接入方式：行为日志写入时固化来源机构快照。',
    transient: false,
  },
  print_count_never_incremented: {
    title: '未接入',
    detail: '计数器字段存在，但全仓没有自增路径，它永远是 0。显示 0 等于说「没人打印过」，那是假话。',
    howTo: '接入方式：把资料打印与打印任务完成事件接起来再计数。',
    transient: false,
  },
  color_split_not_indexed: {
    title: '未接入',
    detail: '订单明细没有按分色建索引，拆不出黑白与彩色各多少页。总页数本身是准的。',
    howTo: '接入方式：订单明细补分色索引后再拆分。',
    transient: false,
  },
  token_usage_json_not_numeric: {
    title: '未接入',
    detail: 'AI 日志里的 token 用量是非数值结构，聚合不出输入 / 输出总量。估算成本本身可用。',
    howTo: '接入方式：token 用量改为数值列后再聚合。',
    transient: false,
  },
  percentile_not_aggregated: {
    title: '未接入',
    detail: '延迟只有平均值聚合，没有分位数聚合，算不出 P95。平均延迟本身可用。',
    howTo: '接入方式：补延迟分位聚合。',
    transient: false,
  },
  sample_below_threshold: {
    title: '样本不足',
    detail: '各分组的样本量都低于最小聚合阈值。为防止小样本反推到个人，这里不给数字。',
    howTo: '口径：样本达到最小聚合阈值后自动展示，不做手工放行。',
    transient: false,
  },
  window_row_cap_exceeded: {
    title: '未计算',
    detail: '统计窗口内的数据行数超过了单次聚合上限，本次不做逐日汇总，避免给出算少了的曲线。',
    howTo: '接入方式：改为按日预聚合后再出趋势。',
    transient: false,
  },
  alerts_not_org_scoped: {
    title: '未接入',
    detail: '告警由平台侧实时派生、不落表，也没有按机构切分的维度，无法只给本机构看。',
    howTo: '接入方式：告警派生补机构维度后再对机构开放。',
    transient: false,
  },
  display_token_not_issued: {
    title: '未签发',
    detail: '本期不签发免登录的只读展示令牌。大屏只能在已登录的后台会话里看。',
    howTo: '口径：可吊销的只读展示令牌是后续独立需求。',
    transient: false,
  },
  upload_counter_unwritten: {
    title: '未接入',
    detail:
      '上传的原始记录按隐私要求会在 24 小时内删除（高敏文件 1 小时），直接数原始记录会漏掉已删除的那部分，所以这里不给数。',
    howTo: '接入方式：在上传完成时另写一条不含文件内容的计数（只记次数、成败与渠道），按天汇总后上屏。',
    transient: false,
  },
  recruitment_hosting_disabled: {
    title: '招聘内容托管未开启',
    short: '未开启',
    detail: '本平台的云服务不保存岗位、招聘会、企业资料，这一项只在客户私有化部署中有数据。',
    howTo: '在客户私有化部署中开启招聘内容托管后自动出现。',
    transient: false,
  },
  inspection_counter_unwritten: {
    title: '未接入',
    detail: '材料检查任务里含隐私命中信息，按规定 24 小时内删除，近 7 天、30 天的检查次数无法从原始记录还原。',
    howTo: '接入方式：检查完成时另写一条不含内容的计数，原始检查任务继续按时删除。',
    transient: false,
  },
  source_query_failed: {
    title: '取数失败',
    detail: '本次快照里这一块的数据源查询失败了。这是一次性故障，不是数据层缺口；下次刷新可能就恢复。',
    howTo: '处理：等待下次自动刷新，或手动刷新一次；持续失败请查服务端日志。',
    transient: true,
  },
}

export function screenReasonCopy(reason: string): ScreenReasonCopy {
  return SCREEN_REASON_COPY[reason] ?? UNKNOWN_REASON
}

/** 大屏统一的「打开来源平台入口」措辞。屏上任何地方都不出现投递字样。 */
export const SCREEN_SOURCE_ENTRY_NOTE =
  '按来源机构计数，不含个人身份。这是「打开了外部入口」，不是投递结果 —— 用户是否在来源平台完成后续动作，本平台无从得知也不记录。'
