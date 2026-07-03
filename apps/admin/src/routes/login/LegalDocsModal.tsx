// LegalDocsModal — 管理员后台《用户服务协议》《隐私政策》弹层
//
// Admin 应用没有独立的 /legal 路由，登录页协议勾选的两个链接在此弹层内展示全文，
// 避免死链。内容为 v1 草拟版，与系统当前真实数据实践对齐（手机号加密存储、
// 界面脱敏、登录/重置记录审计日志）；正式运营前须经法务审定后替换定稿。

import { useState } from 'react'
import { XIcon } from 'lucide-react'

export type LegalDocKind = 'terms' | 'privacy'

interface Section {
  title: string
  paragraphs: string[]
}

const TERMS_SECTIONS: Section[] = [
  {
    title: '一、平台性质',
    paragraphs: [
      '本后台为「AI求职打印服务终端」的运营管理系统，用于终端设备、打印订单、文件、AI 服务及第三方来源信息（岗位、招聘会、政策等）的管理与审核。',
      '本平台不是网络招聘平台：不提供平台内投递，不接收或转交求职者简历，不提供候选人筛选、面试邀约或录用管理功能。',
    ],
  },
  {
    title: '二、账号使用',
    paragraphs: [
      '管理员账号仅限授权运营人员本人使用，不得转借、共享或用于与岗位职责无关的用途。',
      '登录、密码重置、手机号验证及后台关键操作均记录审计日志，供安全追溯与合规检查使用。',
    ],
  },
  {
    title: '三、安全责任',
    paragraphs: [
      '请妥善保管账号密码与短信验证码，验证码仅在有效期内一次性使用，请勿向任何人透露。',
      '发现账号异常（异地登录、无法登录、疑似泄露）时，应立即联系超级管理员处理。',
    ],
  },
  {
    title: '四、其他',
    paragraphs: [
      '本页为 v1 草拟版。正式运营前以运营方法务审定发布的正式版本为准；如本页内容与正式发布版本不一致，以正式发布版本为准。',
    ],
  },
]

const PRIVACY_SECTIONS: Section[] = [
  {
    title: '一、收集的信息',
    paragraphs: [
      '为提供后台登录与账号安全能力，系统处理以下信息：账号名、绑定手机号、登录时间与来源、后台操作日志。',
    ],
  },
  {
    title: '二、使用目的',
    paragraphs: [
      '手机号仅用于短信验证码登录、本人验证与密码找回；操作日志仅用于安全审计与故障排查。',
    ],
  },
  {
    title: '三、存储与保护',
    paragraphs: [
      '手机号在服务端加密存储，界面仅作脱敏展示；短信验证码短时有效、验证后即失效。',
      '上述信息不用于任何营销用途，不向第三方提供。',
    ],
  },
  {
    title: '四、你的权利',
    paragraphs: [
      '如需更正绑定手机号或停用账号，可联系超级管理员办理；相关变更操作同样记录审计日志。',
      '本页为 v1 草拟版，正式运营前以法务审定发布的正式版本为准。',
    ],
  },
]

export function LegalDocsModal({
  initialDoc,
  onClose,
}: {
  initialDoc: LegalDocKind
  onClose: () => void
}) {
  const [doc, setDoc] = useState<LegalDocKind>(initialDoc)
  const sections = doc === 'terms' ? TERMS_SECTIONS : PRIVACY_SECTIONS

  return (
    <div className="c-modal" role="dialog" aria-modal="true" aria-label={doc === 'terms' ? '用户服务协议' : '隐私政策'}>
      <div className="c-modal-card wide">
        <div className="c-modal-head">
          <div>
            <h3>{doc === 'terms' ? '用户服务协议' : '隐私政策'}</h3>
            <p>v1 草拟版 · 正式运营前以法务审定发布版本为准</p>
          </div>
          <button type="button" className="close-btn" onClick={onClose} aria-label="关闭">
            <XIcon size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="c-doc-tabs">
          <button type="button" className={doc === 'terms' ? 'on' : ''} onClick={() => setDoc('terms')}>
            用户服务协议
          </button>
          <button type="button" className={doc === 'privacy' ? 'on' : ''} onClick={() => setDoc('privacy')}>
            隐私政策
          </button>
        </div>

        <div className="c-doc">
          {sections.map((section) => (
            <div key={section.title}>
              <h4>{section.title}</h4>
              {section.paragraphs.map((text, i) => (
                <p key={i}>{text}</p>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
