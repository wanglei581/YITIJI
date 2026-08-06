import 'dotenv/config'
import { PrismaService } from '../src/prisma/prisma.service'
import {
  createFirstAdmin,
  createTemporaryAdminPassword,
  hashTemporaryAdminPassword,
  readFirstAdminBootstrapConfig,
  writeCredentialsFile,
} from '../src/auth/first-admin-bootstrap'

async function main(): Promise<void> {
  const config = readFirstAdminBootstrapConfig(process.env)
  const prisma = new PrismaService()
  if (prisma.dbKind !== 'postgres') throw new Error('FIRST_ADMIN_BOOTSTRAP_POSTGRES_REQUIRED')
  await prisma.onModuleInit()
  let credentialsWritten = false
  let databaseCommitted = false
  try {
    if (await prisma.user.count() !== 0) throw new Error('FIRST_ADMIN_BOOTSTRAP_NOT_EMPTY')
    const temporaryPassword = createTemporaryAdminPassword()
    const passwordHash = await hashTemporaryAdminPassword(temporaryPassword)
    writeCredentialsFile(config.credentialsPath, { username: config.username, temporaryPassword })
    credentialsWritten = true
    const user = await createFirstAdmin(prisma, {
      username: config.username,
      name: config.name,
      passwordHash,
    })
    databaseCommitted = true
    console.log(JSON.stringify({ ok: true, userId: user.id, username: user.username, credentialsPath: config.credentialsPath }))
  } catch (error) {
    if (credentialsWritten && !databaseCommitted) {
      const code = error instanceof Error ? error.message.split(':', 1)[0] : 'UNKNOWN'
      throw new Error(
        `FIRST_ADMIN_BOOTSTRAP_RECONCILIATION_REQUIRED: credentials retained at ${config.credentialsPath}; `
        + `verify User and ${'auth.first_admin_bootstrap.created'} audit state before use or deletion; cause=${code}`,
      )
    }
    throw error
  } finally {
    await prisma.onModuleDestroy()
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
