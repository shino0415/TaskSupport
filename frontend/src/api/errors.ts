/**
 * API呼び出しの失敗を、画面で原因が判別できる形に分類するエラー型。
 *
 * - config: 接続先URL（VITE_API_BASE_URL）が未設定
 * - unauthorized: API Key未入力、またはAPIが401を返した（認証エラー）
 * - http: 上記以外のエラーステータス
 * - network: サーバーに到達できない（未起動・URL誤り・CORS不許可など）
 * - invalidResponse: 応答をJSONとして解釈できない
 */
export type ApiErrorKind = 'config' | 'unauthorized' | 'http' | 'network' | 'invalidResponse'

export class ApiError extends Error {
  readonly kind: ApiErrorKind
  readonly status: number | undefined

  constructor(kind: ApiErrorKind, message: string, status?: number) {
    super(message)
    this.name = 'ApiError'
    this.kind = kind
    this.status = status
  }
}

/** 例外の内容を画面表示用のメッセージへ変換する。 */
export function toDisplayMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message
  }
  if (error instanceof Error && error.message !== '') {
    return `予期しないエラーが発生しました: ${error.message}`
  }
  return '予期しないエラーが発生しました。'
}
