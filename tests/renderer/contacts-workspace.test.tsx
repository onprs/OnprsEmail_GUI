import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Contact } from '@shared/types'
import { ContactsWorkspace } from '@renderer/features/contacts/ContactsWorkspace'
import { account, installMailApi, ok, renderWithQuery } from './test-utils'

const contacts: Contact[] = [
  {
    id: 'contact-a',
    addressBookIds: ['default'],
    name: '联系人甲',
    emails: ['first@example.com'],
    company: '甲公司',
    notes: ''
  },
  {
    id: 'contact-b',
    addressBookIds: ['default'],
    name: '联系人乙',
    emails: ['second@example.com'],
    company: '乙公司',
    notes: ''
  }
]

describe('联系人编辑器', () => {
  it('切换联系人后使用新联系人的初始值而不保留未保存内容', async () => {
    installMailApi({
      listContacts: vi.fn(async () => ok(contacts)),
      saveContact: vi.fn(),
      deleteContact: vi.fn()
    })
    renderWithQuery(<ContactsWorkspace account={account()} />)

    fireEvent.click(await screen.findByRole('button', { name: /联系人甲/ }))
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    const nameInput = screen.getByLabelText('姓名')
    expect(nameInput).toHaveValue('联系人甲')
    fireEvent.change(nameInput, { target: { value: '未保存名称' } })

    fireEvent.click(screen.getByRole('button', { name: /联系人乙/ }))
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    expect(screen.getByLabelText('姓名')).toHaveValue('联系人乙')
    expect(screen.getByLabelText('邮箱')).toHaveValue('second@example.com')
  })
})
