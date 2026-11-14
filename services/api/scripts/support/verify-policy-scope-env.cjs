'use strict'

// 须在其它 import 之前加载：终端模块在加载时就读取这两项，import 会被提到文件头。
process.env.TERMINAL_ADMIN_SECRET ||= 'verify-policy-scope-terminal-admin-secret'
process.env.TERMINAL_ACTION_TOKEN_SECRET ||= 'verify-policy-scope-terminal-action-secret'
