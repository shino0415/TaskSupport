/**
 * API Keyの保持。
 *
 * 決定事項「API Keyのブラウザ側での扱い」に従い、ソースやビルド時の環境変数には
 * 埋め込まず、画面から入力された値をsessionStorageに保持する
 * （リロード後は再入力不要／タブを閉じれば破棄。localStorageへの永続化はしない）。
 */

export const API_KEY_STORAGE_KEY = 'project-tracker.api-key'

/** プライベートブラウジング等でsessionStorageが使えない環境でも画面が壊れないようにする。 */
function getStorage(): Storage | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

export function loadApiKey(): string {
  try {
    return getStorage()?.getItem(API_KEY_STORAGE_KEY) ?? ''
  } catch {
    return ''
  }
}

export function saveApiKey(apiKey: string): void {
  try {
    getStorage()?.setItem(API_KEY_STORAGE_KEY, apiKey)
  } catch {
    // 保持できなくても当該セッション中のメモリ上の値では動作するため、握りつぶす
  }
}

export function clearApiKey(): void {
  try {
    getStorage()?.removeItem(API_KEY_STORAGE_KEY)
  } catch {
    // 同上
  }
}
