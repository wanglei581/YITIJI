import { Page } from '../Page'
import { EmptyState } from '@ai-job-print/ui'
import { FolderIcon } from 'lucide-react'

export default function FilesPage() {
  return (
    <Page title="文件管理" subtitle="用户上传文件及打印文件">
      <EmptyState
        icon={FolderIcon}
        title="暂无文件"
        description="用户上传文件后将在此处显示"
      />
    </Page>
  )
}
