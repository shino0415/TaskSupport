#!/bin/sh
# Railwayのボリュームは既定でroot所有としてマウントされ、appuserからは書き込めない
# （SQLiteが/app/data配下にファイルを作成できずクラッシュする）。
# コンテナ起動直後・root権限のうちに/app/dataの所有者をappuserへ揃えてから、
# アプリプロセス自体はappuserへ権限を落として実行する
# （/app・/app/app・/app/.venvはroot所有のままで、appuserからは変更できない）。
set -e

chown appuser:appuser /app/data

exec su -s /bin/sh appuser -c "exec uvicorn app.main:app --host 0.0.0.0 --port 8000"
