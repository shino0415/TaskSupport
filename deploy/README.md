# デプロイ構成

このアプリは Google Cloud Platform（GCPプロジェクト `tasksupport-portfolio`）上に、
用途の異なる2つの環境としてデプロイされています。

| | 公開デモ環境 | 個人利用環境 |
|---|---|---|
| プラットフォーム | Cloud Run | Compute Engine（VM） |
| 用途 | 誰でも自由に試せるデモ | 自分専用の実データ管理 |
| データリセット | 24時間ごとに自動リセット | 自動リセットしない |
| 詳細 | [`./cloud-run/README.md`](./cloud-run/README.md) | [`./compute-engine/README.md`](./compute-engine/README.md) |

## 経緯

もともと本番デプロイにはRailway（リポジトリルートの `.railway/railway.ts` でInfrastructure as Code
として管理）を使用していましたが、無料トライアルの期限切れによりサービスが停止しました。そのため
GCPへ移行し、現在は上記2環境ともGCP上で稼働しています。`.railway/` ディレクトリは参考用として
リポジトリに残していますが、現在デプロイには使われていません（詳細は [`.railway/README.md`](../.railway/README.md) 参照）。

## 共通の基盤

両環境とも、リポジトリルートの `Dockerfile` からビルドした同じ構成のコンテナイメージを使います。
ただし、イメージの置き場所と更新方法は環境ごとに分かれています（後述の「自動デプロイ」参照）。

| 項目 | 値 |
|---|---|
| GCPプロジェクトID | `tasksupport-portfolio` |
| 有効化しているAPI | `run.googleapis.com` / `compute.googleapis.com` / `artifactregistry.googleapis.com` / `cloudbuild.googleapis.com` |
| Artifact Registry（Cloud Run用・自動デプロイ） | `tasksupport-demo`（`asia-northeast1`、Dockerリポジトリ）。`backend:<コミットSHA>` を置く |
| Artifact Registry（VM用・手動） | `tasksupport`（`asia-northeast1`、Dockerリポジトリ）。`backend:latest` を置く |

### `backend:<コミットSHA>` と `backend:latest` の使い分け

| タグ | リポジトリ | 誰が更新するか | 使う環境 |
|---|---|---|---|
| `backend:<コミットSHA>` | `tasksupport-demo` | masterへのpush時の自動デプロイ（GitHub Actions） | Cloud Run `tasksupport-demo` |
| `backend:latest` | `tasksupport` | 人が手動で（後述「VMの更新手順」） | Compute EngineのVM |

- 自動デプロイは `tasksupport-demo` リポジトリにSHAタグだけをpushし、`latest` は付けません。VM用の `tasksupport`
  リポジトリにはデプロイ用サービスアカウントの権限が無いので、自動デプロイから `latest` が書き換わることはありません。
- 逆に、VM用に `latest` を手動で更新してもCloud Runのイメージは切り替わりません（Cloud Runは `tasksupport-demo` のSHAタグを指しているため）。

## 自動デプロイ（masterへのpush時）

`.github/workflows/ci.yml` の `deploy-backend` / `deploy-frontend` ジョブが行います。

| いつ | 何を | どこへ |
|---|---|---|
| masterへのpushで、CIのチェック（バックエンドのlint・test・マイグレーション検証・Dockerビルドと、フロントエンドの型チェック・lint・テスト・ビルド）がすべて成功したとき | ① バックエンドのイメージ `backend:<コミットSHA>` | Artifact Registry `tasksupport-demo` にpushし、Cloud Run `tasksupport-demo` にデプロイ |
| ①が成功した後 | ② フロントエンド | Vercelのデモ用プロジェクト `frontend` と個人用プロジェクト `tasksupport-personal-frontend`（それぞれ本番デプロイ） |

- チェックがひとつでも失敗したとき、master以外のブランチへのpush、プルリクエストでは、デプロイは行われません。
- Cloud Runのデプロイが失敗したときは、フロントエンドもデプロイされません（新しい画面が古いAPIにつながるのを避けるため）。
  フロントエンド2つは互いに独立しており、片方が失敗してももう片方はデプロイされます。
- Cloud Runへのデプロイはイメージだけを差し替えます（`gcloud run deploy --image=...` のみ）。環境変数・
  `--max-instances=1`・`--min-instances=0`・公開設定・ポート・メモリ・CPU・ランタイム用サービスアカウントは既存の設定のまま変わりません。
- Vercelへのデプロイは、VercelのGit連携ではなくGitHub ActionsからVercel CLIで行います。接続先バックエンド
  （`VITE_API_BASE_URL`）は各Vercelプロジェクトに設定済みのProduction環境変数をそのまま使います（デモ用はCloud Run、個人用はVM）。
- **Compute EngineのVM（個人用バックエンド）は自動デプロイの対象外です。** マイグレーションが手作業のため、
  後述の手順で手動で更新します。個人用フロントエンドは自動デプロイされるので、VMのバックエンドが古いと
  新しい画面が動かない場合があります（その場合はVMを手動で更新する）。
- GCPへの認証はWorkload Identity連携で行い、サービスアカウントの鍵ファイルは使いません。Vercelのトークンは
  GitHub Secrets（`VERCEL_TOKEN`）に置きます。

