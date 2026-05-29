import { Card } from '@ai-job-print/ui'
import { Page } from '../Page'

const COLUMNS = ['时间', '操作人', '动作', '目标对象', '终端 IP', '结果']

export default function AuditPage() {
  return (
    <Page title="日志审计" subtitle="管理员操作日志与系统事件">
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
              {[0, 1, 2, 3, 4, 5].map((i) => (
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
          审计日志接入中,所有管理员操作将在此实时记录
        </div>
      </Card>
    </Page>
  )
}
