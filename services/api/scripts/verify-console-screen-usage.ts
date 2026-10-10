import 'reflect-metadata'
import 'dotenv/config'
import { main } from './console-screen-usage-cases-07'

// 本文件钉住托管打开（b）时的逐字段口径。关闭后的形状在 verify:console-screen-snapshot。
process.env['RECRUITMENT_CONTENT_HOSTING_ENABLED'] = 'true'
main().catch((error: unknown) => {
  console.error('\n❌ verify:console-screen-usage 执行异常')
  console.error(error)
  process.exit(1)
})
