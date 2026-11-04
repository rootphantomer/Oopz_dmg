'use strict'

// 定位 electron-builder 的 `dir` 产物（dist/mac/Oopz.app 或 dist/mac-arm64/Oopz.app）。
// 架构目录名取决于构建机与 target，不写死。

const fs = require('fs')
const path = require('path')

const DIST_DIR = path.join(__dirname, '..', '..', 'dist')

function findAppBinary () {
  if (!fs.existsSync(DIST_DIR)) {
    throw new Error('dist/ 不存在，先跑 npm run build')
  }

  const archDirs = fs.readdirSync(DIST_DIR).filter(name => name.startsWith('mac'))
  for (const dir of archDirs) {
    const binary = path.join(DIST_DIR, dir, 'Oopz.app', 'Contents', 'MacOS', 'Oopz')
    if (fs.existsSync(binary)) return binary
  }

  throw new Error(`在 dist/{${archDirs.join(',')}} 下找不到 Oopz.app/Contents/MacOS/Oopz`)
}

module.exports = { findAppBinary }
