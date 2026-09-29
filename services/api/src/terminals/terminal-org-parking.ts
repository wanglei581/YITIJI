// 终端绑定机构时的停放类型（托管 a，next-tasks 3.15）。
//
// 企业来源与招聘会主办方两类机构在我们云上停放：不再出现在终端可选机构列表里，
// 新绑定与预创建一律拒绝（ORG_TYPE_PARKED，与机构页同一个错误码）。
// 存量绑定不动，由后台页面提示「该机构类型已停放，建议改绑」。

import { BadRequestException } from '@nestjs/common'

export const PARKED_TERMINAL_ORG_TYPES = ['enterprise_source', 'fair_organizer'] as const

export function isParkedTerminalOrgType(type: string | null | undefined): boolean {
  return typeof type === 'string' && (PARKED_TERMINAL_ORG_TYPES as readonly string[]).includes(type)
}

export function orgTypeParkedError(): BadRequestException {
  return new BadRequestException({
    error: { code: 'ORG_TYPE_PARKED', message: '该机构类型已停放，不能绑定终端' },
  })
}
