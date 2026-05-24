import { Button, Card, PageHeader, StatusBadge } from '@ai-job-print/ui'
import {
  BriefcaseIcon,
  CalendarIcon,
  FileTextIcon,
  PrinterIcon,
  ScanIcon,
  SparklesIcon,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'

export function HomePage() {
  const navigate = useNavigate()

  return (
    <div className="p-6">
      <PageHeader
        title="AI求职打印服务终端"
        subtitle="请选择您需要的服务"
        actions={<StatusBadge status="success" label="设备正常" />}
      />

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* AI简历服务 */}
        <Card className="flex flex-col">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary-50">
              <SparklesIcon className="h-6 w-6 text-primary-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">AI简历服务</h2>
              <p className="text-sm text-gray-500">上传、诊断、优化、打印</p>
            </div>
          </div>
          <Button
            className="mt-6 w-full"
            size="lg"
            onClick={() => navigate('/resume/upload')}
          >
            开始使用
          </Button>
        </Card>

        {/* 打印扫描 */}
        <Card className="flex flex-col">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-gray-100">
              <PrinterIcon className="h-6 w-6 text-gray-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">打印扫描</h2>
              <p className="text-sm text-gray-500">文件打印 · 扫描存档</p>
            </div>
          </div>
          <Button
            className="mt-6 w-full"
            size="lg"
            variant="secondary"
            onClick={() => navigate('/print/upload')}
          >
            开始打印
          </Button>
        </Card>

        {/* 扫描存档 */}
        <Card className="flex flex-col">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-gray-100">
              <ScanIcon className="h-6 w-6 text-gray-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">扫描服务</h2>
              <p className="text-sm text-gray-500">扫描原件，生成 PDF</p>
            </div>
          </div>
          <Button
            className="mt-6 w-full"
            size="lg"
            variant="secondary"
            onClick={() => navigate('/print/upload')}
          >
            开始扫描
          </Button>
        </Card>

        {/* 岗位信息 */}
        <Card className="flex flex-col">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-gray-100">
              <BriefcaseIcon className="h-6 w-6 text-gray-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">岗位信息</h2>
              <p className="text-sm text-gray-500">第三方平台岗位展示</p>
            </div>
          </div>
          <Button
            className="mt-6 w-full"
            size="lg"
            variant="ghost"
            onClick={() => navigate('/jobs')}
          >
            查看岗位
          </Button>
        </Card>

        {/* 招聘会 */}
        <Card className="flex flex-col">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-gray-100">
              <CalendarIcon className="h-6 w-6 text-gray-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">招聘会</h2>
              <p className="text-sm text-gray-500">近期招聘会活动信息</p>
            </div>
          </div>
          <Button
            className="mt-6 w-full"
            size="lg"
            variant="ghost"
            onClick={() => navigate('/job-fairs')}
          >
            查看招聘会
          </Button>
        </Card>

        {/* 政策服务 */}
        <Card className="flex flex-col">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-gray-100">
              <FileTextIcon className="h-6 w-6 text-gray-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">政策服务</h2>
              <p className="text-sm text-gray-500">就业政策 · 补贴指南</p>
            </div>
          </div>
          <Button
            className="mt-6 w-full"
            size="lg"
            variant="ghost"
          >
            查看政策
          </Button>
        </Card>
      </div>
    </div>
  )
}
