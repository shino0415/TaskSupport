"""Task CRUDエンドポイントのテスト。

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

    db_path = tmp_path / "test_tasks.db"
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


# --- POST /projects/{id}/tasks ---


def test_create_task_reflects_input_in_response(client):
    project_id = create_project(client)
    payload = make_task_payload()

    response = client.post(f"/projects/{project_id}/tasks", json=payload, headers=AUTH_HEADERS)
    assert response.status_code == 201
    body = response.json()
    for key, value in payload.items():
        assert body[key] == value
    assert body["project_id"] == project_id
    assert body["is_deleted"] is False
    assert isinstance(body["id"], int)


def test_create_task_rejects_mass_assignment_of_is_deleted(client):
    project_id = create_project(client)
    payload = make_task_payload()
    payload["is_deleted"] = True

    response = client.post(f"/projects/{project_id}/tasks", json=payload, headers=AUTH_HEADERS)
    assert response.status_code == 201
    assert response.json()["is_deleted"] is False


def test_create_task_not_found_for_unknown_project_id(client):
    response = client.post(
        "/projects/99999/tasks", json=make_task_payload(), headers=AUTH_HEADERS
    )
    assert response.status_code == 404


def test_create_task_not_found_for_deleted_project(client):
    project_id = create_project(client)
    client.delete(f"/projects/{project_id}", headers=AUTH_HEADERS)

    response = client.post(
        f"/projects/{project_id}/tasks", json=make_task_payload(), headers=AUTH_HEADERS
    )
    assert response.status_code == 404


# --- GET /projects/{id}/tasks ---


def test_list_tasks_excludes_deleted(client):
    project_id = create_project(client)
    task_id1 = create_task(client, project_id, name="A")
    task_id2 = create_task(client, project_id, name="B")
    client.delete(f"/tasks/{task_id1}", headers=AUTH_HEADERS)

    response = client.get(f"/projects/{project_id}/tasks", headers=AUTH_HEADERS)
    assert response.status_code == 200
    ids = [t["id"] for t in response.json()]
    assert task_id1 not in ids
    assert task_id2 in ids


def test_list_tasks_not_found_for_unknown_project_id(client):
    response = client.get("/projects/99999/tasks", headers=AUTH_HEADERS)
    assert response.status_code == 404


def test_list_tasks_not_found_for_deleted_project(client):
    project_id = create_project(client)
    client.delete(f"/projects/{project_id}", headers=AUTH_HEADERS)

    response = client.get(f"/projects/{project_id}/tasks", headers=AUTH_HEADERS)
    assert response.status_code == 404


# --- PATCH /tasks/{id} ---


def test_update_task_updates_fields(client):
    project_id = create_project(client)
    task_id = create_task(client, project_id)

    response = client.patch(
        f"/tasks/{task_id}",
        json={"name": "更新後タスク名", "memo": "更新メモ"},
        headers=AUTH_HEADERS,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "更新後タスク名"
    assert body["memo"] == "更新メモ"
    # 更新していない項目は元の値のまま
    assert body["status"] == "未着手"


def test_update_task_can_clear_nullable_memo(client):
    project_id = create_project(client)
    task_id = create_task(client, project_id, memo="初期メモ")

    response = client.patch(f"/tasks/{task_id}", json={"memo": None}, headers=AUTH_HEADERS)
    assert response.status_code == 200
    assert response.json()["memo"] is None


@pytest.mark.parametrize("field", ["name", "status"])
def test_update_task_rejects_explicit_null_for_required_field(client, field):
    project_id = create_project(client)
    task_id = create_task(client, project_id)

    response = client.patch(f"/tasks/{task_id}", json={field: None}, headers=AUTH_HEADERS)
    assert response.status_code == 422


def test_update_task_not_found_for_unknown_id(client):
    response = client.patch("/tasks/99999", json={"name": "x"}, headers=AUTH_HEADERS)
    assert response.status_code == 404


def test_update_task_not_found_after_deletion(client):
    project_id = create_project(client)
    task_id = create_task(client, project_id)
    client.delete(f"/tasks/{task_id}", headers=AUTH_HEADERS)

    response = client.patch(f"/tasks/{task_id}", json={"name": "x"}, headers=AUTH_HEADERS)
    assert response.status_code == 404


def test_update_task_status_backward_transition_returns_warning(client):
    project_id = create_project(client)
    task_id = create_task(client, project_id, status="完了")

    response = client.patch(
        f"/tasks/{task_id}", json={"status": "処理中"}, headers=AUTH_HEADERS
    )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "処理中"
    assert body["warning"] is not None
    assert "完了" in body["warning"]
    assert "処理中" in body["warning"]


@pytest.mark.parametrize(
    "from_status,to_status",
    [
        ("未着手", "未着手"),  # 同一ステータス
        ("未着手", "処理中"),  # 隣接遷移
        ("未着手", "完了"),  # 飛び越え遷移
    ],
)
def test_update_task_status_forward_transition_has_no_warning(client, from_status, to_status):
    project_id = create_project(client)
    task_id = create_task(client, project_id, status=from_status)

    response = client.patch(
        f"/tasks/{task_id}", json={"status": to_status}, headers=AUTH_HEADERS
    )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == to_status
    assert body.get("warning") is None


def test_update_task_without_status_change_has_no_warning(client):
    project_id = create_project(client)
    task_id = create_task(client, project_id)

    response = client.patch(
        f"/tasks/{task_id}", json={"memo": "更新メモ"}, headers=AUTH_HEADERS
    )
    assert response.status_code == 200
    assert response.json().get("warning") is None


# --- DELETE /tasks/{id} ---


def test_delete_task_marks_is_deleted_and_excludes_from_list(client):
    project_id = create_project(client)
    task_id = create_task(client, project_id)

    delete_response = client.delete(f"/tasks/{task_id}", headers=AUTH_HEADERS)
    assert delete_response.status_code == 204

    list_response = client.get(f"/projects/{project_id}/tasks", headers=AUTH_HEADERS)
    assert task_id not in [t["id"] for t in list_response.json()]


def test_delete_task_not_found_for_unknown_id(client):
    response = client.delete("/tasks/99999", headers=AUTH_HEADERS)
    assert response.status_code == 404


def test_delete_task_is_idempotent_not_found_on_second_call(client):
    project_id = create_project(client)
    task_id = create_task(client, project_id)
    client.delete(f"/tasks/{task_id}", headers=AUTH_HEADERS)

    second_delete = client.delete(f"/tasks/{task_id}", headers=AUTH_HEADERS)
    assert second_delete.status_code == 404


# --- 認証 ---


def test_endpoints_require_api_key(client):
    project_id = create_project(client)
    response = client.get(f"/projects/{project_id}/tasks")
    assert response.status_code == 401
