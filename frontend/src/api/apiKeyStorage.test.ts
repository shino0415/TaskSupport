import { beforeEach, describe, expect, it } from 'vitest'

import { API_KEY_STORAGE_KEY, clearApiKey, loadApiKey, saveApiKey } from './apiKeyStorage'

beforeEach(() => {
  window.sessionStorage.clear()
  window.localStorage.clear()
})

describe('API Keyの保持', () => {
  it('保存したキーを読み出せる（リロード相当）', () => {
    saveApiKey('my-key')

    expect(loadApiKey()).toBe('my-key')
  })

  it('sessionStorageにのみ保存し、localStorageには永続化しない', () => {
    saveApiKey('my-key')

    expect(window.sessionStorage.getItem(API_KEY_STORAGE_KEY)).toBe('my-key')
    expect(window.localStorage.length).toBe(0)
  })

  it('未保存なら空文字列を返す', () => {
    expect(loadApiKey()).toBe('')
  })

  it('クリアすると保持内容が消える', () => {
    saveApiKey('my-key')

    clearApiKey()

    expect(loadApiKey()).toBe('')
    expect(window.sessionStorage.getItem(API_KEY_STORAGE_KEY)).toBeNull()
  })
})
