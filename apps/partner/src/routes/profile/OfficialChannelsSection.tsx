import { useCallback, useEffect, useState } from 'react'
import { Button, Card, EmptyState, ErrorState, LoadingState } from '@ai-job-print/ui'
import { AlertTriangleIcon, BadgeCheckIcon, CheckCircle2Icon, PlusIcon, QrCodeIcon } from 'lucide-react'
import { ConfirmActionDialog } from '../../components/ConfirmActionDialog'
import {
  officialChannelErrorMessage,
  partnerOfficialChannelsService,
  type OfficialChannelPartnerItem,
} from '../../services/api/officialChannels'
import { OFFICIAL_CHANNEL_ORDER_MAX } from './officialChannelRules'
import { OfficialChannelDialog, type OfficialChannelDialogTarget } from './OfficialChannelDialog'
import { OfficialChannelRow } from './OfficialChannelRow'

type Notice = { tone: 'success' | 'error'; text: string }

function sortChannels(rows: OfficialChannelPartnerItem[]): OfficialChannelPartnerItem[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => a.row.displayOrder - b.row.displayOrder || a.index - b.index)
    .map(({ row }) => row)
}

/** 已登记官方域名：机构端只读。null = 服务端没返回这一项，不能当成「未登记」。 */
function VerifiedDomains({ domains }: { domains: string[] | null }) {
  if (domains === null) {
    return (
      <div className="mt-4 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-bg px-4 py-3 text-sm text-warning-fg" role="status">
        <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <p>没有读到本机构已登记的官方域名，暂时不能添加渠道；已有渠道照常列出。请稍后刷新重试。</p>
      </div>
    )
  }
  if (domains.length === 0) {
    return (
      <div className="mt-4 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-bg px-4 py-3 text-sm text-warning-fg" role="status">
        <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <div>
          <p className="font-semibold">尚未登记官方域名，请联系平台完成入驻核验</p>
          <p className="mt-1 text-xs leading-relaxed text-neutral-600">
            平台依据本机构入驻时提交的盖章确认函登记官方域名。登记之前不能添加渠道；登记之后，渠道链接只能落在这些域名或其子域名下。
          </p>
        </div>
      </div>
    )
  }
  return (
    <div className="mt-4 rounded-lg bg-neutral-50 px-4 py-3">
      <p className="text-xs text-neutral-500">
        可用官方域名（平台依据入驻时的盖章确认函登记，机构端只读；子域名同样可用）
      </p>
      <ul className="mt-2 flex flex-wrap gap-2" aria-label="可用官方域名">
        {domains.map((domain) => (
          <li
            key={domain}
            className="inline-flex items-center gap-1.5 rounded-full border border-primary-600/20 bg-surface px-3 py-1 font-mono text-xs text-primary-700"
          >
            <BadgeCheckIcon className="h-3.5 w-3.5" aria-hidden="true" />
            {domain}
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * 机构资料页里的「本机构官方渠道」（3.14）。
 *
 * 机构自己维护渠道名称、链接、排序与启停；二维码只出现在本机构自己的一体机上。
 * 域名由平台在入驻核验时登记，这里只读；没登记时如实说明并关掉「添加」。
 * 每个写操作都以服务端返回为准：成功后才改列表、才说「已保存 / 已启用 / 已归档」；
 * 失败时写出服务端的中文原因，列表保持原样。
 */
export function OfficialChannelsSection() {
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading')
  const [loadError, setLoadError] = useState('')
  const [items, setItems] = useState<OfficialChannelPartnerItem[]>([])
  const [domains, setDomains] = useState<string[] | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [dialog, setDialog] = useState<OfficialChannelDialogTarget | null>(null)
  const [archiveTarget, setArchiveTarget] = useState<OfficialChannelPartnerItem | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)

  useEffect(() => {
    let alive = true
    setState('loading')
    partnerOfficialChannelsService
      .list()
      .then((list) => {
        if (!alive) return
        setItems(sortChannels(list.items))
        setDomains(list.verifiedDomains)
        setState('ready')
      })
      .catch((e: unknown) => {
        if (!alive) return
        setLoadError(officialChannelErrorMessage(e, '请稍后重试'))
        setState('error')
      })
    return () => { alive = false }
  }, [reloadKey])

  const upsert = useCallback((saved: OfficialChannelPartnerItem) => {
    setItems((rows) => sortChannels(rows.some((row) => row.id === saved.id)
      ? rows.map((row) => (row.id === saved.id ? saved : row))
      : [...rows, saved]))
  }, [])

  const canAdd = state === 'ready' && domains !== null && domains.length > 0
  const nextOrder = Math.min(OFFICIAL_CHANNEL_ORDER_MAX, items.reduce((max, row) => Math.max(max, row.displayOrder), 0) + 1)

  const toggle = async (channel: OfficialChannelPartnerItem) => {
    setBusyId(channel.id)
    setNotice(null)
    try {
      const saved = await partnerOfficialChannelsService.update(channel.id, { enabled: !channel.enabled })
      upsert(saved)
      setNotice({ tone: 'success', text: `${saved.enabled ? '已启用' : '已停用'}「${saved.name}」` })
    } catch (e) {
      setNotice({
        tone: 'error',
        text: `「${channel.name}」没有${channel.enabled ? '停用' : '启用'}：${officialChannelErrorMessage(e, '请稍后重试')}`,
      })
    } finally {
      setBusyId(null)
    }
  }

  const archive = async () => {
    const channel = archiveTarget
    if (!channel) return
    setBusyId(channel.id)
    setNotice(null)
    try {
      await partnerOfficialChannelsService.archive(channel.id)
      setItems((rows) => rows.filter((row) => row.id !== channel.id))
      setNotice({ tone: 'success', text: `已归档「${channel.name}」` })
    } catch (e) {
      setNotice({ tone: 'error', text: `「${channel.name}」没有归档：${officialChannelErrorMessage(e, '请稍后重试')}` })
    } finally {
      setBusyId(null)
      setArchiveTarget(null)
    }
  }

  return (
    <Card className="mt-6 p-6" role="region" aria-labelledby="official-channels-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-50">
            <QrCodeIcon className="h-5 w-5 text-primary-700" aria-hidden="true" />
          </div>
          <div>
            <h3 id="official-channels-title" className="text-base font-semibold text-neutral-900">本机构官方渠道</h3>
            <p className="mt-0.5 text-xs text-neutral-500">对应一体机「本机构官方渠道」页 · 只在本机构自己的终端上显示</p>
          </div>
        </div>
        <Button
          size="sm"
          className="flex items-center gap-1.5"
          onClick={() => setDialog({ mode: 'create', nextOrder })}
          disabled={!canAdd}
          title={canAdd ? undefined : '平台登记本机构的官方域名之后才能添加渠道'}
        >
          <PlusIcon className="h-4 w-4" aria-hidden="true" />
          添加渠道
        </Button>
      </div>

      <p className="mt-4 text-sm leading-relaxed text-neutral-600">
        {'这里维护的二维码只出现在本机构自己的一体机终端上，用户扫码后打开本机构的官方网站或官方账号。'
          + '渠道由本机构自行维护；平台只在违法违规、权利人投诉等紧急情况下紧急下架，下架后不能恢复。'}
      </p>

      {state === 'ready' && <VerifiedDomains domains={domains} />}

      {notice && (
        <p
          role={notice.tone === 'success' ? 'status' : 'alert'}
          className={`mt-4 flex items-start gap-2 rounded-lg px-4 py-2.5 text-sm ${
            notice.tone === 'success' ? 'bg-success-bg text-success-fg' : 'bg-error-bg text-error-fg'
          }`}
        >
          {notice.tone === 'success'
            ? <CheckCircle2Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            : <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
          {notice.text}
        </p>
      )}

      <div className="mt-4">
        {state === 'loading' && <LoadingState text="正在读取本机构官方渠道…" size="md" className="py-10" />}
        {state === 'error' && (
          <ErrorState
            className="py-10"
            title="官方渠道没有读到"
            message={loadError}
            onRetry={() => setReloadKey((key) => key + 1)}
          />
        )}
        {state === 'ready' && items.length === 0 && (
          <EmptyState
            className="py-10"
            icon={QrCodeIcon}
            title="还没有添加官方渠道"
            description={canAdd
              ? '点右上角「添加渠道」，二维码会出现在本机构自己的一体机上。'
              : '平台登记本机构的官方域名之后，才能在这里添加渠道。'}
          />
        )}
        {state === 'ready' && items.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-neutral-200">
            <table className="w-full text-sm" aria-label="本机构官方渠道列表">
              <thead>
                <tr className="bg-neutral-50 text-left text-xs text-neutral-500">
                  <th className="w-16 px-4 py-2.5 text-center font-medium">排序</th>
                  <th className="px-4 py-2.5 font-medium">渠道名称与链接</th>
                  <th className="w-40 px-4 py-2.5 font-medium">在终端显示</th>
                  <th className="w-44 px-4 py-2.5 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {items.map((channel) => (
                  <OfficialChannelRow
                    key={channel.id}
                    channel={channel}
                    domains={domains}
                    busy={busyId === channel.id}
                    onToggle={() => void toggle(channel)}
                    onEdit={() => setDialog({ mode: 'edit', channel })}
                    onArchive={() => setArchiveTarget(channel)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {dialog && (
        <OfficialChannelDialog
          key={dialog.mode === 'edit' ? `edit:${dialog.channel.id}` : 'create'}
          target={dialog}
          domains={domains ?? []}
          onClose={() => setDialog(null)}
          onSaved={(saved) => {
            upsert(saved)
            setDialog(null)
            setNotice({ tone: 'success', text: `已保存「${saved.name}」` })
          }}
        />
      )}

      <ConfirmActionDialog
        open={archiveTarget !== null}
        tone="danger"
        title={archiveTarget ? `归档「${archiveTarget.name}」？` : ''}
        description={
          archiveTarget?.emergencyTakedown
            ? '归档后这个渠道从本机构的列表中移除。它已被平台紧急下架，归档不会撤销那条下架记录。机构端没有恢复归档的入口。'
            : '归档后这个渠道从本机构的列表中移除，本机构终端上不再显示它的二维码。机构端没有恢复归档的入口，如需再用请重新添加。'
        }
        confirmLabel="确认归档"
        busy={archiveTarget !== null && busyId === archiveTarget.id}
        onConfirm={() => void archive()}
        onCancel={() => setArchiveTarget(null)}
      />
    </Card>
  )
}
