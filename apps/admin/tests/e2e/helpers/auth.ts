import type { Page } from '@playwright/test'

/** mock 登录旁路写入的会话，与 services/auth MOCK_ADMIN_USER 对齐。 */
export const MOCK_ADMIN_AUTH = {
  token: 'mock-token',
  user: {
    id: 'mock-admin-001',
    name: '系统管理员（预览）',
    role: 'admin' as const,
    orgId: null,
  },
}

export async function injectAdminAuth(page: Page): Promise<void> {
  await page.addInitScript((auth) => {
    try {
      localStorage.setItem('admin_auth_v1', JSON.stringify(auth))
    } catch {
      /* ignore */
    }
  }, MOCK_ADMIN_AUTH)
}
