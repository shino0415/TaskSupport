import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import App from './App'
import { API_KEY_HEADER } from './api/client'
import { API_KEY_STORAGE_KEY } from './api/apiKeyStorage'
import type { Project } from './api/types'

const BASE_URL = 'http://api.test.local:8000'

const SAMPLE_PROJECT: Project = {
  id: 1,
  name: 'ポートフォリオサイト制作',
  client_name: '株式会社サンプル',
  status: '契約中',
  reward: 120000,
  applied_date: '2026-08-01',
  deadline: null,
  platform: 'CrowdWorks',
  memo: null,
  is_deleted: false,
}

function stubFetch(impl: typeof fetch) {
  vi.stubGlobal('fetch', vi.fn(impl))
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  vi.stubEnv('VITE_API_BASE_URL', BASE_URL)
  window.sessionStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('初期画面', () => {
  it('API Key未入力なら入力を促し、APIを呼ばない', () => {
    stubFetch(() => Promise.resolve(jsonResponse(200, [])))

    render(<App />)

    expect(screen.getByRole('heading', { name: '案件・選考トラッカー' })).toBeInTheDocument()
    expect(screen.getByText(/API Keyを入力すると/)).toBeInTheDocument()
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })

  it('接続先（環境変数の値）を画面に表示する', () => {
    stubFetch(() => Promise.resolve(jsonResponse(200, [])))

    render(<App />)

    expect(screen.getByText(`接続先: ${BASE_URL}`)).toBeInTheDocument()
  })
})

describe('API Keyを入力しての疎通', () => {
  it('入力したキーで認証付きリクエストし、取得内容を表示する', async () => {
    stubFetch(() => Promise.resolve(jsonResponse(200, [SAMPLE_PROJECT])))
    const user = userEvent.setup()

    render(<App />)
    await user.type(screen.getByLabelText('API Key'), 'valid-key')
    await user.click(screen.getByRole('button', { name: '保存して接続' }))

    expect(await screen.findByText('ポートフォリオサイト制作')).toBeInTheDocument()
    expect(screen.getByText('取得件数: 1 件')).toBeInTheDocument()
    const [url, init] = vi.mocked(fetch).mock.calls[0]!
    expect(url).toBe(`${BASE_URL}/projects`)
    const headers = (init?.headers ?? {}) as Record<string, string>
    expect(headers[API_KEY_HEADER]).toBe('valid-key')
  })

  it('入力したキーをsessionStorageに保持する', async () => {
    stubFetch(() => Promise.resolve(jsonResponse(200, [])))
    const user = userEvent.setup()

    render(<App />)
    await user.type(screen.getByLabelText('API Key'), 'valid-key')
    await user.click(screen.getByRole('button', { name: '保存して接続' }))

    await waitFor(() =>
      expect(window.sessionStorage.getItem(API_KEY_STORAGE_KEY)).toBe('valid-key'),
    )
    expect(window.localStorage.length).toBe(0)
  })

  it('保持済みのキーがあればリロード後も再入力なしで取得する', async () => {
    window.sessionStorage.setItem(API_KEY_STORAGE_KEY, 'saved-key')
    stubFetch(() => Promise.resolve(jsonResponse(200, [SAMPLE_PROJECT])))

    render(<App />)

    expect(await screen.findByText('ポートフォリオサイト制作')).toBeInTheDocument()
    const [, init] = vi.mocked(fetch).mock.calls[0]!
    const headers = (init?.headers ?? {}) as Record<string, string>
    expect(headers[API_KEY_HEADER]).toBe('saved-key')
  })

  it('クリアすると保持したキーを破棄して未入力状態に戻る', async () => {
    window.sessionStorage.setItem(API_KEY_STORAGE_KEY, 'saved-key')
    stubFetch(() => Promise.resolve(jsonResponse(200, [])))
    const user = userEvent.setup()

    render(<App />)
    await screen.findByText('取得件数: 0 件')
    await user.click(screen.getByRole('button', { name: 'クリア' }))

    expect(window.sessionStorage.getItem(API_KEY_STORAGE_KEY)).toBeNull()
    expect(await screen.findByText(/API Keyを入力すると/)).toBeInTheDocument()
  })

  it('0件でも表示が破綻せず0件と分かる', async () => {
    window.sessionStorage.setItem(API_KEY_STORAGE_KEY, 'saved-key')
    stubFetch(() => Promise.resolve(jsonResponse(200, [])))

    render(<App />)

    expect(await screen.findByText('取得件数: 0 件')).toBeInTheDocument()
    expect(screen.getByText('案件は0件です。')).toBeInTheDocument()
  })
})

describe('エラー表示', () => {
  it('認証エラー時はAPI Keyが原因と分かるメッセージを表示する', async () => {
    window.sessionStorage.setItem(API_KEY_STORAGE_KEY, 'wrong-key')
    stubFetch(() => Promise.resolve(jsonResponse(401, { detail: 'Invalid or missing API Key' })))

    render(<App />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('401')
    expect(alert).toHaveTextContent('API Key')
  })

  it('通信失敗時は接続先・CORSの確認を促すメッセージを表示する', async () => {
    window.sessionStorage.setItem(API_KEY_STORAGE_KEY, 'saved-key')
    stubFetch(() => Promise.reject(new TypeError('Failed to fetch')))

    render(<App />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(BASE_URL)
    expect(alert).toHaveTextContent('CORS')
  })

  it('接続先が未設定なら環境変数の設定不足と分かるメッセージを表示する', async () => {
    vi.stubEnv('VITE_API_BASE_URL', '')
    window.sessionStorage.setItem(API_KEY_STORAGE_KEY, 'saved-key')
    stubFetch(() => Promise.resolve(jsonResponse(200, [])))

    render(<App />)

    expect(await screen.findByRole('alert')).toHaveTextContent('VITE_API_BASE_URL')
  })

  it('再読み込みで復旧できる', async () => {
    window.sessionStorage.setItem(API_KEY_STORAGE_KEY, 'saved-key')
    let shouldFail = true
    stubFetch(() =>
      shouldFail
        ? Promise.reject(new TypeError('Failed to fetch'))
        : Promise.resolve(jsonResponse(200, [SAMPLE_PROJECT])),
    )
    const user = userEvent.setup()

    render(<App />)
    await screen.findByRole('alert')

    shouldFail = false
    await user.click(screen.getByRole('button', { name: '再読み込み' }))

    expect(await screen.findByText('ポートフォリオサイト制作')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
