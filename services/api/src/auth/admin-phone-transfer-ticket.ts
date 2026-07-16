import { BadRequestException } from '@nestjs/common'
import { decryptPhone, hashPhone, isValidCnMobile } from '../common/crypto/phone-identity'

export type AdminPhoneTransferTicket = {
  adminId: string
  adminTokenVersion: number
  partnerId: string
  partnerTokenVersion: number
  encryptedPhone: string
  phoneHash: string
}

export type AdminPhoneTransferStartResult = {
  bindTicket: string
  cooldownSeconds: number
  expiresInSeconds: number
  sourceAccount: {
    username: string
    organizationName: string
    phoneMasked: string
  }
}

export const adminPhoneTransferKeys = {
  ticket: (adminId: string, bindTicket: string) =>
    `internal:admin:phone-transfer:ticket:${adminId}:${bindTicket}`,
  activeTicket: (adminId: string) => `internal:admin:phone-transfer:active:${adminId}`,
  verifyLock: (adminId: string, bindTicket: string) =>
    `internal:admin:phone-transfer:verify-lock:${adminId}:${bindTicket}`,
  currentPasswordFailures: (adminId: string) =>
    `internal:admin:phone-initial-bind:password-fail:${adminId}`,
  sessionState: (userId: string) => `internal:session-state:${userId}`,
}

export function adminPhoneTransferUnavailable(): BadRequestException {
  return new BadRequestException({
    error: { code: 'AUTH_PHONE_TRANSFER_UNAVAILABLE', message: '当前账号暂不可进行手机号安全转移' },
  })
}

export function parseAdminPhoneTransferTicket(
  serializedTicket: string,
  expectedAdminId: string,
): { ticket: AdminPhoneTransferTicket; phone: string } {
  try {
    const value: unknown = JSON.parse(serializedTicket)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid ticket')

    const ticket = value as Record<string, unknown>
    const ticketKeys = Object.keys(ticket).sort()
    const expectedKeys = [
      'adminId',
      'adminTokenVersion',
      'encryptedPhone',
      'partnerId',
      'partnerTokenVersion',
      'phoneHash',
    ]
    if (
      JSON.stringify(ticketKeys) !== JSON.stringify(expectedKeys) ||
      ticket.adminId !== expectedAdminId ||
      typeof ticket.adminId !== 'string' ||
      !ticket.adminId ||
      typeof ticket.partnerId !== 'string' ||
      !ticket.partnerId ||
      ticket.partnerId === ticket.adminId ||
      typeof ticket.encryptedPhone !== 'string' ||
      !ticket.encryptedPhone ||
      typeof ticket.phoneHash !== 'string' ||
      !ticket.phoneHash ||
      !isNonNegativeSafeInteger(ticket.adminTokenVersion) ||
      !isNonNegativeSafeInteger(ticket.partnerTokenVersion)
    ) {
      throw new Error('invalid ticket')
    }

    const parsedTicket: AdminPhoneTransferTicket = {
      adminId: ticket.adminId,
      adminTokenVersion: ticket.adminTokenVersion,
      partnerId: ticket.partnerId,
      partnerTokenVersion: ticket.partnerTokenVersion,
      encryptedPhone: ticket.encryptedPhone,
      phoneHash: ticket.phoneHash,
    }
    const phone = decryptPhone(parsedTicket.encryptedPhone)
    if (!isValidCnMobile(phone) || hashPhone(phone) !== parsedTicket.phoneHash) {
      throw new Error('invalid ticket phone')
    }
    return { ticket: parsedTicket, phone }
  } catch {
    throw adminPhoneTransferUnavailable()
  }
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}
