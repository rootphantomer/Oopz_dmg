# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目性质

这是一个 Electron 桌面端应用（仅 macOS，arm64 + x64），将 `https://web.oopz.cn` 封装为原生窗口。代码体量很小——主进程逻辑全部在 `main.js`（~350 行），渲染进程不写业务代码，全部交给 `web.oopz.cn` 处理。

## 常用命令

```bash
npm install          # 安装依赖
npm start            # 开发运行（electron .）
npm run build        # 打包 .app（不走 DMG，最快自测用）
npm run build:dir    # 仅输出 .app 目录（最快，不打 DMG）
npm run build:dmg    # 输出 DMG（实际发布用，CI 也跑这条）
npm run clean        # 清掉 node_modules + dist
```

**发布流程**：打 tag 触发 CI，不需要手动构建。

```bash
git tag v1.x.y && git push origin v1.x.y
```

CI 位于 `.github/workflows/release.yml`：在 `macos-latest` 上跑 `electron-builder --mac --publish never`，再把两个 DMG + `latest-mac.yml` + blockmap 一起通过 `softprops/action-gh-release@v2` 发到 GitHub Release。`electron-updater` 端读取 `latest-mac.yml` 做增量更新。

**注意**：`package.json` 的 `build` 字段里 `publish.provider` 是 `github`，仓库是 `rootphantomer/Oopz_dmg`（不是本仓库 `oopz`）。改发布目标时改这里。

## 架构要点

### 单进程单窗口
整个应用只有一个 `BrowserWindow`（`mainWindow` 全局变量）。关闭按钮 = 隐藏到托盘，`app.isQuitting` 标记为 true 时才真正退出。菜单栏「退出」设置 `app.isQuitting = true` 后调用 `app.quit()`。

### 持久化 Session
所有 `BrowserWindow` 和 `session.fromPartition` 都用 partition `persist:oopz`。这意味着 cookie / sessionStorage / IndexedDB 都跨启动保留——**重启后登录态不丢是这个 partition 实现的**，不要轻易换。

### 文件职责
- `main.js` — 主进程（窗口、托盘、权限、自动更新、离线页、文件下载、Dock 徽标、窗口状态持久化）
- `preload.js` — 预加载脚本（当前是空的，只保留 contextBridge 扩展空间）
- `package.json` — electron-builder 配置 + npm scripts
- `.github/workflows/release.yml` — tag 触发 → 构建 DMG → 发 Release
- `scripts/gen_icons.py` — 从 icon.png 生成 .iconset

### 窗口状态持久化
`mainWindow` 位置/大小防抖 500ms 写入 `~/Library/Application Support/oopz/window-state.json`。读取时只校验 `width/height ≥ 400×300`，**不校验坐标是否在当前显示器范围内**——这是已知缺陷，改时要补 `screen.getDisplayMatching` 校验。

### 权限策略
`setupMediaPermissions` 自动批准 `media`（麦克风），其他全部拒绝。当前 allowlist 里还有个不存在的 `audioCapture`，是死代码。

### 导航策略
外链统一用 `shell.openExternal` 打开，仅 `https://web.oopz.cn` 和 `https://oopz.cn` 在 app 内导航。注意 `setWindowOpenHandler` 对这两个域名返回 `action: 'allow'`——会让网页 `window.open()` 在 app 内弹新窗口，单窗口体验可能受影响。

### 自动更新
`electron-updater` 在 `production` 模式（非 `NODE_ENV=development`）启动后延迟 10s 检查，`autoDownload=true`，下载完成后弹静默通知，点击触发 `quitAndInstall`。错误事件只 `console.error`，不弹给用户。

### 离线页
`showOfflinePage` 在 `did-fail-load` 时把内联 HTML 通过 `data:` URL 注入窗口。HTML 是模板字符串每次重建，可优化为模块级常量。

### Dock 未读徽标
监听 `page-title-updated`，用正则 `/[\(\[](\d+\+?)[\]\)]/` 从 title 提取 `(3)` / `[12+]` 形式的数字，写到 `app.dock.setBadge`。

## 修改注意事项

- 改完 `main.js` 后 `npm run build:dir` 验证启动正常（比打 DMG 快很多）
- 涉及 session 分区名 (`persist:oopz`) 时，用户登录态会丢
- CI 用 Node 22，本地最好对齐
- 应用**未签名**，发布说明里那段 Gatekeeper 提示是必要的（`hardenedRuntime: false`、`gatekeeperAssess: false`）
- `electron-updater` 增量更新依赖 DMG 同名 `.blockmap` 文件，CI 已经一并上传