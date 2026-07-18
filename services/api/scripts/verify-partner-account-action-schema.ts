import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

const sqliteSchema = read('prisma/schema.prisma')
const postgresSchema = read('prisma/postgres/schema.prisma')
const sqliteMigration = read('prisma/migrations/20260718143000_add_partner_password_proof_state/migration.sql')
const postgresMigration = read(
  'prisma/postgres/migrations/20260718143000_add_partner_password_proof_state/migration.sql',
)
const accountView = read('src/orgs/admin-org-account-view.ts')
const adminOrgs = read('src/orgs/admin-orgs.service.ts')
const authService = read('src/auth/auth.service.ts')
const authController = read('src/auth/auth.controller.ts')
const initialPhoneBind = read('src/auth/initial-phone-bind.service.ts')
const seed = read('prisma/seed.ts')

for (const [label, schema] of [
  ['SQLite', sqliteSchema],
  ['PostgreSQL', postgresSchema],
] as const) {
  assert.match(
    schema,
    /passwordProofState\s+String\s+@default\("legacy"\)/,
    `${label} User schema must default passwordProofState to legacy`,
  )
}

assert.equal(
  createHash('sha256').update(sqliteMigration).digest('hex'),
  createHash('sha256').update(postgresMigration).digest('hex'),
  'SQLite and PostgreSQL password proof migrations must remain byte-equivalent',
)
assert.match(sqliteMigration, /CHECK \("passwordProofState" IN \('legacy', 'temporary', 'owner_managed'\)\)/)

assert.match(accountView, /availableActionVerificationMethods:/)
const responseInterface = accountView.match(/export interface AdminOrgAccount \{([\s\S]*?)\n\}/)?.[1]
assert.ok(responseInterface, 'AdminOrgAccount response interface must exist')
assert.doesNotMatch(
  responseInterface,
  /passwordProofState:/,
  'Admin account response must not expose passwordProofState',
)
assert.match(accountView, /phoneHash && account\.phoneEnc && account\.phoneVerifiedAt/)
assert.match(accountView, /passwordProofState === PASSWORD_PROOF_STATE\.OWNER_MANAGED/)

assert.ok(
  (adminOrgs.match(/PASSWORD_PROOF_STATE\.TEMPORARY/g) ?? []).length >= 4,
  'Admin-created/reset/tombstoned credentials must be temporary',
)
assert.ok(
  (authService.match(/PASSWORD_PROOF_STATE\.OWNER_MANAGED/g) ?? []).length >= 1,
  'Verified-phone password recovery must establish owner_managed proof',
)
assert.match(
  authService,
  /passwordProofStateAfterSelfChange\(user\.passwordProofState, user\.role\)/,
  'Self-service change must preserve non-owner-managed Partner proof state',
)
assert.match(
  initialPhoneBind,
  /user\.role !== 'partner' \|\| user\.passwordProofState === PASSWORD_PROOF_STATE\.OWNER_MANAGED/,
  'Partner initial phone bind must reject admin-known temporary or legacy password proof',
)
assert.match(initialPhoneBind, /passwordProofState: PASSWORD_PROOF_STATE\.OWNER_MANAGED,[\s\S]*tokenVersion: user\.tokenVersion/)
assert.ok(
  (authService.match(/this\.assertPartnerPasswordProofReady\(user\)/g) ?? []).length >= 3,
  'Partner initial and prerecorded phone verification paths must reject untrusted proof states',
)
assert.match(authService, /phoneEnc: user\.phoneEnc,[\s\S]*passwordProofState: PASSWORD_PROOF_STATE\.OWNER_MANAGED,[\s\S]*tokenVersion: user\.tokenVersion/)
assert.match(authService, /jti: randomUUID\(\)/, 'Every newly issued internal JWT must carry a random login identifier')
assert.match(authController, /ApiResponse<Omit<AuthedUser, 'sessionId'>>/)
assert.doesNotMatch(
  authController.match(/me\(@CurrentUser\(\) user: AuthedUser\)[\s\S]*?\n  \}/)?.[0] ?? '',
  /ApiResponse\.ok\(user\)/,
  '/auth/me must not return the server-only session fingerprint',
)
assert.ok(
  (seed.match(/PASSWORD_PROOF_STATE\.TEMPORARY/g) ?? []).length >= 3,
  'Seeded known passwords must reset proof state to temporary',
)

console.log('verify-partner-account-action-schema: PASS')
