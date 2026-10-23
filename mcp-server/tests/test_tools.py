import json
import logging
from typing import Any

import httpx2
import pytest
from mcp import Client
from mcp.types import CallToolResult, TextContent

from tests.conftest import TEST_API_KEY, TEST_BASE_URL, FakeApi

pytestmark = pytest.mark.anyio

COURSE = {
    "id": 1,
    "name": "線形代数",
    "day_of_week": "月",
    "period": 2,
    "academic_year": 2026,
    "term": "前期",
    "memo": None,
    "is_deleted": False,
}
ASSIGNMENT = {
    "id": 3,
    "course_id": 1,
    "name": "レポート1",
    "status": "未着手",
    "deadline": "2026-10-30T23:59:00",
    "submission_method": "LMS",
    "memo": None,
    "is_deleted": False,
}
COMPANY = {"id": 5, "name": "株式会社サンプル", "is_deleted": False}
INTERVIEW_STEP = {
    "id": 7,
    "company_id": 5,
    "type": "一次面接",
    "date": "2026-11-02",
    "memo": None,
    "prep_status": "未着手",
    "result": "未定",
    "is_deleted": False,
}
COMPANY_TASK = {
    "id": 9,
    "company_id": 5,
    "name": "ES提出",
    "memo": "800字",
    "status": "未着手",
    "is_deleted": False,
}

# (ツール名, 引数, 呼ばれるべきAPIのパス, APIの応答)
READ_TOOLS: list[tuple[str, dict[str, Any], str, Any]] = [
    ("list_courses", {}, "/courses", [COURSE]),
    ("get_course", {"course_id": 1}, "/courses/1", COURSE),
    ("list_assignments", {"course_id": 1}, "/courses/1/assignments", [ASSIGNMENT]),
    ("get_assignment", {"assignment_id": 3}, "/assignments/3", ASSIGNMENT),
    (
        "list_upcoming_assignments",
        {},
        "/assignments/upcoming",
        [{**ASSIGNMENT, "course_name": "線形代数"}],
    ),
    ("list_companies", {}, "/companies", [COMPANY]),
    ("get_company", {"company_id": 5}, "/companies/5", COMPANY),
    (
        "list_interview_steps",
        {"company_id": 5},
        "/companies/5/interview-steps",
        [INTERVIEW_STEP],
    ),
    ("list_upcoming_interview_steps", {}, "/interview-steps/upcoming", [INTERVIEW_STEP]),
    ("list_company_tasks", {"company_id": 5}, "/companies/5/company-tasks", [COMPANY_TASK]),
]
TOOL_IDS = [t[0] for t in READ_TOOLS]
# idを受け取るツール（存在しないidで404になりうる）
TOOLS_WITH_ID = [t for t in READ_TOOLS if t[1]]


def json_response(status: int, body: Any) -> Any:
    return lambda request: httpx2.Response(status, json=body)


def result_text(result: CallToolResult) -> str:
    assert len(result.content) == 1
    content = result.content[0]
    assert isinstance(content, TextContent)
    return content.text


async def assert_server_still_works(client: Client, fake_api: FakeApi) -> None:
    fake_api.handler = json_response(200, [COURSE])
    result = await client.call_tool("list_courses", {})
    assert not result.is_error
    assert json.loads(result_text(result)) == [COURSE]


async def test_list_tools_exposes_read_tools_with_schema_and_read_only_hint(
    mcp_client: Client,
) -> None:
    tools = {tool.name: tool for tool in (await mcp_client.list_tools()).tools}

    assert set(tools) == set(TOOL_IDS)
    for name, args, _, _ in READ_TOOLS:
        tool = tools[name]
        assert tool.description and "読み取り専用" in tool.description
        assert tool.title
        assert tool.annotations is not None
        assert tool.annotations.read_only_hint is True
        assert set(tool.input_schema.get("properties", {})) == set(args)
        assert set(tool.input_schema.get("required", [])) == set(args)
        for arg in args:
            assert tool.input_schema["properties"][arg]["type"] == "integer"


@pytest.mark.parametrize(("name", "args", "path", "body"), READ_TOOLS, ids=TOOL_IDS)
async def test_read_tool_calls_api_and_returns_response(
    mcp_client: Client, fake_api: FakeApi, name: str, args: dict[str, Any], path: str, body: Any
) -> None:
    fake_api.handler = json_response(200, body)

    result = await mcp_client.call_tool(name, args)

    assert not result.is_error
    assert json.loads(result_text(result)) == body
    assert len(fake_api.requests) == 1
    request = fake_api.requests[0]
    assert request.method == "GET"
    assert str(request.url) == f"{TEST_BASE_URL}{path}"
    assert request.headers["X-API-Key"] == TEST_API_KEY


async def test_empty_list_is_returned_as_empty_json_array(
    mcp_client: Client, fake_api: FakeApi
) -> None:
    # 論理削除済みのデータの除外はAPI側で行われ、ツールはAPIの応答をそのまま返す。
    fake_api.handler = json_response(200, [])

    result = await mcp_client.call_tool("list_courses", {})

    assert not result.is_error
    assert json.loads(result_text(result)) == []


@pytest.mark.parametrize(("name", "args", "path", "body"), TOOLS_WITH_ID, ids=lambda v: str(v))
async def test_not_found_is_returned_as_tool_error(
    mcp_client: Client, fake_api: FakeApi, name: str, args: dict[str, Any], path: str, body: Any
) -> None:
    fake_api.handler = json_response(404, {"detail": "Course not found"})

    result = await mcp_client.call_tool(name, args)

    assert result.is_error
    text = result_text(result)
    assert "HTTP 404" in text
    assert "Course not found" in text
    await assert_server_still_works(mcp_client, fake_api)


