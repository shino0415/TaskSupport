import httpx2
import pytest
from mcp import Client

from tasksupport_mcp.api_client import ApiClient, ApiError
from tasksupport_mcp.config import Config
from tasksupport_mcp.server import build_server
from tests.conftest import TEST_API_KEY, TEST_BASE_URL

pytestmark = pytest.mark.anyio


async def test_repr_does_not_contain_api_key() -> None:
    api = ApiClient(
        Config(base_url=TEST_BASE_URL, api_key=TEST_API_KEY),
        transport=httpx2.MockTransport(lambda request: httpx2.Response(200, json=[])),
    )
    try:
        assert TEST_API_KEY not in repr(api)
        assert TEST_BASE_URL in repr(api)
    finally:
        await api.aclose()


async def test_timeout_message_includes_configured_seconds() -> None:
    def raise_timeout(request: httpx2.Request) -> httpx2.Response:
        raise httpx2.ConnectTimeout("timed out", request=request)

    api = ApiClient(
        Config(base_url=TEST_BASE_URL, api_key=TEST_API_KEY),
        timeout=3,
        transport=httpx2.MockTransport(raise_timeout),
    )
    try:
        with pytest.raises(ApiError, match="タイムアウト 3秒") as exc_info:
            await api.get("/courses")
        assert exc_info.value.__cause__ is None
        assert TEST_API_KEY not in str(exc_info.value)
    finally:
        await api.aclose()


async def test_http_client_is_closed_when_server_session_ends() -> None:
    api = ApiClient(
        Config(base_url=TEST_BASE_URL, api_key=TEST_API_KEY),
        transport=httpx2.MockTransport(lambda request: httpx2.Response(200, json=[])),
    )

    async with Client(build_server(api)) as client:
        await client.call_tool("list_courses", {})
        assert not api._client.is_closed

    assert api._client.is_closed
