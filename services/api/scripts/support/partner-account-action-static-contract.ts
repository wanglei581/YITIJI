import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const API_ROOT = resolve(import.meta.dirname, '../..')

async function source(relativePath: string): Promise<string> {
  return readFile(resolve(API_ROOT, relativePath), 'utf8')
}

export async function verifyPartnerAccountActionStaticContract(): Promise<void> {
  const [
    ticket, dto, controller, legacyController, actionService, rebindService, authController,
    adminOrgsService, accountSecurity,
  ] = await Promise.all([
    source('src/auth/partner-account-action-ticket.ts'),
    source('src/orgs/dto/partner-account-action.dto.ts'),
    source('src/orgs/partner-account-action.controller.ts'),
    source('src/orgs/admin-orgs.controller.ts'),
    source('src/auth/partner-account-action.service.ts'),
    source('src/auth/partner-phone-rebind.service.ts'),
    source('src/auth/auth.controller.ts'),
    source('src/orgs/admin-orgs.service.ts'),
    source('src/orgs/admin-org-account-security.ts'),
  ])

  assert.match(ticket, /randomBytes\(32\)\.toString\('base64url'\)/)
  assert.match(ticket, /createHash\('sha256'\)/)
  assert.doesNotMatch(ticket, /verified:\$\{ticket\}|rebind:\$\{ticket\}/)

  assert.match(dto, /assertExactCredentialDto/)
  assert.match(dto, /hasCode\s*!==\s*hasPassword/)
  assert.match(dto, /@Matches\(\/\^\\d\{6\}\$\//)
  assert.match(dto, /@MinLength\(8\)/)
  assert.equal((dto.match(/@MaxLength\(72\)/g) ?? []).length, 2)

  const routes = [
    "@Post('admin/orgs/:orgId/accounts/:accountId/action-challenges')",
    "@Post('admin/orgs/:orgId/accounts/:accountId/action-challenges/:challengeId/verify')",
    "@Delete('admin/orgs/:orgId/accounts/:accountId/action-challenges/:challengeId')",
    "@Delete('admin/orgs/:orgId/accounts/:accountId/action-tickets/current')",
    "@Post('admin/orgs/:orgId/accounts/:accountId/phone-rebind/start')",
    "@Post('admin/orgs/:orgId/accounts/:accountId/phone-rebind/resend-new')",
    "@Post('admin/orgs/:orgId/accounts/:accountId/phone-rebind/verify')",
    "@Delete('admin/orgs/:orgId/accounts/:accountId/phone-rebind/current')",
    "@Delete('admin/orgs/:orgId/accounts/:accountId')",
  ]
  for (const route of routes) assert.ok(controller.includes(route), `missing route ${route}`)
  assert.match(controller, /@Headers\('x-account-action-ticket'\)/)
  assert.match(controller, /@Headers\('x-phone-rebind-ticket'\)/)
  assert.doesNotMatch(legacyController, /@Delete\('admin\/orgs\/:id\/accounts\/:accountId'\)/)
  assert.match(adminOrgsService, /trustedBinding:\s*TrustedAccountActionBinding/)
  assert.doesNotMatch(adminOrgsService, /trustedBinding\?:/)
  assert.match(accountSecurity, /adminTokenVersion/)
  assert.match(accountSecurity, /partnerTokenVersion/)

  const actionContract = `${actionService}\n${ticket}`
  assert.match(actionContract, /ACCOUNT_ACTION_STEP_UP_REQUIRED/)
  assert.match(actionContract, /ADMIN_REAUTH_REQUIRED/)
  assert.match(actionContract, /ACCOUNT_PASSWORD_PROOF_NOT_READY/)
  assert.match(actionService, /consumeDeleteTicketAndAcquireLock/)
  assert.match(actionService, /releaseCommitLock/)
  assert.match(actionContract, /decryptPhone/)
  assert.match(actionContract, /hashPhone\(phone\)\s*!==\s*partner\.phoneHash/)

  assert.match(rebindService, /partner_phone_rebind_new/)
  assert.match(rebindService, /PHONE_TAKEN/)
  assert.match(rebindService, /tokenVersion:\s*\{\s*increment:\s*1\s*\}/)
  assert.match(rebindService, /setJsonIfVersionNotOlder/)
  assert.match(rebindService, /auditLog\.create/)

  assert.match(authController, /@Post\('logout'\)/)
  assert.match(authController, /clearAdminRecentVerification/)
  assert.match(authController, /loggedOut:\s*true/)

  const sensitiveLogging = /(?:logger\.(?:log|warn|error|debug)|console\.(?:log|warn|error))[^\n]*(?:currentPassword|adminCurrentPassword|code|ticket|phoneHash|phoneEnc|redis[^\s]*key)/i
  assert.doesNotMatch(`${actionService}\n${rebindService}`, sensitiveLogging)
}
