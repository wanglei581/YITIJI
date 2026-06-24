/**
 * 合规标准文案库(SSOT — Single Source of Truth)。
 *
 * 三端展示合规横幅 / 提示 / 隐私声明时,**必须**从这里 import 字符串,
 * 严禁在页面里直接硬编码合规文案。原因:
 *   1. 合规边界由 docs/compliance/compliance-boundary.md 和 CLAUDE.md §2 管控,
 *      文案变更必须双方同步,集中在一处便于审计
 *   2. UI 文案禁词("一键投递"等)由 lint 规则扫这里,集中检查
 *   3. 翻译 / A/B / 法务复核时只改一处
 *
 * 维护人:Claude(在 owners.md 独占清单内)。
 * Mavis 等其它协作者只 import 不修改;需新增文案 → 写 handoff-to-claude.md。
 */

export const COMPLIANCE_COPY = {
  /**
   * Kiosk/20 招聘列表顶部横幅(橙色 warning)。
   * 参考:legacy-miaoda/screenshots/kiosk/20-招聘页面.png 已有此文案。
   */
  KIOSK_JOBS_TOP: '本页面岗位信息由合作服务机构或官方就业平台提供,投递及后续招聘流程以前往来源平台办理为准。',

  /**
   * Kiosk/21 招聘会列表顶部横幅(橙色 warning)。
   */
  KIOSK_FAIRS_TOP: '本页面招聘会信息由合作机构或主办方提供,预约及参会流程以前往来源平台办理为准。',

  /**
   * Kiosk 简历上传页隐私承诺(绿色 success,放在上传按钮上方)。
   * Mavis 报告强调:隐私声明可见性必须在 Kiosk 上传页,不能藏在 Admin。
   */
  KIOSK_RESUME_UPLOAD_PRIVACY: '上传的简历仅用于你发起的 AI 分析,不进入简历库、不转发任何第三方。未登录或高敏文件短期自动清理;登录后默认保存 90 天,可在「我的文档」中调整保存期限或随时删除。',

  /**
   * Kiosk 诊断报告页免责声明。AI 诊断分数为求职准备参考,不代表企业真实评价或录用结果。
   */
  KIOSK_RESUME_REPORT_DISCLAIMER: '诊断报告仅供求职准备参考,不代表真实招聘结果。',

  /**
   * Kiosk 简历优化页声明。优化仅调整表达,基于用户真实经历,不编造虚假内容。
   */
  KIOSK_RESUME_OPTIMIZE_DISCLAIMER: '优化建议基于你的真实经历,不生成虚假经历。',

  /**
   * Kiosk 简历服务通用隐私声明。系统不向企业反向推送简历或诊断/优化报告。
   */
  KIOSK_RESUME_NO_SEND_ENTERPRISE: '系统不会将你的简历或报告发送给企业。',

  /**
   * Kiosk 简历诊断/优化页演示数据提示(蓝色 info,放在页面顶部)。
   * 背景:真实 AI Provider 尚未接通(均为 stub),当前分数/建议由演示用 MockAiProvider 生成。
   * 仅在 mock 模式(API_MODE!=='http')展示——http 模式接真后端后,假数据不再出现,banner 自动隐藏。
   * 目的:防止用户把演示分数误当作真实 AI 评价结果。
   */
  KIOSK_RESUME_DEMO_NOTICE: '当前简历诊断 / 优化结果由演示用 AI 生成,分数与建议仅供体验参考;接入正式 AI 服务后将以真实分析为准。',

  /**
   * Kiosk 打印扫描服务中心敏感文件提示(绿色 success)。
   * 证件照、身份证复印件等属敏感文件,完成后按隐私策略自动清理,不长期留存。
   */
  KIOSK_PRINT_SCAN_SENSITIVE: '证件照、身份证等敏感文件仅用于本次打印/扫描,完成后按隐私策略自动清理,不长期留存、不转发第三方。',

  /**
   * Kiosk 签名盖章 MVP 说明页声明(蓝色 info)。
   * 必须明确:图片合成的签名/印章预览不是 CA 认证电子签名,不具备法律效力;
   * 仅用于个人材料整理与打印辅助,不提供 CA 电子签 / 电子认证 / 合同签署服务。
   */
  KIOSK_PRINT_SCAN_ESIGN_NOTICE: '签名盖章仅用于个人材料整理与打印辅助，不提供 CA 电子签、电子认证或合同签署服务；仅为图片合成预览，不具备法律认证效力，正式法律文件请通过具备资质的电子签名服务办理。',

  /**
   * Kiosk 材料扫描流程演示说明(灰/橙色提示)。
   * 真机扫描依赖一体机 + Terminal Agent(TWAIN/扫描到 SMB,Phase 8.2),
   * 当前前端为流程演示,不能让用户误解为已接真机。
   */
  KIOSK_SCAN_DEMO_NOTICE: '当前页面用于流程演示；真机扫描需在一体机连接 Terminal Agent 后使用。',

  /**
   * Kiosk/30 校企合作主页顶部横幅(蓝色 info,严肃合规声明)。
   * 应对客户场景:学校问"我们能不能代收学生简历转给参展企业?"
   */
  KIOSK_CAMPUS_TOP: '本页面岗位信息由参展企业或就业中心提供,简历投递与后续招聘流程以前往来源平台办理为准。本系统不代收求职者简历,不向企业反向推送候选人。',

  /**
   * Admin/08 岗位信息源页顶部横幅(蓝色 info)。
   * 法务最爱的那段。参考:legacy-miaoda/screenshots/admin/08-岗位信息源.png。
   */
  ADMIN_JOB_SOURCES_TOP: '当前平台未取得人力资源服务许可证。系统仅作为第三方信息的聚合入口,禁止在系统内设计一键投递、企业收简历功能,所有岗位必须显示合法的外部跳转链接,由用户在第三方完成流程。',

  /**
   * Admin/06 文件管理页顶部横幅(蓝色 info)。
   * 强调隐私自动清理 + 操作日志。
   */
  ADMIN_FILES_TOP: '系统仅在合规期限内保留必要文件:证件照、身份证复印件等高敏文件按短期有效期自动清理;会员原始简历默认保存 90 天,用户确认后可延长至 180 天;优化后或派生成果物可确认后长期保存,到期由清理任务按 expiresAt 自动从云端物理删除。',

  /**
   * Admin/14 日志审计页顶部声明(蓝色 info)。
   * 强调审计不可篡改,demo 时点这一句最有说服力。
   */
  ADMIN_AUDIT_TOP: '所有管理员操作均由系统自动记录,不可删除、不可篡改。审计日志保留期不少于 180 天。',

  /**
   * Partner 工作台顶部横幅(橙色 warning)。
   * 参考:legacy-miaoda/screenshots/partner/01-首页方案A.png 已有此文案。
   * 应对合作机构方:让他们知道我方不接受平台内投递/筛选/邀约。
   */
  PARTNER_DASHBOARD_TOP: '本后台用于合作数据维护与运营统计,不承接平台内简历投递、候选人筛选和面试邀约。',
} as const

export type ComplianceCopyKey = keyof typeof COMPLIANCE_COPY

/**
 * UI 文案禁词清单。任何用户可见文案(按钮 / 提示 / 标题)出现这些词必须改写。
 * 由 CLAUDE.md §2 管控。lint 规则可扫描三端 src/ 检查。
 */
export const COMPLIANCE_FORBIDDEN_TERMS = [
  '一键投递',
  '立即投递',
  '平台投递',
  '企业收简历',
  '候选人管理',
  '一键报名',
] as const

/**
 * UI 文案推荐替代词。
 */
export const COMPLIANCE_PREFERRED_TERMS = [
  '查看岗位',
  '去来源平台投递',
  '扫码投递',
  '查看招聘会',
  '去来源平台预约',
  '扫码预约',
] as const
