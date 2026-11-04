'use strict'

// 启动冒烟测试：打包后的 app 能起来并且 8 秒内不退出。
// 主要用来兜住那些「构建成功但一启动就崩」的配置错误，
// 例如 asar integrity 写入异常、fuses 与启动路径冲突、漏打包文件。

const { spawn } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { findAppBinary } = require('./lib/app-path')

const ALIVE_MS = 8000

function cleanup (dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
}

function main () {
  let binary
  try {
    binary = findAppBinary()
  } catch (err) {
    console.error('[boot] ERROR:', err.message)
    process.exit(1)
  }

  // 独立的 userData 目录：避免和用户正在运行的 Oopz 抢单实例锁（抢不到会直接退出）
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oopz-boot-'))
  const child = spawn(binary, [`--user-data-dir=${userDataDir}`], {
    stdio: ['ignore', 'ignore', 'pipe'],
  })

  let done = false
  let stderr = ''
  child.stderr.on('data', chunk => { stderr += chunk })

  const timer = setTimeout(() => {
    done = true
    console.log(`[boot] PASS: 应用存活超过 ${ALIVE_MS}ms`)
    child.kill('SIGTERM')
    // 给 app 一点时间清理，随后强制杀掉
    setTimeout(() => {
      child.kill('SIGKILL')
      cleanup(userDataDir)
      process.exit(0)
    }, 2000)
  }, ALIVE_MS)

  child.on('error', err => {
    if (done) return
    done = true
    clearTimeout(timer)
    console.error('[boot] FAIL: 无法启动：', err.message)
    cleanup(userDataDir)
    process.exit(1)
  })

  // 用 close 而不是 exit：close 在所有 stdio 关闭后才触发，能拿到完整 stderr
  child.on('close', (code, signal) => {
    if (done) return
    done = true
    clearTimeout(timer)

    // CI/无 GUI 会话的环境里 Electron 起不来，这属于环境问题而不是产物问题
    if (/WindowServer|Failed to connect|NSApplication|no.*GUI|Unable to init/i.test(stderr)) {
      console.warn('[boot] SKIP: 当前环境没有可用的 GUI 会话，跳过启动检查')
      console.warn('[boot] stderr:\n' + stderr.slice(-2000))
      cleanup(userDataDir)
      process.exit(0)
    }

    console.error(`[boot] FAIL: 应用在 ${ALIVE_MS}ms 内退出 (code=${code}, signal=${signal})`)
    if (stderr.trim()) console.error('[boot] stderr:\n' + stderr.slice(-4000))
    cleanup(userDataDir)
    process.exit(1)
  })
}

main()
