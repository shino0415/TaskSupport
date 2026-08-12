"""CORS設定。

別オリジンで動作するフロントエンドからAPIを呼び出せるようにするための設定。
許可オリジンは環境変数にカンマ区切りで列挙する方式（決定事項「CORSの許可オリジン
指定方針」）で、未設定・空の場合はどのオリジンも許可しない（fail closed）。
設定漏れが「全オリジン許可」という危険側に倒れないよう、ワイルドカードによる
全許可は既定値にしない。
"""

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

CORS_ALLOW_ORIGINS_ENV_VAR = "CORS_ALLOW_ORIGINS"

# プリフライトで許可するメソッド・ヘッダー。本APIが実際に用いるものだけを
# 明示列挙する（ワイルドカードは使わない）。
ALLOWED_METHODS = ["GET", "POST", "PATCH", "DELETE"]
# Content-Typeはリクエストボディ（application/json）の送信に、X-API-Keyは認証に必要。
ALLOWED_HEADERS = ["Content-Type", "X-API-Key"]


def get_allowed_origins() -> list[str]:
    """環境変数のカンマ区切り文字列を許可オリジンのリストに変換する。

    未設定・空文字列・カンマのみといった実質的に何も指定されていない場合は
    空リストを返し、いかなるオリジンも許可されない状態にする。
    """
    raw = os.environ.get(CORS_ALLOW_ORIGINS_ENV_VAR, "")
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


def configure_cors(app: FastAPI) -> None:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=get_allowed_origins(),
        allow_methods=ALLOWED_METHODS,
        allow_headers=ALLOWED_HEADERS,
        # 認証はX-API-Keyヘッダーで行いCookieを使わないため、資格情報付きリクエストは許可しない
        allow_credentials=False,
    )
