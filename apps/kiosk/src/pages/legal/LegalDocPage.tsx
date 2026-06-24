// ============================================================
// 用户服务协议 / 隐私政策（审计修复：原登录页两个按钮只弹「即将上线」）。
//
// 内容为 v1 草拟版，与系统当前真实数据实践对齐（短 TTL 文件、不留简历库、
// OCR 不留原文、会员手机号加密存储等）。正式运营前须经运营方法务审定后替换定稿
// （见 docs/compliance/）。Kiosk 模式：大字号、可滚动、无外链。
// ============================================================

import { useNavigate, useParams } from 'react-router-dom'
import { Button, PageHeader } from '@ai-job-print/ui'
import { FileTextIcon, ShieldCheckIcon } from 'lucide-react'

const UPDATED_AT = '2026 年 6 月 22 日'

interface Section {
  title: string
  paragraphs: string[]
}

const TERMS_SECTIONS: Section[] = [
  {
    title: '一、服务说明',
    paragraphs: [
      '本终端为「AI求职打印服务终端」，提供 AI 简历服务（诊断、优化、生成）、文档打印扫描、第三方岗位信息与招聘会信息浏览入口、政策信息查询等服务。',
      '本平台不是网络招聘平台：不提供平台内投递、不向企业收取或转交您的简历、不参与任何企业筛选、面试或录用环节。岗位与招聘会信息均来自第三方/官方来源，投递与报名请通过页面提供的来源平台入口自行办理。',
    ],
  },
  {
    title: '二、账号与登录',
    paragraphs: [
      '您可以游客身份使用大部分服务。使用手机验证码登录后，可将服务记录（简历记录、文档、打印订单、收藏、权益）关联到您的账号，仅本人可见。',
      '本终端为公共设备：页面刷新、离开或闲置超时后将自动退出登录并清除会话信息，请勿在终端上留存个人物品与文件。',
    ],
  },
  {
    title: '三、用户承诺',
    paragraphs: [
      '您承诺上传的简历及其他文件为本人所有或已获合法授权，内容真实、不含违法信息。',
      '不得利用本终端从事任何违法活动，不得上传含他人隐私、涉密或侵权内容的文件。',
    ],
  },
  {
    title: '四、AI 服务的性质',
    paragraphs: [
      'AI 诊断、优化与生成结果仅基于您提供的内容产生，仅供您本人修改简历时参考，不代表任何招聘结果承诺。本平台不作出"保面试""保录用""提高通过率"等任何承诺。',
      'AI 输出可能存在偏差；通过拍照或扫描识别的内容（OCR）可能存在识别误差，请您在使用前核对关键信息。',
    ],
  },
  {
    title: '五、收费与打印',
    paragraphs: [
      '打印服务按现场公示价目执行。打印任务一经确认开始输出，纸张耗材即发生消耗，请在确认前核对打印参数。',
    ],
  },
  {
    title: '六、其他',
    paragraphs: [
      '本协议未尽事宜以现场公示及运营方发布的正式版本为准。如本页内容与正式发布版本不一致，以正式发布版本为准。',
    ],
  },
]

const PRIVACY_SECTIONS: Section[] = [
  {
    title: '一、我们收集的信息',
    paragraphs: [
      '登录信息：手机号（用于验证码登录）。手机号在系统中加密存储，页面展示时脱敏。',
      '服务内容：您主动上传的简历及文件、AI 服务过程中产生的结果、打印任务记录、您的收藏与权益记录。',
      '我们不会采集您的人脸信息，不读取您设备中的其他文件。',
    ],
  },
  {
    title: '二、信息如何使用',
    paragraphs: [
      '简历内容仅用于您本次发起的 AI 分析（诊断/优化/生成），不进入任何"简历库"，不推送给任何企业或第三方招聘方。',
      '图片或扫描件简历会经第三方文字识别（OCR）服务提取文字，仅传输识别所需的图像数据，识别原文不写入日志，图像不在云端留存。',
      'AI 分析由配置的大模型服务完成，仅传输完成分析所必需的文本内容。',
    ],
  },
  {
    title: '三、保存期限与自动清理',
    paragraphs: [
      '证件照、身份证复印件、未登录上传文件等高敏或匿名文件设置短期有效期，到期自动删除。',
      '登录会员上传的原始简历与求职材料默认保存 90 天，可在确认保存条款后延长至 180 天；优化后或派生成果物可在本人确认保存条款后长期保存。',
      '您可以在对应业务页面（我的文档 / AI服务记录等）查看保存期限、调整允许的保存策略，或随时自行删除本人的文档与 AI 记录，删除文件为物理删除。',
      '公共设备会话信息（含登录态）在退出、闲置超时或进入待机时即刻清除。',
    ],
  },
  {
    title: '四、您的权利',
    paragraphs: [
      '登录后您可查看、下载、删除本人名下的文档与记录；所有数据仅本人可见，他人（含其他会员）无法访问。',
      '管理员因运维需要访问文件时，系统会记录审计日志。',
    ],
  },
  {
    title: '五、联系我们',
    paragraphs: [
      '如对个人信息保护有任何疑问或需要协助，请联系现场工作人员或通过终端公示的运营方联系方式与我们沟通。',
      '本政策正式版本以运营方发布为准；如本页内容与正式发布版本不一致，以正式发布版本为准。',
    ],
  },
]

const DOCS = {
  terms: { title: '用户服务协议', icon: FileTextIcon, sections: TERMS_SECTIONS },
  privacy: { title: '隐私政策', icon: ShieldCheckIcon, sections: PRIVACY_SECTIONS },
} as const

export function LegalDocPage() {
  const navigate = useNavigate()
  const { doc } = useParams<{ doc: string }>()
  const meta = doc === 'privacy' ? DOCS.privacy : DOCS.terms
  const Icon = meta.icon

  return (
    <div className="flex h-full flex-col px-6 pt-6">
      <PageHeader
        title={meta.title}
        subtitle={`更新日期：${UPDATED_AT}`}
        actions={
          <Button size="sm" variant="secondary" onClick={() => navigate(-1)}>
            返回
          </Button>
        }
      />
      <div className="mt-4 flex-1 overflow-y-auto pb-8">
        <div className="mx-auto max-w-2xl rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
          <div className="mb-5 flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-50 text-primary-600">
              <Icon className="h-5 w-5" aria-hidden="true" />
            </span>
            <p className="text-sm text-gray-500">
              请在使用服务前仔细阅读。继续登录或使用本终端服务，即视为您已阅读并同意本{meta.title}。
            </p>
          </div>
          {meta.sections.map((s) => (
            <section key={s.title} className="mb-5">
              <h2 className="mb-2 text-base font-bold text-gray-900">{s.title}</h2>
              {s.paragraphs.map((para) => (
                <p key={para.slice(0, 16)} className="mb-2 text-sm leading-relaxed text-gray-700">
                  {para}
                </p>
              ))}
            </section>
          ))}
          <p className="mt-6 border-t border-gray-100 pt-4 text-xs leading-relaxed text-gray-400">
            本文本为试运营版本，正式运营前以运营方法务审定发布的版本为准。
          </p>
        </div>
      </div>
    </div>
  )
}
