"""CORS許可オリジン設定のテスト。

- 環境変数のカンマ区切り列挙のパース（未設定・空・空白混じり）
- 許可オリジン／非許可オリジン／未設定時のレスポンスヘッダーの差
- 本APIが実際に使うHTTPメソッドと認証ヘッダーに対するプリフライトの成功
- CORS導入後も認証・論理削除など既存の挙動が変わらないこと

環境変数はアプリ組み立て時（`create_app()`）に読み込まれるため、各テストで
環境変数を設定した上でアプリを都度作り直す。実行中の開発用DBファイル（app.db）を
汚染しないよう、DBが要るケースでは`get_db`をテスト用の一時ファイルDBで
オーバーライドし、lifespan（`init_db`）を走らせないTestClientを使う。
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from app.auth import API_KEY_ENV_VAR
from app.cors import CORS_ALLOW_ORIGINS_ENV_VAR, get_allowed_origins
from app.database import Base, build_engine, get_db
from app.main import create_app

TEST_API_KEY = "test-secret-key"
AUTH_HEADERS = {"X-API-Key": TEST_API_KEY}

ALLOWED_ORIGIN = "http://localhost:5173"
ANOTHER_ALLOWED_ORIGIN = "https://tracker.example.com"
DISALLOWED_ORIGIN = "https://evil.example.com"
ORIGINS_ENV_VALUE = f"{ALLOWED_ORIGIN},{ANOTHER_ALLOWED_ORIGIN}"

ACAO = "access-control-allow-origin"


def make_client(monkeypatch, tmp_path, origins_env: str | None):
    """指定したCORS環境変数の下で組み立てたアプリのTestClientを返す。"""
    monkeypatch.setenv(API_KEY_ENV_VAR, TEST_API_KEY)
    if origins_env is None:
        monkeypatch.delenv(CORS_ALLOW_ORIGINS_ENV_VAR, raising=False)
    else:
        monkeypatch.setenv(CORS_ALLOW_ORIGINS_ENV_VAR, origins_env)

    app = create_app()

    db_path = tmp_path / "test_cors.db"
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
    # lifespan（init_db）を走らせると開発用DBファイルが作られてしまうため、
    # コンテキストマネージャは使わずにリクエストのみ行う。
    return TestClient(app)


@pytest.fixture
def client(monkeypatch, tmp_path):
    return make_client(monkeypatch, tmp_path, ORIGINS_ENV_VALUE)


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


# --- 環境変数のパース（単体） ---


@pytest.mark.parametrize(
    ("env_value", "expected"),
    [
        ("http://localhost:5173", ["http://localhost:5173"]),
        (
            "http://localhost:5173,https://tracker.example.com",
            ["http://localhost:5173", "https://tracker.example.com"],
        ),
        (
            " http://localhost:5173 , https://tracker.example.com ",
            ["http://localhost:5173", "https://tracker.example.com"],
        ),
        ("", []),
        ("   ", []),
        (",", []),
        ("http://localhost:5173,,", ["http://localhost:5173"]),
    ],
)
def test_get_allowed_origins_parses_comma_separated_value(monkeypatch, env_value, expected):
    monkeypatch.setenv(CORS_ALLOW_ORIGINS_ENV_VAR, env_value)
    assert get_allowed_origins() == expected


def test_get_allowed_origins_returns_empty_list_when_env_var_unset(monkeypatch):
    monkeypatch.delenv(CORS_ALLOW_ORIGINS_ENV_VAR, raising=False)
    assert get_allowed_origins() == []


# --- 許可オリジン ---


@pytest.mark.parametrize("origin", [ALLOWED_ORIGIN, ANOTHER_ALLOWED_ORIGIN])
def test_listed_origins_receive_allow_origin_header(client, origin):
    response = client.get("/projects", headers={**AUTH_HEADERS, "Origin": origin})
    assert response.status_code == 200
    assert response.headers[ACAO] == origin


# --- 非許可オリジン ---


def test_unlisted_origin_does_not_receive_allow_origin_header(client):
    response = client.get("/projects", headers={**AUTH_HEADERS, "Origin": DISALLOWED_ORIGIN})
    assert ACAO not in response.headers


def test_unlisted_origin_preflight_does_not_receive_allow_origin_header(client):
    response = client.options(
        "/projects",
        headers={
            "Origin": DISALLOWED_ORIGIN,
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "x-api-key",
        },
    )
    assert ACAO not in response.headers


def test_origin_matching_is_exact_and_not_prefix_based(client):
    # 許可オリジンを部分文字列として含むだけの別オリジンは許可されない
    for origin in (
        f"{ALLOWED_ORIGIN}.evil.example.com",
        "http://localhost:5174",
        "https://localhost:5173",
    ):
        response = client.get("/projects", headers={**AUTH_HEADERS, "Origin": origin})
        assert ACAO not in response.headers


# --- 環境変数が未設定・空の場合（fail closed） ---


@pytest.mark.parametrize("origins_env", [None, "", "   ", ","])
@pytest.mark.parametrize("origin", [ALLOWED_ORIGIN, ANOTHER_ALLOWED_ORIGIN, DISALLOWED_ORIGIN])
def test_no_origin_is_allowed_when_env_var_unset_or_empty(
    monkeypatch, tmp_path, origins_env, origin
):
    client = make_client(monkeypatch, tmp_path, origins_env)

    simple_response = client.get("/projects", headers={**AUTH_HEADERS, "Origin": origin})
    assert ACAO not in simple_response.headers

    preflight_response = client.options(
        "/projects",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "x-api-key",
        },
    )
    assert ACAO not in preflight_response.headers


@pytest.mark.parametrize("origins_env", [None, ""])
def test_wildcard_is_not_the_default(monkeypatch, tmp_path, origins_env):
    client = make_client(monkeypatch, tmp_path, origins_env)
    response = client.get("/projects", headers={**AUTH_HEADERS, "Origin": DISALLOWED_ORIGIN})
    assert response.headers.get(ACAO) != "*"
    assert ACAO not in response.headers


def test_wildcard_is_not_returned_even_when_origins_are_configured(client):
    response = client.get("/projects", headers={**AUTH_HEADERS, "Origin": ALLOWED_ORIGIN})
    assert response.headers[ACAO] != "*"


# --- プリフライト ---


@pytest.mark.parametrize("method", ["GET", "POST", "PATCH", "DELETE"])
def test_preflight_succeeds_for_used_methods_and_auth_header(client, method):
    response = client.options(
        "/projects",
        headers={
            "Origin": ALLOWED_ORIGIN,
            "Access-Control-Request-Method": method,
            "Access-Control-Request-Headers": "x-api-key, content-type",
        },
    )
    assert response.status_code == 200
    assert response.headers[ACAO] == ALLOWED_ORIGIN

    allowed_methods = {
        m.strip() for m in response.headers["access-control-allow-methods"].split(",")
    }
    assert method in allowed_methods

    allowed_headers = {
        h.strip().lower() for h in response.headers["access-control-allow-headers"].split(",")
    }
    assert {"x-api-key", "content-type"} <= allowed_headers


def test_preflight_does_not_require_api_key(client):
    # プリフライトはブラウザが自動送信するため認証ヘッダーを持たない。
    # グローバル依存関係の認証より前にCORSミドルウェアが応答する必要がある。
    response = client.options(
        "/projects",
        headers={
            "Origin": ALLOWED_ORIGIN,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "x-api-key, content-type",
        },
    )
    assert response.status_code == 200


# --- 既存の挙動が変わらないこと ---


def test_authentication_still_rejects_requests_without_api_key_from_allowed_origin(client):
    response = client.get("/projects", headers={"Origin": ALLOWED_ORIGIN})
    assert response.status_code == 401


def test_authentication_still_rejects_invalid_api_key_from_allowed_origin(client):
    response = client.get("/projects", headers={"X-API-Key": "wrong-key", "Origin": ALLOWED_ORIGIN})
    assert response.status_code == 401


def test_existing_endpoint_behavior_is_unchanged_with_cors_enabled(client):
    create_response = client.post(
        "/projects", json=make_project_payload(), headers={**AUTH_HEADERS, "Origin": ALLOWED_ORIGIN}
    )
    assert create_response.status_code == 201
    project_id = create_response.json()["id"]

    # 親詳細に子情報を含めない
    detail = client.get(
        f"/projects/{project_id}", headers={**AUTH_HEADERS, "Origin": ALLOWED_ORIGIN}
    )
    assert detail.status_code == 200
    assert "tasks" not in detail.json()

    # ステータス逆行はブロックせずwarning付きで200
    forward = client.patch(
        f"/projects/{project_id}",
        json={"status": "契約中"},
        headers={**AUTH_HEADERS, "Origin": ALLOWED_ORIGIN},
    )
    assert forward.status_code == 200
    assert forward.json()["warning"] is None

    backward = client.patch(
        f"/projects/{project_id}",
        json={"status": "提案中"},
        headers={**AUTH_HEADERS, "Origin": ALLOWED_ORIGIN},
    )
    assert backward.status_code == 200
    assert backward.json()["warning"] is not None

    # 論理削除後は一覧・詳細から除外される
    delete_response = client.delete(
        f"/projects/{project_id}", headers={**AUTH_HEADERS, "Origin": ALLOWED_ORIGIN}
    )
    assert delete_response.status_code == 204

    listed = client.get("/projects", headers={**AUTH_HEADERS, "Origin": ALLOWED_ORIGIN})
    assert listed.status_code == 200
    assert [p["id"] for p in listed.json()] == []
    assert (
        client.get(
            f"/projects/{project_id}", headers={**AUTH_HEADERS, "Origin": ALLOWED_ORIGIN}
        ).status_code
        == 404
    )
