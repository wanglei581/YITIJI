import 'reflect-metadata'
import 'dotenv/config'
import { main } from './console-screen-snapshot-cases-18'

main().catch((error: unknown) => {
  console.error('\n❌ verify:console-screen-snapshot 执行异常')
  console.error(error)
  process.exit(1)
})
