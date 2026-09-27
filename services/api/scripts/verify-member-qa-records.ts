import 'dotenv/config'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { closeSync, openSync, mkdtempSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { PrismaService } from '../src/prisma/prisma.service'
import { MemberAssetsService } from '../src/member-assets/member-assets.service'
import { JobFitService } from '../src/ai/resume/job-fit.service'
import { CareerPlanService } from '../src/ai/resume/career-plan.service'
import { MemberAssetsController } from '../src/member-assets/member-assets.controller'

async function main() {
  // 不读取开发/生产库；自建可删除的 verify SQLite，CI 也使用相同边界。
  const dir = mkdtempSync(join(tmpdir(), 'w3a-verify-'))
  const db = join(dir, 'member-qa-verify.db')
  closeSync(openSync(db, 'a'))
  process.env.DATABASE_URL = `file:${db}`
  execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'db', 'push'], { cwd: resolve(__dirname, '..'), env: process.env, stdio: 'pipe' })
  process.env.RECRUITMENT_CONTENT_HOSTING_ENABLED = 'false'
  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const service = new MemberAssetsService(prisma)
  const prefix = `verify-w3a-${randomUUID()}`
  const owner = `${prefix}-owner`, other = `${prefix}-other`
  const future = new Date(Date.now() + 3600_000), past = new Date(Date.now() - 1000)
  const sessions: string[] = []
  try {
    for (const id of [owner, other]) await prisma.endUser.create({ data: { id, phoneHash: id, phoneEnc: 'verify-only', nickname: 'verify', enabled: true, status: 'active' } })
    for (const [suffix, endUserId, expiresAt] of [['live', owner, future], ['expired', owner, past], ['other', other, future]] as const) {
      const id = `${prefix}-${suffix}`; sessions.push(id)
      await prisma.advisorSession.create({ data: { id, endUserId, topic: 'verify topic', skill: 'qa', expiresAt } })
    }
    for (let i = 0; i < 61; i++) {
      const createdAt = new Date(1_700_000_000_000 + i)
      await prisma.advisorArtifact.create({ data: { id: `${prefix}-qa-${i}`, sessionId: sessions[0], kind: 'qa_pins', provider: 'verify', payloadJson: JSON.stringify({ title: `verify ${i}`, pins: [{ content: 'private' }] }), createdAt, expiresAt: future } })
      await prisma.aiResumeResult.create({ data: { id: `${prefix}-ai-${i}`, endUserId: owner, taskId: `${prefix}-task-${i}`, kind: 'parse', status: 'completed', provider: 'verify', payloadJson: '{}', createdAt, expiresAt: future } })
    }
    for (const [suffix, sessionId, kind, expiresAt] of [['expired-artifact', sessions[0], 'qa_pins', past], ['expired-session', sessions[1], 'qa_pins', future], ['foreign', sessions[2], 'qa_pins', future], ['not-qa', sessions[0], 'slot_draft', future]] as const) {
      await prisma.advisorArtifact.create({ data: { id: `${prefix}-${suffix}`, sessionId, kind, provider: 'verify', payloadJson: '{}', expiresAt } })
    }
    const first = await service.listAiRecords(owner, { cursor: null, pageSize: 50 }, { cursor: null, pageSize: 50 })
    assert.equal(first.items.length, 50); assert.equal(first.qaRecords.length, 50)
    assert.equal(first.total, 61); assert.equal(first.qaTotal, 61)
    assert.ok(first.nextCursor); assert.ok(first.qaNextCursor)
    const second = await service.listAiRecords(owner, { cursor: first.nextCursor, pageSize: 50 }, { cursor: first.qaNextCursor, pageSize: 50 })
    assert.equal(second.items.length, 11); assert.equal(second.qaRecords.length, 11)
    assert.equal(second.nextCursor, null); assert.equal(second.qaNextCursor, null)
    assert.equal(new Set([...first.qaRecords, ...second.qaRecords].map((item) => item.id)).size, 61)
    for (const item of first.qaRecords) {
      assert.ok(!('payloadJson' in item)); assert.ok(!('accessTokenHash' in item)); assert.ok(!('pins' in item))
      assert.equal(item.sessionId, sessions[0]); assert.equal(item.artifactId, item.id)
    }
    const independent = await service.listAiRecords(owner, { cursor: first.nextCursor, pageSize: 50 }, { cursor: null, pageSize: 50 })
    assert.equal(independent.items.length, 11); assert.equal(independent.qaRecords.length, 50)
    const foreignList = await service.listAiRecords(other, { cursor: null, pageSize: 50 })
    assert.equal(foreignList.qaTotal, 1); assert.equal(foreignList.qaRecords[0].id, `${prefix}-foreign`)
    console.log('PASS QA/main 61 rows, separate cursors, exact totals, expiry/parent expiry, owner isolation, safe fields')

    // 托管关闭时首批可能全被过滤，但不能因此丢掉较早的可见记录。
    for (let i = 0; i < 51; i++) await prisma.aiResumeResult.create({ data: {
      id: `${prefix}-hidden-${i}`, endUserId: owner, taskId: `${prefix}-hidden-task-${i}`, kind: 'job_fit',
      status: 'completed', provider: 'verify', payloadJson: '{"job":{"id":"system-only"}}', expiresAt: future,
    } })
    const hiddenFirst = await service.listAiRecords(owner, { cursor: null, pageSize: 50 })
    assert.equal(hiddenFirst.items.length, 0); assert.ok(hiddenFirst.nextCursor); assert.equal(hiddenFirst.total, 61)
    const hiddenNext = await service.listAiRecords(owner, { cursor: hiddenFirst.nextCursor, pageSize: 50 })
    assert.ok(hiddenNext.items.length > 0)
    for (let i = 0; i < 53; i++) await prisma.fileObject.create({ data: {
      id: `${prefix}-file-${i}`, storageKey: `${prefix}/${i}.pdf`, filename: 'verify.pdf', mimeType: 'application/pdf',
      sizeBytes: 100, sha256: 'verify', purpose: 'print_doc', endUserId: owner, ownerType: 'user', ownerId: owner,
      status: 'active', createdBy: i < 2 ? null : 'job_fit', createdAt: new Date(1_700_000_000_000 + i), expiresAt: future,
    } })
    const docs = await service.listDocuments(owner, { cursor: null, pageSize: 50 })
    assert.equal(docs.items.length, 0); assert.equal(docs.total, 2); assert.ok(docs.nextCursor)
    const oldDocs = await service.listDocuments(owner, { cursor: docs.nextCursor, pageSize: 50 })
    assert.equal(oldDocs.items.length, 2); assert.equal(oldDocs.nextCursor, null)
    console.log('PASS hidden first page preserves AI/document cursor and reaches older allowed records')

    const target = first.qaRecords[0].id
    const missing = (error: unknown) => (error as { getStatus?: () => number }).getStatus?.() === 404
    await assert.rejects(() => service.deleteQaRecord(other, target), missing)
    await assert.rejects(() => service.deleteQaRecord(owner, `${prefix}-not-qa`), missing)
    assert.ok(await prisma.advisorArtifact.findUnique({ where: { id: target } }))
    const writes: unknown[] = []
    const controller = new MemberAssetsController(service, { write: async (entry: unknown) => { writes.push(entry) } } as never)
    await controller.deleteQaRecord({ endUserId: owner } as never, target, { headers: {} })
    assert.equal(await prisma.advisorArtifact.findUnique({ where: { id: target } }), null)
    assert.equal((writes[0] as { targetId: string }).targetId, target)
    assert.equal(writes.length, 1)
    await assert.rejects(() => controller.deleteQaRecord({ endUserId: owner } as never, target, { headers: {} }), missing)
    assert.equal(writes.length, 1)
    const after = await service.listAiRecords(owner, { cursor: null, pageSize: 50 })
    assert.equal(after.qaTotal, 60)
    assert.ok(await prisma.advisorSession.findUnique({ where: { id: sessions[0] } }))
    console.log('PASS QA deletion: cross-owner/non-QA/repeat 404, hard delete, one audit, total refresh, parent retained')
    const taskId = `${prefix}-task-0`
    const unused = {} as never
    const readers = [
      ['job_fit', new JobFitService(prisma, unused, unused, unused)],
      ['career_plan', new CareerPlanService(prisma, unused, unused, unused, unused, unused, unused, unused)],
    ] as const
    for (const [kind, reader] of readers) {
      await prisma.aiResumeResult.create({ data: { taskId, kind, endUserId: owner, status: 'completed', provider: 'verify', expiresAt: future,
        payloadJson: JSON.stringify({ job: { title: '手填要求' }, payload: { summary: 'verify own result' }, basedOn: {}, providerName: 'verify' }),
      } })
      assert.equal((await reader.getLatest(taskId, { endUserId: owner, accessToken: null })).taskId, taskId)
      await assert.rejects(() => reader.getLatest(taskId, { endUserId: other, accessToken: null }), missing)
      await prisma.aiResumeResult.update({ where: { taskId_kind: { taskId, kind } }, data: { expiresAt: past } })
      await assert.rejects(() => reader.getLatest(taskId, { endUserId: owner, accessToken: null }), missing)
      await prisma.aiResumeResult.update({ where: { taskId_kind: { taskId, kind } }, data: { expiresAt: future } })
    }
    await service.deleteResume(owner, `${prefix}-ai-0`)
    for (const [, reader] of readers) await assert.rejects(() => reader.getLatest(taskId, { endUserId: owner, accessToken: null }), missing)
    assert.equal(await prisma.aiResumeResult.count({ where: { taskId } }), 0)
    console.log('PASS existing job-fit/career readers: explicit task, own access, foreign/expired/deleted denial, resume cascade')

  } finally {
    await prisma.advisorSession.deleteMany({ where: { id: { in: sessions } } })
    await prisma.aiResumeResult.deleteMany({ where: { endUserId: { in: [owner, other] } } })
    await prisma.fileObject.deleteMany({ where: { endUserId: { in: [owner, other] } } })
    await prisma.endUser.deleteMany({ where: { id: { in: [owner, other] } } })
    await prisma.onModuleDestroy()
    rmSync(dir, { recursive: true, force: true })
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
