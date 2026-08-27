# 贡献指南

## 开发环境

- 使用 `package.json` 中声明的 Node.js 和 npm 版本。
- 使用 `npm ci` 按 `package-lock.json` 安装依赖，不手工修改锁文件。
- 目标平台和完整验证环境为 Windows x64。
- 仅修改应用图标时安装 `requirements-icon.txt` 中的 Python 依赖。

## 开发流程

1. 从最新的 `main` 分支创建用途明确的分支。
2. 修改前先确认相关主进程、preload、渲染进程和共享契约的调用关系。
3. 按改动风险补充单元测试或 Electron E2E。
4. 提交前运行 `npm run check`。
5. 涉及用户流程、IPC、持久化或网络交互时，再运行 `npm run test:e2e`。
6. 涉及打包、协议加载或 preload 时，还需在 Windows 运行 `npm run test:e2e:packaged`。

## 代码约定

- TypeScript 保持严格模式，不使用未验证的类型断言绕过外部数据校验。
- Renderer 只能通过 preload 暴露的类型化 API 访问主进程；新增 IPC 必须同时更新共享通道、Zod Schema、preload 和主进程处理器。
- 网络响应、IPC 输入和持久化数据应在信任边界完成运行时校验。
- 用户可见文本使用清晰、直接的中文，不显示调试信息或面向开发者的说明。
- 使用 `npm run format` 统一格式，并让 `npm run lint` 保持零警告。

## 测试要求

- `tests/unit/` 保护服务逻辑、存储迁移、输入契约和主进程安全边界。
- `tests/renderer/` 使用 jsdom 保护 Renderer 状态转换与关键交互。
- `tests/e2e/` 使用隔离用户目录，不得访问真实账号、真实邮件或生产凭据。
- 测试凭据必须是明显的虚构值，且不能与任何线上配置相同。
- 修复缺陷时应先补充能复现问题的测试，再验证修复后的行为。

## 隐私与安全

不得提交 `.env`、账号密码、注册码、Ingress 密钥、代码签名私钥、本地数据库、真实 `.eml`、日志、截图或测试报告。提交前至少执行：

```bash
git status --short
git diff --check
git diff --cached --name-only
```

发现安全问题时不要创建包含利用细节的公开 Issue，请按 [安全策略](SECURITY.md) 私下报告。

## 拉取请求

拉取请求应说明行为变化、影响范围和实际执行的验证命令。避免把功能改动、机械格式化和无关重构混在同一提交中。依赖更新必须保留精确版本并提交同步生成的 `package-lock.json`。

仓库尚未配置 Windows 代码签名证书，因此不会自动发布安装程序。正式发布前需要完成版本更新、全套测试、打包后启动验证、恶意软件扫描、代码签名和 SHA-256 校验。
