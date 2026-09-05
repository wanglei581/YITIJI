// 语音说简历 · 题库。一题对应 DTO 一个确定槽位，不做 LLM 自由采访。
// 组装/校验走 utils/resume-build-model.js，这里只描述「问什么、写到哪」。

const model = require('../../utils/resume-build-model')

const LEN = model.LEN

function emptyForm() {
  return {
    basic: { name: '', phone: '', email: '', city: '' },
    intention: { position: '', city: '', jobType: '', salary: '' },
    eduRows: [model.emptyEducation()],
    expRows: [model.emptyExperience()],
    projRows: [model.emptyProject()],
    skillsText: '',
    certsText: '',
    selfIntro: '',
  }
}

function getPath(obj, path) {
  const parts = String(path || '').split('.')
  let cur = obj
  for (let i = 0; i < parts.length; i += 1) {
    if (cur == null) return ''
    const key = /^\d+$/.test(parts[i]) ? Number(parts[i]) : parts[i]
    cur = cur[key]
  }
  return cur == null ? '' : cur
}

function setPath(obj, path, value) {
  const parts = String(path || '').split('.')
  let cur = obj
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = /^\d+$/.test(parts[i]) ? Number(parts[i]) : parts[i]
    if (cur[key] == null) {
      cur[key] = /^\d+$/.test(parts[i + 1]) ? [] : {}
    }
    cur = cur[key]
  }
  const last = parts[parts.length - 1]
  cur[/^\d+$/.test(last) ? Number(last) : last] = value
  return obj
}

function isFilled(form, path) {
  return Boolean(String(getPath(form, path) || '').trim())
}

/**
 * 题库写死。input:
 *   voice  可录音，确认前不算事实
 *   text   永远手打（电话；邮箱听错率高也手打）
 * need     前置槽位为空则整题跳过（比如没说单位，就不问职务）
 */
const QUESTIONS = [
  {
    id: 'name', slot: 'basic.name', title: '姓名',
    prompt: '请说出你的姓名。',
    hint: '转成文字后必须你自己看一眼，确认后才写进简历。',
    example: '例如：张三',
    input: 'voice', required: true, skippable: false, maxLen: LEN.name,
  },
  {
    id: 'phone', slot: 'basic.phone', title: '手机号',
    prompt: '请手动输入手机号。',
    hint: '大厅里旁人能听见，请手动输入。',
    input: 'text', keyboard: 'number', required: false, skippable: true, maxLen: LEN.phone,
    sensitive: true,
  },
  {
    id: 'email', slot: 'basic.email', title: '邮箱',
    prompt: '有邮箱的话请手动输入。没有可以跳过。',
    hint: '邮箱容易听错，请手动输入。',
    input: 'text', keyboard: 'text', required: false, skippable: true, maxLen: LEN.email,
  },
  {
    id: 'city', slot: 'basic.city', title: '所在城市',
    prompt: '你现在在哪个城市？',
    example: '例如：北京',
    input: 'voice', required: false, skippable: true, maxLen: LEN.city,
  },
  {
    id: 'position', slot: 'intention.position', title: '目标岗位',
    prompt: '你想找什么工作？',
    example: '例如：仓库操作工、电工、保洁',
    input: 'voice', required: true, skippable: false, maxLen: LEN.position,
  },
  {
    id: 'wantCity', slot: 'intention.city', title: '期望城市',
    prompt: '希望在哪个城市工作？没有要求可以跳过。',
    input: 'voice', required: false, skippable: true, maxLen: LEN.city,
  },
  {
    id: 'jobType', slot: 'intention.jobType', title: '工作类型',
    prompt: '全职、兼职还是临时工？不确定可以跳过。',
    input: 'voice', required: false, skippable: true, maxLen: LEN.jobType,
  },
  {
    id: 'salary', slot: 'intention.salary', title: '期望薪资',
    prompt: '一个月想拿多少钱？没有也可以跳过。',
    input: 'voice', required: false, skippable: true, maxLen: LEN.salary,
  },
  {
    id: 'eduSchool', slot: 'eduRows.0.school', title: '学校',
    prompt: '你上过什么学校？没有学历可以跳过。',
    input: 'voice', required: false, skippable: true, maxLen: LEN.school,
  },
  {
    id: 'eduMajor', slot: 'eduRows.0.major', title: '专业',
    prompt: '学的是什么专业？',
    input: 'voice', required: false, skippable: true, maxLen: LEN.major,
    need: 'eduRows.0.school',
  },
  {
    id: 'eduDegree', slot: 'eduRows.0.degree', title: '学历',
    prompt: '学历是中专、高中、大专还是本科？',
    input: 'voice', required: false, skippable: true, maxLen: LEN.degree,
    need: 'eduRows.0.school',
  },
  {
    id: 'eduPeriod', slot: 'eduRows.0.period', title: '在校时间',
    prompt: '大概哪年到哪年在读？记不清可以跳过。',
    example: '例如：二零一八到二零二一年',
    input: 'voice', required: false, skippable: true, maxLen: LEN.period,
    need: 'eduRows.0.school',
  },
  {
    id: 'eduDesc', slot: 'eduRows.0.description', title: '在校情况',
    prompt: '在学校做过什么、拿过什么奖？没有可以跳过。',
    input: 'voice', required: false, skippable: true, maxLen: LEN.description,
    need: 'eduRows.0.school',
  },
  {
    id: 'expCompany', slot: 'expRows.0.company', title: '工作单位',
    prompt: '最近一份工作在哪家单位？没有工作经历可以跳过。',
    input: 'voice', required: false, skippable: true, maxLen: LEN.company,
  },
  {
    id: 'expRole', slot: 'expRows.0.role', title: '岗位',
    prompt: '在那里做什么岗位？',
    input: 'voice', required: true, skippable: false, maxLen: LEN.role,
    need: 'expRows.0.company',
  },
  {
    id: 'expPeriod', slot: 'expRows.0.period', title: '工作时间',
    prompt: '这份工作大概做了多久？记不清可以跳过。',
    example: '例如：二零二三年到现在',
    input: 'voice', required: false, skippable: true, maxLen: LEN.period,
    need: 'expRows.0.company',
  },
  {
    id: 'expDesc', slot: 'expRows.0.description', title: '做过什么',
    prompt: '用你自己的话说，在那里具体做过什么。',
    hint: 'AI 只润色你这句话，不会替你编。',
    input: 'voice', required: true, skippable: false, maxLen: LEN.description,
    need: 'expRows.0.company',
  },
  {
    id: 'projName', slot: 'projRows.0.name', title: '项目名称',
    prompt: '有没有做过一个能写上简历的项目？没有可以跳过。',
    input: 'voice', required: false, skippable: true, maxLen: LEN.projectName,
  },
  {
    id: 'projRole', slot: 'projRows.0.role', title: '项目角色',
    prompt: '你在这个项目里负责什么？',
    input: 'voice', required: false, skippable: true, maxLen: LEN.role,
    need: 'projRows.0.name',
  },
  {
    id: 'projDesc', slot: 'projRows.0.description', title: '项目内容',
    prompt: '这个项目做了什么、结果怎样？',
    input: 'voice', required: true, skippable: false, maxLen: LEN.description,
    need: 'projRows.0.name',
  },
  {
    id: 'skills', slot: 'skillsText', title: '技能',
    prompt: '你会哪些本事？一项项说就行。',
    example: '例如：电焊、叉车、收银',
    hint: '多项用顿号或逗号隔开。',
    input: 'voice', required: false, skippable: true, maxLen: 1000,
  },
  {
    id: 'certs', slot: 'certsText', title: '证书',
    prompt: '有没有证书或资质？没有可以跳过。',
    example: '例如：电工证、驾驶证',
    input: 'voice', required: false, skippable: true, maxLen: 1000,
  },
  {
    id: 'selfIntro', slot: 'selfIntro', title: '自我介绍',
    prompt: '再用几句话介绍一下自己。不想说可以跳过，简历上这一栏会空着。',
    input: 'voice', required: false, skippable: true, maxLen: LEN.selfIntro,
  },
]

