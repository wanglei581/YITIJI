import type { ReactNode } from 'react'
import { QxTouchBand } from '../../components/qingxu/touch/QxTouchBand'
import { QxTouchDock } from '../../components/qingxu/touch/QxTouchDock'
import { QxTouchIcon, type QxTouchIconName } from '../../components/qingxu/touch/QxTouchIcon'
import {
  QxTouchStateAiDown,
  QxTouchStateDeviceOff,
  QxTouchStateEmpty,
  QxTouchStateError,
  QxTouchStateLoading,
  QxTouchStateUnavailable,
  QxTouchStateUnconfirmed,
} from '../../components/qingxu/touch/QxTouchStates'
import type { QxTouchTileProps } from '../../components/qingxu/touch/QxTouchTile'

export type GalleryStateId = 'loading' | 'empty' | 'error' | 'unavailable' | 'device-off' | 'unconfirmed' | 'ai-down'

const PHONE = '183-6916-1921'

type Actions = {
  onGo: (label: string) => void
  onHome: () => void
  onBack: () => void
}

function holdTile(icon: QxTouchIconName, title: string, desc: string, tone?: QxTouchTileProps['tone']): QxTouchTileProps {
  return { icon, title, desc, tone, off: true, label: `${title}，${desc}` }
}

export function buildStateFrame(id: GalleryStateId, actions: Actions): {
  band: ReactNode
  body: ReactNode
  dock: ReactNode
  bodyClassName: string
} {
  const go = actions.onGo
  if (id === 'loading') {
    return {
      bodyClassName: 'qxt-body-print',
      band: (
        <QxTouchBand
          place=" "
          onBack={actions.onBack}
          eyebrow="打印扫描服务"
          title="正在确认这台机器能做什么。"
          sub="确认前，打印、扫描这几项先不进入；到机码、复印照常可用。"
          seal="idle"
          status={{ text: '正在读取本机能力', tone: 'reading' }}
          rail={{ labels: ['选文件', '材料检查', '预览与参数', '核对价格'], now: -1 }}
        />
      ),
      body: (
        <QxTouchStateLoading
          fine="按 A4 出纸 · 彩色 / 双面 · 本机暂未开通"
          toolsTitle="其他工具"
          tasks={[
            { icon: 'printer', title: '打印文件', desc: '正在确认这台机器能不能打印', held: true, chip: '正在确认', chipTone: 'slate', label: '打印文件，正在确认' },
            { icon: 'scan', title: '扫描纸质材料', desc: '正在确认这台机器能不能扫描', held: true, chip: '正在确认', chipTone: 'slate', label: '扫描纸质材料，正在确认' },
            {
              icon: 'copy',
              title: '复印',
              desc: <>在打印机屏幕上点<span className="qxt-nowrap">「复印」</span><span className="qxt-nowrap">「身份证复印」</span>或<span className="qxt-nowrap">「票据复印」</span>；不经过这台一体机下单，也不进打印订单</>,
              take: '复印件',
              onClick: () => go('复印'),
            },
            {
              icon: 'ticket',
              title: '到机码核销',
              chip: '不是取件码',
              chipTone: 'slate',
              desc: <>凭码办理，<br />不登录也能核销<br />· 8 位数字（历史 10 位码也<span className="qxt-nowrap">支持）</span></>,
              take: '订单里的打印件',
              visual: (
                <div className="qxt-codeart" aria-hidden="true">
                  {Array.from({ length: 8 }, (_, index) => <i key={index} />)}
                </div>
              ),
              onClick: () => go('到机码核销'),
            },
          ]}
          tools={[
            holdTile('image', '照片打印', '正在确认'),
            holdTile('layers', '照片合成 PDF', '正在确认'),
            holdTile('idcard', '证件照', '正在确认'),
            holdTile('pen', '签名', '正在确认', 'clay'),
            { icon: 'folder', title: '我的文档', desc: '登录后查看', tone: 'slate', onClick: () => go('我的文档') },
            { icon: 'receipt', title: '打印订单', desc: '登录后查看', tone: 'slate', onClick: () => go('打印订单') },
          ]}
        />
      ),
      dock: <QxTouchDock onBack={actions.onBack} ask="问小青：怎么选打印方式？" />,
    }
  }
  if (id === 'empty') {
    return {
      bodyClassName: 'qxt-body-fill',
      band: (
        <QxTouchBand
          place=" "
          onBack={actions.onBack}
          eyebrow="材料检查与预览"
          title="这一页没有待处理的文件"
          sub="先选好要打印的材料，再检查、再设参数。"
          seal={null}
          status={{ text: '没有待处理的文件', tone: 'warn' }}
        />
      ),
      body: (
        <QxTouchStateEmpty
          howto="文件还没选，或者上一位的文件已经清除。到这一步没有订单，也没有扣费。"
          stepsTitle="办理顺序"
          steps={['选文件', '材料检查', '预览与参数', '核对价格']}
          slabs={[
            { title: '去选文件', desc: '手机、U 盘，把真实文件带进这次办理', onClick: () => go('去选文件') },
            { title: '我的文档（登录后）', desc: '登录后才能看到你保存的文件', onClick: () => go('我的文档（登录后）') },
          ]}
          fine="这一页本身不保存文件"
        />
      ),
      dock: <QxTouchDock onBack={actions.onBack} ask="问小青：文件要从哪传？" primary={{ label: '去选文件', onClick: () => go('去选文件') }} />,
    }
  }
  if (id === 'error') {
    return {
      bodyClassName: 'qxt-body-fill',
      band: (
        <QxTouchBand
          place=" "
          onBack={actions.onBack}
          eyebrow="打印文件 · 上传"
          title="这份文件没传上来"
          sub="体积是在手机上就拦下的，系统没有收到这份文件。"
          seal={null}
          status={{ text: '没有收下', tone: 'warn' }}
        />
      ),
      body: (
        <QxTouchStateError
          file={{
            badge: 'PDF',
            name: <>毕业论文-终稿（含图表）<span className="qxt-nowrap">.pdf</span></>,
            meta: '手机通道 · 这一份没有进入本次办理',
            chip: '未收下',
            chipTone: 'cin',
          }}
          reasonTitle="原因"
          reason="这个文件 23.6MB，超过单个 10MB 的上限，没有发出去。请压缩后再选一次。"
          slabs={[
            { title: '重新传一次', desc: '这一份没有收下。压缩后再选一次', onClick: () => go('重新传一次') },
            { title: '换一种方式', desc: '改用 U 盘，或登录后从我的文档选', onClick: () => go('换一种方式') },
          ]}
          remind={`需要帮助？拨打服务电话 ${PHONE}`}
        />
      ),
      dock: <QxTouchDock onBack={actions.onBack} ask="问小青：这份太大了怎么办？" primary={{ label: '重新传一次', onClick: () => go('重新传一次') }} />,
    }
  }
  if (id === 'unavailable') {
    const ai = 'AI能力当前不可用'
    const net = '在线服务当前不可用'
    return {
      bodyClassName: 'qxt-body-tight',
      band: (
        <QxTouchBand
          place=" "
          onBack={actions.onBack}
          eyebrow="改简历"
          title="在线服务暂时连不上"
          sub="网络断开时，这台机器暂时办不了需要联网的事，请稍后再来。"
          seal={null}
          status={{ text: '在线服务不可用', tone: 'warn' }}
        />
      ),
      body: (
        <QxTouchStateUnavailable
          primaryTitle="八项简历能力"
          primaryHint="要联网的先停"
          primary={[
            holdTile('eye', 'AI 简历诊断', ai),
            holdTile('pen', 'AI 简历优化', ai),
            holdTile('file', '从零生成简历', ai),
            holdTile('layout', '简历素材库', net),
            holdTile('map', '职业规划', ai),
            holdTile('clipboard', '求职材料', net),
            holdTile('printer', '简历打印', net),
            holdTile('target', '简历对照', ai),
          ]}
          secondaryTitle="常用入口"
          secondaryHint="同样要联网"
          secondary={[
            holdTile('user', '我的简历', net, 'slate'),
            holdTile('sparkle', 'AI 服务记录', net),
            holdTile('compass', '自我探索', net),
          ]}
          remind={`需要帮助？拨打服务电话 ${PHONE}`}
        />
      ),
      dock: (
        <QxTouchDock
          onBack={actions.onBack}
          ask={{ label: '小青也要联网，恢复后再问', disabled: true }}
          primary={{ label: '重新检测', onClick: () => go('重新检测') }}
        />
      ),
    }
  }
  if (id === 'device-off') {
    return {
      bodyClassName: 'qxt-body-hub',
      band: (
        <QxTouchBand
          place=" "
          onBack={actions.onBack}
          eyebrow="打印 · 扫描 · 复印"
          title="这台机器出不了纸。"
          sub="缺纸了。打印和扫描先停，订单还在。"
          seal={null}
          status={{ text: '打印机缺纸 · 出纸类暂停', tone: 'warn' }}
        />
      ),
      body: (
        <QxTouchStateDeviceOff
          laterTitle="先传、稍后打印"
          tasks={[
            { icon: 'printer', title: '打印文件', chip: '打印机缺纸', chipTone: 'clay', held: true, desc: '打印机缺纸，这次出不了纸。文件可以先从下面传上来。', label: '打印文件，打印机缺纸' },
            { icon: 'scan', title: '扫描纸质材料', chip: '一起停', chipTone: 'clay', held: true, desc: '扫描和打印是同一台机器，一起停。', label: '扫描纸质材料，一起停' },
            { icon: 'copy', title: '复印', held: true, pressable: true, desc: '缺纸时复印也出不了纸，补纸后再用', take: '看复印步骤', onClick: () => go('复印') },
            { icon: 'ticket', title: '到机码核销', chip: '不是取件码', chipTone: 'slate', desc: '这台机器现在出不了纸，核销完也拿不到纸；订单还在，请稍后再来。', take: '核对这一单', onClick: () => go('到机码核销') },
          ]}
          later={[
            { icon: 'phone', title: '手机扫码上传', desc: '先传上来，稍后打印', onClick: () => go('手机扫码上传') },
            { icon: 'usb', title: 'U 盘导入', desc: '先导入，稍后打印', onClick: () => go('U 盘导入') },
          ]}
          remind={`这台机器暂时打不了，我们已经收到提醒，会尽快处理。你可以稍后再来；需要帮助请拨打服务电话 ${PHONE}。`}
        />
      ),
      dock: <QxTouchDock onBack={actions.onBack} ask="问小青：缺纸了文件还要传吗？" />,
    }
  }
  if (id === 'unconfirmed') {
    return {
      bodyClassName: 'qxt-body-unc',
      band: (
        <QxTouchBand
          kind="compact"
          place=" "
          onBack={actions.onBack}
          eyebrow="打印结果"
          title="这次打印结果未确认。"
          sub="系统已明确登记，等待人工核查"
          seal={null}
          status={{ text: '打印结果未确认', tone: 'warn' }}
        />
      ),
      body: (
        <QxTouchStateUnconfirmed
          steps={[
            { title: '先看出纸口是否已有纸张', detail: '设备在断电、失联或硬件异常后，无法确认这次打印的实际结果。' },
            { title: '无论有没有，这笔订单都已保留，不要重复打印', detail: '不猜成功也不猜失败，已登记等待人工核查。' },
            { title: <>需要帮助？拨打服务电话 <span className="qxt-nowrap">{PHONE}</span>，报这一单的订单号</>, detail: '服务时间：工作日 9:00–18:00' },
          ]}
          summary={[
            { label: '订单号', value: 'ORD-20261026-0418' },
            { label: '文件', value: <>毕业生就业推荐表（已填写）<span className="qxt-nowrap">.pdf</span></> },
            { label: '参数', value: '2 张 · 黑白 · 单面' },
          ]}
          exits={[
            { label: '查看订单说明', onClick: () => go('查看订单说明') },
            { label: '反馈问题', onClick: () => go('反馈问题') },
          ]}
          row={{ icon: 'receipt', title: '查看打印订单', onClick: () => go('查看打印订单') }}
          fine="这次结果已登记，等待人工核查；订单保留。"
        />
      ),
      dock: (
        <QxTouchDock
          back={false}
          onBack={actions.onBack}
          left={(
            <button type="button" className="qxt-btn qxt-btn-sec" onClick={actions.onHome}>
              <QxTouchIcon name="chevL" size={30} strokeWidth={2.4} />
              返回首页
            </button>
          )}
          ask="问小青：取纸或异常怎么办"
          primary={{ label: '使用帮助', onClick: () => go('使用帮助') }}
        />
      ),
    }
  }
  return {
    bodyClassName: 'qxt-body-aidown',
    band: (
      <QxTouchBand
        kind="compact"
        place=" "
        onBack={actions.onBack}
        eyebrow="简历诊断报告"
        title="这次没诊断出来"
        sub="今天的 AI 次数用完了，明天恢复；可以先打印原件。"
        seal={null}
        status={{ text: '解析失败', tone: 'warn' }}
        rail={{ labels: ['上传与方向', 'AI 解析', '诊断报告', '优化打印'], now: 1 }}
      />
    ),
    body: (
      <QxTouchStateAiDown
        howto="「李佳怡-产品运营-简历.pdf」的解析没有完成。这次没有生成诊断结论，下面不需要 AI 的事现在就能做。"
        exitsTitle="这些都不需要 AI · 现在就能做"
        exits={[
          { title: '打印我上传的原件', desc: '不需要 AI，先检查个人信息再打印', take: '去核对', visual: <QxTouchIcon name="printer" size={40} strokeWidth={2} />, onClick: () => go('打印我上传的原件') },
          { title: '去打印 / 扫描其他材料', desc: '打印扫描不依赖 AI，照常可用', take: '去打印扫描', visual: <QxTouchIcon name="printer" size={40} strokeWidth={2} />, onClick: () => go('去打印 / 扫描其他材料') },
          { title: '查政策', desc: '查看本机构发布的政策与办理说明', take: '去看政策', visual: <QxTouchIcon name="book" size={40} strokeWidth={2} />, onClick: () => go('查政策') },
          { title: '本机构官方渠道', desc: '扫码查看本机构官网或官方账号', take: '去扫码', visual: <QxTouchIcon name="qr" size={40} strokeWidth={2} />, onClick: () => go('本机构官方渠道') },
        ]}
        checksTitle="不等 AI，先自己核一遍"
        checksNote="6 项 · 纸质简历同样适用"
        checks={[
          '姓名、手机号、邮箱在第一屏就能看到',
          '每段经历都写了起止时间',
          '职责后面跟着结果，不只写「负责什么」',
          '技能写清工具名称和熟练程度',
          '通读一遍，没有错别字和断行',
          '控制在一到两页，导出后再看一次排版',
        ]}
      />
    ),
    dock: (
      <QxTouchDock
        onBack={actions.onBack}
        ask={{ label: '小青暂时不可用，先自己核一遍', disabled: true }}
        primary={{ label: '打印我上传的原件', onClick: () => go('打印我上传的原件') }}
      />
    ),
  }
}
