# Onprs Mail Desktop

**简体中文** | [English](README.en.md)

[![CI](https://github.com/onprs/OnprsEmail_GUI/actions/workflows/ci.yml/badge.svg)](https://github.com/onprs/OnprsEmail_GUI/actions/workflows/ci.yml)

Onprs Mail Desktop 是面向 `onprs.online` 邮件系统的 Windows 桌面客户端。它通过基于 HTTPS 的 JMAP 收发邮件，并展示 Ingress API 提取的全域收件内容、验证码和链接。

## 功能

### 账号与邮件

- 使用现有 JMAP 账号登录，或通过服务器注册码创建 `@onprs.online` 邮箱并自动登录。
- 管理多个账号、浏览邮箱文件夹和分页邮件列表，并使用服务端搜索定位邮件。
- 安全阅读纯文本与 HTML 邮件；打开未读邮件时自动标记为已读，并支持加星、移动、移入垃圾箱、回复和转发。
- 使用富文本编辑器撰写邮件，手动保存服务端草稿，上传或下载附件，并通过 JMAP Submission 发信。

### 全域收件与联系人

- 按收件地址聚合和筛选全域收件内容，复制验证码，并通过系统浏览器打开提取的链接。
- Ingress v2 可下载附件和原始 `.eml`，并删除单封邮件；Ingress v1 支持浏览正文和按收件地址清理。
- 账号支持 JMAP Contacts 时，可搜索、新建、编辑和删除联系人。
- 提供服务状态检查、跟随系统/浅色/深色主题及隐私设置。

### 安全设计

- 使用 Electron `safeStorage`（Windows 上由 DPAPI 支持）加密保存用户选择记住的账号密码、Ingress 密钥和可选保存的注册码。
- 启用沙箱化 preload、上下文隔离、受校验的类型化 IPC、HTML 净化和 iframe CSP。
- 默认阻止远程图片，外部链接只交由系统浏览器处理。

## 环境要求

- 目标平台：Windows x64。
- Node.js `22.13.0` 以上的 22.x 版本，或 Node.js `24.0.0` 及以上版本；CI 固定使用 Node.js 24。
- npm `11.16.0`，版本记录在 `packageManager` 字段中。
- 仅重新生成应用图标时需要 Python 3 和 `requirements-icon.txt` 中的 Pillow。

客户端开发不需要项目级 `.env`。账号密码、注册码、Ingress 密钥和真实邮件数据不得写入仓库。

## 开始开发

```bash
git clone https://github.com/onprs/OnprsEmail_GUI.git
cd OnprsEmail_GUI
npm ci
npm run dev
```

## 工程命令

| 命令                        | 用途                                                   |
| --------------------------- | ------------------------------------------------------ |
| `npm run dev`               | 启动 Electron Vite 开发环境                            |
| `npm run build`             | 构建主进程、preload 和渲染进程                         |
| `npm run format`            | 使用 Prettier 格式化受管文件                           |
| `npm run lint`              | 运行 ESLint，并将警告视为失败                          |
| `npm run audit:prod`        | 使用 npm 官方安全数据库审计生产依赖                    |
| `npm run typecheck`         | 严格检查 Node/Electron 与渲染进程 TypeScript           |
| `npm test`                  | 运行 Node 单元测试和 jsdom 组件测试                    |
| `npm run test:unit`         | 运行主进程、存储及共享契约单元测试                     |
| `npm run test:renderer`     | 运行 Renderer jsdom 组件测试                           |
| `npm run test:coverage`     | 运行两套测试并分别检查覆盖率门槛                       |
| `npm run test:e2e`          | 构建并运行真实 Electron 端到端测试                     |
| `npm run test:e2e:packaged` | 生成 Windows 目录包并执行打包后启动测试                |
| `npm run check`             | 依次执行格式检查、Lint、类型检查、覆盖率测试和生产构建 |
| `npm run dist:dir`          | 生成 `release/win-unpacked/` 目录包                    |
| `npm run dist:win`          | 生成 Windows x64 NSIS 安装程序                         |

`npm run test:e2e` 使用隔离用户目录和本地 JMAP/注册契约服务器，覆盖安全启动、创建与登录、阅读、发信及发送恢复。`npm run test:e2e:packaged` 仅在 Windows 验证目录包的 `app://` 页面、preload bridge 和安全启动，不执行 NSIS 安装过程。

GitHub Actions 会在拉取请求和 `main` 分支推送时运行质量门禁与源码 E2E；`main` 分支推送还会执行打包后启动测试。失败时会保留 Playwright 报告、trace 和截图。

## 目录结构

| 路径              | 职责                                                   |
| ----------------- | ------------------------------------------------------ |
| `src/main/`       | Electron 主进程、JMAP/Ingress 服务、安全策略和本地存储 |
| `src/preload/`    | 向渲染进程暴露最小化、类型化的 IPC bridge              |
| `src/renderer/`   | React 界面、状态管理和交互流程                         |
| `src/shared/`     | 主进程与渲染进程共用的类型、Schema 和 IPC 通道         |
| `tests/unit/`     | 服务、存储、安全处理和输入契约单元测试                 |
| `tests/renderer/` | Renderer 状态转换和关键交互的 jsdom 组件测试           |
| `tests/e2e/`      | 源码 Electron 流程及 Windows 目录包启动测试            |

## Windows 打包

仓库已包含应用图标，通常无需重新生成。需要更新图标时执行：

```bash
python -m pip install -r requirements-icon.txt
npm run icon
```

生成目录包或安装程序：

```bash
npm run dist:dir
npm run dist:win
```

安装程序输出为 `release/Onprs-Mail-<version>-x64.exe`。仓库尚未配置 Windows 代码签名证书，生成的安装程序可能被 Windows SmartScreen 标记为未知发布者。

## 服务端配套

完整的全域收件和邮箱创建功能依赖 [OnprsEmail](https://github.com/onprs/OnprsEmail) 中的 Ingress v2，两套凭据必须相互独立：

- 全域收件使用服务器 `.env` 中的 `INGRESS_SECRET_KEY`；Cloudflare Worker Secret `INGRESS_SECRET` 必须保存相同值，且长度不得少于 32 个字符。
- 邮箱创建使用独立的 `ACCOUNT_REGISTRATION_CODE` 和受限的 Stalwart provisioning 配置，不能与 Ingress 查询密钥混用。

部署和轮换流程见服务端文档 [桌面端创建邮箱](https://github.com/onprs/OnprsEmail/blob/main/docs/account-registration.md)。桌面客户端不会接触或保存 Stalwart 管理凭据。

## 参与贡献与安全报告

提交改动前请阅读 [贡献指南](CONTRIBUTING.md)，安全问题请按 [安全策略](SECURITY.md) 私下报告。
