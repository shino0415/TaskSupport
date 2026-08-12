/**
 * 実行環境ごとの設定値。
 *
 * APIの接続先はソースに直書きせず、Viteの環境変数（VITE_API_BASE_URL）から読み込む。
 * 未設定のままフォールバックURLへ繋ぎにいくと接続先の取り違えに気づけないため、
 * 未設定は設定不備として扱う。
 */

export const API_BASE_URL_ENV_VAR = 'VITE_API_BASE_URL'

/** 末尾スラッシュを取り除いたAPIのベースURL。未設定・空の場合はnullを返す。 */
export function getApiBaseUrl(): string | null {
  const raw = import.meta.env.VITE_API_BASE_URL
  const value = typeof raw === 'string' ? raw.trim() : ''
  if (value === '') {
    return null
  }
  return value.replace(/\/+$/, '')
}
