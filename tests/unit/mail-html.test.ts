import { describe, expect, it } from 'vitest'
import { sanitizeMailHtml } from '@main/security/mail-html'

describe('邮件 HTML 净化', () => {
  it('移除脚本、事件处理器和表单', () => {
    const html = sanitizeMailHtml(`
      <script>window.require('node:fs')</script>
      <img src="https://tracker.example/pixel" onerror="alert(1)">
      <form action="https://attacker.example"><input name="password"></form>
      <p style="background:url(https://tracker.example/css)">正文</p>
    `)
    expect(html).not.toContain('<script')
    expect(html).not.toContain('onerror')
    expect(html).not.toContain('<form')
    expect(html).not.toContain('<input')
    expect(html).not.toContain('style=')
    expect(html).toContain('正文')
  })

  it('只保留邮件链接的安全协议并固定新窗口属性', () => {
    const html = sanitizeMailHtml(`
      <a href="javascript:alert(1)">危险</a>
      <a href="https://onprs.online/path">安全</a>
    `)
    expect(html).not.toContain('javascript:')
    expect(html).toContain('https://onprs.online/path')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
  })
})