自動デプロイに必要な外部サービス側の初期設定（GCP（Workload Identity連携・デプロイ用サービスアカウント・
Cloud Run専用ランタイム用サービスアカウントへの切り替え・自動デプロイ専用Artifact Registryリポジトリ・権限付与）・
Vercel（トークン）・GitHub（Secrets/Variables））は [`./github-actions/README.md`](./github-actions/README.md)
にまとめています。**この手順はまだ実行されておらず、実行はユーザーの確認を取ってから行います。** 設定が済むまでは、
masterへのpushでデプロイジョブが動いても認証で失敗します（CIのチェック自体には影響しません）。
専用リポジトリ `tasksupport-demo` にはクリーンアップポリシーを設定し、新しいものから5個のイメージだけを残します
（VM用の `tasksupport` には設定しません）。

### 自動デプロイが使えないときの手動デプロイ

GitHub Actionsや外部サービスの設定に問題があるときは、自分の権限（`gcloud auth login` / `vercel login` 済み）で
手動デプロイできます。Cloud Runの手順は [`./cloud-run/README.md`](./cloud-run/README.md) の「手動デプロイ」を参照してください。
フロントエンドは、リポジトリルートで次のように実行します（自動デプロイと同じ手順。プロジェクトIDは
[`./github-actions/README.md`](./github-actions/README.md) のV-2を参照）。

```bash
cd frontend
# デモ用は VERCEL_PROJECT_ID=prj_uL7v5KvvXzu3vMsRjKtMHgYJYbmT、個人用は prj_3u4SA2oOclU28nEX5CQyo0OVbMvw
export VERCEL_ORG_ID=team_QrGhVoQu9Cohe9vL6l9sWxaz
export VERCEL_PROJECT_ID=<デプロイするプロジェクトのID>
vercel pull --yes --environment=production
vercel build --prod
vercel deploy --prebuilt --prod
```

バックエンドを手動デプロイした場合も、フロントエンドより先にCloud Runを更新してください。

## VMの更新手順（手動、`latest` の更新を含む）

VM（個人利用環境）は自動デプロイの対象外のため、次の手順で手動で更新します。

1. （マイグレーションが必要な変更の場合）[`./compute-engine/README.md`](./compute-engine/README.md) の手順に従い、
   VMのアプリを止めてDBをバックアップし、マイグレーションを適用する（新しいイメージを起動する前に行う）。
2. 更新したいコミットをチェックアウトしたリポジトリルートで、VM用の `backend:latest` をビルド・pushする（自分の権限で実行）。

   ```bash
   gcloud config set project tasksupport-portfolio
   gcloud builds submit \
     --tag asia-northeast1-docker.pkg.dev/tasksupport-portfolio/tasksupport/backend:latest \
     .
   ```

   Cloud Runは `tasksupport-demo` リポジトリのイメージを使っているため、この操作でCloud Runは切り替わりません。
3. VM上で新しいイメージに切り替える。

   ```bash
   gcloud compute ssh tasksupport-personal --zone=us-central1-a
   # VM上で、docker-compose.yml のあるディレクトリに移動してから
   docker compose pull app && docker compose up -d
   ```

4. 個人用フロントエンド（`https://tasksupport-personal-frontend.vercel.app`）で一覧が表示されることを確認する。

## 公開デモ環境（Cloud Run）

- サービス名: `tasksupport-demo`（リージョン `asia-northeast1`）
- サービスURL: `https://tasksupport-demo-769416410713.asia-northeast1.run.app`
- フロントエンド: 既存Vercelプロジェクト `frontend`（`https://frontend-silk-kappa-cub22v0dtl.vercel.app`）
- masterへのpush時に自動デプロイされます（上記「自動デプロイ」参照）。
- 手動デプロイのコマンド・環境変数・`--max-instances=1` にしている理由などは
  [`./cloud-run/README.md`](./cloud-run/README.md) を参照してください。

## 個人利用環境（Compute Engine）

- VM名: `tasksupport-personal`（ゾーン `us-central1-a`、マシンタイプ `e2-micro`、常時無料枠対象）
- 静的外部IP: `tasksupport-personal-ip`（リージョン `us-central1`、実IP `136.112.37.243`）
- TLS: CaddyコンテナがIPアドレスから機械的に決まる `136.112.37.243.sslip.io` でLet's Encrypt証明書を自動取得
- フロントエンド: 新規Vercelプロジェクト `tasksupport-personal-frontend`
  （`https://tasksupport-personal-frontend.vercel.app`。masterへのpush時に自動デプロイされる）
- バックエンドは自動デプロイの対象外。更新は上記「VMの更新手順」で手動で行う。
- VM再作成時の再現手順・docker-compose構成などは
  [`./compute-engine/README.md`](./compute-engine/README.md) を参照してください。
- VMインスタンスメタデータに `startup-script` / `docker-compose-yml` / `caddyfile` / `env-file` を
  設定済みで、VM再作成時にもこのメタデータだけでほぼ再現できます。ただし `env-file` メタデータには
  実際のAPI Key等の秘密情報が含まれるため、リポジトリには一切含めていません（秘密情報はGCP側の
  メタデータにのみ存在します）。値を確認したい場合は以下のようなコマンドで取得できます。

  ```bash
  gcloud compute instances describe tasksupport-personal \
    --zone=us-central1-a \
    --format="value(metadata.items.filter('key:env-file').firstof('value'))"
  ```

## 秘密情報の扱い

このリポジトリは **GitHubパブリックリポジトリ**（`shino0415/TaskSupport`）です。公開デモ環境のAPI Key
（`demo-fb6713027aa00b2a`）はREADME.mdに記載して自由に使ってもらう想定のものですが、個人利用環境の
API Keyはランダム生成した非公開の値であり、どのドキュメント・コードにも記載していません。
