export const PASSWORD_PROOF_STATE = {
  LEGACY: 'legacy',
  TEMPORARY: 'temporary',
  OWNER_MANAGED: 'owner_managed',
} as const

export type PasswordProofState = (typeof PASSWORD_PROOF_STATE)[keyof typeof PASSWORD_PROOF_STATE]

export const PARTNER_PASSWORD_PROOF_NOT_READY_MESSAGE = '这个机构账号还没有登记使用人的手机号，暂时不能自己验证。请联系平台运营，凭盖章的《账号联系人确认函》登记联系人手机号；登记后在登录页点「忘记密码」设置自己的密码即可。'

export function partnerPhoneSelfVerifyReady(role: string, state: string): boolean {
  return role !== 'partner' || state === PASSWORD_PROOF_STATE.OWNER_MANAGED
}

export function passwordProofState<T extends PasswordProofState>(state: T): T {
  return state
}

export function passwordProofStateAfterSelfChange(current: string, role: string): PasswordProofState {
  if (role !== 'partner') return PASSWORD_PROOF_STATE.OWNER_MANAGED
  if (current === PASSWORD_PROOF_STATE.OWNER_MANAGED) return PASSWORD_PROOF_STATE.OWNER_MANAGED
  if (current === PASSWORD_PROOF_STATE.TEMPORARY) return PASSWORD_PROOF_STATE.TEMPORARY
  return PASSWORD_PROOF_STATE.LEGACY
}
