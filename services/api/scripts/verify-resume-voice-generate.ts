/**
 * Wave 4 — 简历语音生成首版门禁。
 *
 * 覆盖:
 *   1. 后端存在 /resume/voice/transcribe 端点,使用 FileInterceptor 内存收短音频。
 *   2. 端点有文件大小上限、Throttle 限流和 AUDIO_MISSING / ASR_FAILED / ASR_NOT_CONFIGURED 诚实错误。
 *   3. ASR 服务只记录元数据,不得记录转写正文。
 *   4. 简历语音端点不得写 FileObject / COS / signedUrl / DB 持久化音频。
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { BadRequestException } from '@nestjs/common'
import { AiController } from '../src/ai/ai.controller'

function pass(m: string) { console.log(`  PASS ${m}`) }
function fail(m: string): never { console.error(`  FAIL ${m}`); process.exitCode = 1; throw new Error(m) }

const root = join(__dirname, '..')
const controllerSrc = readFileSync(join(root, 'src/ai/ai.controller.ts'), 'utf-8')
const dtoSrc = readFileSync(join(root, 'src/ai/dto/resume-voice.dto.ts'), 'utf-8')
const asrSrc = readFileSync(join(root, 'src/asr/asr.service.ts'), 'utf-8')
const sharedSrc = readFileSync(join(root, '../../packages/shared/src/types/ai.ts'), 'utf-8')

console.log('\n=== Wave 4 简历语音生成门禁 ===')

if (!controllerSrc.includes("@Post('resume/voice/transcribe')")) {
  fail('1a. 未找到 /resume/voice/transcribe 端点')
}
if (!controllerSrc.includes('FileInterceptor(RESUME_VOICE_AUDIO_FIELD')) {
  fail('1b. 简历语音端点必须使用 FileInterceptor 接收 audio 字段')
}
if (!controllerSrc.includes('fileSize: RESUME_VOICE_MAX_AUDIO_BYTES')) {
  fail('1c. 简历语音端点必须设置 RESUME_VOICE_MAX_AUDIO_BYTES 文件大小上限')
}
if (!controllerSrc.includes('@Throttle({ default: { ttl: 60_000, limit: 6 } })')) {
  fail('1d. 简历语音端点必须设置公共终端限流')
}
pass('1. 简历语音转写端点、内存音频字段、文件上限和限流存在')

if (!dtoSrc.includes("export const RESUME_VOICE_AUDIO_FIELD = 'audio'")) {
  fail('2a. RESUME_VOICE_AUDIO_FIELD 必须固定为 audio')
}
if (!dtoSrc.includes('export const RESUME_VOICE_MAX_AUDIO_BYTES = 4 * 1024 * 1024')) {
  fail('2b. RESUME_VOICE_MAX_AUDIO_BYTES 必须为 4MB')
}
if (!sharedSrc.includes('export interface ResumeVoiceTranscribeResponse')) {
  fail('2c. shared 未定义 ResumeVoiceTranscribeResponse')
}
if (!sharedSrc.includes('providerName: string')) {
  fail('2d. ResumeVoiceTranscribeResponse 必须返回 providerName 元数据')
}
pass('2. DTO/shared 契约固定 audio 字段、4MB 上限和 provider 元数据')

for (const needle of ['AUDIO_MISSING', 'ASR_FAILED', 'ASR_NOT_CONFIGURED']) {
  const haystack = needle === 'ASR_NOT_CONFIGURED' ? `${controllerSrc}\n${asrSrc}` : controllerSrc
  if (!haystack.includes(needle)) fail(`3. 缺少诚实错误码 ${needle}`)
}
if (!controllerSrc.includes('语音转写失败，请改用文字输入')) {
  fail('3. ASR 失败必须提示改用文字输入')
}
if (!controllerSrc.includes('INVALID_AUDIO_FORMAT')) {
  fail('3. 非 WAV 音频必须被前置拒绝')
}
pass('3. ASR 缺失/失败/格式错误码与文字兜底文案存在')

const endpointMatch = controllerSrc.match(/async transcribeResumeVoice[\s\S]*?\n  \}/)
if (!endpointMatch) fail('4. 未找到 transcribeResumeVoice 方法体')
const endpointBody = endpointMatch![0]
for (const forbidden of ['FileObject', 'files.upload', 'upload(', 'signedUrl', 'storage.write', 'prisma.fileObject']) {
  if (endpointBody.includes(forbidden)) {
    fail(`4. transcribeResumeVoice 不得包含持久化/签名文件逻辑: ${forbidden}`)
  }
}
if (!endpointBody.includes('this.asr.recognizeWav(audio.buffer)')) {
  fail('4. transcribeResumeVoice 必须只把内存 buffer 交给 AsrService')
}
if (endpointBody.includes('ApiResponse.ok(')) {
  fail('4. transcribeResumeVoice 成功响应必须返回裸 DTO,不得包 ApiResponse 信封')
}
pass('4. 转写端点不写 FileObject/COS/signedUrl,只转发内存 buffer')

for (const forbidden of ['logger.log(result.text)', 'logger.warn(result.text)', 'logger.error(result.text)', 'console.log(result.text)', 'console.error(result.text)']) {
  if (controllerSrc.includes(forbidden) || asrSrc.includes(forbidden)) {
    fail(`5. 不得记录转写正文: ${forbidden}`)
  }
}
if (!asrSrc.includes("this.logMeta('asr.ok'")) {
  fail('5. ASR 成功日志应只记录元数据')
}
if (!asrSrc.includes('chars: result.text.length') || !asrSrc.includes('bytes: buffer.length')) {
  fail('5. ASR 元数据日志应记录字数/字节数,而非正文')
}
pass('5. ASR 日志只记录元数据,不记录转写正文')

async function verifyRuntimeShape() {
  const wav = Buffer.from('RIFF0000WAVEfmt ')
  const fakeAsr = {
    activeProviderName: 'unit-asr',
    recognizeWav: async () => ({ ok: true, text: '真实转写文本' }),
  }
  const controller = new AiController({} as never, {} as never, {} as never, {} as never, {} as never, fakeAsr as never)
  const ok = await controller.transcribeResumeVoice({ buffer: wav } as Express.Multer.File)
  if (ok.text !== '真实转写文本' || ok.providerName !== 'unit-asr') {
    fail('6a. transcribeResumeVoice 成功路径未返回裸 text/providerName DTO')
  }
  if ('success' in ok || 'data' in ok) {
    fail('6b. transcribeResumeVoice 成功路径不得返回 ApiResponse success/data 信封')
  }

  try {
    await controller.transcribeResumeVoice({ buffer: Buffer.from('NOPE') } as Express.Multer.File)
    fail('6c. 非 WAV buffer 必须抛 INVALID_AUDIO_FORMAT')
  } catch (err) {
    const response = err instanceof BadRequestException ? err.getResponse() : null
    if (!JSON.stringify(response).includes('INVALID_AUDIO_FORMAT')) {
      fail('6c. 非 WAV buffer 未返回 INVALID_AUDIO_FORMAT')
    }
  }
  pass('6. 运行时成功响应为裸 DTO,坏 WAV 被前置拒绝')
}

void verifyRuntimeShape()
  .then(() => console.log('\n=== ALL PASS: Wave 4 简历语音生成门禁 ==='))
  .catch((err) => fail(err instanceof Error ? err.message : '6. 运行时断言失败'))