function questionAt(index) {
  return QUESTIONS[index] || null
}

function nextIndex(from, form, skipFilled) {
  for (let i = from; i < QUESTIONS.length; i += 1) {
    const q = QUESTIONS[i]
    if (q.need && !isFilled(form, q.need)) continue
    if (skipFilled && isFilled(form, q.slot)) continue
    return i
  }
  return -1
}

function applyAnswer(form, slot, raw, maxLen) {
  let text = String(raw == null ? '' : raw).trim()
  const cap = Number(maxLen) || 0
  if (cap > 0 && text.length > cap) text = text.slice(0, cap)
  setPath(form, slot, text)
  return text
}

function transcribeFail(err) {
  const code = (err && err.code) || ''
  const status = err && err.statusCode
  const msg = (err && err.message) || ''
  if (code === 'ASR_NOT_CONFIGURED' || msg.indexOf('语音转写未启用') >= 0 || msg.indexOf('凭证未配置') >= 0) {
    return { degrade: true, msg: msg || '语音转写未启用，请改用文字输入' }
  }
  if (code === 'INVALID_AUDIO_FORMAT' || msg.indexOf('必须上传 WAV') >= 0) {
    return { degrade: true, msg: msg || '这台手机录出来的格式服务端不接受，请改用文字输入' }
  }
  if (code === 'AUDIO_MISSING') {
    return { degrade: false, msg: msg || '没有录到声音，请重试或改用文字输入' }
  }
  if (code === 'ASR_FAILED') {
    return { degrade: false, msg: msg || '没有识别到有效文字，请重说或改用文字输入' }
  }
  if (status === 429) {
    return { degrade: false, msg: msg || '这一分钟转写次数用完了，请稍等再录，或改用手打。' }
  }
  if (code === 'permission-denied' || code === 'unsupported' || code === 'no-device') {
    return { degrade: true, msg: msg || '麦克风不可用，请改用文字输入' }
  }
  return { degrade: false, msg: msg || '语音转写失败，请改用文字输入' }
}

module.exports = {
  QUESTIONS,
  emptyForm,
  getPath,
  questionAt,
  nextIndex,
  applyAnswer,
  transcribeFail,
  LEN,
}
