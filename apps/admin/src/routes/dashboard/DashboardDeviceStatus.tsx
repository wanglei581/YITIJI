import { formatCount } from '@ai-job-print/shared'
import { Meter, SectionCard } from '@ai-job-print/ui'
import type { AdminTerminalRecord, AdminPrinterRecord } from '../../services/api/devices'
import { BlockError, BlockLoading, SectionLink } from './DashboardWidgets'

export function DashboardDeviceStatus({ terminals, printers, terminalError, printerError, printerTotal, readyPrinters, toner, paper, onRetry, retryTerminals, retryPrinters }: {
  terminals: AdminTerminalRecord[] | null; printers: AdminPrinterRecord[] | null
  terminalError: boolean; printerError: boolean
  printerTotal: number; readyPrinters: number; toner: number | null; paper: number | null
  onRetry: () => void; retryTerminals: () => void; retryPrinters: () => void
}) {
  return (
            <SectionCard title="设备状态" action={<SectionLink href="/devices">设备管理</SectionLink>}>
              {terminals === null && printers === null ? (
                terminalError || printerError ? (
                  <BlockError
                    message="设备状态加载失败"
                    onRetry={onRetry}
                  />
                ) : (
                  <BlockLoading />
                )
              ) : (
                <div className="flex flex-col gap-2.5">
                  {(() => {
                    if (terminals === null) {
                      return (
                        <p className="text-xs text-warning-fg">
                          终端列表加载失败，终端在线率暂缺。
                          <button type="button" onClick={retryTerminals} className="ml-2 font-bold text-primary-700 hover:underline">
                            重试
                          </button>
                        </p>
                      )
                    }
                    if (terminals.length === 0) {
                      return <p className="py-8 text-center text-sm text-neutral-400">暂无已注册终端</p>
                    }
                    const online = terminals.filter((terminal) => terminal.online).length
                    return (
                      <>
                        <Meter
                          label="终端在线率"
                          percent={(online / terminals.length) * 100}
                          valueText={`${formatCount(online)}/${formatCount(terminals.length)}`}
                          low={online < terminals.length}
                        />
                        {printers !== null && printerTotal > 0 && (
                          <Meter
                            label="打印机就绪"
                            percent={(readyPrinters / printerTotal) * 100}
                            valueText={`${formatCount(readyPrinters)}/${formatCount(printerTotal)}`}
                            low={readyPrinters < printerTotal}
                          />
                        )}
                      </>
                    )
                  })()}
                  {printers !== null ? (
                    <>
                      {toner !== null && (
                        <Meter label="碳粉均值" percent={toner} valueText={`${toner}%`} low={toner < 40} />
                      )}
                      {/* paperTrayLevel 后端当前恒 null（未上报），口径与工作台百分比一致；
                          不上报时整行不渲染（avgLevel 返回 null），绝不显示「张」等猜测单位。 */}
                      {paper !== null && (
                        <Meter label="纸量均值" percent={paper} valueText={`${paper}%`} low={paper < 40} />
                      )}
                      {printerTotal === 0 && terminals !== null && terminals.length > 0 && (
                        <p className="text-xs text-neutral-400">打印机尚无心跳上报</p>
                      )}
                    </>
                  ) : (
                    printerError && (
                      <p className="text-xs text-warning-fg">
                        打印机数据加载失败，打印机状态暂缺。
                        <button type="button" onClick={retryPrinters} className="ml-2 font-bold text-primary-700 hover:underline">
                          重试
                        </button>
                      </p>
                    )
                  )}
                </div>
              )}
            </SectionCard>
  )
}
