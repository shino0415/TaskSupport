"""デモ環境専用: Web本体プロセス内で一定間隔ごとにダミーデータへ自動リセットする
バックグラウンドタスク。

「デモ環境用シードデータ投入スクリプトの追加」タスクで実装した`seed()`をそのまま
流用する。Railwayでは永続ボリュームを1サービスにしか接続できず、Web本体サービス
とは別のスケジューラ（Cron Job等）からは同じDBファイルにアクセスできないため、
Web本体プロセス自身が一定間隔ごとに自らリセットを実行する方式にした。

この処理は公開デモ環境専用の挙動であり、通常運用・ローカル開発・既存の開発用DB
（実データ）では絶対に動いてはならない。そのため明示的なオプトイン（環境変数
`DEMO_AUTO_RESET_ENABLED`）が無い限り一切動作しない（fail closed）。

HTTPエンドポイントとしては公開しない。このモジュールはどのルーター
（`app/routers/`配下）にも登録されない独立モジュールで、`app.main`のlifespanから
起動・停止のみされる。
"""

import asyncio
import logging
import os
from collections.abc import Callable
from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.seed_demo_data import seed

logger = logging.getLogger("app.demo_reset")

ENABLED_ENV_VAR = "DEMO_AUTO_RESET_ENABLED"
INTERVAL_HOURS_ENV_VAR = "DEMO_AUTO_RESET_INTERVAL_HOURS"
DEFAULT_INTERVAL_HOURS = 24.0
_TRUTHY_VALUES = {"1", "true"}


def is_enabled() -> bool:
    """明示的なオプトインが行われているか（環境変数ベース、未設定時はFalse）。"""
    return os.environ.get(ENABLED_ENV_VAR, "").strip().lower() in _TRUTHY_VALUES


def get_interval_seconds() -> float:
    """自動リセットの実行間隔（秒）。環境変数未設定時は24時間。"""
    raw = os.environ.get(INTERVAL_HOURS_ENV_VAR)
    hours = float(raw) if raw else DEFAULT_INTERVAL_HOURS
    return hours * 3600


def run_reset_once(session_factory: Callable[[], Session] = SessionLocal) -> dict[str, int]:
    """1回分のダミーデータ再投入を行い、実行日時が分かるログを出力する。

    既存の`seed()`をそのまま呼ぶのみで、`seed()`自体の挙動やCLIからの単発実行
    （`app.seed_demo_data.main()`）には一切影響しない。
    """
    db = session_factory()
    try:
        counts = seed(db)
        db.commit()
    finally:
        db.close()
    logger.info(
        "デモ環境用データを自動リセットしました（実行日時: %s）: %s",
        datetime.now().isoformat(timespec="seconds"),
        counts,
    )
    return counts


async def run_periodic_reset(
    interval_seconds: float,
    reset_fn: Callable[[], Any] = run_reset_once,
) -> None:
    """interval_secondsごとにreset_fnを呼び出し続ける（呼び出し側にキャンセルされるまで無限ループ）。

    reset_fnは同期関数（DBアクセスを含む）のため、`asyncio.to_thread`で別スレッドに
    退避して実行する。イベントループ自体は塞がないため、通常のAPIリクエストの処理は
    自動リセットの実行中もブロックされない。
    """
    while True:
        await asyncio.sleep(interval_seconds)
        await asyncio.to_thread(reset_fn)


def start_background_task() -> asyncio.Task[None] | None:
    """オプトインしている場合のみ、バックグラウンドタスクを起動して返す。

    オプトインしていない場合は何も起動せずNoneを返す（通常運用・ローカル開発・
    既存の開発用DBが自動的に消去されることはない）。
    """
    if not is_enabled():
        return None
    interval_seconds = get_interval_seconds()
    logger.info(
        "デモ環境用データの自動リセットを有効化しました（%.4f時間ごと）",
        interval_seconds / 3600,
    )
    return asyncio.create_task(run_periodic_reset(interval_seconds, reset_fn=run_reset_once))
