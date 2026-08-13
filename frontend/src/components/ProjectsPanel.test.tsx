import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { Project } from '../api/types'
import { ProjectsPanel } from './ProjectsPanel'

const BASE_URL = 'http://api.test.local:8000'
const API_KEY = 'valid-key'

const PROJECT_A: Project = {
  id: 1,
  name: 'ポートフォリオサイト制作',
  client_name: '株式会社サンプル',
  status: '契約中',
  reward: 120000,
  applied_date: '2026-08-01',
  deadline: '2026-09-30',
  platform: 'CrowdWorks',
  memo: '週次で進捗報告',
  is_deleted: false,
}

const PROJECT_B: Project = {
  id: 2,
  name: 'LP制作',
  client_name: '合同会社テスト',
  status: '提案中',
  reward: 50000,
  applied_date: '2026-08-05',
  deadline: null,
  platform: 'ランサーズ',
  memo: null,
  is_deleted: false,
}

/** 逆行遷移の警告を返す線形部分の順序（バックエンドの状態遷移グラフの一部を模す）。 */
const STATUS_ORDER = ['提案中', '契約中', '納品済み', '完了']

type FakeServer = {
  projects: Project[]
  requests: { method: string; url: string; body: unknown }[]
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** 論理削除・ステータス逆行時のwarningまで模した簡易APIサーバー。 */
function setupFakeServer(initial: Project[]): FakeServer {
  const server: FakeServer = { projects: initial.map((p) => ({ ...p })), requests: [] }
  let nextId = Math.max(0, ...initial.map((p) => p.id)) + 1

  const handler = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input))
    const method = init?.method ?? 'GET'
    const body: unknown = init?.body === undefined ? undefined : JSON.parse(String(init.body))
    server.requests.push({ method, url: `${url.pathname}${url.search}`, body })

    const match = /^\/projects\/(\d+)$/.exec(url.pathname)
    if (url.pathname === '/projects' && method === 'GET') {
      const status = url.searchParams.get('status')
      const visible = server.projects.filter(
        (p) => !p.is_deleted && (status === null || p.status === status),
      )
      return Promise.resolve(jsonResponse(200, visible))
    }
    if (url.pathname === '/projects' && method === 'POST') {
      const created = { ...(body as Omit<Project, 'id' | 'is_deleted'>), id: nextId, is_deleted: false }
      nextId += 1
      server.projects.push(created)
      return Promise.resolve(jsonResponse(201, created))
    }
    if (match !== null) {
      const id = Number(match[1])
      const target = server.projects.find((p) => p.id === id && !p.is_deleted)
      if (target === undefined) {
        return Promise.resolve(jsonResponse(404, { detail: 'Project not found' }))
      }
      if (method === 'GET') {
        return Promise.resolve(jsonResponse(200, target))
      }
      if (method === 'PATCH') {
        const patch = body as Partial<Project>
        const before = target.status
        Object.assign(target, patch)
        const isBackward =
          patch.status !== undefined &&
          STATUS_ORDER.includes(before) &&
          STATUS_ORDER.includes(patch.status) &&
          STATUS_ORDER.indexOf(patch.status) < STATUS_ORDER.indexOf(before)
        return Promise.resolve(
          jsonResponse(200, {
            ...target,
            warning: isBackward
              ? `${before} から ${patch.status} への変更です。意図的な変更か確認してください。`
              : null,
          }),
        )
      }
      if (method === 'DELETE') {
        target.is_deleted = true
        return Promise.resolve(new Response(null, { status: 204 }))
      }
    }
    return Promise.resolve(jsonResponse(404, { detail: 'Not Found' }))
  }

  vi.stubGlobal('fetch', vi.fn(handler))
  return server
}

function renderPanel() {
  return render(<ProjectsPanel apiKey={API_KEY} />)
}

async function fillDateField(label: string, value: string) {
  const input = screen.getByLabelText(label, { exact: false })
  fireEvent.change(input, { target: { value } })
  await waitFor(() => expect(input).toHaveValue(value))
}

/** ダイアログが閉じきるまで待つ（開いている間は背後の一覧がaria-hiddenで参照できないため）。 */
async function waitForDialogClosed() {
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
}

async function selectOption(user: ReturnType<typeof userEvent.setup>, label: string, option: string) {
  await user.click(screen.getByLabelText(label))
  await user.click(await screen.findByRole('option', { name: option }))
}

