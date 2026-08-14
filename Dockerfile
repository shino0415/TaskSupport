# uvのバージョンはCI（.github/workflows/ci.yml）のenv.UV_VERSIONと一致させる。
# build-argsが渡されない場合（ローカルでのdocker build単体実行等）はこのデフォルト値にフォールバックする。
# COPY --from=<image>にはビルド引数の変数展開が使えないため、公式uvイメージを
# 一旦別ステージ（uv）としてFROMし、builderステージからはそのステージ名を参照する。
ARG UV_VERSION=0.12.1

FROM ghcr.io/astral-sh/uv:${UV_VERSION} AS uv

# マルチステージビルド: builderで依存関係の解決・インストールのみを行い、
# 実行イメージには.venvとアプリコードのみをコピーして最小限に保つ。
FROM python:3.12-slim AS builder

# uvバイナリを公式イメージからコピーする（pip経由のインストールより高速・再現性が高い）
COPY --from=uv /uv /uvx /bin/

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

WORKDIR /app

# 依存関係定義のみを先にコピーしてsyncすることで、アプリコード変更時に
# 依存関係インストールのDockerレイヤーキャッシュを再利用できるようにする
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-install-project --no-dev

COPY backend/app ./app
RUN uv sync --locked --no-dev

FROM python:3.12-slim

WORKDIR /app

# コンテナエスケープ等が発生した場合の被害範囲を狭めるため、rootではなく専用の非特権ユーザーで実行する
RUN useradd --no-create-home --shell /usr/sbin/nologin appuser

COPY --from=builder /app/.venv ./.venv
COPY --from=builder /app/app ./app

# SQLiteファイルの書き込み先をアプリコード（/app/app）や/app自体から切り離す。
# /app・/app/app・/app/.venvはroot所有・書き込み不可のままとし（appuserからは読み取り・実行のみ）、
# DBファイル専用ディレクトリ（/app/data）だけをappuser所有にすることで、
# 仮に任意ファイル書き込みが可能な脆弱性があってもアプリコードの改ざん（例: 偽ライブラリの設置）を防ぐ
RUN mkdir -p /app/data && chown appuser:appuser /app/data

ENV PATH="/app/.venv/bin:$PATH" \
    DATABASE_URL="sqlite:////app/data/app.db"

# entrypoint.shがroot権限でchownした後にappuserへ落とすため、ここではUSERを固定しない
# （永続ボリュームを/app/dataにマウントする環境では、マウント時点の所有者がroot初期値に
# 上書きされるため、ビルド時のchownだけでは不十分。詳細はentrypoint.shのコメント参照）
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8000

ENTRYPOINT ["/entrypoint.sh"]
