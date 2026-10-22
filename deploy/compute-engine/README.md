# Compute Engine（個人利用専用デプロイ構成）

このディレクトリは、公開デモ環境（Cloud Run、`deploy/cloud-run/`）とは別に、
**個人の実データ管理用として** Google Compute Engineの単一VM（`e2-micro`、常時無料枠）上で
このアプリをdocker composeにより常時稼働させるための構成をまとめたものです。

全体像は [`deploy/README.md`](../README.md) を参照してください。

バックエンドのソースコード・`Dockerfile`・`entrypoint.sh` はリポジトリルートのものをそのまま使い、
このディレクトリにはCompute Engine向けの追加構成ファイル（docker-compose.yml / Caddyfile / .env）のみを置きます。

## 公開デモ環境との違い

| | 公開デモ環境（Cloud Run） | このVM（Compute Engine） |
|---|---|---|
| 用途 | 誰でも自由に試せるデモ | 自分専用の実データ管理 |
| データリセット | `DEMO_AUTO_RESET_ENABLED=1` により1日1回自動リセット | **自動リセットしない**（`DEMO_AUTO_RESET_ENABLED` は設定自体を渡さない） |
| TLS終端 | プラットフォーム側が処理 | Caddyコンテナが `<静的IP>.sslip.io` でLet's Encrypt証明書を自動取得 |

**このVM上のデータは自動的にリセットされません。** 個人の実データが入るため、`.env` の
`DEMO_AUTO_RESET_ENABLED` は絶対に設定しないでください（未設定であれば `backend/app` 側の
自動リセット処理は起動しません）。

## 前提条件

以下はこのdocker-compose構成の範囲外で、事前に別途用意しておく必要があります。

- Artifact Registryに、リポジトリルートの `Dockerfile` でビルドしたバックエンドイメージをpush済みであること
  （例: `asia-northeast1-docker.pkg.dev/PROJECT_ID/tasksupport/backend:latest`）
- VMに静的external IPアドレスが割り当てられていること（`SSLIP_DOMAIN` の元になる）
- ポート80・443を許可するファイアウォールルールが設定されていること（Let's EncryptのHTTP-01チャレンジ・HTTPSアクセスに必要）
- VM作成自体（`gcloud compute instances create` 等）・Docker / Docker Composeのインストールは
  このディレクトリの範囲外です。事前にVM上で完了させておいてください。

## 使い方

1. `.env.example` を `.env` にコピーし、値を埋める

   ```bash
   cd deploy/compute-engine
   cp .env.example .env
   # API_KEY, CORS_ALLOW_ORIGINS, SSLIP_DOMAIN を編集
   ```

   - `API_KEY`: 自分専用の強いランダム値（`openssl rand -hex 32` 等で生成）
   - `CORS_ALLOW_ORIGINS`: 個人用フロントエンド（Vercel）のURL
   - `SSLIP_DOMAIN`: VMの静的external IPから機械的に決まる `<IP>.sslip.io` 形式のホスト名

2. `docker-compose.yml` 内の `app.image` のプレースホルダ
   （`asia-northeast1-docker.pkg.dev/PROJECT_ID/tasksupport/backend:latest`）を、
   実際にpush済みのイメージタグに書き換える

3. 起動する

   ```bash
   docker compose up -d
   ```

   初回起動時はCaddyがLet's Encryptから証明書を取得するため、数十秒程度アクセスできない時間が発生することがあります。
   `docker compose logs -f caddy` で取得状況を確認できます。

4. 動作確認

   ```bash
   curl -H "X-API-Key: <.envに設定したAPI_KEY>" https://<SSLIP_DOMAIN>/courses
   ```

## 既存DBへの授業系置き換えマイグレーションの適用

旧版（案件系の `project` / `task` / `work_log` テーブルを含むDB）で運用していた `./data/app.db` を
最新版に移行する場合の手順です。コンテナイメージにはAlembicのマイグレーション定義が含まれないため、
リポジトリをチェックアウトした環境（`uv` が使える環境）からDBファイルに対して適用します。

**注意**: 最新のマイグレーション（`b7c3e1a9d4f2`）は案件系3テーブル（`project` / `task` / `work_log`）を
**そのデータごと削除**し、授業系の `course` / `assignment` を作成します（選考系のテーブル・データには
触れません）。適用前に必ずDBファイルをバックアップしてください。

1. アプリを停止し、DBファイルをバックアップする

   ```bash
   cd deploy/compute-engine
   docker compose stop app
   cp ./data/app.db ./data/app.db.bak-$(date +%Y%m%d%H%M%S)
   ```

2. リポジトリルートで、記録上のリビジョンを確認する（`<DBファイルの絶対パス>` は `./data/app.db` の絶対パス）

   ```bash
   DATABASE_URL=sqlite:///<DBファイルの絶対パス> uv run alembic -c backend/alembic.ini current
   ```

   alembicのリビジョン記録が実テーブルとずれている場合（`company_task` テーブルが既に存在するのに
   `974953724e96` より前のリビジョンが記録されている、または何も記録されていない場合）は、
   先に記録を実態に合わせる必要があり得ます。

   ```bash
   DATABASE_URL=sqlite:///<DBファイルの絶対パス> uv run alembic -c backend/alembic.ini stamp 974953724e96
   ```

3. 最新まで適用する

   ```bash
   DATABASE_URL=sqlite:///<DBファイルの絶対パス> uv run alembic -c backend/alembic.ini upgrade head
   ```

4. 新しいイメージでアプリを起動する（`docker compose pull app && docker compose up -d`）

アプリは起動時に不足テーブルを自動作成するため、手順3より前に新しいイメージのアプリを起動すると
`course` / `assignment` が先に作られ、`upgrade head` が失敗します。必ずアプリ起動前に適用してください。

## データの永続化

- SQLiteのDBファイルはホスト側の `./data` ディレクトリにマウントされ（`./data:/app/data`）、
  VMの再起動やコンテナの再作成後も残ります。
- Caddyが取得した証明書は `caddy_data` / `caddy_config` の名前付きvolumeに保存され、
  再起動のたびにLet's Encryptへ再取得しに行くことはありません。
- 両サービスとも `restart: unless-stopped` を設定しているため、VM再起動時にDockerが起動していれば
  自動的にコンテナも復帰します。

## バックアップについて

自動リセットが無い＝データ消失時の復旧手段も自分で用意する必要がある、ということです。
`./data/app.db` を定期的に別の場所へコピーするなど、必要に応じて独自にバックアップを検討してください
（このディレクトリの構成には含まれていません）。
