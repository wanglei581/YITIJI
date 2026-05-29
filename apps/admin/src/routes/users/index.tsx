import { Card } from '@ai-job-print/ui'
import { Page } from '../Page'

const COLUMNS = ['手机号', '昵称', '所属终端', '注册时间', '最近活跃', '订单数', '操作']

export default function UsersPage() {
  return (
    <Page title="用户管理" subtitle="终端注册用户列表">
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
              {[0, 1, 2, 3, 4].map((i) => (
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
          用户数据接入中,接入后将显示真实记录
        </div>
      </Card>
    </Page>
  )
}
