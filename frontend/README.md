# フロントエンド（案件・選考トラッカー）

React + Vite + TypeScript のSPA。バックエンド（`../backend`）のAPIを別オリジンから呼び出す。

## セットアップ

```bash
cd frontend
npm install
```

Node.jsは24系（LTS）で動作確認している。

## 環境変数

APIの接続先はソースに直書きせず、Viteの環境変数から読み込む。

| 変数 | 説明 |
|---|---|
| `VITE_API_BASE_URL` | APIのベースURL（例: `http://localhost:8000`）。末尾スラッシュは付けても除去される |

- 開発時は `.env.development`（コミット済み・秘密情報なし）が使われる。
- 個人の設定で上書きしたい場合は `.env.local` / `.env.development.local` を作る（Git管理外）。
- 本番ビルド時は `.env.production` またはビルド環境の環境変数で指定する。未設定のままビルドすると、画面に接続先が未設定である旨のメッセージが表示される。

**API Keyは環境変数・ソースコードに置かない。** 画面上の入力欄から入力し、`sessionStorage` に保持する（リロード後は再入力不要、タブを閉じると破棄される）。

## コマンド

| コマンド | 内容 |
|---|---|
| `npm run dev` | 開発サーバー起動（既定 http://localhost:5173 ） |
| `npm run build` | 型チェック＋本番ビルド（`dist/`） |
| `npm run typecheck` | 型チェックのみ（違反があれば非0で終了） |
| `npm run lint` | oxlintによるlint（警告も含め違反があれば非0で終了） |
| `npm run test` | Vitest（jsdom）によるテスト |

## バックエンドとの接続

APIはCORSの許可オリジンを環境変数で受け取る。開発サーバーのオリジンを列挙してからAPIを起動する。

```bash
# リポジトリルートで
API_KEY=<任意のキー> \
CORS_ALLOW_ORIGINS=http://localhost:5173 \
uv run uvicorn app.main:app --app-dir backend --port 8000
```

画面上部の「API Key」欄に上記 `API_KEY` と同じ値を入力して「保存して接続」を押すと、`GET /projects` の結果が表示される。

- キーが誤っている場合は認証エラー（HTTP 401）である旨が表示される。
- APIが起動していない・接続先URLが誤っている・オリジンがCORSに列挙されていない場合は、接続先とCORS設定の確認を促すメッセージが表示される。
