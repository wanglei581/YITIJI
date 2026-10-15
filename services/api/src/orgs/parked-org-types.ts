import { BadRequestException } from '@nestjs/common'

/**
 * next-tasks 3.15 停放的机构类型：企业来源方与招聘会主办方。
 *
 * 托管 a 下我们云上不存岗位、招聘会、企业资料，这两类机构在本平台已经没有可做的事：
 * 不能新建、不能把现有机构改成这两类、不能导入（partner-capabilities.ts 矩阵已置 false）、
 * 不能绑定终端（终端绑定那一路复用本文件的错误码）。
 *
 * 存量不动：已经是这两类的机构照常读取、登录、启停，编辑与类型无关的字段也不受影响。
 * 客户私有化部署（b）若要恢复，改这里的清单即可，前后端各处都从这份清单或同一错误码出发。
 */
export const PARKED_ORG_TYPES = ['enterprise_source', 'fair_organizer'] as const

export type ParkedOrgType = (typeof PARKED_ORG_TYPES)[number]

const PARKED_TYPE_LABELS: Record<ParkedOrgType, string> = {
  enterprise_source: '企业数据来源',
  fair_organizer: '招聘会主办方',
}

/** 停放类型被拒时的错误码。终端绑定用同一个码，前端按它出同一句提示。 */
export const ORG_TYPE_PARKED = 'ORG_TYPE_PARKED'

export function isParkedOrgType(type: string | null | undefined): type is ParkedOrgType {
  return typeof type === 'string' && (PARKED_ORG_TYPES as readonly string[]).includes(type)
}

export function throwOrgTypeParked(type: string): never {
  throw new BadRequestException({
    error: {
      code: ORG_TYPE_PARKED,
      // 文案不带类型英文键，前端直接展示给管理员（有的前端解析器会把 details 拼进提示，所以也不放 details）。
      message: `企业数据来源、招聘会主办方这两类机构已停放：不能新建，也不能把机构改成这两类（本次类型：${PARKED_TYPE_LABELS[type as ParkedOrgType] ?? '已停放类型'}）`,
    },
  })
}
