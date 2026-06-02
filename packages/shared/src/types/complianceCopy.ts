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
  KIOSK_RESUME_UPLOAD_PRIVACY: '上传的简历仅供本次 AI 分析使用,分析完成后 1 小时内自动删除,不留存、不转发任何第三方。',

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
  ADMIN_FILES_TOP: '系统仅在合规期限内保留必要文件。涉及隐私的敏感文件(身份证复印件、证件照、用户自传的简历)将在设定有效期(默认 24 小时)后自动从云端清理,以满足隐私保护合规要求。',

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
