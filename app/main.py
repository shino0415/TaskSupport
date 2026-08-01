"""FastAPIアプリケーションのエントリーポイント。

起動時（lifespan）にDBファイル・テーブルが存在しなければ自動生成する。
"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI

from app.auth import verify_api_key
from app.database import init_db


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    init_db()
    yield


# verify_api_keyをアプリ全体のグローバル依存関係として登録することで、
# 以降追加される全エンドポイントに認証チェックが自動的に適用される。
# なお/docs・/redoc・/openapi.jsonはStarletteの素のルートとして登録されグローバル
# dependenciesの対象外になるため、本人専用ツールという性質上、公開の必要性が薄い
# これらのドキュメントUIごと無効化することで認証バイパス経路を塞ぐ。
app = FastAPI(
    title="案件・選考トラッカー API",
    lifespan=lifespan,
    dependencies=[Depends(verify_api_key)],
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)
