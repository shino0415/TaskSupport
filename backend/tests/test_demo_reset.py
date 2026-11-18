"""デモ環境用データの自動定期リセット（Web本体プロセス内バックグラウンド実行）のテスト。

- オプトイン（環境変数）していない場合は一切動作しないこと（fail closed）
- オプトインした場合、一定間隔ごとに`seed()`が繰り返し呼ばれる（周期的に機能する）こと
- 自動リセットの実行がイベントループ・通常のAPIリクエスト処理をブロックしないこと
- HTTPエンドポイントとしては公開されないこと
- 実行のたびに実行日時が分かるログが出力されること

実行中の開発用DBファイル（app.db）を汚染しないよう、DBが要るテストは全てtmp_path配下の
一時ファイルDB・一時sessionmakerに対してのみ検証する。
"""

import asyncio
import contextlib
import time

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from app import demo_reset
from app.database import Base, build_engine
from app.main import app as fastapi_app

# --- 環境変数の読み取り（is_enabled / get_interval_seconds） ---


def test_is_enabled_defaults_to_false_when_env_var_unset(monkeypatch):
    monkeypatch.delenv(demo_reset.ENABLED_ENV_VAR, raising=False)
    assert demo_reset.is_enabled() is False


@pytest.mark.parametrize("value", ["true", "True", "TRUE", "1"])
def test_is_enabled_is_true_for_truthy_values(monkeypatch, value):
    monkeypatch.setenv(demo_reset.ENABLED_ENV_VAR, value)
    assert demo_reset.is_enabled() is True


@pytest.mark.parametrize("value", ["", "false", "0", "no", "yes", "  "])
def test_is_enabled_is_false_for_anything_else(monkeypatch, value):
    monkeypatch.setenv(demo_reset.ENABLED_ENV_VAR, value)
    assert demo_reset.is_enabled() is False


def test_get_interval_seconds_defaults_to_24_hours(monkeypatch):
    monkeypatch.delenv(demo_reset.INTERVAL_HOURS_ENV_VAR, raising=False)
    assert demo_reset.get_interval_seconds() == 24 * 3600


def test_get_interval_seconds_uses_custom_env_var(monkeypatch):
    monkeypatch.setenv(demo_reset.INTERVAL_HOURS_ENV_VAR, "0.5")
    assert demo_reset.get_interval_seconds() == 0.5 * 3600


# --- run_reset_once（1回分のリセット実行・ログ出力） ---


def test_run_reset_once_reseeds_the_database_and_returns_counts(tmp_path):
    engine = build_engine(f"sqlite:///{tmp_path / 'reset_once.db'}")
    Base.metadata.create_all(bind=engine)
    session_factory = sessionmaker(bind=engine)

    counts = demo_reset.run_reset_once(session_factory=session_factory)

    assert counts == {
        "course": 4,
        "assignment": 7,
        "company": 6,
        "interview_step": 10,
        "company_task": 4,
    }

    from app import models

    db = session_factory()
    assert db.query(models.Company).count() == 6
    db.close()


def test_run_reset_once_logs_execution_datetime(tmp_path, caplog):
    engine = build_engine(f"sqlite:///{tmp_path / 'reset_log.db'}")
    Base.metadata.create_all(bind=engine)
    session_factory = sessionmaker(bind=engine)

    from datetime import date

    with caplog.at_level("INFO", logger="app.demo_reset"):
        demo_reset.run_reset_once(session_factory=session_factory)

    assert len(caplog.records) == 1
    message = caplog.records[0].getMessage()
    assert date.today().isoformat() in message
    assert "自動リセット" in message