beforeEach(() => {
  vi.stubEnv('VITE_API_BASE_URL', BASE_URL)
})

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('一覧と絞り込み', () => {
  it('案件一覧と件数を表示する', async () => {
    setupFakeServer([PROJECT_A, PROJECT_B])

    renderPanel()

    expect(await screen.findByText('取得件数: 2 件')).toBeInTheDocument()
    expect(screen.getByText('ポートフォリオサイト制作')).toBeInTheDocument()
    expect(screen.getByText('LP制作')).toBeInTheDocument()
  })

  it('0件でも表示が破綻せず0件と分かる', async () => {
    setupFakeServer([])

    renderPanel()

    expect(await screen.findByText('取得件数: 0 件')).toBeInTheDocument()
    expect(screen.getByText('案件は0件です。')).toBeInTheDocument()
  })

  it('ステータスで絞り込むとstatusクエリ付きで取得し、該当分だけ表示する', async () => {
    const server = setupFakeServer([PROJECT_A, PROJECT_B])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('取得件数: 2 件')
    await selectOption(user, 'ステータスで絞り込み', '契約中')

    expect(await screen.findByText('取得件数: 1 件')).toBeInTheDocument()
    expect(screen.getByText('ポートフォリオサイト制作')).toBeInTheDocument()
    expect(screen.queryByText('LP制作')).not.toBeInTheDocument()
    expect(server.requests.at(-1)?.url).toBe(`/projects?status=${encodeURIComponent('契約中')}`)
  })

  it('絞り込みを「すべて」に戻すと全件表示に戻る', async () => {
    setupFakeServer([PROJECT_A, PROJECT_B])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('取得件数: 2 件')
    await selectOption(user, 'ステータスで絞り込み', '契約中')
    await screen.findByText('取得件数: 1 件')
    await selectOption(user, 'ステータスで絞り込み', 'すべて')

    expect(await screen.findByText('取得件数: 2 件')).toBeInTheDocument()
  })
})

describe('詳細表示', () => {
  it('一覧から詳細を開くと GET /projects/{id} の内容を表示する', async () => {
    const server = setupFakeServer([PROJECT_A, PROJECT_B])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('取得件数: 2 件')
    await user.click(screen.getByRole('button', { name: '案件「LP制作」の詳細' }))

    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText('ランサーズ')).toBeInTheDocument()
    expect(within(dialog).getByText('合同会社テスト')).toBeInTheDocument()
    expect(within(dialog).getByText('未設定')).toBeInTheDocument()
    expect(server.requests.at(-1)).toMatchObject({ method: 'GET', url: '/projects/2' })
  })

  it('削除済みの案件の詳細は参照できず、404と分かるメッセージを表示する', async () => {
    // 一覧取得後に削除された案件を参照する状況（詳細だけが404になる）を再現する
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) =>
        Promise.resolve(
          new URL(String(input)).pathname === '/projects'
            ? jsonResponse(200, [PROJECT_B])
            : jsonResponse(404, { detail: 'Project not found' }),
        ),
      ),
    )
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('取得件数: 1 件')
    await user.click(screen.getByRole('button', { name: '案件「LP制作」の詳細' }))

    const dialog = await screen.findByRole('dialog')
    const alert = await within(dialog).findByRole('alert')
    expect(alert).toHaveTextContent('404')
    expect(alert).toHaveTextContent('Project not found')
  })

  it('詳細を閉じると一覧に戻れる', async () => {
    setupFakeServer([PROJECT_A])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('取得件数: 1 件')
    await user.click(screen.getByRole('button', { name: '案件「ポートフォリオサイト制作」の詳細' }))
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByText('CrowdWorks')
    await user.click(within(dialog).getByRole('button', { name: '閉じる' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})

describe('新規登録', () => {
  it('フォームから登録でき、一覧と詳細に反映される', async () => {
    const server = setupFakeServer([])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('取得件数: 0 件')
    await user.click(screen.getByRole('button', { name: '新規登録' }))

    await user.type(screen.getByLabelText('案件名', { exact: false }), 'コーポレートサイト改修')
    await user.type(screen.getByLabelText('クライアント名', { exact: false }), '株式会社ノヴァ')
    await selectOption(user, 'ステータス', '契約中')
    await user.type(screen.getByLabelText('報酬額', { exact: false }), '80000')
    await fillDateField('応募日', '2026-08-11')
    await user.type(screen.getByLabelText('プラットフォーム', { exact: false }), 'CrowdWorks')
    await user.type(screen.getByLabelText('メモ'), '要件定義から')
    await user.click(screen.getByRole('button', { name: '登録する' }))
    await waitForDialogClosed()

    expect(await screen.findByText('案件を登録しました。')).toBeInTheDocument()
    expect(await screen.findByText('コーポレートサイト改修')).toBeInTheDocument()
    expect(screen.getByText('取得件数: 1 件')).toBeInTheDocument()

    const created = server.requests.find((request) => request.method === 'POST')
    expect(created?.body).toEqual({
      name: 'コーポレートサイト改修',
      client_name: '株式会社ノヴァ',
      status: '契約中',
      reward: 80000,
      applied_date: '2026-08-11',
      deadline: null,
      platform: 'CrowdWorks',
      memo: '要件定義から',
    })

    await user.click(screen.getByRole('button', { name: '案件「コーポレートサイト改修」の詳細' }))
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText('要件定義から')).toBeInTheDocument()
  })

  it('必須項目が未入力なら項目ごとのメッセージを表示し、送信しない', async () => {
    const server = setupFakeServer([])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('取得件数: 0 件')
    await user.click(screen.getByRole('button', { name: '新規登録' }))
    await user.click(screen.getByRole('button', { name: '登録する' }))

    expect(await screen.findByText('案件名を入力してください。')).toBeInTheDocument()
    expect(screen.getByText('クライアント名を入力してください。')).toBeInTheDocument()
    expect(screen.getByText('報酬額を入力してください。')).toBeInTheDocument()
    expect(screen.getByText('応募日を入力してください。')).toBeInTheDocument()
    expect(screen.getByText('プラットフォームを入力してください。')).toBeInTheDocument()
    expect(server.requests.some((request) => request.method === 'POST')).toBe(false)
  })

  it('登録時の通信エラーは原因が分かる形でフォームに表示され、入力内容は保持される', async () => {
    setupFakeServer([])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('取得件数: 0 件')
    await user.click(screen.getByRole('button', { name: '新規登録' }))
    await user.type(screen.getByLabelText('案件名', { exact: false }), '通信断テスト')
    await user.type(screen.getByLabelText('クライアント名', { exact: false }), '株式会社サンプル')
    await user.type(screen.getByLabelText('報酬額', { exact: false }), '1000')
    await fillDateField('応募日', '2026-08-11')
    await user.type(screen.getByLabelText('プラットフォーム', { exact: false }), 'CrowdWorks')

    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    )
    await user.click(screen.getByRole('button', { name: '登録する' }))

    const dialog = await screen.findByRole('dialog')
    const alert = await within(dialog).findByRole('alert')
    expect(alert).toHaveTextContent(BASE_URL)
    expect(alert).toHaveTextContent('CORS')
    expect(screen.getByLabelText('案件名', { exact: false })).toHaveValue('通信断テスト')
  })
})

describe('編集', () => {
  it('各項目を編集でき、変更内容が一覧に反映される', async () => {
    const server = setupFakeServer([PROJECT_A])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('取得件数: 1 件')
    await user.click(screen.getByRole('button', { name: '案件「ポートフォリオサイト制作」を編集' }))

    const nameField = screen.getByLabelText('案件名', { exact: false })
    await user.clear(nameField)
    await user.type(nameField, 'ポートフォリオサイト制作（改訂）')
    await selectOption(user, 'ステータス', '納品済み')
    await user.click(screen.getByRole('button', { name: '更新する' }))
    await waitForDialogClosed()

    expect(await screen.findByText('案件を更新しました。')).toBeInTheDocument()
    expect(await screen.findByText('ポートフォリオサイト制作（改訂）')).toBeInTheDocument()
    expect(within(screen.getByRole('table')).getByText('納品済み')).toBeInTheDocument()
    const patch = server.requests.find((request) => request.method === 'PATCH')
    expect(patch?.url).toBe('/projects/1')
    expect(patch?.body).toMatchObject({ name: 'ポートフォリオサイト制作（改訂）', status: '納品済み' })
  })

  it('ステータス逆行時はAPIの警告を表示しつつ、更新自体は成立する', async () => {
    setupFakeServer([PROJECT_A])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('取得件数: 1 件')
    await user.click(screen.getByRole('button', { name: '案件「ポートフォリオサイト制作」を編集' }))
    await selectOption(user, 'ステータス', '提案中')
    await user.click(screen.getByRole('button', { name: '更新する' }))
    await waitForDialogClosed()

    const alert = await screen.findByText(/意図的な変更か確認してください/)
    expect(alert).toHaveTextContent('契約中 から 提案中 への変更です')
    // 警告が出ても更新はブロックされない
    expect(alert).toHaveTextContent('変更は保存されています')
    expect(await screen.findByText('提案中')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '案件「ポートフォリオサイト制作」の詳細' }))
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText('提案中')).toBeInTheDocument()
  })
})

