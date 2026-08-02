"""WorkLog計測系エンドポイントのテスト。

実行中の開発用DBファイル（app.db）を汚染しないよう、テスト専用の一時ファイル
SQLiteエンジンを都度作成し、`get_db`依存関係をオーバーライドして使う。
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from app.auth import API_KEY_ENV_VAR
from app.database import Base, build_engine, get_db
from app.main import app

TEST_API_KEY = "test-secret-key"
AUTH_HEADERS = {"X-API-Key": TEST_API_KEY}


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setenv(API_KEY_ENV_VAR, TEST_API_KEY)

    db_path = tmp_path / "test_work_logs.db"
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
        yield test_client
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


def start_work_log(client, task_id):
    response = client.post(f"/tasks/{task_id}/work-logs/start", headers=AUTH_HEADERS)
    return response


# --- POST /tasks/{id}/work-logs/start ---


def test_start_work_log_creates_record_with_started_at(client):
    project_id = create_project(client)
    task_id = create_task(client, project_id)

    response = start_work_log(client, task_id)
    assert response.status_code == 201
    body = response.json()
    assert body["task_id"] == task_id
    assert body["started_at"] is not None
    assert body["ended_at"] is None
    assert body["is_deleted"] is False
    assert isinstance(body["id"], int)


def test_start_work_log_allows_multiple_running_logs_for_same_task(client):
    project_id = create_project(client)
    task_id = create_task(client, project_id)

    first = start_work_log(client, task_id)
    second = start_work_log(client, task_id)

    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["id"] != second.json()["id"]

    list_response = client.get(f"/tasks/{task_id}/work-logs", headers=AUTH_HEADERS)
    ids = [w["id"] for w in list_response.json()]
    assert first.json()["id"] in ids
    assert second.json()["id"] in ids


def test_start_work_log_allows_concurrent_logs_across_tasks_and_projects(client):
    project_id1 = create_project(client)
    project_id2 = create_project(client)
    task_id1 = create_task(client, project_id1)
    task_id2 = create_task(client, project_id2)

    response1 = start_work_log(client, task_id1)
    response2 = start_work_log(client, task_id2)
    assert response1.status_code == 201
    assert response2.status_code == 201


def test_start_work_log_not_found_for_unknown_task_id(client):
    response = start_work_log(client, 99999)
    assert response.status_code == 404


def test_start_work_log_not_found_for_deleted_task(client):
    project_id = create_project(client)
    task_id = create_task(client, project_id)
    client.delete(f"/tasks/{task_id}", headers=AUTH_HEADERS)

    response = start_work_log(client, task_id)
    assert response.status_code == 404


# --- PATCH /work-logs/{id}/stop ---


def test_stop_work_log_records_ended_at(client):
    project_id = create_project(client)
    task_id = create_task(client, project_id)
    work_log_id = start_work_log(client, task_id).json()["id"]

    response = client.patch(f"/work-logs/{work_log_id}/stop", headers=AUTH_HEADERS)
    assert response.status_code == 200
    body = response.json()
    assert body["ended_at"] is not None
    assert body["started_at"] is not None


def test_stop_work_log_already_stopped_returns_conflict(client):
    project_id = create_project(client)
    task_id = create_task(client, project_id)
    work_log_id = start_work_log(client, task_id).json()["id"]
    client.patch(f"/work-logs/{work_log_id}/stop", headers=AUTH_HEADERS)

    response = client.patch(f"/work-logs/{work_log_id}/stop", headers=AUTH_HEADERS)
    assert response.status_code == 409


def test_stop_work_log_not_found_for_unknown_id(client):
    response = client.patch("/work-logs/99999/stop", headers=AUTH_HEADERS)
    assert response.status_code == 404


def test_stop_work_log_not_found_after_deletion(client):
    project_id = create_project(client)
    task_id = create_task(client, project_id)
    work_log_id = start_work_log(client, task_id).json()["id"]
    client.delete(f"/work-logs/{work_log_id}", headers=AUTH_HEADERS)

    response = client.patch(f"/work-logs/{work_log_id}/stop", headers=AUTH_HEADERS)
    assert response.status_code == 404


# --- GET /tasks/{id}/work-logs ---


def test_list_work_logs_excludes_deleted(client):
    project_id = create_project(client)
    task_id = create_task(client, project_id)
    work_log_id1 = start_work_log(client, task_id).json()["id"]
    work_log_id2 = start_work_log(client, task_id).json()["id"]
    client.delete(f"/work-logs/{work_log_id1}", headers=AUTH_HEADERS)

    response = client.get(f"/tasks/{task_id}/work-logs", headers=AUTH_HEADERS)
    assert response.status_code == 200
    ids = [w["id"] for w in response.json()]
    assert work_log_id1 not in ids
    assert work_log_id2 in ids


def test_list_work_logs_not_found_for_unknown_task_id(client):
    response = client.get("/tasks/99999/work-logs", headers=AUTH_HEADERS)
    assert response.status_code == 404


def test_list_work_logs_not_found_for_deleted_task(client):
    project_id = create_project(client)
    task_id = create_task(client, project_id)
    client.delete(f"/tasks/{task_id}", headers=AUTH_HEADERS)

    response = client.get(f"/tasks/{task_id}/work-logs", headers=AUTH_HEADERS)
    assert response.status_code == 404


# --- DELETE /work-logs/{id} ---


def test_delete_work_log_marks_is_deleted_and_excludes_from_list(client):
    project_id = create_project(client)
    task_id = create_task(client, project_id)
    work_log_id = start_work_log(client, task_id).json()["id"]

    delete_response = client.delete(f"/work-logs/{work_log_id}", headers=AUTH_HEADERS)
    assert delete_response.status_code == 204

    list_response = client.get(f"/tasks/{task_id}/work-logs", headers=AUTH_HEADERS)
    assert work_log_id not in [w["id"] for w in list_response.json()]


def test_delete_work_log_not_found_for_unknown_id(client):
    response = client.delete("/work-logs/99999", headers=AUTH_HEADERS)
    assert response.status_code == 404


def test_delete_work_log_is_idempotent_not_found_on_second_call(client):
    project_id = create_project(client)
    task_id = create_task(client, project_id)
    work_log_id = start_work_log(client, task_id).json()["id"]
    client.delete(f"/work-logs/{work_log_id}", headers=AUTH_HEADERS)

    second_delete = client.delete(f"/work-logs/{work_log_id}", headers=AUTH_HEADERS)
    assert second_delete.status_code == 404


# --- 認証 ---


def test_endpoints_require_api_key(client):
    project_id = create_project(client)
    task_id = create_task(client, project_id)
    response = client.get(f"/tasks/{task_id}/work-logs")
    assert response.status_code == 401
