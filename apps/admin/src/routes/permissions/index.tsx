import { Card } from '@ai-job-print/ui'
import { Page } from '../Page'

const COLUMNS = ['角色名称', '描述', '成员数', '权限范围', '创建时间', '操作']

export default function PermissionsPage() {
  return (
    <Page title="权限管理" subtitle="管理员角色与操作权限">
      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-100 bg-gray-50">
              <tr>
                {COLUMNS.map((h) => (
                  <th key={h} className="whitespace-nowrap px-4 py-3 text-left text-xs font-medium text-gray-500">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {[0, 1, 2].map((i) => (
                <tr key={i}>
                  {COLUMNS.map((_, j) => (
                    <td key={j} className="px-4 py-4">
                      <div className="h-3 w-3/4 rounded bg-gray-100" />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t border-gray-100 bg-gray-50 px-5 py-3 text-xs text-gray-400">
          角色权限模型设计中,后续将提供"超级管理员 / 运营 / 只读"等预置角色
        </div>
      </Card>
    </Page>
  )
}
