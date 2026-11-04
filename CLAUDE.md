# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目性质

这是一个 Electron 桌面端应用（仅 macOS，arm64 + x64），将 `https://web.oopz.cn` 封装为原生窗口。代码体量很小——主进程逻辑全部在 `main.js`（~485 行），渲染进程不写业务代码，全部交给 `web.oopz.cn` 处理。

**技术栈**：Electron 44 + electron-builder 26 + electron-updater 6。

## 常用命令

```bash
npm install          # 安装依赖
npm start            # 开发运行（electron .）
npm run build        # 仅生成 .app 目录（electron-builder --mac dir，最快自测用）
npm run build:dmg    # 输出 DMG（实际发布用；CI 跑等价命令）
npm run check        # node --check 语法校验（CI 第一道关卡）
npm run clean        # 清掉 node_modules + dist
```

**发布流程**：打 tag 触发 CI，不需要手动构建。

```bash
git tag v1.x.y && git push origin v1.x.y
```

CI 位于 `.github/workflows/release.yml`：在 `macos-latest` 上跑 `electron-builder --mac dmg --x64 --arm64 --publish never`，再把两个 DMG + `latest-mac.yml` + blockmap 一起通过 `softprops/action-gh-release` 发到 GitHub Release。`electron-updater` 端读取 `latest-mac.yml` 做增量更新。

所有 `actions/*` 均已 pin 到 commit SHA（注释里标版本号），改动时需同步更新注释。

**注意**：`package.json` 的 `build` 字段里 `publish.provider` 是 `github`，仓库是 `rootphantomer/Oopz_dmg`（不是本仓库 `oopz`）。改发布目标时改这里。

## 架构要点

### 单进程单窗口
整个应用只有一个 `BrowserWindow`（`mainWindow` 全局变量）。关闭按钮 = 隐藏到托盘，`app.isQuitting` 标记为 true 时才真正退出。菜单栏「退出」设置 `app.isQuitting = true` 后调用 `app.quit()`。

### 持久化 Session
所有 `BrowserWindow` 和 `session.fromPartition` 都用 partition `persist:oopz`。这意味着 cookie / sessionStorage / IndexedDB 都跨启动保留——**重启后登录态不丢是这个 partition 实现的**，不要轻易换。

### 文件职责
- `main.js` — 主进程（窗口、托盘、权限、自动更新、离线页、文件下载、Dock 徽标、窗口状态持久化）
- `preload.js` — 预加载脚本（当前是空的，只保留 contextBridge 扩展空间）
- `offline.html` — 离线提示页。由主进程 `loadFile()` 加载，重试目标为页面内常量（不接收外部 URL）
- `package.json` — electron-builder 配置 + npm scripts
- `build/entitlements.mac.plist` — hardened runtime 所需的 entitlement（JIT / 出站网络 / 用户选择文件）
- `.github/workflows/release.yml` — tag 触发 → 构建 DMG → 发 Release
- `scripts/gen_icons.py` — 从 icon.png 生成 .iconset

### 窗口状态持久化
`mainWindow` 位置/大小防抖 500ms 写入 `~/Library/Application Support/Oopz/window-state.json`（路径在 `app.whenReady()` 内才求值——`app.getPath()` 在 ready 前不可靠）。注意目录是大写 `Oopz`（取自 Info.plist 的 `CFBundleName`），不是 `package.json` 里的小写 `name`。读取时校验 `width/height ≥ 400×300`，**并用 `screen.getAllDisplays()` 校验坐标是否仍落在某块显示器范围内**，避免多屏断开后窗口恢复到屏幕外。

### 权限策略
`setupMediaPermissions` 自动批准 `media`（麦克风），其他全部拒绝。

判定逻辑在 `isAllowedMediaRequest`：**只有明确要求 `video` 时才拒绝，其余（`audio` / `unknown` / 未指定）一律放行**。
注意两个 handler 的 details 字段不同——`setPermissionRequestHandler` 给 `mediaTypes`（数组），`setPermissionCheckHandler` 给 `mediaType`（单数字符串，可能是 `'unknown'`）。不要用 `mediaTypes.includes('audio')` 这种正向判断：Electron 传空数组时会静默拒绝麦克风。

### 导航策略
外链统一用 `shell.openExternal` 打开，仅 `https://web.oopz.cn` 和 `https://oopz.cn` 允许在 app 内导航（`will-navigate` 拦截非白名单 URL 转外部浏览器）。

`setWindowOpenHandler` 始终返回 `{ action: 'deny' }`（保持单窗口），但白名单域名的处理与 `will-navigate` **不同**：走 `mainWindow.loadURL(url)` 留在 app 内。

⚠️ 白名单域名**不能**改成 `safeOpenExternal`——踢到 Safari 会丢失登录态，且 WebRTC 麦克风权限在浏览器里需重新授权。代价是当前页面被替换且无法后退，这是单窗口设计的固有取舍。

注意 `nativeWindowOpen` 已在 **Electron 18 被移除**（项目用 44），`webPreferences` 里不要写这个选项，它是死代码。

### 自动更新
`electron-updater` 在非 `NODE_ENV=development` 时启动后延迟 10s 检查，`autoDownload=true`，下载完成后弹静默通知，点击触发 `quitAndInstall`。错误事件只 `console.error`，不弹给用户。

### 崩溃恢复
`render-process-gone` 时 `webContents.reload()`，**崩溃次数按 60 秒滑动窗口统计**（`CRASH_WINDOW_MS` + `rendererCrashTimestamps` 数组），超过 `MAX_RENDERER_RETRIES`（3 次）就停止重试并显示离线页。

