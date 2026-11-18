/** 批量预建终端在列表上的激活投影。只根据生命周期和绑定码行推导，不造时间。 */

export type TerminalActivationStatus = 'no_code' | 'code_unused' | 'code_expired' | 'activated'

export const ACTIVATION_STATUS_LABEL: Record<TerminalActivationStatus, string> = {
  no_code: '未生成码',
  code_unused: '码未用',
  code_expired: '码已过期',
  activated: '已激活',
}

export interface TerminalBindCodeSnapshot {
  usedAt: Date | null
  revokedAt: Date | null
  expiresAt: Date
}

export interface TerminalActivationProjection {
  activationStatus: TerminalActivationStatus
  activationStatusLabel: string
  firstActivatedAt: Date | null
}

export function projectActivation(input: {
  lifecycleStatus: string
  codes: TerminalBindCodeSnapshot[]
  now: Date
}): TerminalActivationProjection {
  const usedAt = input.codes
    .map((code) => code.usedAt)
    .filter((value): value is Date => value instanceof Date)
    .map((value) => value.getTime())
  const firstActivatedAt = usedAt.length > 0 ? new Date(Math.min(...usedAt)) : null
  if (input.lifecycleStatus !== 'planned' || firstActivatedAt) {
    return {
      activationStatus: 'activated',
      activationStatusLabel: ACTIVATION_STATUS_LABEL.activated,
      firstActivatedAt,
    }
  }
  const open = input.codes.filter((code) => !code.usedAt && !code.revokedAt)
  if (open.some((code) => code.expiresAt > input.now)) {
    return {
      activationStatus: 'code_unused',
      activationStatusLabel: ACTIVATION_STATUS_LABEL.code_unused,
      firstActivatedAt: null,
    }
  }
  if (open.length > 0) {
    return {
      activationStatus: 'code_expired',
      activationStatusLabel: ACTIVATION_STATUS_LABEL.code_expired,
      firstActivatedAt: null,
    }
  }
  return {
    activationStatus: 'no_code',
    activationStatusLabel: ACTIVATION_STATUS_LABEL.no_code,
    firstActivatedAt: null,
  }
}
