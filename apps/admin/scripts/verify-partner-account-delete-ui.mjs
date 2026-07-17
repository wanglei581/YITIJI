import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const failures = []

function read(relativePath) {
  const path = resolve(root, relativePath)
  return existsSync(path) ? readFileSync(path, 'utf8') : ''
}

function expect(condition, message) {
  if (!condition) failures.push(message)
}

const adapter = read('src/services/api/orgsAdmin.ts')
const page = read('src/routes/partners/index.tsx')
const manager = read('src/routes/partners/PartnerAccountManager.tsx')
const dialog = read('src/routes/partners/PartnerAccountDeletionDialog.tsx')

console.log('\n=== Partner account safe deletion UI verification ===')

expect(
  adapter.includes("req<{ success: true }>('DELETE', `/admin/orgs/${orgId}/accounts/${accountId}`)"),
  'adapter 必须调用 Admin 成员删除端点',
)
expect(adapter.includes('deleteAccount(orgId: string, accountId: string): Promise<void>'), '服务契约必须声明 deleteAccount')
expect(page.includes('<PartnerAccountManager'), '机构详情必须复用独立的账号管理组件')
expect(dialog.includes('role="alertdialog"'), '确认框必须使用 alertdialog')
expect(dialog.includes('删除后不可直接恢复'), '确认框必须声明不可直接恢复')
expect(manager.includes('LAST_ACTIVE_PARTNER_ACCOUNT_REQUIRED'), '冲突必须给出接替账号提示')
expect(manager.includes('accountBusy !== null'), '删除期间必须锁定同一列表的账号操作')
expect(manager.includes('await onReload()'), '删除成功后必须重新加载机构详情')

if (failures.length > 0) {
  for (const failure of failures) console.error(`  FAIL ${failure}`)
  process.exit(1)
}

console.log('  PASS 删除 adapter、二次确认、忙碌锁、冲突提示与刷新契约完整')
