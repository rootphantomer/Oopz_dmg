# Oopz Desktop

将 [web.oopz.cn](https://web.oopz.cn) 封装为 macOS 原生桌面应用。

## 功能

- 系统托盘图标，关闭窗口后后台运行
- 持久化登录（Cookie/Session 不丢失）
- 单实例锁，防止重复启动
- 外部链接自动用系统浏览器打开

## 开发

```bash
npm install
npm start          # 开发运行
```

## 打包

```bash
npm run build      # 生成 dist/Oopz-*.dmg（x64 + arm64）
npm run build:dir  # 仅生成 .app（不打 dmg，速度快）
```

输出在 `dist/` 目录。

## 项目结构

```
oopz/
├── main.js          # Electron 主进程
├── preload.js       # 预加载脚本
├── package.json     # 项目配置 & electron-builder 配置
├── assets/
│   ├── icon.icns          # macOS App 图标
│   ├── icon.png           # 512x512 PNG 图标
│   ├── trayTemplate.png   # 托盘图标（16x16 模板）
│   └── trayTemplate@2x.png
└── scripts/
    └── gen_icons.py       # 图标生成脚本
```
