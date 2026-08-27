# Onprs Mail Desktop

面向 `onprs.online` 邮件系统的 Windows 本地客户端。应用通过 HTTPS JMAP 完成邮件收发，并通过 Ingress API 提供全域收件、验证码提取和链接查看能力。

## 功能

- 在客户端内使用服务器注册码创建 `@onprs.online` 邮箱并自动登录；首次成功后可由 Windows DPAPI 加密记住注册码，后续创建无需重复输入。
- 多账号 JMAP 登录、邮箱文件夹、分页列表、服务端搜索和安全正文阅读。
- 已读、星标、移动、垃圾箱、回复和转发。
- 富文本撰写、服务端草稿、附件上传下载和 JMAP Submission 发送。
- 全域收件地址流、验证码复制、链接查看、附件、原始 `.eml` 和细粒度删除。
- JMAP 联系人、服务状态检查、浅色/深色主题和隐私设置。
- Windows DPAPI 保护账号密码、Ingress 密钥和可选保存的注册码；沙箱化 Preload、类型化 IPC、HTML 净化和远程图片阻止。

## 开发

```bash
npm install
npm run dev
```

## 验证

```bash
npm run typecheck
npm test
npm run test:e2e
npm run test:e2e:packaged
```

E2E 使用隔离用户目录启动真实 Electron 进程，并通过本地 JMAP 契约服务器验证登录、阅读和发信流程。

## Windows 打包

```bash
npm run icon
npm run dist:dir
npm run dist:win
```

安装程序输出到 `release/Onprs-Mail-0.1.1-x64.exe`。当前开发构建未配置商业代码签名证书，Windows SmartScreen 可能显示未知发布者。

## 服务端配套

完整的全域收件和邮箱创建功能依赖 `Onprs_Email` 中的 Ingress v2。部署前必须同时更新服务器 `.env` 与 Cloudflare Worker 的 `INGRESS_SECRET`，密钥长度不得少于 32 个字符。邮箱创建服务的配置流程见 `Onprs_Email/docs/account-registration.md`。
