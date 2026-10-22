"""授業（Course）CRUDエンドポイントのテスト。

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

COURSE_FIELDS = {
    "id",
    "name",
    "day_of_week",
    "period",
    "academic_year",
    "term",
    "memo",
    "is_deleted",
}


@pytest.fixture
def session_factory(tmp_path):
    db_path = tmp_path / "test_courses.db"
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
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def make_course_payload(**overrides):
    payload = {
        "name": "線形代数",
        "day_of_week": "月",
        "period": 2,
        "academic_year": 2026,
        "term": "前期",
        "memo": "教科書持参",
    }
    payload.update(overrides)
    return payload


def create_course(client, **overrides):
    response = client.post("/courses", json=make_course_payload(**overrides), headers=AUTH_HEADERS)
    assert response.status_code == 201
    return response.json()["id"]


INVALID_FIELD_VALUES = [
    ("name", ""),
    ("name", "   "),
    ("name", None),
    ("day_of_week", "月曜"),
    ("day_of_week", "Mon"),
    ("day_of_week", ""),
    ("period", 0),
    ("period", -1),
    ("period", 1.5),
    ("period", "abc"),
    ("term", "夏期"),
    ("term", ""),
]


# --- POST /courses ---


def test_create_course_reflects_input_in_response(client):
    payload = make_course_payload()
    response = client.post("/courses", json=payload, headers=AUTH_HEADERS)
    assert response.status_code == 201
    body = response.json()
    assert set(body) == COURSE_FIELDS
    for key, value in payload.items():
        assert body[key] == value
    assert body["is_deleted"] is False
    assert isinstance(body["id"], int)


def test_create_course_with_name_only(client):
    response = client.post("/courses", json={"name": "集中講義"}, headers=AUTH_HEADERS)
    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "集中講義"
    for key in ("day_of_week", "period", "academic_year", "term", "memo"):
        assert body[key] is None


@pytest.mark.parametrize("day", ["月", "火", "水", "木", "金", "土", "日"])
def test_create_course_accepts_all_days_of_week(client, day):
    response = client.post(
        "/courses", json={"name": "授業", "day_of_week": day}, headers=AUTH_HEADERS
    )
    assert response.status_code == 201
    assert response.json()["day_of_week"] == day


@pytest.mark.parametrize("term", ["前期", "後期", "通年"])
def test_create_course_accepts_all_terms(client, term):
    response = client.post("/courses", json={"name": "授業", "term": term}, headers=AUTH_HEADERS)
    assert response.status_code == 201
    assert response.json()["term"] == term


def test_create_course_accepts_period_one(client):
    response = client.post("/courses", json={"name": "授業", "period": 1}, headers=AUTH_HEADERS)
    assert response.status_code == 201
    assert response.json()["period"] == 1


def test_create_course_rejects_missing_name(client):
    response = client.post("/courses", json={"day_of_week": "月"}, headers=AUTH_HEADERS)
    assert response.status_code == 422


@pytest.mark.parametrize(("field", "value"), INVALID_FIELD_VALUES)
def test_create_course_rejects_invalid_values(client, field, value):
    response = client.post(
        "/courses", json=make_course_payload(**{field: value}), headers=AUTH_HEADERS
    )
    assert response.status_code == 422


def test_create_course_rejects_mass_assignment_of_id_and_is_deleted(client):
    payload = make_course_payload()
    payload["is_deleted"] = True
    payload["id"] = 12345
    response = client.post("/courses", json=payload, headers=AUTH_HEADERS)
    assert response.status_code == 201
    body = response.json()
    assert body["is_deleted"] is False
    assert body["id"] != 12345


# --- GET /courses ---


def test_list_courses_excludes_deleted(client):
    id1 = create_course(client, name="A")
    id2 = create_course(client, name="B")
    client.delete(f"/courses/{id1}", headers=AUTH_HEADERS)

    response = client.get("/courses", headers=AUTH_HEADERS)
    assert response.status_code == 200
    ids = [c["id"] for c in response.json()]
    assert id1 not in ids
    assert id2 in ids
    assert all(c["is_deleted"] is False for c in response.json())


def test_list_courses_returns_empty_list_when_none(client):
    response = client.get("/courses", headers=AUTH_HEADERS)
    assert response.status_code == 200
    assert response.json() == []


# --- GET /courses/{id} ---


def test_get_course_detail_returns_own_fields(client):
    course_id = create_course(client)
    response = client.get(f"/courses/{course_id}", headers=AUTH_HEADERS)
    assert response.status_code == 200
    body = response.json()
    assert body["id"] == course_id
    assert body["name"] == "線形代数"


def test_get_course_detail_does_not_include_assignment_info(client, session_factory):
    course_id = create_course(client)
    # 課題APIは後続タスクで実装するため、DBへ直接課題を作成する
    with session_factory() as db:
        db.add(models.Assignment(course_id=course_id, name="レポート1", status="未着手"))
        db.commit()

    response = client.get(f"/courses/{course_id}", headers=AUTH_HEADERS)
    assert response.status_code == 200
    body = response.json()
    assert set(body) == COURSE_FIELDS
    assert "レポート1" not in response.text


def test_get_course_detail_not_found_for_unknown_id(client):
    response = client.get("/courses/99999", headers=AUTH_HEADERS)
    assert response.status_code == 404


def test_get_course_detail_not_found_after_deletion(client):
    course_id = create_course(client)
    client.delete(f"/courses/{course_id}", headers=AUTH_HEADERS)
    response = client.get(f"/courses/{course_id}", headers=AUTH_HEADERS)
    assert response.status_code == 404


# --- PATCH /courses/{id} ---


def test_update_course_partial_update_keeps_unspecified_fields(client):
    course_id = create_course(client)
    response = client.patch(
        f"/courses/{course_id}", json={"period": 3, "term": "後期"}, headers=AUTH_HEADERS
    )
    assert response.status_code == 200
    body = response.json()
    assert body["period"] == 3
    assert body["term"] == "後期"
    original = make_course_payload()
    for key in ("name", "day_of_week", "academic_year", "memo"):
        assert body[key] == original[key]

    detail = client.get(f"/courses/{course_id}", headers=AUTH_HEADERS).json()
    assert detail == body


def test_update_course_updates_all_fields(client):
    course_id = create_course(client)
    new_values = {
        "name": "解析学",
        "day_of_week": "金",
        "period": 5,
        "academic_year": 2027,
        "term": "通年",
        "memo": "変更後",
    }
    response = client.patch(f"/courses/{course_id}", json=new_values, headers=AUTH_HEADERS)
    assert response.status_code == 200
    body = response.json()
    for key, value in new_values.items():
        assert body[key] == value


def test_update_course_with_empty_body_changes_nothing(client):
    course_id = create_course(client)
    before = client.get(f"/courses/{course_id}", headers=AUTH_HEADERS).json()
    response = client.patch(f"/courses/{course_id}", json={}, headers=AUTH_HEADERS)
    assert response.status_code == 200
    assert response.json() == before


@pytest.mark.parametrize("field", ["day_of_week", "period", "academic_year", "term", "memo"])
def test_update_course_can_clear_nullable_field(client, field):
    course_id = create_course(client)
    response = client.patch(f"/courses/{course_id}", json={field: None}, headers=AUTH_HEADERS)
    assert response.status_code == 200
    assert response.json()[field] is None


@pytest.mark.parametrize(("field", "value"), INVALID_FIELD_VALUES)
def test_update_course_rejects_invalid_values(client, field, value):
    course_id = create_course(client)
    before = client.get(f"/courses/{course_id}", headers=AUTH_HEADERS).json()
    response = client.patch(f"/courses/{course_id}", json={field: value}, headers=AUTH_HEADERS)
    assert response.status_code == 422
    after = client.get(f"/courses/{course_id}", headers=AUTH_HEADERS).json()
    assert after == before


def test_update_course_ignores_id_and_is_deleted(client):
    course_id = create_course(client)
    response = client.patch(
        f"/courses/{course_id}",
        json={"id": 12345, "is_deleted": True},
        headers=AUTH_HEADERS,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["id"] == course_id
    assert body["is_deleted"] is False
    assert client.get(f"/courses/{course_id}", headers=AUTH_HEADERS).status_code == 200


def test_update_course_not_found_for_unknown_id(client):
    response = client.patch("/courses/99999", json={"name": "x"}, headers=AUTH_HEADERS)
    assert response.status_code == 404


def test_update_course_not_found_after_deletion(client):
    course_id = create_course(client)
    client.delete(f"/courses/{course_id}", headers=AUTH_HEADERS)
    response = client.patch(f"/courses/{course_id}", json={"name": "x"}, headers=AUTH_HEADERS)
    assert response.status_code == 404


# --- DELETE /courses/{id} ---


def test_delete_course_marks_is_deleted_and_excludes_from_list(client, session_factory):
    course_id = create_course(client)
    response = client.delete(f"/courses/{course_id}", headers=AUTH_HEADERS)
    assert response.status_code == 204

    list_response = client.get("/courses", headers=AUTH_HEADERS)
    assert course_id not in [c["id"] for c in list_response.json()]

    # 物理削除ではなく論理削除であること
    with session_factory() as db:
        course = db.get(models.Course, course_id)
        assert course is not None
        assert course.is_deleted is True


def test_delete_course_not_found_for_unknown_id(client):
    response = client.delete("/courses/99999", headers=AUTH_HEADERS)
    assert response.status_code == 404


def test_delete_course_not_found_on_second_call(client):
    course_id = create_course(client)
    client.delete(f"/courses/{course_id}", headers=AUTH_HEADERS)
    second = client.delete(f"/courses/{course_id}", headers=AUTH_HEADERS)
    assert second.status_code == 404


# --- 認証 ---


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("post", "/courses", {"name": "授業"}),
        ("get", "/courses", None),
        ("get", "/courses/{id}", None),
        ("patch", "/courses/{id}", {"name": "変更"}),
        ("delete", "/courses/{id}", None),
    ],
)
@pytest.mark.parametrize("headers", [{}, {"X-API-Key": "wrong-key"}])
def test_endpoints_reject_missing_or_wrong_api_key(client, method, path, body, headers):
    course_id = create_course(client)
    url = path.format(id=course_id)
    kwargs = {"headers": headers}
    if body is not None:
        kwargs["json"] = body
    response = client.request(method.upper(), url, **kwargs)
    assert response.status_code == 401

    # 拒否されたリクエストでデータが変化していないこと
    detail = client.get(f"/courses/{course_id}", headers=AUTH_HEADERS)
    assert detail.status_code == 200
    assert detail.json()["name"] == "線形代数"
    assert len(client.get("/courses", headers=AUTH_HEADERS).json()) == 1
