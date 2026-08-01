"""API Key認証。

環境変数に設定した単一の固定キーを`X-API-Key`ヘッダーと照合するシンプルな方式
（1人専用ツール前提）。将来ログイン認証等へ差し替える可能性を考慮し、
業務ロジックから独立した1箇所の関門（`verify_api_key`）として実装する。
app.mainでこの関数をFastAPIのグローバル依存関係として登録することで、
以降追加される全エンドポイントに自動的に適用される。
"""

import os
import secrets

from fastapi import Header, HTTPException, status

API_KEY_ENV_VAR = "API_KEY"


def verify_api_key(x_api_key: str | None = Header(default=None, alias="X-API-Key")) -> None:
    expected_key = os.environ.get(API_KEY_ENV_VAR)
    # 環境変数が未設定、またはヘッダー未指定の場合はいかなるキーでも認証を通さない（fail closed）。
    # 比較にはタイミング攻撃対策として定数時間比較のsecrets.compare_digestを用いる。
    if not expected_key or x_api_key is None or not secrets.compare_digest(x_api_key, expected_key):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing API Key",
        )
