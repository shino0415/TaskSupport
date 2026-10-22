"""廃止した案件系（Project/Task/WorkLog・時給換算）エンドポイントのテスト。

spec.md「## 決定事項」の「案件系の廃止と授業系への置き換え」に沿い、旧案件系の
全エンドポイントが存在せず、正しいAPI Key付きでリクエストしても404になることを確認する。
実行中の開発用DBファイル（app.db）を汚染しないよう、一時ファイルDBを使う。
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from app.auth import API_KEY_ENV_VAR
from app.database import Base, build_engine, get_db
from app.main import app

TEST_API_KEY = "test-secret-key"
AUTH_HEADERS = {"X-API-Key": TEST_API_KEY}

REMOVED_ENDPOINTS = [
    ("POST", "/projects"),
    ("GET", "/projects"),
    ("GET", "/projects/1"),
    ("PATCH", "/projects/1"),
    ("DELETE", "/projects/1"),
    ("GET", "/projects/1/hourly-rate"),
    ("POST", "/projects/1/tasks"),
    ("GET", "/projects/1/tasks"),
    ("GET", "/tasks/1"),
    ("PATCH", "/tasks/1"),
    ("DELETE", "/tasks/1"),
    ("POST", "/tasks/1/work-logs/start"),
    ("GET", "/tasks/1/work-logs"),
    ("GET", "/work-logs/running"),
    ("GET", "/work-logs/1"),
    ("PATCH", "/work-logs/1/stop"),
    ("DELETE", "/work-logs/1"),
]


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setenv(API_KEY_ENV_VAR, TEST_API_KEY)

    engine = build_engine(f"sqlite:///{tmp_path / 'test_removed_endpoints.db'}")
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


@pytest.mark.parametrize(("method", "path"), REMOVED_ENDPOINTS)
def test_removed_project_endpoints_return_404(client, method, path):
    response = client.request(method, path, json={}, headers=AUTH_HEADERS)
    assert response.status_code == 404


def test_no_project_system_routes_are_registered():
    paths = set(app.openapi()["paths"].keys())
    assert paths
    for removed_prefix in ("/projects", "/tasks", "/work-logs"):
        assert not any(path.startswith(removed_prefix) for path in paths)
    assert not any("hourly-rate" in path for path in paths)
