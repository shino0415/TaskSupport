"""設定ファイル（接続先URLとAPI Key）の読み込みと検査。"""

import os
import stat
import tomllib
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

CONFIG_ENV_VAR = "TASKSUPPORT_MCP_CONFIG"
DEFAULT_CONFIG_PATH = Path("~/.config/tasksupport-mcp/config.toml")
REQUIRED_KEYS = ("base_url", "api_key")


class ConfigError(Exception):
    """設定ファイルの不備。メッセージには設定値（特にapi_key）を含めない。"""


@dataclass(frozen=True)
class Config:
    base_url: str
    api_key: str = field(repr=False)


def resolve_config_path(environ: Mapping[str, str] | None = None) -> Path:
    env = os.environ if environ is None else environ
    override = env.get(CONFIG_ENV_VAR)
    path = Path(override) if override else DEFAULT_CONFIG_PATH
    return path.expanduser()


def _check_parent_dirs(path: Path) -> None:
    # 他のユーザーが書き込めるディレクトリにあると、ファイル（やリンク）を差し替えられる。
    dirs = {path.parent, Path(os.path.realpath(path)).parent}
    for directory in sorted(dirs):
        try:
            dir_mode = stat.S_IMODE(os.stat(directory).st_mode)
        except OSError as exc:
            raise ConfigError(
                f"設定ファイルのディレクトリを確認できません: {directory}（{exc.strerror}）"
            ) from None
        if dir_mode & 0o022:
            raise ConfigError(
                f"設定ファイルのディレクトリにグループ・その他の書き込み権限があります"
                f"（現在 {dir_mode:03o}）: {directory}\n"
                f"`chmod go-w {directory}` で書き込み権限を外すか、別の場所に置いてください。"
            )


def _read_config_file(path: Path) -> dict[str, Any]:
    # 検査と読み込みの間に差し替えられないよう、先に開いてから開いたファイルを検査する。
    # O_NONBLOCKはFIFOを指定されたときに開く処理で止まらないため。
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK)
    except FileNotFoundError:
        raise ConfigError(
            f"設定ファイルが見つかりません: {path}\n"
            f"base_url と api_key を書いたTOMLファイルを作成し、権限を600にしてください"
            f"（場所は環境変数 {CONFIG_ENV_VAR} で変更できます）。"
        ) from None
    except OSError as exc:
        raise ConfigError(f"設定ファイルを確認できません: {path}（{exc.strerror}）") from None

    try:
        st = os.fstat(fd)
        if not stat.S_ISREG(st.st_mode):
            raise ConfigError(f"設定ファイルが通常のファイルではありません: {path}")

        if st.st_uid != os.getuid():
            raise ConfigError(
                f"設定ファイルの所有者が実行ユーザーではありません: {path}\n"
                f"実行ユーザーが所有するファイルにしてください。"
            )

        # API Keyを含むため、600（所有者の読み書き）を超える権限のファイルは使わない。
        if stat.S_IMODE(st.st_mode) & ~0o600:
            raise ConfigError(
                f"設定ファイルの権限が広すぎます（現在 {stat.S_IMODE(st.st_mode):03o}）: {path}\n"
                f"`chmod 600 {path}` で所有者だけが読み書きできるようにしてください。"
            )

        _check_parent_dirs(path)
    except BaseException:
        os.close(fd)
        raise

    with os.fdopen(fd, "rb") as f:
        try:
            return tomllib.load(f)
        except OSError as exc:
            raise ConfigError(f"設定ファイルを読めません: {path}（{exc.strerror}）") from None
        except tomllib.TOMLDecodeError as exc:
            # TOMLDecodeErrorのメッセージは位置情報のみで、ファイルの中身は含まない。
            raise ConfigError(f"設定ファイルがTOMLとして読めません: {path}（{exc}）") from None


def _is_printable_ascii(value: str) -> bool:
    return all(0x20 <= ord(ch) <= 0x7E for ch in value)


def load_config(environ: Mapping[str, str] | None = None) -> Config:
    path = resolve_config_path(environ)
    data = _read_config_file(path)

    values: dict[str, str] = {}
    for key in REQUIRED_KEYS:
        value = data.get(key)
        if value is None:
            raise ConfigError(f"設定ファイルに {key} がありません: {path}")
        if not isinstance(value, str) or not value.strip():
            raise ConfigError(f"設定ファイルの {key} は空でない文字列にしてください: {path}")
        values[key] = value.strip()

    # HTTPヘッダーに載せるため。値はメッセージに出さない。
    if not _is_printable_ascii(values["api_key"]):
        raise ConfigError(
            f"設定ファイルの api_key に使えない文字（ASCII以外・改行・制御文字）があります: {path}"
        )

    base_url = values["base_url"].rstrip("/")
    parsed = urlsplit(base_url)
    # API Keyを平文で送らないよう、接続先はHTTPSに限る。
    if parsed.scheme != "https" or not parsed.hostname:
        raise ConfigError(f"設定ファイルの base_url は https:// で始まるURLにしてください: {path}")
    # 資格情報つきURLはrepr・ログに出るため、またクエリ等はパスの組み立てを壊すため拒否する。
    if parsed.username is not None or parsed.password is not None:
        raise ConfigError(f"設定ファイルの base_url にユーザー名・パスワードは書けません: {path}")
    if parsed.query or parsed.fragment or "?" in base_url or "#" in base_url:
        raise ConfigError(
            f"設定ファイルの base_url にクエリ（?）・フラグメント（#）は書けません: {path}"
        )

    return Config(base_url=base_url, api_key=values["api_key"])
