/**
 * 工作台「最近操作」用的审计中文名。
 * 取管理员工作台与日志审计页两份动作表的并集，并补上审计契约里有、两页都没有的动作。
 * 工作台与日志审计共用这份标签，列表不显示原始动作码。
 * 没有映射时显示「其他操作」，不把动作码原样给运营看。
 */

const ACTION_LABELS: Record<string, string> = {
  // 第六批补名清单：以下 217 项由服务端源码动作全集补齐。
  'ad_asset.create_external': '新增外链宣传素材',
  'ad_asset.delete': '删除宣传素材',
  'ad_asset.update': '更新宣传素材',
  'ad_asset.upload': '上传宣传素材',
  'ad_playlist.create': '新建宣传播放方案',
  'ad_playlist.delete': '删除宣传播放方案',
  'ad_playlist.update': '更新宣传播放方案',
  'advisor.artifact_print': '打印顾问生成材料',
  'advisor.run': '执行 AI 顾问任务',
  'advisor.session_create': '新建顾问会话',
  'advisor_session.cleanup_expired': '清理过期顾问会话',
  'ai_quota.released': 'AI 调用失败，退回已预占的额度',
  'ai_quota.release_cap_exceeded': 'AI 调用失败，当日退回次数已达上限，不再退回额度',
  'ai.access_switch_changed': '修改 AI 使用开关',
  'ai.access_switch_failed': '修改 AI 使用开关失败',
  'ai.content_blocked': 'AI 内容安全拦截',
  'ai_safety.lexicon.update': '更新 AI 内容安全词库',
  'ai_model_config.toggle': '启停 AI 模型配置',
  'ai_model_config.update': '更新 AI 模型配置',
  'ai_service_log.cleanup_expired': '清理过期 AI 服务日志',
  'ai_usage_record.cleanup_expired': '清理过期 AI 用量记录',
  'assistant.session_summary': '生成助手对话小结',
  'assistant.voice_transcribe': '助手语音转写',
  'auth.first_admin_bootstrap.created': '创建首位管理员',
  'auth.first_admin_bootstrap.password_changed': '首位管理员修改初始密码',
  'auth.password_login_second_factor_sent': '发送登录二次验证短信',
  'auth.password_reset_complete': '完成密码重置',
  'auth.password_reset_start': '开始密码重置',
  'auth.password_reset_unknown': '未找到密码重置账号',
  'auth.phone_bind_code': '发送手机绑定验证码',
  'auth.phone_bind_verify': '核验手机绑定验证码',
  'auth.sms_code_send': '发送短信验证码',
  'benefit.redeem': '核销会员权益',
  'benefit_activity.claim': '领取权益活动',
  'benefit_activity.create': '新建权益活动',
  'benefit_activity.end': '结束权益活动',
  'benefit_activity.publish': '发布权益活动',
  'benefit_activity.update': '更新权益活动',
  'company.create': '新建企业展示资料',
  'company.import': '导入企业展示资料',
  'company.link_jobs': '关联企业展示岗位',
  'company.publish': '发布企业展示资料',
  'company.review': '审核企业展示资料',
  'company.unlink_job': '解除企业岗位关联',
  'company.unpublish': '下架企业展示资料',
  'company.update': '更新企业展示资料',
  'contract_review.report_abandoned': '放弃保存合同审查报告',
  'contract_review.report_generated': '生成合同审查报告',
  'contract_review.report_kept': '本人确认保存合同审查报告',
  'data_source.admin_disable': '管理员停用数据源',
  'data_source.admin_enable': '管理员启用数据源',
  'data_source.archive': '归档数据源',
  'data_source.content_bulk_unpublish': '批量下架数据源内容',
  'data_source.credential_rotate': '轮换数据源凭据',
  'data_source.response_config_update': '更新数据源响应配置',
  'data_source.unarchive': '恢复已归档数据源',
  'excel.import.confirm': '确认表格导入',
  'fair.company.create': '新建招聘会参展企业',
  'fair.company.delete': '删除招聘会参展企业',
  'fair.company.update': '更新招聘会参展企业',
  'fair.material.delete': '删除招聘会材料',
  'fair.material.publish': '发布招聘会材料',
  'fair.material.update': '更新招聘会材料',
  'fair.material.upload': '上传招聘会材料',
  'fair.partner_unpublish': '机构下架招聘会',
  'fair.partner_update': '机构更新招聘会',
  'fair.update': '更新招聘会',
  'fair.venue_guide.delete': '删除招聘会场馆指引',
  'fair.venue_guide.save': '保存招聘会场馆指引',
  'fair.visit_plan': '生成招聘会参观计划',
  'fair.visit_plan_print': '打印招聘会参观计划',
  'fair.zone.create': '新建招聘会展区',
  'fair.zone.delete': '删除招聘会展区',
  'fair.zone.update': '更新招聘会展区',
  'feedback.contact_phone_revealed': '查看反馈联系手机',
  'feedback.reply': '回复用户反馈',
  'feedback.status_change': '变更用户反馈状态',
  'feedback.view': '查看用户反馈',
  'file.admin_access': '管理员访问文件',
  'file.content_tampered': '文件内容变化被拦截',
  'file.direct_upload_completed': '完成文件直传校验',
  'file.retention_update': '更新文件保存期限',
  'file.storage_delete_reconciled': '核对存储文件删除结果',
  'job.partner_unpublish': '机构下架岗位信息',
  'job.partner_update': '机构更新岗位信息',
  'job_material.generate': '生成求职材料',
  'job_material.template.create': '新建求职材料模板',
  'job_material.template.publish': '发布求职材料模板',
  'job_material.template.update': '更新求职材料模板',
  'material_task.pii_manual_confirmed': '人工确认材料个人信息检查',
  'member.ai_record_delete': '删除本人 AI 记录',
  'member.browse_log_delete': '删除本人浏览记录',
  'member.external_jump_log_delete': '删除本人外跳记录',
  'member.package_order.create': '创建会员套餐订单',
  'member.phone.rebind': '会员换绑手机号',
  'member.closure.requested': '会员申请注销账号',
  'member.closure.cancelled': '会员撤回注销申请',
  'member.closure.executed': '执行会员账号注销',
  'member.closure.failed': '会员账号注销未完成',
  'member.print_order.cancel': '会员取消打印订单',
  'member.print_order.create': '会员创建打印订单',
  'member.qa_record_delete': '删除本人问答记录',
  'member.resume_delete': '删除本人简历',
  'member_ai_consent.revoke': '撤回会员 AI 授权',
  'member_benefit.grant': '发放会员权益',
  'member_benefit.revoke': '撤销会员权益',
  'member_benefit.search': '查找会员权益',
  'member_data_export.completed': '完成会员数据导出',
  'member_data_export.delivery_finished': '完成会员数据导出交付',
  'member_data_export.delivery_reconciled': '核对会员数据导出交付',
  'member_data_export.expired': '会员数据导出到期',
  'member_data_export.failed': '会员数据导出失败',
  'member_data_export.orphan_cleaned': '清理未关联的数据导出文件',
  'member_data_export.ready': '会员数据导出文件已就绪',
  'member_data_request.create': '新建会员数据权利申请',
  'member_data_request.reject': '驳回会员数据权利申请',
  'member_data_request.retry': '重试会员数据权利申请',
  'member_notification.broadcast.create': '新建会员群发通知',
  'member_notification.broadcast.delete': '删除会员群发通知',
  'mock_interview.create': '新建模拟面试',
  'mock_interview.member_delete': '删除本人模拟面试',
  'mock_interview.practice_sheet_print': '打印面试练习单',
  'mock_interview.report_generated': '生成模拟面试报告',
  'mock_interview.report_print': '打印模拟面试报告',
  'offline_agency.create': '新建线下机构',
  'offline_agency.update': '更新线下机构',
  'offline_agency_job.create': '新建线下机构岗位入口',
  'offline_agency_job.delete': '删除线下机构岗位入口',
  'offline_agency_job.update': '更新线下机构岗位入口',
  'order.mark_paid_online': '确认订单在线付款',
  'order.mark_paid_redemption': '确认订单权益抵扣付款',
  'order.online_payment_pending_refund': '在线付款订单等待退款',
  'order.paid_unfulfilled_file_unavailable': '已付款未履约订单文件不可用',
  'order.pickup_expired_auto_refund': '取件到期自动退款',
  'order.pickup_expired_auto_refund_skipped': '跳过取件到期自动退款',
  'order.refund': '订单退款',
  'org.account.action_cancelled': '取消机构账号敏感操作',
  'org.account.action_challenge_started': '发送机构账号操作验证码',
  'org.account.action_verification_failed': '机构账号操作验证失败',
  'org.account.action_verified': '机构账号操作验证通过',
  'org.account.admin_verification_failed': '机构账号管理员验证失败',
  'org.account.bind_email': '绑定机构账号邮箱',
  'org.account.create': '新建机构账号',
  'org.account.delete': '删除机构账号',
  'org.account.delete_failed': '删除机构账号失败',
  'org.account.disable': '停用机构账号',
  'org.account.enable': '启用机构账号',
  'org.account.phone_rebind': '机构账号换绑手机号',
  'org.account.phone_rebind_failed': '机构账号换绑手机号失败',
  'org.account.reset_password': '重置机构账号密码',
  'org.account.session_invalidation_failed': '机构账号会话失效处理失败',
  'org.create': '新建机构',
  'org.disable': '停用机构',
  'org.enable': '启用机构',
  'payment.attempt_created': '创建支付尝试',
  'payment.attempt_failed': '支付尝试失败',
  'payment.channel_accepted_unconfirmed': '支付渠道受理但结果未确认',
  'payment.code_attempt_amount_mismatch': '付款码支付金额不符',
  'payment.code_attempt_created': '创建付款码支付尝试',
  'payment.code_attempt_failed': '付款码支付失败',
  'payment.qr_expiry_amount_mismatch': '支付码到期核对金额不符',
  'payment.qr_expiry_channel_closed': '支付码到期关闭渠道订单',
  'payment.qr_expiry_reconciled_paid': '支付码到期核对为已付款',
  'payment.reconcile_amount_mismatch': '支付核对金额不符',
  'payment.reconcile_terminal_failure': '支付核对为终止失败',
  'payment.reconciled': '完成支付核对',
  'policy.create': '新建政策公告',
  'policy.delete': '删除政策公告',
  'policy.eligibility_rules_replace': '更新政策资格规则',
  'policy.emergency_takedown': '紧急下架政策公告',
  'policy.partner_update': '机构更新政策公告',
  'policy.unpublish': '下架政策公告',
  'price.updated': '更新打印价目',
  'print_conversion.images_to_pdf': '合并打印图片为 PDF',
  'print_job.pii_scan_bypassed': '本人确认跳过打印个人信息检查',
  'print_job.retry': '重试打印任务',
  'print_job.takeaway_url': '获取打印文件带走链接',
  'print_job.timeout_unconfirmed': '打印超时且出纸未确认',
  'print_order.pickup_claim': '领取打印订单',
  'print_order.pickup_claim_rejected': '打印订单领取被拒绝',
  'print_order.pickup_code_reissued': '重新签发打印取件码',
  'print_order.release': '放行打印订单',
  'print_scan.task.cancel': '取消扫描任务',
  'print_scan.task.retry': '重试打印扫描任务',
  'print_sign.compose': '合成打印签名',
  'print_task.admin_unpaid_closed': '管理员关闭未付款打印任务',
  'print_task.closed_pending_disposed': '处置已关闭订单待处理打印任务',
  'print_task.legacy_pending_disposed': '处置历史待处理打印任务',
  'recruitment.circuit_break': '招聘内容紧急熔断',
  'recruitment.emergency_takedown': '紧急下架招聘展示内容',
  'recruitment.qualification_evidence_access': '查看招聘资质证据',
  'refund.blocked': '退款被拦截',
  'refund.channel_ambiguous': '退款渠道结果待确认',
  'refund.channel_error': '退款渠道异常',
  'refund.created': '创建退款申请',
  'refund.notify_amount_mismatch': '退款通知金额不符',
  'refund.processing': '退款处理中',
  'refund.retried': '重试退款',
  'resume.career_plan': '生成职业规划',
  'resume.career_plan_print': '打印职业规划',
  'resume.export_unlabeled_requested': '请求导出无标识简历',
  'resume.generate_exported': '导出 AI 生成简历',
  'resume.generate_submitted': '提交 AI 简历生成',
  'resume.job_fit': '生成岗位匹配参考',
  'resume.job_fit_print': '打印岗位匹配参考',
  'resume.layout_adjusted': '调整简历排版',
  'terminal.asset.create_planned': '登记计划装机终端',
  'terminal.bind_code.create': '创建终端绑定码',
  'terminal.capability.cleared': '清除终端能力配置',
  'terminal.capability.update': '更新终端能力开通状态',
  'terminal.credential.emergency_revoke': '紧急撤销终端凭据',
  'terminal.lifecycle.update': '更新终端生命周期',
  'terminal.release_observation_plan.activate': '启用终端发布观测计划',
  'terminal.release_observation_plan.cancel': '取消终端发布观测计划',
  'terminal.release_observation_plan.create': '新建终端发布观测计划',
  'terminal.release_observation_plan.pause': '暂停终端发布观测计划',
  'toolbox_allowed_host.review': '审核工具箱域名',
  'toolbox_allowed_host.upsert': '保存工具箱域名',
  'toolbox_app.create': '新建工具箱应用',
  'toolbox_app.suspend': '暂停工具箱应用',
  'toolbox_version.approve': '审核通过工具箱版本',
  'toolbox_version.create': '新建工具箱版本',
  'toolbox_version.publish': '发布工具箱版本',
  'toolbox_version.reject': '驳回工具箱版本',
  'toolbox_version.submit': '提交工具箱版本审核',
  // 此后保留原有动作中文名。
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
  AiQuotaReservation: 'AI 额度预占记录',
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
