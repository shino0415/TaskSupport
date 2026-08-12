/**
 * APIクライアント。
 *
 * 認証は決定事項どおり`X-API-Key`ヘッダーで行う（Cookieは使わないため
 * credentialsは送らない）。失敗は原因の分かるApiErrorへ変換して投げる。
 */

import { getApiBaseUrl } from '../config'
import { ApiError } from './errors'

export const API_KEY_HEADER = 'X-API-Key'

type RequestOptions = {
  method?: string
  body?: unknown
  signal?: AbortSignal
}

async function extractDetail(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json()
    if (body !== null && typeof body === 'object' && 'detail' in body) {
      const detail = (body as { detail: unknown }).detail
      return typeof detail === 'string' ? detail : JSON.stringify(detail)
    }
  } catch {
    // ボディがJSONでない場合はステータスのみで通知する
  }
  return ''
}

export async function apiRequest<T>(
  path: string,
  apiKey: string,
  options: RequestOptions = {},
): Promise<T> {
  const baseUrl = getApiBaseUrl()
  if (baseUrl === null) {
    throw new ApiError(
      'config',
      'APIの接続先が設定されていません。環境変数 VITE_API_BASE_URL を設定してください。',
    )
  }
  if (apiKey.trim() === '') {
    throw new ApiError(
      'unauthorized',
      'API Keyが入力されていません。画面上部のフォームにAPI Keyを入力してください。',
    )
  }

  const headers: Record<string, string> = { [API_KEY_HEADER]: apiKey }
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }

  let response: Response
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    })
  } catch (error) {
    // fetch自体の失敗はサーバー未起動・URL誤り・CORS不許可などブラウザ側から
    // 区別できないため、確認すべき観点をまとめて提示する
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error
    }
    throw new ApiError(
      'network',
      `APIサーバーに接続できませんでした（${baseUrl}）。` +
        'APIが起動しているか、接続先URLとCORSの許可オリジン設定を確認してください。',
    )
  }

  if (response.status === 401) {
    throw new ApiError(
      'unauthorized',
      '認証エラー（HTTP 401）: API Keyが正しくありません。入力したキーを確認してください。',
      response.status,
    )
  }
  if (!response.ok) {
    const detail = await extractDetail(response)
    throw new ApiError(
      'http',
      `APIがエラーを返しました（HTTP ${response.status}）${detail === '' ? '' : `: ${detail}`}`,
      response.status,
    )
  }
  if (response.status === 204) {
    return undefined as T
  }

  try {
    return (await response.json()) as T
  } catch {
    throw new ApiError('invalidResponse', `APIの応答を解釈できませんでした（${path}）。`)
  }
}
