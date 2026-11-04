'use strict'

// 校验打包产物上的 Electron Fuses 是否按 package.json 的 build.electronFuses 生效。
// 这些开关不看构建日志，只看产物本身——配置写错时 electron-builder 不会报错。

const { getCurrentFuseWire, FuseV1Options, FuseState } = require('@electron/fuses')
const { findAppBinary } = require('./lib/app-path')

const FUSE_NAMES = Object.fromEntries(
  Object.entries(FuseV1Options).map(([name, value]) => [value, name])
)

// 名称 -> 期望状态
const EXPECTED = {
  RunAsNode: FuseState.DISABLE,
  EnableNodeOptionsEnvironmentVariable: FuseState.DISABLE,
  EnableNodeCliInspectArguments: FuseState.DISABLE,
  OnlyLoadAppFromAsar: FuseState.ENABLE,
  EnableEmbeddedAsarIntegrityValidation: FuseState.ENABLE,
}

async function main () {
  const binary = findAppBinary()
  const wire = await getCurrentFuseWire(binary)

  const problems = []
  for (const [name, expected] of Object.entries(EXPECTED)) {
    const actual = wire[FuseV1Options[name]]
    console.log(`[fuses] ${name}: ${FuseState[actual] || actual}`)
    if (actual !== expected) {
      problems.push(`${name} 期望 ${FuseState[expected]}，实际 ${FuseState[actual] || actual}`)
    }
  }

  // 顺带打印未断言项，便于排查
  for (const [index, state] of Object.entries(wire)) {
    const name = FUSE_NAMES[index]
    if (name && !(name in EXPECTED)) {
      console.log(`[fuses] (未断言) ${name}: ${FuseState[state] || state}`)
    }
  }

  if (problems.length > 0) {
    console.error('[fuses] FAIL:\n  ' + problems.join('\n  '))
    process.exit(1)
  }
  console.log('[fuses] PASS')
}

main().catch(err => {
  console.error('[fuses] ERROR:', err.message)
  process.exit(1)
})
