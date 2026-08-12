"""Project作成・参照・削除エンドポイントのテスト。

実行中の開発用DBファイル（app.db）を汚染しないよう、テスト専用のインメモリ
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

    # SQLiteのインメモリDBは接続ごとに別DBになってしまうため、テスト用の一時
    # ファイルDBを使い、開発用DBファイル（app.db）を汚染しないようにする。
    db_path = tmp_path / "test_projects.db"
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


# --- POST /projects ---


def test_create_project_reflects_input_in_response(client):
    payload = make_project_payload()
    response = client.post("/projects", json=payload, headers=AUTH_HEADERS)
    assert response.status_code == 201
    body = response.json()
    for key, value in payload.items():
        assert body[key] == value
    assert body["is_deleted"] is False
    assert isinstance(body["id"], int)


def test_create_project_rejects_mass_assignment_of_is_deleted(client):
    payload = make_project_payload()
    payload["is_deleted"] = True
    response = client.post("/projects", json=payload, headers=AUTH_HEADERS)
    assert response.status_code == 201
    assert response.json()["is_deleted"] is False


# --- GET /projects ---


def test_list_projects_excludes_deleted(client):
    id1 = create_project(client, name="A")
    id2 = create_project(client, name="B")
    client.delete(f"/projects/{id1}", headers=AUTH_HEADERS)

    response = client.get("/projects", headers=AUTH_HEADERS)
    assert response.status_code == 200
    ids = [p["id"] for p in response.json()]
    assert id1 not in ids
    assert id2 in ids


def test_list_projects_filters_by_status(client):
    create_project(client, name="提案中案件", status="提案中")
    contracted_id = create_project(client, name="契約中案件", status="契約中")

    response = client.get("/projects", params={"status": "契約中"}, headers=AUTH_HEADERS)
    assert response.status_code == 200
    results = response.json()
    assert all(p["status"] == "契約中" for p in results)
    assert contracted_id in [p["id"] for p in results]


# --- GET /projects/{id} ---


def test_get_project_detail_does_not_include_child_task_info(client):
    project_id = create_project(client)

    response = client.get(f"/projects/{project_id}", headers=AUTH_HEADERS)
    assert response.status_code == 200
    body = response.json()
    assert body["id"] == project_id
    assert "tasks" not in body


def test_get_project_detail_not_found_for_unknown_id(client):
    response = client.get("/projects/99999", headers=AUTH_HEADERS)
    assert response.status_code == 404


def test_get_project_detail_not_found_after_deletion(client):
    project_id = create_project(client)
    client.delete(f"/projects/{project_id}", headers=AUTH_HEADERS)

    response = client.get(f"/projects/{project_id}", headers=AUTH_HEADERS)
    assert response.status_code == 404


# --- DELETE /projects/{id} ---


def test_delete_project_marks_is_deleted_and_excludes_from_list(client):
    project_id = create_project(client)

    delete_response = client.delete(f"/projects/{project_id}", headers=AUTH_HEADERS)
    assert delete_response.status_code == 204

    list_response = client.get("/projects", headers=AUTH_HEADERS)
    assert project_id not in [p["id"] for p in list_response.json()]


def test_delete_project_not_found_for_unknown_id(client):
    response = client.delete("/projects/99999", headers=AUTH_HEADERS)
    assert response.status_code == 404


def test_delete_project_is_idempotent_not_found_on_second_call(client):
    project_id = create_project(client)
    client.delete(f"/projects/{project_id}", headers=AUTH_HEADERS)

    second_delete = client.delete(f"/projects/{project_id}", headers=AUTH_HEADERS)
    assert second_delete.status_code == 404


# --- PATCH /projects/{id} ---


def test_update_project_updates_fields(client):
    project_id = create_project(client)

    response = client.patch(
        f"/projects/{project_id}",
        json={"name": "更新後の案件名", "reward": 80000},
        headers=AUTH_HEADERS,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "更新後の案件名"
    assert body["reward"] == 80000
    # 更新していない項目は元の値のまま
    assert body["client_name"] == "テストクライアント"


@pytest.mark.parametrize(
    "field,initial_value",
    [
        ("deadline", "2026-03-01"),
        ("memo", "初期メモ"),
    ],
)
def test_update_project_can_clear_nullable_field(client, field, initial_value):
    project_id = create_project(client, **{field: initial_value})

    response = client.patch(
        f"/projects/{project_id}", json={field: None}, headers=AUTH_HEADERS
    )
    assert response.status_code == 200
    assert response.json()[field] is None


@pytest.mark.parametrize(
    "field,value",
    [
        ("name", None),
        ("client_name", None),
        ("status", None),
        ("reward", None),
        ("applied_date", None),
        ("platform", None),
    ],
)
def test_update_project_rejects_explicit_null_for_required_field(client, field, value):
    project_id = create_project(client)

    response = client.patch(
        f"/projects/{project_id}", json={field: value}, headers=AUTH_HEADERS
    )
    assert response.status_code == 422


def test_update_project_not_found_for_unknown_id(client):
    response = client.patch("/projects/99999", json={"name": "x"}, headers=AUTH_HEADERS)
    assert response.status_code == 404


def test_update_project_status_backward_transition_returns_warning(client):
    project_id = create_project(client, status="納品済み")

    response = client.patch(
        f"/projects/{project_id}", json={"status": "契約中"}, headers=AUTH_HEADERS
    )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "契約中"
    assert body["warning"] is not None
    assert "納品済み" in body["warning"]
    assert "契約中" in body["warning"]


@pytest.mark.parametrize(
    "from_status,to_status",
    [
        ("提案中", "提案中"),  # 同一ステータス
        ("提案中", "契約中"),  # 隣接遷移
        ("提案中", "納品済み"),  # 飛び越え遷移
        ("提案中", "見送り"),  # 分岐への遷移
        ("契約中", "見送り"),  # 分岐への遷移
    ],
)
def test_update_project_status_forward_transition_has_no_warning(client, from_status, to_status):
    project_id = create_project(client, status=from_status)

    response = client.patch(
        f"/projects/{project_id}", json={"status": to_status}, headers=AUTH_HEADERS
    )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == to_status
    assert body.get("warning") is None


def test_update_project_status_branch_to_branch_transition_has_no_warning(client):
    project_id = create_project(client, status="完了")

    response = client.patch(
        f"/projects/{project_id}", json={"status": "見送り"}, headers=AUTH_HEADERS
    )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "見送り"
    assert body.get("warning") is None


def test_update_project_without_status_change_has_no_warning(client):
    project_id = create_project(client)

    response = client.patch(
        f"/projects/{project_id}", json={"memo": "更新メモ"}, headers=AUTH_HEADERS
    )
    assert response.status_code == 200
    assert response.json().get("warning") is None


# --- 認証 ---


def test_endpoints_require_api_key(client):
    response = client.get("/projects")
    assert response.status_code == 401