def test_run_reset_once_restores_company_statuses_changed_via_api(tmp_path, monkeypatch):
    from app import models
    from app.auth import API_KEY_ENV_VAR
    from app.database import get_db

    engine = build_engine(f"sqlite:///{tmp_path / 'reset_company_status.db'}")
    Base.metadata.create_all(bind=engine)
    session_factory = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    demo_reset.run_reset_once(session_factory=session_factory)

    def statuses() -> dict[str, str]:
        db = session_factory()
        try:
            return {c.name: str(c.status) for c in db.query(models.Company)}
        finally:
            db.close()

    seeded = statuses()

    monkeypatch.setenv(API_KEY_ENV_VAR, "test-secret-key")
    headers = {"X-API-Key": "test-secret-key"}

    def override_get_db():
        db = session_factory()
        try:
            yield db
        finally:
            db.close()

    fastapi_app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(fastapi_app) as client:
            companies = {c["name"]: c for c in client.get("/companies", headers=headers).json()}
            # 手動の変更（逆行を含む）
            for name, new_status in [
                ("例示ネットワークス株式会社", "選考中"),
                ("仮想メディア株式会社", "内定"),
                ("架空フーズ株式会社", "内定"),
            ]:
                response = client.patch(
                    f"/companies/{companies[name]['id']}",
                    json={"status": new_status},
                    headers=headers,
                )
                assert response.status_code == 200
            # 選考ステップの不通過による自動お見送り
            target = companies["サンプルテクノロジーズ株式会社"]
            steps = client.get(f"/companies/{target['id']}/interview-steps", headers=headers)
            response = client.patch(
                f"/interview-steps/{steps.json()[0]['id']}",
                json={"result": "不通過"},
                headers=headers,
            )
            assert response.status_code == 200
    finally:
        fastapi_app.dependency_overrides.clear()

    changed = statuses()
    assert changed["サンプルテクノロジーズ株式会社"] == "お見送り"
    assert changed != seeded

    demo_reset.run_reset_once(session_factory=session_factory)

    assert statuses() == seeded
    engine.dispose()


# --- run_periodic_reset（周期的な自動実行） ---


def test_run_periodic_reset_calls_reset_fn_repeatedly_until_cancelled():
    calls = []

    async def scenario():
        task = asyncio.create_task(
            demo_reset.run_periodic_reset(0.01, reset_fn=lambda: calls.append(1))
        )
        await asyncio.sleep(0.1)
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task

    asyncio.run(scenario())
    assert len(calls) >= 3


def test_run_periodic_reset_executes_first_reset_immediately_without_waiting_for_interval():
    """intervalを待たずに、タスク開始直後（ほぼ即座）に1回目のreset_fnが呼ばれること。

    Cloud Run等、コンテナがスケールダウン/コールドスタートするたびにディスクが初期化
    される環境では、初回実行までinterval_seconds（デフォルト24時間）待ってしまうと
    起動直後のDBが空のまま長時間放置されてしまう。intervalを意図的に長く設定しても
    即座に1回目が実行されることを検証する。
    """
    calls = []

    async def scenario():
        task = asyncio.create_task(
            demo_reset.run_periodic_reset(3600, reset_fn=lambda: calls.append(1))
        )
        await asyncio.sleep(0.05)  # 長いinterval中でも即時実行は完了しているはず
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task

    asyncio.run(scenario())
    assert len(calls) == 1


def test_run_periodic_reset_does_not_block_the_event_loop():
    """reset_fnの実行中も、他のタスク（＝通常のAPIリクエスト相当）が並行して進む。"""
    order = []

    def slow_reset():
        order.append("reset-start")
        time.sleep(0.15)
        order.append("reset-end")

    async def other_task():
        await asyncio.sleep(0.02)
        order.append("other-task-progressed-during-reset")

    async def scenario():
        task = asyncio.create_task(demo_reset.run_periodic_reset(0.001, reset_fn=slow_reset))
        await asyncio.sleep(0.02)  # reset_fnがスレッドで開始されるのを待つ
        other = asyncio.create_task(other_task())
        await asyncio.sleep(0.05)  # other_taskは完了するがslow_resetはまだ実行中
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task
        await other

    asyncio.run(scenario())
    assert order == [
        "reset-start",
        "other-task-progressed-during-reset",
        "reset-end",
    ]


