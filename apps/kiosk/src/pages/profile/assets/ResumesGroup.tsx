// 我的简历（C-2D）：上传诊断（parse，含优化版入口）+ AI 生成（generate）。
// 入口语义：查看报告 / 查看优化版 / 查看·导出·打印（生成预览页内提供导出与打印）。
// 读取均凭本人会员 token（结果页 getToken 取 Authorization），归属由后端门禁校验。

import { useNavigate } from 'react-router-dom'
import type { MemberResumeItem } from '@ai-job-print/shared'
import { EyeIcon, FileTextIcon, SparklesIcon, WandSparklesIcon } from 'lucide-react'
import { aiStatusLabel, formatTime } from './format'
import { AssetGroupShell, AssetRow, RowTextButton } from './ui'
import type { AssetGroupHandle } from './useMemberAssetGroups'

export function ResumesGroup({ group }: { group: AssetGroupHandle<MemberResumeItem> }) {
  const navigate = useNavigate()
  return (
    <AssetGroupShell
      title="我的简历"
      group={group}
      empty="暂无简历记录，完成 AI 简历服务后在此查看"
      renderRow={(r) =>
        r.kind === 'generate' ? (
          <AssetRow
            key={r.id}
            icon={SparklesIcon}
            iconBg="bg-violet-50"
            iconColor="text-violet-600"
            name={`AI 生成简历 · ${aiStatusLabel(r.status)}`}
            meta={formatTime(r.createdAt)}
          >
            {r.status === 'completed' && (
              <RowTextButton
                label="查看 / 打印"
                icon={EyeIcon}
                onClick={() => navigate('/resume/generate/preview', { state: { taskId: r.taskId } })}
              />
            )}
          </AssetRow>
        ) : (
          <AssetRow
            key={r.id}
            icon={FileTextIcon}
            iconBg="bg-primary-50"
            iconColor="text-primary-600"
            name={`简历诊断 · ${aiStatusLabel(r.status)}${r.optimized ? ' · 已生成优化版' : ''}`}
            meta={formatTime(r.createdAt)}
          >
            <RowTextButton
              label="查看报告"
              icon={EyeIcon}
              onClick={() => navigate('/resume/report', { state: { success: true, taskId: r.taskId } })}
            />
            {r.optimized && (
              <RowTextButton
                label="优化版"
                icon={WandSparklesIcon}
                onClick={() => navigate('/resume/optimize', { state: { taskId: r.taskId } })}
              />
            )}
          </AssetRow>
        )
      }
    />
  )
}
