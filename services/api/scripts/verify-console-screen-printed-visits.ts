import 'reflect-metadata'
import 'dotenv/config'
import { main } from './console-screen-printed-visits-cases-04'

main().catch((error: unknown) => {
  console.error('\n❌ verify:console-screen-printed-visits 执行异常')
  console.error(error)
  process.exit(1)
})
