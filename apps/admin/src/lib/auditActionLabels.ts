/**
 * 工作台「最近操作」用的审计中文名。
 * 取管理员工作台与日志审计页两份动作表的并集，并补上审计契约里有、两页都没有的动作。
 * 工作台与日志审计共用这份标签，列表不显示原始动作码。
 * 没有映射时显示「其他操作」，不把动作码原样给运营看。
 */

const ACTION_LABELS: Record<string, string> = {
  'admin.user.detail.view': '查看用户详情',
  'admin.user.phone_search': '按手机号查找用户',
  'admin.user.restore': '恢复用户账号',
  'job_ai_session.cleanup_expired': '清理过期岗位 AI 会话',
  'print_job.create': '创建打印任务',
  'order.mark_paid': '确认订单已付款',
  'resume.diagnosis_exported': '导出简历诊断报告',
  'ai_resume_result.cleanup_expired': '清理过期 AI 简历结果',
  'file.upload': '文件上传',
  'file.delete': '文件删除',
  'file.force_delete': '文件删除',
  'file.cleanup_expired': '过期文件清理',
  'file.get_signed_url': '访问文件',
  'job.review': '岗位审核',
  'job.publish': '岗位发布',
  'job.import': '岗位导入',
  'offline_agency.review': '线下机构审核',
  'offline_agency.publish': '线下机构发布',
  'offline_agency.delete': '线下机构删除',
  'job_source.create': '岗位数据源创建',
  'job_source.update': '岗位数据源更新',
  'fair.review': '招聘会审核',
  'fair.publish': '招聘会发布',
  'fair.import': '招聘会导入',
  'data_source.create': '数据源创建',
  'data_source.toggle': '数据源启停',
  'smart_campus_config.update': '智慧校园配置更新',
  'partner.smart_campus_config.update': '机构智慧校园配置更新',
  'toolbox_config.update': '工具箱配置更新',
  'kiosk_job_board.global_update': '一体机岗位板全局更新',
  'kiosk_job_board.terminal_update': '一体机岗位板终端更新',
  'terminal.org.update': '终端所属机构更新',
  'terminal.profile.update': '终端资料更新',
  'terminal.bind_code.exchange': '终端绑定码兑换',
  'resume.parse_submitted': '简历解析提交',
  'resume.optimize_requested': '简历优化请求',
  'resume.self_assessment_create': '简历自评创建',
  'resume.self_assessment_view': '简历自评查看',
  'resume.self_assessment_print': '简历自评打印',
  'resume.self_assessment_withdraw': '简历自评撤回',
  'assistant.chat_message': 'AI 助手消息',
  'auth.password_login': '密码登录',
  'auth.sms_login': '短信登录',
  'auth.password_change_self': '本人修改密码',
  'auth.phone_initial_bind_start': '开始绑定手机号',
  'auth.phone_initial_bind_complete': '完成绑定手机号',
  'auth.phone_initial_bind_cancel': '取消绑定手机号',
  'auth.phone_transfer_start': '开始换绑手机号',
  'auth.phone_transfer_complete': '完成换绑手机号',
  'auth.phone_transfer_cancel': '取消换绑手机号',
  'auth.phone_released_by_admin': '管理员解绑手机号',
  'organization.create': '机构创建',
  'organization.update': '机构资料更新（历史记录）',
  'organization.content_trust': '机构内容可信核验',
  'organization.verified_domains_replace': '更新机构已核验域名',
  'org.update': '机构资料更新（管理员）',
  'org.self_profile_update': '机构自助资料更新',
  'official_channel.create': '新增官方渠道',
  'official_channel.update': '更新官方渠道',
  'official_channel.archive': '归档官方渠道',
  'user.create': '内部账号创建',
  'user.disable': '内部账号停用',
  'user.enable': '内部账号启用',
  'user.step_up_failed': '本人密码确认失败',
  'user.backup_admin_challenge_started': '备用管理员验证码已发送',
  'user.emergency_enable_requested': '备用管理员应急启用',
  'partner_account.contact_phone_registered': '登记机构联系人手机',
  'partner_account.contact_phone_registration_reverted': '撤回联系人手机登记（知会短信未发出）',
  'company.maintenance_unpublish': '下架演示企业（运维）',
  'admin.user.disable': '用户停用',
  'system.login': '登录（历史记录）',
  'system.config_change': '系统配置变更',
  'print_job.admin_abandon': '管理员废弃打印任务',
  'print_job.admin_verify_outcome': '管理员核查打印结果',
  'alert.acknowledge': '确认告警',
  'alert.silence': '静默告警',
  'alert.close': '关闭告警',
  'alert.reopen': '重新打开告警',
  'legal_doc.view': '查看法务文档正文',
  'legal_doc.create': '新建法务文档版本',
  'legal_doc.activate': '启用法务文档版本',
  'policy.publish': '政策发布',
  'policy.review': '政策审核',
  'screensaver_config.update': '待机宣传屏配置更新',
}

