"""授業タスク・選考トラッカーAPIを呼ぶローカル（stdio）MCPサーバー。"""

import sys

from tasksupport_mcp.api_client import ApiClient
from tasksupport_mcp.config import ConfigError, load_config
from tasksupport_mcp.server import build_server


def main() -> None:
    try:
        config = load_config()
    except ConfigError as exc:
        # stdoutはMCPのプロトコル通信に使うため、エラーはstderrに出す。
        print(f"tasksupport-mcp: {exc}", file=sys.stderr)
        sys.exit(1)

    build_server(ApiClient(config)).run("stdio")
