# Oopz Desktop

将 [web.oopz.cn](https://web.oopz.cn) 封装为 macOS 原生桌面应用。

## 功能

- 🎙️ **语音通话**：自动授权麦克风权限，开箱即用
- 📌 **系统托盘**：关闭窗口后最小化到菜单栏，后台运行
- 🔒 **持久登录**：Cookie/Session 持久化，重启不丢失登录态
- 🔗 **安全导航**：外部链接自动用系统浏览器打开，仅限 oopz.cn 域名
- 🚫 **单实例锁**：防止重复启动，已有窗口时自动聚焦

## 下载

前往 [Releases](https://github.com/rootphantomer/Oopz_dmg/releases) 下载最新版本。

| 文件 | 架构 | 适用机型 |
|------|------|----------|
| `Oopz-*-arm64.dmg` | Apple Silicon (arm64) | M1 / M2 / M3 / M4 系列 Mac |
| `Oopz-*-x64.dmg` | Intel (x64) | Intel 芯片 Mac |

## 开发

```bash
# 安装依赖（首次）
npm install

# 开发运行
npm start
```

> 如果 Electron 下载慢，创建 `.npmrc` 文件：
> ```
> electron_mirror=https://npmmirror.com/mirrors/electron/
> ```

## 打包

```bash
npm run build      # 生成 .app（默认，速度快）
npm run build:dmg  # 生成 DMG 安装包（x64 + arm64）
npm run build:dir  # 仅生成 .app 目录（不打包，最快）
```

输出在 `dist/` 目录。

## 发布

通过 Git Tag 触发 GitHub Actions 自动构建并发布 Release：

```bash
git tag v1.0.0
git push origin v1.0.0
```

CI 会自动：
1. 构建 arm64 + x64 双架构 DMG
2. 创建 GitHub Release
3. 上传 DMG 安装包并生成更新日志

## 项目结构

```
oopz/
├── main.js              # Electron 主进程（窗口、托盘、权限）
├── preload.js           # 预加载脚本（安全隔离）
├── package.json         # 项目配置 & electron-builder 配置
├── .github/
│   └── workflows/
│       └── release.yml  # CI/CD 自动发布
├── assets/
│   ├── icon.icns              # macOS App 图标
│   ├── icon.png               # 512x512 PNG 图标
│   ├── trayTemplate.png       # 托盘图标 16x16（自动适配深/浅色）
│   └── trayTemplate@2x.png   # 托盘图标 32x32（Retina）
└── scripts/
    └── gen_icons.py           # 图标生成脚本
```

## 自定义图标

替换 `assets/` 下的图标文件即可：

| 文件 | 用途 | 规格 |
|------|------|------|
| `icon.png` | App 图标源文件 | 512x512 或 1024x1024 PNG |
| `icon.icns` | macOS App 图标 | 可由 icon.png 自动生成 |
| `trayTemplate.png` | 托盘图标 | 16x16 黑色模板图标 |
| `trayTemplate@2x.png` | 托盘图标 Retina | 32x32 黑色模板图标 |

> 托盘图标使用 Template 命名（文件名含 `Template`），macOS 会自动根据深色/浅色模式反色。

重新生成 `.icns`：

```bash
# 1. 替换 assets/icon.png 为你的图标（1024x1024 推荐）
# 2. 运行生成脚本
python3 scripts/gen_icons.py
# 3. 转换 icns
iconutil -c icns assets/icon.iconset -o assets/icon.icns
```

## 技术栈

- [Electron](https://www.electronjs.org/) 39
- [electron-builder](https://www.electronjs.org/builder) 26
- 目标平台：macOS（x64 + arm64）
