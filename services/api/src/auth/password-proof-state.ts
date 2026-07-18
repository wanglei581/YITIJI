export const PASSWORD_PROOF_STATE = {
  LEGACY: 'legacy',
  TEMPORARY: 'temporary',
  OWNER_MANAGED: 'owner_managed',
} as const

export type PasswordProofState = (typeof PASSWORD_PROOF_STATE)[keyof typeof PASSWORD_PROOF_STATE]

export function passwordProofState<T extends PasswordProofState>(state: T): T {
  return state
}
