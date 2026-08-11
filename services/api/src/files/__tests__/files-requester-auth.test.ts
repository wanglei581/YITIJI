import assert from 'node:assert/strict'
import test from 'node:test'
import type { JwtService } from '@nestjs/jwt'
import type { AuditService } from '../../audit/audit.service'
import type { RedisService } from '../../common/redis/redis.service'
import type { PrismaService } from '../../prisma/prisma.service'
import { FilesController } from '../files.controller'
import type { FileRequester, FilesService } from '../files.service'

type PrivateFilesController = {
  resolveRequester(req: {
    headers: Record<string, string | string[] | undefined>
  }): Promise<FileRequester | null>
}

function makeController(args: {
  payload: { sub: string; role: 'admin' | 'partner' | 'kiosk'; orgId: string | null; ver: number }
  user: {
    id: string
    role: string
    orgId: string | null
    enabled: boolean
    tokenVersion: number
    deletedAt: Date | null
  } | null
  orgEnabled?: boolean
}): PrivateFilesController {
  const jwt = {
    verify: (_token: string, options?: { audience?: string }) => {
      if (options?.audience === 'enduser') throw new Error('not a member token')
      return args.payload
    },
  } as unknown as JwtService
  const redis = {
    get: async () => null,
    setJsonIfVersionNotOlder: async () => 'written' as const,
  } as unknown as RedisService
  const prisma = {
    user: {
      findUnique: async () => args.user,
    },
    organization: {
      findUnique: async () => (args.user?.orgId ? { enabled: args.orgEnabled ?? true } : null),
    },
  } as unknown as PrismaService

  return new FilesController(
    {} as FilesService,
    {} as AuditService,
    jwt,
    redis,
    prisma
  ) as unknown as PrivateFilesController
}

const request = {
  headers: { authorization: 'Bearer signed-internal-token' },
}

test('mixed-auth file routes reject a disabled user even when the JWT is still valid', async () => {
  const controller = makeController({
    payload: { sub: 'user-1', role: 'admin', orgId: null, ver: 4 },
    user: {
      id: 'user-1',
      role: 'admin',
      orgId: null,
      enabled: false,
      tokenVersion: 4,
      deletedAt: null,
    },
  })

  assert.equal(await controller.resolveRequester(request), null)
})

test('mixed-auth file routes reject a tokenVersion mismatch', async () => {
  const controller = makeController({
    payload: { sub: 'user-1', role: 'admin', orgId: null, ver: 3 },
    user: {
      id: 'user-1',
      role: 'admin',
      orgId: null,
      enabled: true,
      tokenVersion: 4,
      deletedAt: null,
    },
  })

  assert.equal(await controller.resolveRequester(request), null)
})

test('mixed-auth file routes reject a partner whose organization is disabled', async () => {
  const controller = makeController({
    payload: { sub: 'partner-1', role: 'partner', orgId: 'org-old', ver: 2 },
    user: {
      id: 'partner-1',
      role: 'partner',
      orgId: 'org-current',
      enabled: true,
      tokenVersion: 2,
      deletedAt: null,
    },
    orgEnabled: false,
  })

  assert.equal(await controller.resolveRequester(request), null)
})

test('mixed-auth file routes use the current database role and organization', async () => {
  const controller = makeController({
    payload: { sub: 'partner-1', role: 'admin', orgId: 'org-old', ver: 2 },
    user: {
      id: 'partner-1',
      role: 'partner',
      orgId: 'org-current',
      enabled: true,
      tokenVersion: 2,
      deletedAt: null,
    },
    orgEnabled: true,
  })

  assert.deepEqual(await controller.resolveRequester(request), {
    kind: 'user',
    userId: 'partner-1',
    role: 'partner',
    orgId: 'org-current',
  })
})