# --- start_background_task（オプトインの有無で起動を切り替える） ---


def test_start_background_task_returns_none_when_not_opted_in(monkeypatch):
    monkeypatch.delenv(demo_reset.ENABLED_ENV_VAR, raising=False)

    async def scenario():
        return demo_reset.start_background_task()

    task = asyncio.run(scenario())
    assert task is None


def test_start_background_task_creates_a_task_when_opted_in(monkeypatch):
    monkeypatch.setenv(demo_reset.ENABLED_ENV_VAR, "true")
    monkeypatch.setenv(demo_reset.INTERVAL_HOURS_ENV_VAR, "0.0000001")  # 極短間隔
    calls = []
    monkeypatch.setattr(demo_reset, "run_reset_once", lambda *a, **kw: calls.append(1))

    async def scenario():
        task = demo_reset.start_background_task()
        assert task is not None
        await asyncio.sleep(0.05)
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task

    asyncio.run(scenario())
    assert len(calls) >= 1


def test_start_background_task_executes_first_reset_immediately_even_with_default_interval(
    monkeypatch,
):
    """デフォルトの24時間intervalのままでも、起動直後に1回目のリセットが実行されること。"""
    monkeypatch.setenv(demo_reset.ENABLED_ENV_VAR, "true")
    monkeypatch.delenv(demo_reset.INTERVAL_HOURS_ENV_VAR, raising=False)  # デフォルト24時間
    calls = []
    monkeypatch.setattr(demo_reset, "run_reset_once", lambda *a, **kw: calls.append(1))

    async def scenario():
        task = demo_reset.start_background_task()
        assert task is not None
        await asyncio.sleep(0.05)
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task

    asyncio.run(scenario())
    assert len(calls) == 1


# --- HTTPエンドポイントとしては公開されない ---


def test_demo_reset_is_not_exposed_as_an_http_endpoint():
    paths = set(fastapi_app.openapi()["paths"].keys())
    assert paths, "no routes were registered; the endpoint list itself is broken"
    assert not any("demo" in path or "reset" in path for path in paths)


# --- アプリ全体（lifespan）での結線: オプトインの有無で実際の挙動が変わる ---


def make_app_client_env(monkeypatch, tmp_path):
    import app.database as database_module

    engine = database_module.build_engine(f"sqlite:///{tmp_path / 'lifespan.db'}")
    monkeypatch.setattr(database_module, "engine", engine)
    monkeypatch.setattr(database_module, "SessionLocal", sessionmaker(bind=engine))


def test_app_running_without_opt_in_never_triggers_automatic_reset(monkeypatch, tmp_path):
    make_app_client_env(monkeypatch, tmp_path)
    monkeypatch.delenv(demo_reset.ENABLED_ENV_VAR, raising=False)
    # 万一オプトイン判定にバグがあっても検知できるよう、間隔は極短に設定しておく
    monkeypatch.setenv(demo_reset.INTERVAL_HOURS_ENV_VAR, "0.0000001")

    calls = []
    monkeypatch.setattr(demo_reset, "run_reset_once", lambda *a, **kw: calls.append(1))

    with TestClient(fastapi_app):
        time.sleep(0.1)

    assert calls == []


def test_app_running_with_opt_in_triggers_periodic_automatic_reset(monkeypatch, tmp_path):
    make_app_client_env(monkeypatch, tmp_path)
    monkeypatch.setenv(demo_reset.ENABLED_ENV_VAR, "true")
    monkeypatch.setenv(demo_reset.INTERVAL_HOURS_ENV_VAR, "0.0000001")  # 極短間隔

    calls = []
    monkeypatch.setattr(demo_reset, "run_reset_once", lambda *a, **kw: calls.append(1))

    with TestClient(fastapi_app):
        time.sleep(0.1)

    assert len(calls) >= 2