⚠️ 不要在 `did-finish-load` 里重置计数器——崩溃后 reload 也会触发该事件，会导致上限永远不生效。

### 离线页
`showOfflinePage` 用 `loadFile(OFFLINE_PAGE_PATH)` 加载真实的 `offline.html`，**不是 data: URL**。原因：data: URL 有长度限制和 CSP 限制，且重试导航在 `will-navigate` 链路上难以放行。

重试目标写死在 `offline.html` 里（`RETRY_URL` 常量 = `https://web.oopz.cn`），**不再通过 query 注入**——断网重试统一回首页，不回失败时的子路径（SPA 下影响可忽略）。

⚠️ 两个必须知道的坑：
1. **不要把窗口位置数据当跳转目标**。曾经用 `loadFile({ query: { retry } })` + `URLSearchParams(window.location.search)` + `location.href`，被 CodeQL 判为 `js/xss` + `js/client-side-unvalidated-url-redirection`：主进程的白名单校验在另一个进程，污点分析看不见。想保留子路径重试，必须让主进程 `loadURL()` 执行跳转（IPC），而不是在渲染进程赋值 `location`。
2. **不要在 offline.html 里监听 window `online` 事件做自动重连**。Electron 官方文档指出 `navigator.onLine` 是「在线弱指示」（虚拟网卡 / always-connected 网卡都返回 `true`），该事件在离线页加载瞬间几乎必然误触发 → 跳转 → 失败 → `did-fail-load` 跳回离线页 → 无限死循环。改为用户手动点按钮。

另外 `loadFile` 加载 `file://` 失败时**不会**触发 `did-fail-load`（Chromium 对本地文件走同步读取路径），所以 `.catch` 是唯一兜底，那里会退回 `loadURL(APP_URL)` 渲染 Chromium 自带错误页，避免纯白屏。

### Dock 未读徽标
监听 `page-title-updated`，用正则 `/[(（[【]\s*(\d+\+?)\s*[)）\]】]/` 提取未读数，兼容半角 `(3) [12+]` 与全角 `（3） 【12+】`，写到 `app.dock.setBadge`。

### 托盘图标
只需 `nativeImage.createFromPath('assets/trayTemplate.png')` + `setTemplateImage(true)`。

- Electron 的 `createFromPath` **会自动加载同目录的 `@2x` 文件**，不需要手动 `addRepresentation`
- 但「自动模板图」依赖文件名以 `Template` 结尾，打包后资源名可能被哈希化，所以仍要显式 `setTemplateImage(true)`

### 应用菜单
`setupApplicationMenu()` 在非 development 模式下用 `Menu.setApplicationMenu()` 覆盖默认菜单，**屏蔽 DevTools / Reload / Electron 品牌标识**。development 模式保留默认菜单便于调试。

## 修改注意事项

- 改完 `main.js` 后 `npm run check` 过语法，再 `npm run build` 验证启动正常（比打 DMG 快很多）
- 涉及 session 分区名 (`persist:oopz`) 时，用户登录态会丢
- CI 用 Node 22，本地最好对齐
- **发版流程**：`npm version <新版本> --no-git-tag-version` 改 `package.json` + `package-lock.json`（必须同步，只改前者会导致 `npm ci` 报 lock 不同步）→ commit → `git tag -a v<版本> -m "..."` → `git push origin main && git push origin v<版本>`。**tag push 会触发 CI 在 macOS runner 上构建 DMG，本地不产出 release。**
- **版本号一起改三处**：CI 的 release notes 模板里写死了版本相关描述（如最低系统版本），升 Electron 大版本时必须同步改 `.github/workflows/release.yml` 的 notes 段和 `README.md` 的系统要求，否则 Release 页面会漏掉 breaking change
- **最低系统版本由 Electron 版本决定**：`package.json` 的 `build.mac` 下没有 `LSMinimumSystemVersion` 字段，electron-builder 按 Electron 自带的 Info.plist 推导。**实测 Electron 44 → macOS 13.0**，Electron 39 → macOS 10.15。升级 Electron 大版本后不要只看发布说明，直接核对产物：
  ```bash
  plutil -p dist/mac*/Oopz.app/Contents/Info.plist | grep LSMinimumSystemVersion
  ```
  同时在同一个 PR 里同步 `README.md` 的系统要求与 `release.yml` 的 notes 模板。
- 应用**完全未签名**：无 Apple Developer ID 证书，electron-builder 在没有证书时会**整段跳过签名**——即使写了 `hardenedRuntime: true` + `build/entitlements.mac.plist` 也不会生效。实测发布产物的 `codesign -dv` 输出为 `flags=0x20002(adhoc,linker-signed)`、`Identifier=Electron`、没有 `Runtime Version` 行，entitlements 为空。连带影响：
  - Squirrel.Mac 要求更新包满足当前 app 的签名要求，ad-hoc 构建的 cdhash 每次都变 → **自动更新可能停在「重启安装」这一步**（`autoUpdater` 的 `error` 只打 console，用户看不到）
  - TCC（麦克风等）授权按 cdhash 记录，换构建后可能重新弹窗
  - 要真正修复只能上 Developer ID + 公证；否则就把更新降级为「提示 + 打开 Release 页」
- 改 `actions/*` 版本时，SHA 必须去 GitHub API 核对，不要凭记忆写 —— 写错会让 CI 直接失败
- `electron-updater` 增量更新依赖 DMG 同名 `.blockmap` 文件，CI 已经一并上传