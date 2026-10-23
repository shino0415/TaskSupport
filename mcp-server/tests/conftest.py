from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass, field

import httpx2
import pytest
from mcp import Client

from tasksupport_mcp.api_client import ApiClient
from tasksupport_mcp.config import Config
from tasksupport_mcp.server import build_server

# 実在しない例示用の値（実環境には接続しない）。
TEST_BASE_URL = "https://api.example.invalid"
TEST_API_KEY = "test-secret-key-do-not-leak"

Handler = Callable[[httpx2.Request], httpx2.Response]


@dataclass
class FakeApi:
    """httpx2のモックtransportで既存APIの応答を差し替える。"""

    handler: Handler | None = None
    requests: list[httpx2.Request] = field(default_factory=list)

    def __call__(self, request: httpx2.Request) -> httpx2.Response:
        self.requests.append(request)
        assert self.handler is not None, "テストでhandlerを設定すること"
        return self.handler(request)


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.fixture
def fake_api() -> FakeApi:
    return FakeApi()


@pytest.fixture
async def mcp_client(fake_api: FakeApi) -> AsyncIterator[Client]:
    api = ApiClient(
        Config(base_url=TEST_BASE_URL, api_key=TEST_API_KEY),
        transport=httpx2.MockTransport(fake_api),
    )
    async with Client(build_server(api)) as client:
        yield client
