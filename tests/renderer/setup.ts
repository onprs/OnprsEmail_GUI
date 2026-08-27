import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'
import { useAppStore } from '@renderer/store/use-app-store'

afterEach(() => {
  cleanup()
  useAppStore.setState({
    view: 'mail',
    activeAccountId: null,
    activeMailboxId: null,
    selectedEmailId: null,
    compose: null,
    toasts: []
  })
  vi.clearAllMocks()
})

Object.defineProperty(window, 'confirm', {
  configurable: true,
  value: vi.fn(() => true)
})
