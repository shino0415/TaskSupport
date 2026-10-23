"""コンソールスクリプトをstdioで起動し、MCPクライアントから接続できることを確かめる。

ツール一覧の取得だけを行い、APIには接続しない。
"""

import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest
from mcp import Client, StdioServerParameters
from mcp.client.stdio import stdio_client

from tasksupport_mcp.config import CONFIG_ENV_VAR
from tests.conftest import TEST_API_KEY, TEST_BASE_URL

pytestmark = pytest.mark.anyio


def console_script() -> str:
    script = Path(sys.executable).parent / "tasksupport-mcp"
    if script.exists():
        return str(script)
    found = shutil.which("tasksupport-mcp")
    assert found, "tasksupport-mcp のコンソールスクリプトが見つからない"
    return found


def write_config(tmp_path: Path, mode: int = 0o600) -> Path:
    path = tmp_path / "config.toml"
    path.write_text(f'base_url = "{TEST_BASE_URL}"\napi_key = "{TEST_API_KEY}"\n', "utf-8")
    os.chmod(path, mode)
    return path


async def test_client_can_connect_over_stdio_and_list_tools(tmp_path: Path) -> None:
    config_path = write_config(tmp_path)
    errlog_path = tmp_path / "stderr.log"
    params = StdioServerParameters(command=console_script(), env={CONFIG_ENV_VAR: str(config_path)})

    with errlog_path.open("w", encoding="utf-8") as errlog:
        async with Client(stdio_client(params, errlog=errlog)) as client:
            tools = (await client.list_tools()).tools

    assert {tool.name for tool in tools} >= {"list_courses", "list_company_tasks"}
    assert TEST_API_KEY not in errlog_path.read_text("utf-8")


def test_console_script_exits_with_error_on_bad_config(tmp_path: Path) -> None:
    config_path = write_config(tmp_path, mode=0o644)

    proc = subprocess.run(
        [console_script()],
        env={**os.environ, CONFIG_ENV_VAR: str(config_path)},
        stdin=subprocess.DEVNULL,
        capture_output=True,
        text=True,
        timeout=30,
    )

    assert proc.returncode == 1
    assert proc.stdout == ""
    assert "権限が広すぎます" in proc.stderr
    assert TEST_API_KEY not in proc.stderr
