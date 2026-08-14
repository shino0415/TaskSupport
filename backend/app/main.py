"""FastAPIアプリケーションのエントリーポイント。

起動時（lifespan）にDBファイル・テーブルが存在しなければ自動生成する。
"""

import asyncio
import contextlib
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI

from app.auth import verify_api_key
from app.cors import configure_cors
from app.database import init_db
from app.demo_reset import start_background_task
from app.routers import companies, company_tasks, interview_steps, projects, tasks, work_logs


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    init_db()
    # オプトイン（環境変数）していない限りNoneが返り、何も起動しない。
    demo_reset_task = start_background_task()
    try:
        yield
    finally:
        if demo_reset_task is not None:
            demo_reset_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await demo_reset_task


def create_app() -> FastAPI:
    """アプリケーションを組み立てる。

    CORSの許可オリジンはこの関数の実行時（＝通常はプロセス起動時）に環境変数から
    読み込まれる。テストから環境変数を変えた状態のアプリを得る用途も兼ねる。
    """
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

    configure_cors(app)

    app.include_router(projects.router)
    app.include_router(tasks.router)
    app.include_router(work_logs.router)
    app.include_router(companies.router)
    app.include_router(interview_steps.router)
    app.include_router(company_tasks.router)
    return app


app = create_app()
