import { expect, test, type Page, type Route } from '@playwright/test'
import { MOCK_ADMIN_AUTH } from './helpers/auth'
import { openAuthed } from './helpers/open'

const FAIR_NAME = '招聘会资料_探针.pdf'
const SESSION_NAME = '场次资料_探针.pdf'
const RESUME_NAME = '简历_探针.pdf'
const LIST_FAIL = '文件库暂时打不开'
const DELETE_FAIL = '文件正在打印中，暂时不能删除'
const LINK_FAIL = '临时链接签不出来'

function record(id: string, filename: string, purpose: string) {
  return {
    id,
    filename,
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    sha256: 'ab'.repeat(32),
    purpose,
    sensitiveLevel: 'normal',
    status: 'active',
    assetCategory: 'original',
    ownerType: 'partner',
    ownerId: 'org-1',
    retentionPolicy: 'months_3',
    retentionSetBy: 'system',
    retentionConsentAt: null,
    retentionConsentVersion: null,
    retentionLockedReason: null,
    uploaderId: 'org-1',
    endUserId: null,
    expiresAt: '2026-12-01T00:00:00.000Z',
    deletedAt: null,
    deletedBy: null,
    deleteReason: null,
    createdAt: '2026-11-01T00:00:00.000Z',
  }
}

const ALL_FILES = [
  record('file-fair', FAIR_NAME, 'fair_material'),
  record('file-session', SESSION_NAME, 'job_fair_material'),
  record('file-resume', RESUME_NAME, 'resume_upload'),
]

function summary() {
  return {
    totalActive: ALL_FILES.length,
    longTermCount: 0,
    expiringWithin7Days: 0,
    expiringWithin30Days: 0,
    expiredPendingCleanup: 0,
    byRetentionPolicy: [],
    byRetentionSetBy: [],
    generatedAt: '2026-11-17T00:00:00.000Z',
  }
}

async function installFiles(page: Page, mode: 'ok' | 'list-fail' | 'delete-fail' | 'link-fail') {
  const listUrls: string[] = []
  await page.route('**/api/v1/**', async (route: Route) => {
    const request = route.request()
    const url = new URL(request.url())
    const json = (body: unknown, status = 200) => route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body),
    })
    if (url.pathname.endsWith('/auth/me')) {
      return json({ data: { userId: MOCK_ADMIN_AUTH.user.id, role: 'admin', orgId: null } })
    }
    if (url.pathname.endsWith('/files/lifecycle-summary')) {
      return json({ data: summary() })
    }
    if (request.method() === 'DELETE' && /\/files\/[^/]+$/.test(url.pathname)) {
      if (mode === 'delete-fail') {
        return json({ error: { code: 'FILE_IN_USE', message: DELETE_FAIL } }, 409)
      }
      return json({ data: record('file-fair', FAIR_NAME, 'fair_material') })
    }
    if (request.method() === 'GET' && /\/files\/[^/]+\/url$/.test(url.pathname)) {
      if (mode === 'link-fail') {
        return json({ error: { code: 'FILE_URL_FAILED', message: LINK_FAIL } }, 500)
      }
      return json({
        data: {
          fileId: 'file-fair',
          signedUrl: 'https://files.example/probe.pdf',
          expiresAt: '2026-11-17T00:05:00.000Z',
          purpose: 'fair_material',
        },
      })
    }
    if (url.pathname.endsWith('/files')) {
      listUrls.push(url.search)
      if (mode === 'list-fail') {
        return json({ error: { code: 'FILE_LIST_FAILED', message: LIST_FAIL } }, 500)
      }
      const purpose = url.searchParams.get('purpose')
      const wanted = purpose ? new Set(purpose.split(',')) : null
      const items = wanted ? ALL_FILES.filter((file) => wanted.has(file.purpose)) : ALL_FILES
      return json({ data: { items, total: items.length } })
    }
    return json({ items: [], total: 0, data: [] })
  })
  return { listUrls }
}

async function openFiles(page: Page) {
  await openAuthed(page, '/files')
  await expect(page.getByRole('heading', { name: '文件管理' })).toBeVisible()
}

test('招聘会资料筛选把两种用途一起发给列表接口', async ({ page }) => {
  const files = await installFiles(page, 'ok')
  await openFiles(page)
  await expect(page.getByText(RESUME_NAME)).toBeVisible()
  await page.getByRole('button', { name: '招聘会资料', exact: true }).click()
  await expect(page.getByText(FAIR_NAME)).toBeVisible()
  await expect(page.getByText(SESSION_NAME)).toBeVisible()
  await expect(page.getByText(RESUME_NAME)).toHaveCount(0)
  expect(files.listUrls.some((search) => search.includes('purpose=fair_material%2Cjob_fair_material') || search.includes('purpose=fair_material,job_fair_material'))).toBe(true)
})

test('列表失败显示服务端原因，不显示空列表', async ({ page }) => {
  await installFiles(page, 'list-fail')
  await openFiles(page)
  await expect(page.getByText(LIST_FAIL)).toBeVisible()
  await expect(page.getByText('当前筛选条件下无文件')).toHaveCount(0)
  await expect(page.getByText('未找到匹配的文件')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '重试' })).toBeVisible()
})

test('删除被拒绝时保留该行，并显示服务端原因', async ({ page }) => {
  await installFiles(page, 'delete-fail')
  await openFiles(page)
  await expect(page.getByText(FAIR_NAME)).toBeVisible()
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: '手动删除' }).first().click()
  await expect(page.getByText(`删除失败：${DELETE_FAIL}`)).toBeVisible()
  await expect(page.getByText(`已删除：${FAIR_NAME}`)).toHaveCount(0)
  await expect(page.getByText(FAIR_NAME)).toBeVisible()
})

test('取链接失败时显示服务端原因，不显示已打开', async ({ page }) => {
  await installFiles(page, 'link-fail')
  await openFiles(page)
  await page.getByRole('button', { name: '查看文件' }).first().click()
  await expect(page.getByText(`获取访问链接失败：${LINK_FAIL}`)).toBeVisible()
  await expect(page.getByText('已打开')).toHaveCount(0)
  await expect(page.getByText('已查看')).toHaveCount(0)
})
