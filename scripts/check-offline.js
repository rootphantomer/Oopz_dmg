'use strict'

// 校验 offline.html 里的内联 <script> 语法。
//
// `npm run check` 里的 node --check 只能覆盖 .js 文件，offline.html 的内联脚本
// 是语法盲区——而它恰恰是离线页唯一的业务逻辑，写错只会在断网时才暴露。

const fs = require('fs')
const path = require('path')
const vm = require('vm')

const file = path.join(__dirname, '..', 'offline.html')
const html = fs.readFileSync(file, 'utf8')
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]

if (scripts.length !== 1) {
  console.error(`[check] offline.html 期望恰好 1 段内联 <script>，实际 ${scripts.length} 段`)
  process.exit(1)
}

try {
  // 只做编译（语法校验），不执行
  new vm.Script(scripts[0][1], { filename: 'offline.html#inline-script' })
} catch (err) {
  console.error('[check] offline.html 内联脚本语法错误：', err.message)
  process.exit(1)
}

console.log('[check] offline.html 内联脚本语法 OK')