@pytest.mark.parametrize(("name", "args", "path", "body"), READ_TOOLS, ids=TOOL_IDS)
async def test_validation_error_is_returned_with_detail(
    mcp_client: Client, fake_api: FakeApi, name: str, args: dict[str, Any], path: str, body: Any
) -> None:
    detail = [
        {
            "type": "int_parsing",
            "loc": ["path", "course_id"],
            "msg": "Input should be a valid integer",
            "input": "x",
        }
    ]
    fake_api.handler = json_response(422, {"detail": detail})

    result = await mcp_client.call_tool(name, args)

    assert result.is_error
    text = result_text(result)
    assert "HTTP 422" in text
    assert "Input should be a valid integer" in text
    assert '"loc": ["path", "course_id"]' in text


@pytest.mark.parametrize(("name", "args", "path", "body"), READ_TOOLS, ids=TOOL_IDS)
async def test_unauthorized_is_returned_without_api_key(
    mcp_client: Client,
    fake_api: FakeApi,
    caplog: pytest.LogCaptureFixture,
    name: str,
    args: dict[str, Any],
    path: str,
    body: Any,
) -> None:
    caplog.set_level(logging.DEBUG)
    fake_api.handler = json_response(401, {"detail": "Invalid or missing API Key"})

    result = await mcp_client.call_tool(name, args)

    assert result.is_error
    text = result_text(result)
    assert "HTTP 401" in text
    assert "Invalid or missing API Key" in text
    assert "api_key" in text
    assert TEST_API_KEY not in text
    assert TEST_API_KEY not in caplog.text
    await assert_server_still_works(mcp_client, fake_api)


@pytest.mark.parametrize(("name", "args", "path", "body"), READ_TOOLS, ids=TOOL_IDS)
async def test_timeout_is_returned_as_tool_error(
    mcp_client: Client,
    fake_api: FakeApi,
    caplog: pytest.LogCaptureFixture,
    name: str,
    args: dict[str, Any],
    path: str,
    body: Any,
) -> None:
    caplog.set_level(logging.DEBUG)

    def raise_timeout(request: httpx2.Request) -> httpx2.Response:
        raise httpx2.ReadTimeout("timed out", request=request)

    fake_api.handler = raise_timeout

    result = await mcp_client.call_tool(name, args)

    assert result.is_error
    text = result_text(result)
    assert "タイムアウト" in text
    assert TEST_API_KEY not in text
    assert TEST_API_KEY not in caplog.text
    await assert_server_still_works(mcp_client, fake_api)


@pytest.mark.parametrize(("name", "args", "path", "body"), READ_TOOLS, ids=TOOL_IDS)
async def test_connection_failure_is_returned_as_tool_error(
    mcp_client: Client,
    fake_api: FakeApi,
    caplog: pytest.LogCaptureFixture,
    name: str,
    args: dict[str, Any],
    path: str,
    body: Any,
) -> None:
    caplog.set_level(logging.DEBUG)

    def raise_connect_error(request: httpx2.Request) -> httpx2.Response:
        raise httpx2.ConnectError("connection refused", request=request)

    fake_api.handler = raise_connect_error

    result = await mcp_client.call_tool(name, args)

    assert result.is_error
    text = result_text(result)
    assert "接続できませんでした" in text
    assert "ConnectError" in text
    assert TEST_API_KEY not in text
    assert TEST_API_KEY not in caplog.text
    await assert_server_still_works(mcp_client, fake_api)


async def test_other_http_error_with_non_json_body(mcp_client: Client, fake_api: FakeApi) -> None:
    fake_api.handler = lambda request: httpx2.Response(502, text="<html>Bad Gateway</html>")

    result = await mcp_client.call_tool("list_courses", {})

    assert result.is_error
    text = result_text(result)
    assert "HTTP 502" in text
    assert "Bad Gateway" in text
    await assert_server_still_works(mcp_client, fake_api)


async def test_error_without_body(mcp_client: Client, fake_api: FakeApi) -> None:
    fake_api.handler = lambda request: httpx2.Response(500)

    result = await mcp_client.call_tool("list_courses", {})

    assert result.is_error
    assert "HTTP 500" in result_text(result)
    assert "詳細なし" in result_text(result)


async def test_redirect_is_not_followed(mcp_client: Client, fake_api: FakeApi) -> None:
    fake_api.handler = lambda request: httpx2.Response(
        307, headers={"Location": "https://other.example.invalid/courses"}
    )

    result = await mcp_client.call_tool("list_courses", {})

    assert result.is_error
    assert "HTTP 307" in result_text(result)
    assert len(fake_api.requests) == 1


async def test_non_json_success_response_is_tool_error(
    mcp_client: Client, fake_api: FakeApi
) -> None:
    fake_api.handler = lambda request: httpx2.Response(200, text="not json")

    result = await mcp_client.call_tool("list_courses", {})

    assert result.is_error
    assert "JSONとして読めません" in result_text(result)
    await assert_server_still_works(mcp_client, fake_api)


async def test_invalid_argument_type_is_rejected_without_calling_api(
    mcp_client: Client, fake_api: FakeApi
) -> None:
    result = await mcp_client.call_tool("get_course", {"course_id": "abc"})

    assert result.is_error
    assert "course_id" in result_text(result)
    assert fake_api.requests == []
    await assert_server_still_works(mcp_client, fake_api)