const ROLE_LABELS: Record<string, string> = {
  admin: '管理员',
  partner: '合作机构',
  kiosk: '一体机',
  system: '系统',
  'system-cli': '系统',
  'system-bootstrap': '系统',
  member: '会员',
  anonymous_report_capability: '匿名用户',
  enduser: '用户',
  end_user: '用户',
}

const TARGET_LABELS: Record<string, string> = {
  auth: '登录',
  EndUser: '用户',
  order: '订单',
  ai_resume_result: 'AI 简历结果',
  job_ai_session: '岗位 AI 会话',
  file: '文件',
  job: '岗位',
  job_source: '岗位信息源',
  offline_agency: '线下机构',
  organization: '机构',
  org: '机构',
  fair: '招聘会',
  fair_source: '招聘会信息源',
  user: '用户',
  system: '系统',
  smart_campus_config: '智慧校园配置',
  toolbox_config: '工具箱配置',
  kiosk_job_board: '一体机岗位板',
  terminal: '终端',
  print_task: '打印任务',
  print_job: '打印任务',
  derived_alert: '告警',
  alert: '告警',
  LegalDocVersion: '法务文档版本',
  legal_doc: '法务文档版本',
  legal_doc_version: '法务文档版本',
  policy: '政策',
  official_channel: '官方渠道',
  screensaver_config: '待机宣传屏',
  ad_playlist: '播放方案',
}

const ACTOR_NAME_KEYS = ['actorName', 'operatorName', 'userName', 'username', 'displayName', 'realName']

export interface AuditActorInput {
  actorRole: string
  actorId: string | null
  payloadJson?: string | null
  currentUser?: { id: string; name: string } | null
  /** 列表记录上若多带了姓名字段，从这里读；没有就只显示角色。 */
  record?: object | null
}

export function getAuditActionLabel(action: string): string {
  return ACTION_LABELS[action] ?? '其他操作'
}

export function getAuditTargetLabel(targetType: string | null | undefined): string {
  if (!targetType) return ''
  return TARGET_LABELS[targetType] ?? '其他对象'
}

export function getAuditRoleLabel(role: string): string {
  return ROLE_LABELS[role] ?? '其他角色'
}

function looksLikeOpaqueId(value: string): boolean {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) return true
  if (/^c[a-z0-9]{20,}$/i.test(value)) return true
  if (/^[0-9a-f]{24,}$/i.test(value)) return true
  return value.length >= 16 && /^[A-Za-z0-9_-]+$/.test(value)
}

function readablePersonName(value: unknown, actorId: string | null): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text || text.length > 40) return null
  if (actorId && text === actorId) return null
  if (looksLikeOpaqueId(text)) return null
  return text
}

function nameFromRecord(record: object | null | undefined, actorId: string | null): string | null {
  if (!record) return null
  const bag = record as Record<string, unknown>
  for (const key of ACTOR_NAME_KEYS) {
    const name = readablePersonName(bag[key], actorId)
    if (name) return name
  }
  return null
}

function nameFromPayload(payloadJson: string | null | undefined, actorId: string | null): string | null {
  if (!payloadJson) return null
  try {
    const parsed = JSON.parse(payloadJson) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    return nameFromRecord(parsed, actorId)
  } catch {
    return null
  }
}

export function getAuditActorLabel(input: AuditActorInput): string {
  const fromRecord = nameFromRecord(input.record, input.actorId)
  if (fromRecord) return fromRecord
  const fromPayload = nameFromPayload(input.payloadJson, input.actorId)
  if (fromPayload) return fromPayload
  const me = input.currentUser
  if (me && input.actorId && me.id === input.actorId) {
    const mine = readablePersonName(me.name, input.actorId)
    if (mine) return mine
  }
  return ROLE_LABELS[input.actorRole] ?? '其他'
}
