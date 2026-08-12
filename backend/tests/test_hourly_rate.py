"""時給換算エンドポイント（GET /projects/{id}/hourly-rate）のテスト。

work_logsの正確な稼働時間を制御するため、start/stop APIではなく直接DBセッションで
started_at/ended_atを設定したWorkLogレコードを作成する。
実行中の開発用DBファイル（app.db）を汚染しないよう、テスト専用の一時ファイル
SQLiteエンジンを都度作成し、`get_db`依存関係をオーバーライドして使う。
"""

from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from app import models
from app.auth import API_KEY_ENV_VAR
from app.database import Base, build_engine, get_db
from app.main import app

TEST_API_KEY = "test-secret-key"
AUTH_HEADERS = {"X-API-Key": TEST_API_KEY}


@pytest.fixture
def client_and_session(monkeypatch, tmp_path):
    monkeypatch.setenv(API_KEY_ENV_VAR, TEST_API_KEY)

    db_path = tmp_path / "test_hourly_rate.db"
    engine = build_engine(f"sqlite:///{db_path}")
    Base.metadata.create_all(bind=engine)
    TestSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    def override_get_db():
        db = TestSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client, TestSessionLocal
    app.dependency_overrides.clear()


def make_project_payload(**overrides):
    payload = {
        "name": "テスト案件",
        "client_name": "テストクライアント",
        "status": "提案中",
        "reward": 50000,
        "applied_date": "2026-01-01",
        "deadline": "2026-02-01",
        "platform": "CrowdWorks",
        "memo": "メモ",
    }
    payload.update(overrides)
    return payload


def create_project(client, **overrides):
    payload = make_project_payload(**overrides)
    response = client.post("/projects", json=payload, headers=AUTH_HEADERS)
    return response.json()["id"]


def make_task_payload(**overrides):
    payload = {
        "name": "テストタスク",
        "status": "未着手",
        "memo": "メモ",
    }
    payload.update(overrides)
    return payload


def create_task(client, project_id, **overrides):
    payload = make_task_payload(**overrides)
    response = client.post(f"/projects/{project_id}/tasks", json=payload, headers=AUTH_HEADERS)
    return response.json()["id"]


def add_work_log(SessionLocal, task_id, *, hours=None, is_deleted=False, running=False):
    """指定した稼働時間（時間単位）のWorkLogを直接DBに作成する。

    running=Trueの場合はended_atをNULLのまま（進行中）にする。
    """
    started_at = datetime(2026, 1, 1, 9, 0, 0)
    ended_at = None if running else started_at + timedelta(hours=hours)
    db = SessionLocal()
    try:
        work_log = models.WorkLog(
            task_id=task_id,
            started_at=started_at,
            ended_at=ended_at,
            is_deleted=is_deleted,
        )
        db.add(work_log)
        db.commit()
        db.refresh(work_log)
        return work_log.id
    finally:
        db.close()


def get_hourly_rate(client, project_id):
    return client.get(f"/projects/{project_id}/hourly-rate", headers=AUTH_HEADERS)


def test_hourly_rate_computed_from_reward_and_total_task_hours(client_and_session):
    client, SessionLocal = client_and_session
    project_id = create_project(client, reward=10000)
    task_id = create_task(client, project_id)
    add_work_log(SessionLocal, task_id, hours=1)
    add_work_log(SessionLocal, task_id, hours=1)

    response = get_hourly_rate(client, project_id)
    assert response.status_code == 200
    body = response.json()
    assert body["project_id"] == project_id
    assert body["reward"] == 10000
    assert body["total_work_hours"] == pytest.approx(2.0)
    assert body["hourly_rate"] == pytest.approx(5000.0)


def test_hourly_rate_excludes_deleted_tasks_and_work_logs(client_and_session):
    client, SessionLocal = client_and_session
    project_id = create_project(client, reward=10000)
    active_task_id = create_task(client, project_id)
    deleted_task_id = create_task(client, project_id)

    # 集計対象になるべきログ（1時間）
    add_work_log(SessionLocal, active_task_id, hours=1)
    # 同一（active）タスク内の削除済みログ（除外されるべき）
    add_work_log(SessionLocal, active_task_id, hours=3, is_deleted=True)
    # 削除済みタスク配下のログ（タスクごと除外されるべき）
    add_work_log(SessionLocal, deleted_task_id, hours=5)
    client.delete(f"/tasks/{deleted_task_id}", headers=AUTH_HEADERS)

    response = get_hourly_rate(client, project_id)
    assert response.status_code == 200
    body = response.json()
    assert body["total_work_hours"] == pytest.approx(1.0)
    assert body["hourly_rate"] == pytest.approx(10000.0)


def test_hourly_rate_running_log_excluded_from_total(client_and_session):
    client, SessionLocal = client_and_session
    project_id = create_project(client, reward=10000)
    task_id = create_task(client, project_id)
    add_work_log(SessionLocal, task_id, hours=1)
    # 進行中ログ（ended_at未設定）は集計に含めない設計のため、合計は1時間のまま
    add_work_log(SessionLocal, task_id, running=True)

    response = get_hourly_rate(client, project_id)
    assert response.status_code == 200
    body = response.json()
    assert body["total_work_hours"] == pytest.approx(1.0)
    assert body["hourly_rate"] == pytest.approx(10000.0)


def test_hourly_rate_zero_total_hours_returns_consistent_response_without_error(
    client_and_session,
):
    client, _SessionLocal = client_and_session
    project_id = create_project(client, reward=10000)
    create_task(client, project_id)  # タスクはあるが稼働ログなし

    response = get_hourly_rate(client, project_id)
    assert response.status_code == 200
    body = response.json()
    assert body["total_work_hours"] == 0
    assert body["hourly_rate"] is None


def test_hourly_rate_zero_total_hours_when_no_tasks(client_and_session):
    client, _SessionLocal = client_and_session
    project_id = create_project(client, reward=10000)

    response = get_hourly_rate(client, project_id)
    assert response.status_code == 200
    body = response.json()
    assert body["total_work_hours"] == 0
    assert body["hourly_rate"] is None


def test_hourly_rate_not_found_for_unknown_project_id(client_and_session):
    client, _SessionLocal = client_and_session
    response = get_hourly_rate(client, 99999)
    assert response.status_code == 404


def test_hourly_rate_not_found_for_deleted_project(client_and_session):
    client, _SessionLocal = client_and_session
    project_id = create_project(client)
    client.delete(f"/projects/{project_id}", headers=AUTH_HEADERS)

    response = get_hourly_rate(client, project_id)
    assert response.status_code == 404


def test_hourly_rate_requires_api_key(client_and_session):
    client, _SessionLocal = client_and_session
    project_id = create_project(client)
    response = client.get(f"/projects/{project_id}/hourly-rate")
    assert response.status_code == 401
