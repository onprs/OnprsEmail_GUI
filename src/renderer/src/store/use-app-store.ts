import { create } from 'zustand'
import type { AppView } from '@shared/types'

export interface ComposeSeed {
  mode: 'new' | 'reply' | 'forward'
  draftId?: string
  to?: string[]
  subject?: string
  text?: string
  html?: string
}

interface ToastItem {
  id: number
  message: string
  tone: 'success' | 'error' | 'info'
}

interface AppState {
  view: AppView
  activeAccountId: string | null
  activeMailboxId: string | null
  selectedEmailId: string | null
  compose: ComposeSeed | null
  toasts: ToastItem[]
  setView(view: AppView): void
  setActiveAccount(accountId: string | null): void
  setActiveMailbox(mailboxId: string | null): void
  setSelectedEmail(emailId: string | null): void
  openCompose(seed?: Partial<ComposeSeed>): void
  closeCompose(): void
  notify(message: string, tone?: ToastItem['tone']): void
  dismissToast(id: number): void
}

let toastId = 0

export const useAppStore = create<AppState>((set) => ({
  view: 'mail',
  activeAccountId: null,
  activeMailboxId: null,
  selectedEmailId: null,
  compose: null,
  toasts: [],
  setView: (view) => set({ view }),
  setActiveAccount: (activeAccountId) => set({ activeAccountId, activeMailboxId: null, selectedEmailId: null }),
  setActiveMailbox: (activeMailboxId) => set({ activeMailboxId, selectedEmailId: null }),
  setSelectedEmail: (selectedEmailId) => set({ selectedEmailId }),
  openCompose: (seed) => set({ compose: { mode: 'new', ...seed } }),
  closeCompose: () => set({ compose: null }),
  notify: (message, tone = 'info') => {
    const id = ++toastId
    set((state) => ({ toasts: [...state.toasts, { id, message, tone }] }))
    window.setTimeout(() => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })), 4200)
  },
  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }))
}))
