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

両環境とも、同じコンテナイメージ（リポジトリルートの `Dockerfile` からビルド）を共有しています。

| 項目 | 値 |
|---|---|
| GCPプロジェクトID | `tasksupport-portfolio` |
| 有効化しているAPI | `run.googleapis.com` / `compute.googleapis.com` / `artifactregistry.googleapis.com` / `cloudbuild.googleapis.com` |
| Artifact Registryリポジトリ | `tasksupport`（`asia-northeast1`、Dockerリポジトリ） |
| イメージビルドコマンド | `gcloud builds submit --tag asia-northeast1-docker.pkg.dev/tasksupport-portfolio/tasksupport/backend:latest .`（リポジトリルートで実行） |

## 公開デモ環境（Cloud Run）

- サービス名: `tasksupport-demo`（リージョン `asia-northeast1`）
- サービスURL: `https://tasksupport-demo-769416410713.asia-northeast1.run.app`
- フロントエンド: 既存Vercelプロジェクト `frontend`（`https://frontend-silk-kappa-cub22v0dtl.vercel.app`）
- デプロイコマンド・環境変数・`--max-instances=1` にしている理由などは
  [`./cloud-run/README.md`](./cloud-run/README.md) を参照してください。

## 個人利用環境（Compute Engine）

- VM名: `tasksupport-personal`（ゾーン `us-central1-a`、マシンタイプ `e2-micro`、常時無料枠対象）
- 静的外部IP: `tasksupport-personal-ip`（リージョン `us-central1`、実IP `136.112.37.243`）
- TLS: CaddyコンテナがIPアドレスから機械的に決まる `136.112.37.243.sslip.io` でLet's Encrypt証明書を自動取得
- フロントエンド: 新規Vercelプロジェクト `tasksupport-personal-frontend`
  （`https://tasksupport-personal-frontend.vercel.app`）
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
