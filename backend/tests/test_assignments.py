"""課題（Assignment）CRUDエンドポイントのテスト。

実行中の開発用DBファイル（app.db）を汚染しないよう、テスト専用の一時ファイル
SQLiteエンジンを都度作成し、`get_db`依存関係をオーバーライドして使う。
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from app import models
from app.auth import API_KEY_ENV_VAR
from app.database import Base, build_engine, get_db
from app.main import app

TEST_API_KEY = "test-secret-key"
AUTH_HEADERS = {"X-API-Key": TEST_API_KEY}

ASSIGNMENT_FIELDS = {
    "id",
    "course_id",
    "name",
    "status",
    "deadline",
    "submission_method",
    "memo",
    "is_deleted",
}

# SQLite INTEGER（符号付き64bit）の範囲を超えるid
HUGE_ID = 10**20


@pytest.fixture
def session_factory(tmp_path):
    db_path = tmp_path / "test_assignments.db"
    engine = build_engine(f"sqlite:///{db_path}")
    Base.metadata.create_all(bind=engine)
    yield sessionmaker(autocommit=False, autoflush=False, bind=engine)
    engine.dispose()


@pytest.fixture
def client(monkeypatch, session_factory):
    monkeypatch.setenv(API_KEY_ENV_VAR, TEST_API_KEY)

    def override_get_db():
        db = session_factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app, raise_server_exceptions=False) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def create_course(client, name="線形代数"):
    response = client.post("/courses", json={"name": name}, headers=AUTH_HEADERS)
    assert response.status_code == 201
    return response.json()["id"]


def make_assignment_payload(**overrides):
    payload = {
        "name": "レポート1",
        "status": "取組中",
        "deadline": "2026-11-01T23:59:00",
        "submission_method": "WebClass",
        "memo": "A4で2枚",
    }
    payload.update(overrides)
    return payload


def create_assignment(client, course_id, **overrides):
    response = client.post(
        f"/courses/{course_id}/assignments",
        json=make_assignment_payload(**overrides),
        headers=AUTH_HEADERS,
    )
    assert response.status_code == 201
    return response.json()["id"]


def get_assignment(client, assignment_id):
    response = client.get(f"/assignments/{assignment_id}", headers=AUTH_HEADERS)
    assert response.status_code == 200
    return response.json()


INVALID_FIELD_VALUES = [
    ("name", ""),
    ("name", "   "),
    ("name", None),
    ("status", "完了"),
    ("status", "提出"),
    ("status", ""),
    ("status", None),
    ("submission_method", "webclass"),
    ("submission_method", "メール"),
    ("submission_method", ""),
    ("deadline", "期限なし"),
    ("deadline", "2026-13-01T00:00:00"),
    ("deadline", "2026-11-01T23:59:00+09:00"),
    ("deadline", "2026-11-01T23:59:00Z"),
]


# --- POST /courses/{id}/assignments ---


def test_create_assignment_reflects_input_in_response(client):
    course_id = create_course(client)
    payload = make_assignment_payload()
    response = client.post(
        f"/courses/{course_id}/assignments", json=payload, headers=AUTH_HEADERS
    )
    assert response.status_code == 201
    body = response.json()
    assert set(body) == ASSIGNMENT_FIELDS
    for key, value in payload.items():
        assert body[key] == value
    assert body["course_id"] == course_id
    assert body["is_deleted"] is False
    assert isinstance(body["id"], int)


def test_create_assignment_with_name_only_defaults_status_to_not_started(client):
    course_id = create_course(client)
    response = client.post(
        f"/courses/{course_id}/assignments", json={"name": "小テスト"}, headers=AUTH_HEADERS
    )
    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "小テスト"
    assert body["status"] == "未着手"
    for key in ("deadline", "submission_method", "memo"):
        assert body[key] is None


@pytest.mark.parametrize("status", ["未着手", "取組中", "未提出", "提出済み"])
def test_create_assignment_accepts_all_statuses(client, status):
    course_id = create_course(client)
    response = client.post(
        f"/courses/{course_id}/assignments",
        json={"name": "課題", "status": status},
        headers=AUTH_HEADERS,
    )
    assert response.status_code == 201
    assert response.json()["status"] == status


@pytest.mark.parametrize("method", ["WebClass", "紙", "その他"])
def test_create_assignment_accepts_all_submission_methods(client, method):
    course_id = create_course(client)
    response = client.post(
        f"/courses/{course_id}/assignments",
        json={"name": "課題", "submission_method": method},
        headers=AUTH_HEADERS,
    )
    assert response.status_code == 201
    assert response.json()["submission_method"] == method


def test_create_assignment_rejects_missing_name(client):
    course_id = create_course(client)
    response = client.post(
        f"/courses/{course_id}/assignments", json={"status": "未着手"}, headers=AUTH_HEADERS
    )
    assert response.status_code == 422


@pytest.mark.parametrize(("field", "value"), INVALID_FIELD_VALUES)
def test_create_assignment_rejects_invalid_values(client, field, value):
    course_id = create_course(client)
    response = client.post(
        f"/courses/{course_id}/assignments",
        json=make_assignment_payload(**{field: value}),
        headers=AUTH_HEADERS,
    )
    assert response.status_code == 422
    listed = client.get(f"/courses/{course_id}/assignments", headers=AUTH_HEADERS).json()
    assert listed == []


def test_create_assignment_ignores_id_is_deleted_and_course_id(client):
    course_id = create_course(client)
    other_course_id = create_course(client, name="別の授業")
    payload = make_assignment_payload(id=9999, is_deleted=True, course_id=other_course_id)
    response = client.post(
        f"/courses/{course_id}/assignments", json=payload, headers=AUTH_HEADERS
    )
    assert response.status_code == 201
    body = response.json()
    assert body["id"] != 9999
    assert body["is_deleted"] is False
    assert body["course_id"] == course_id


def test_create_assignment_not_found_for_unknown_course(client):
    response = client.post(
        "/courses/99999/assignments", json=make_assignment_payload(), headers=AUTH_HEADERS
    )
    assert response.status_code == 404


def test_create_assignment_not_found_for_deleted_course(client, session_factory):
    course_id = create_course(client)
    client.delete(f"/courses/{course_id}", headers=AUTH_HEADERS)
    response = client.post(
        f"/courses/{course_id}/assignments", json=make_assignment_payload(), headers=AUTH_HEADERS
    )
    assert response.status_code == 404
    with session_factory() as db:
        assert db.query(models.Assignment).count() == 0


# --- deadline の日時の扱い ---


def test_deadline_is_stored_and_returned_as_naive_datetime(client, session_factory):
    course_id = create_course(client)
    assignment_id = create_assignment(client, course_id, deadline="2026-11-01T23:59:30")

    assert get_assignment(client, assignment_id)["deadline"] == "2026-11-01T23:59:30"
    with session_factory() as db:
        stored = db.get(models.Assignment, assignment_id).deadline
    assert (stored.year, stored.month, stored.day) == (2026, 11, 1)
    assert (stored.hour, stored.minute, stored.second) == (23, 59, 30)
    assert stored.tzinfo is None


def test_deadline_accepts_value_without_seconds(client):
    course_id = create_course(client)
    assignment_id = create_assignment(client, course_id, deadline="2026-11-01T09:00")
    assert get_assignment(client, assignment_id)["deadline"] == "2026-11-01T09:00:00"


# --- GET /courses/{id}/assignments ---


def test_list_assignments_returns_only_active_assignments_of_the_course(client):
    course_id = create_course(client)
    other_course_id = create_course(client, name="別の授業")
    kept_id = create_assignment(client, course_id, name="残る課題")
    deleted_id = create_assignment(client, course_id, name="消す課題")
    create_assignment(client, other_course_id, name="他授業の課題")
    client.delete(f"/assignments/{deleted_id}", headers=AUTH_HEADERS)

    response = client.get(f"/courses/{course_id}/assignments", headers=AUTH_HEADERS)
    assert response.status_code == 200
    body = response.json()
    assert [item["id"] for item in body] == [kept_id]
    assert set(body[0]) == ASSIGNMENT_FIELDS


def test_list_assignments_returns_empty_list_when_none(client):
    course_id = create_course(client)
    response = client.get(f"/courses/{course_id}/assignments", headers=AUTH_HEADERS)
    assert response.status_code == 200
    assert response.json() == []


def test_list_assignments_not_found_for_unknown_course(client):
    response = client.get("/courses/99999/assignments", headers=AUTH_HEADERS)
    assert response.status_code == 404


def test_list_assignments_not_found_for_deleted_course(client):
    course_id = create_course(client)
    create_assignment(client, course_id)
    client.delete(f"/courses/{course_id}", headers=AUTH_HEADERS)
    response = client.get(f"/courses/{course_id}/assignments", headers=AUTH_HEADERS)
    assert response.status_code == 404


# --- GET /assignments/{id} ---


def test_get_assignment_returns_all_fields_including_course_id(client):
    course_id = create_course(client)
    payload = make_assignment_payload()
    assignment_id = create_assignment(client, course_id, **payload)

    body = get_assignment(client, assignment_id)
    assert set(body) == ASSIGNMENT_FIELDS
    assert body["id"] == assignment_id
    assert body["course_id"] == course_id
    for key, value in payload.items():
        assert body[key] == value
    assert body["is_deleted"] is False


def test_get_assignment_not_found_for_unknown_id(client):
    response = client.get("/assignments/99999", headers=AUTH_HEADERS)
    assert response.status_code == 404


def test_get_assignment_not_found_after_deletion(client):
    course_id = create_course(client)
    assignment_id = create_assignment(client, course_id)
    client.delete(f"/assignments/{assignment_id}", headers=AUTH_HEADERS)
    response = client.get(f"/assignments/{assignment_id}", headers=AUTH_HEADERS)
    assert response.status_code == 404


# --- PATCH /assignments/{id} ---


def test_update_assignment_partial_update_keeps_unspecified_fields(client):
    course_id = create_course(client)
    assignment_id = create_assignment(client, course_id)
    before = get_assignment(client, assignment_id)

    response = client.patch(
        f"/assignments/{assignment_id}", json={"memo": "変更後メモ"}, headers=AUTH_HEADERS
    )
    assert response.status_code == 200
    body = response.json()
    assert body["memo"] == "変更後メモ"
    assert body["warning"] is None
    after = get_assignment(client, assignment_id)
    assert after == {**before, "memo": "変更後メモ"}


def test_update_assignment_updates_all_fields(client):
    course_id = create_course(client)
    assignment_id = create_assignment(client, course_id, status="未着手")
    changes = {
        "name": "レポート2",
        "status": "取組中",
        "deadline": "2026-12-24T18:30:00",
        "submission_method": "紙",
        "memo": "手書き",
    }
    response = client.patch(f"/assignments/{assignment_id}", json=changes, headers=AUTH_HEADERS)
    assert response.status_code == 200
    body = response.json()
    assert set(body) == ASSIGNMENT_FIELDS | {"warning"}
    for key, value in changes.items():
        assert body[key] == value
    after = get_assignment(client, assignment_id)
    for key, value in changes.items():
        assert after[key] == value


def test_update_assignment_with_empty_body_changes_nothing(client):
    course_id = create_course(client)
    assignment_id = create_assignment(client, course_id)
    before = get_assignment(client, assignment_id)
    response = client.patch(f"/assignments/{assignment_id}", json={}, headers=AUTH_HEADERS)
    assert response.status_code == 200
    assert response.json()["warning"] is None
    assert get_assignment(client, assignment_id) == before


@pytest.mark.parametrize("field", ["deadline", "submission_method", "memo"])
def test_update_assignment_can_clear_nullable_field(client, field):
    course_id = create_course(client)
    assignment_id = create_assignment(client, course_id)
    response = client.patch(
        f"/assignments/{assignment_id}", json={field: None}, headers=AUTH_HEADERS
    )
    assert response.status_code == 200
    assert get_assignment(client, assignment_id)[field] is None


@pytest.mark.parametrize(("field", "value"), INVALID_FIELD_VALUES)
def test_update_assignment_rejects_invalid_values(client, field, value):
    course_id = create_course(client)
    assignment_id = create_assignment(client, course_id)
    before = get_assignment(client, assignment_id)
    response = client.patch(
        f"/assignments/{assignment_id}", json={field: value}, headers=AUTH_HEADERS
    )
    assert response.status_code == 422
    assert get_assignment(client, assignment_id) == before


def test_update_assignment_ignores_id_is_deleted_and_course_id(client):
    course_id = create_course(client)
    other_course_id = create_course(client, name="別の授業")
    assignment_id = create_assignment(client, course_id)
    response = client.patch(
        f"/assignments/{assignment_id}",
        json={"id": 9999, "is_deleted": True, "course_id": other_course_id},
        headers=AUTH_HEADERS,
    )
    assert response.status_code == 200
    after = get_assignment(client, assignment_id)
    assert after["id"] == assignment_id
    assert after["is_deleted"] is False
    assert after["course_id"] == course_id


def test_update_assignment_not_found_for_unknown_id(client):
    response = client.patch("/assignments/99999", json={"memo": "x"}, headers=AUTH_HEADERS)
    assert response.status_code == 404


def test_update_assignment_not_found_after_deletion(client):
    course_id = create_course(client)
    assignment_id = create_assignment(client, course_id)
    client.delete(f"/assignments/{assignment_id}", headers=AUTH_HEADERS)
    response = client.patch(
        f"/assignments/{assignment_id}", json={"memo": "x"}, headers=AUTH_HEADERS
    )
    assert response.status_code == 404


# --- PATCH /assignments/{id} のステータス遷移警告 ---


@pytest.mark.parametrize(
    ("from_status", "to_status"),
    [
        ("提出済み", "取組中"),
        ("未提出", "未着手"),
        ("取組中", "未着手"),
        ("提出済み", "未提出"),
    ],
)
def test_update_assignment_backward_status_returns_warning_and_applies(
    client, from_status, to_status
):
    course_id = create_course(client)
    assignment_id = create_assignment(client, course_id, status=from_status)
    response = client.patch(
        f"/assignments/{assignment_id}", json={"status": to_status}, headers=AUTH_HEADERS
    )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == to_status
    assert isinstance(body["warning"], str)
    assert from_status in body["warning"] and to_status in body["warning"]
    assert get_assignment(client, assignment_id)["status"] == to_status


@pytest.mark.parametrize(
    ("from_status", "to_status"),
    [
        ("取組中", "取組中"),
        ("未着手", "取組中"),
        ("取組中", "未提出"),
        ("未提出", "提出済み"),
        ("未着手", "提出済み"),
        ("未着手", "未提出"),
    ],
)
def test_update_assignment_non_backward_status_has_no_warning(client, from_status, to_status):
    course_id = create_course(client)
    assignment_id = create_assignment(client, course_id, status=from_status)
    response = client.patch(
        f"/assignments/{assignment_id}", json={"status": to_status}, headers=AUTH_HEADERS
    )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == to_status
    assert body["warning"] is None


# --- DELETE /assignments/{id} ---


def test_delete_assignment_marks_is_deleted_and_excludes_from_list(client, session_factory):
    course_id = create_course(client)
    assignment_id = create_assignment(client, course_id)
    response = client.delete(f"/assignments/{assignment_id}", headers=AUTH_HEADERS)
    assert response.status_code == 204
    assert client.get(f"/courses/{course_id}/assignments", headers=AUTH_HEADERS).json() == []
    with session_factory() as db:
        row = db.get(models.Assignment, assignment_id)
        assert row is not None
        assert row.is_deleted is True


def test_delete_assignment_not_found_for_unknown_id(client):
    response = client.delete("/assignments/99999", headers=AUTH_HEADERS)
    assert response.status_code == 404


def test_delete_assignment_not_found_on_second_call(client):
    course_id = create_course(client)
    assignment_id = create_assignment(client, course_id)
    client.delete(f"/assignments/{assignment_id}", headers=AUTH_HEADERS)
    second = client.delete(f"/assignments/{assignment_id}", headers=AUTH_HEADERS)
    assert second.status_code == 404


# --- SQLite INTEGERの範囲を超えるid ---


@pytest.mark.parametrize("huge_id", [HUGE_ID, -HUGE_ID])
@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("post", "/courses/{id}/assignments", {"name": "課題"}),
        ("get", "/courses/{id}/assignments", None),
        ("get", "/assignments/{id}", None),
        ("patch", "/assignments/{id}", {"memo": "x"}),
        ("delete", "/assignments/{id}", None),
    ],
)
def test_out_of_range_id_returns_404_instead_of_500(client, method, path, body, huge_id):
    kwargs = {"headers": AUTH_HEADERS}
    if body is not None:
        kwargs["json"] = body
    response = client.request(method.upper(), path.format(id=huge_id), **kwargs)
    assert response.status_code == 404


# --- 認証 ---


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("post", "/courses/{course_id}/assignments", {"name": "課題"}),
        ("get", "/courses/{course_id}/assignments", None),
        ("get", "/assignments/{assignment_id}", None),
        ("patch", "/assignments/{assignment_id}", {"status": "未着手"}),
        ("delete", "/assignments/{assignment_id}", None),
    ],
)
@pytest.mark.parametrize("headers", [{}, {"X-API-Key": "wrong-key"}])
def test_endpoints_reject_missing_or_wrong_api_key(client, method, path, body, headers):
    course_id = create_course(client)
    assignment_id = create_assignment(client, course_id)
    url = path.format(course_id=course_id, assignment_id=assignment_id)
    kwargs = {"headers": headers}
    if body is not None:
        kwargs["json"] = body
    response = client.request(method.upper(), url, **kwargs)
    assert response.status_code == 401

    # 拒否されたリクエストでデータが変化していないこと
    detail = get_assignment(client, assignment_id)
    assert detail["status"] == "取組中"
    assert detail["is_deleted"] is False
    listed = client.get(f"/courses/{course_id}/assignments", headers=AUTH_HEADERS).json()
    assert [item["id"] for item in listed] == [assignment_id]