describe('削除', () => {
  it('確認のうえ削除でき、削除後は一覧から参照できなくなる', async () => {
    const server = setupFakeServer([PROJECT_A, PROJECT_B])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('取得件数: 2 件')
    await user.click(screen.getByRole('button', { name: '案件「LP制作」を削除' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/案件「LP制作」を削除します/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: '削除する' }))
    await waitForDialogClosed()

    expect(await screen.findByText('案件「LP制作」を削除しました。')).toBeInTheDocument()
    expect(await screen.findByText('取得件数: 1 件')).toBeInTheDocument()
    expect(screen.queryByText('LP制作')).not.toBeInTheDocument()
    expect(server.requests.some((r) => r.method === 'DELETE' && r.url === '/projects/2')).toBe(true)
    expect(
      screen.queryByRole('button', { name: '案件「LP制作」の詳細' }),
    ).not.toBeInTheDocument()
  })

  it('キャンセルすると削除されない', async () => {
    const server = setupFakeServer([PROJECT_A])
    const user = userEvent.setup()

    renderPanel()
    await screen.findByText('取得件数: 1 件')
    await user.click(screen.getByRole('button', { name: '案件「ポートフォリオサイト制作」を削除' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'キャンセル' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(server.requests.some((request) => request.method === 'DELETE')).toBe(false)
    expect(screen.getByText('ポートフォリオサイト制作')).toBeInTheDocument()
  })
})

describe('通信エラー', () => {
  it('一覧取得に失敗すると原因が分かるメッセージを表示する', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse(401, { detail: 'Invalid or missing API Key' }))),
    )

    renderPanel()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('401')
    expect(alert).toHaveTextContent('API Key')
  })
})
