/**
 * 机构类型矩阵：type 决定唯一场景模板和模块权限上限。
 * 从 admin-orgs.service 拆出，避免收费复位去引用机构服务时和本表绕成环。
 */

export interface OrgTypeMatrixRule {
  sceneTemplate: string | null
  allowedModules: Set<string>
}

const matrixModules = (modules: string[]) => new Set(modules)

const PUBLIC_EMPLOYMENT_RULE: OrgTypeMatrixRule = {
  sceneTemplate: 'public_employment',
  allowedModules: matrixModules([
    'resume_service', 'print_scan', 'policy_service', 'job_info', 'job_fair',
    'ai_interview', 'device_status', 'service_statistics', 'external_apply_redirect',
  ]),
}

export const ORG_TYPE_MATRIX: Record<string, OrgTypeMatrixRule> = {
  school_employment_center: {
    sceneTemplate: 'school',
    allowedModules: matrixModules([
      'resume_service',
      'print_scan',
      'policy_service',
      'job_info',
      'job_fair',
      'smart_campus',
      'ai_interview',
      'device_status',
      'service_statistics',
      'external_apply_redirect',
    ]),
  },
  public_employment_service: PUBLIC_EMPLOYMENT_RULE,
  // 零工之家、就业服务站属公共就业服务体系，场景与模块上限同人社版（2026-09-29 新增）。
  gig_worker_home: PUBLIC_EMPLOYMENT_RULE,
  employment_service_station: PUBLIC_EMPLOYMENT_RULE,
  licensed_hr_agency: {
    sceneTemplate: 'licensed_hr_service',
    allowedModules: matrixModules([
      'resume_service',
      'print_scan',
      'job_info',
      'job_fair',
      'ai_interview',
      'device_status',
      'service_statistics',
      'external_apply_redirect',
    ]),
  },
  fair_organizer: {
    sceneTemplate: null,
    allowedModules: matrixModules([]),
  },
  enterprise_source: {
    sceneTemplate: null,
    allowedModules: matrixModules([]),
  },
}
