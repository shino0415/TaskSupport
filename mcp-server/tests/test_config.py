import os
from pathlib import Path

import pytest

from tasksupport_mcp import main
from tasksupport_mcp.config import (
    CONFIG_ENV_VAR,
    DEFAULT_CONFIG_PATH,
    Config,
    ConfigError,
    load_config,
    resolve_config_path,
)

SECRET = "super-secret-api-key"


def write_config(path: Path, content: str, mode: int = 0o600) -> Path:
    path.write_text(content, encoding="utf-8")
    os.chmod(path, mode)
    return path


def valid_content(base_url: str = "https://api.example.invalid") -> str:
    return f'base_url = "{base_url}"\napi_key = "{SECRET}"\n'


def env_for(path: Path) -> dict[str, str]:
    return {CONFIG_ENV_VAR: str(path)}


def test_loads_valid_config_from_env_path(tmp_path: Path) -> None:
    path = write_config(tmp_path / "config.toml", valid_content("https://api.example.invalid/"))

    config = load_config(env_for(path))

    assert config == Config(base_url="https://api.example.invalid", api_key=SECRET)


def test_owner_read_only_permission_is_accepted(tmp_path: Path) -> None:
    path = write_config(tmp_path / "config.toml", valid_content(), mode=0o400)

    assert load_config(env_for(path)).api_key == SECRET


def test_default_path_is_used_without_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    config_dir = tmp_path / ".config" / "tasksupport-mcp"
    config_dir.mkdir(parents=True)
    write_config(config_dir / "config.toml", valid_content())

    assert resolve_config_path({}) == config_dir / "config.toml"
    assert load_config({}).api_key == SECRET
    assert DEFAULT_CONFIG_PATH == Path("~/.config/tasksupport-mcp/config.toml")


def test_empty_env_falls_back_to_default_path(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))

    assert resolve_config_path({CONFIG_ENV_VAR: ""}) == (
        tmp_path / ".config" / "tasksupport-mcp" / "config.toml"
    )


def test_env_path_expands_user(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))

    assert resolve_config_path({CONFIG_ENV_VAR: "~/my.toml"}) == tmp_path / "my.toml"


def test_missing_file(tmp_path: Path) -> None:
    path = tmp_path / "missing.toml"

    with pytest.raises(ConfigError, match="設定ファイルが見つかりません") as exc_info:
        load_config(env_for(path))
    assert str(path) in str(exc_info.value)
    assert CONFIG_ENV_VAR in str(exc_info.value)


def test_directory_is_rejected(tmp_path: Path) -> None:
    with pytest.raises(ConfigError, match="通常のファイルではありません"):
        load_config(env_for(tmp_path))


@pytest.mark.parametrize("mode", [0o640, 0o604, 0o644, 0o660, 0o700, 0o777])
def test_permission_wider_than_600_is_rejected(tmp_path: Path, mode: int) -> None:
    path = write_config(tmp_path / "config.toml", valid_content(), mode=mode)

    with pytest.raises(ConfigError, match="権限が広すぎます") as exc_info:
        load_config(env_for(path))
    assert f"{mode:03o}" in str(exc_info.value)
    assert "chmod 600" in str(exc_info.value)
    assert SECRET not in str(exc_info.value)


@pytest.mark.parametrize("missing", ["base_url", "api_key"])
def test_missing_key(tmp_path: Path, missing: str) -> None:
    lines = {
        "base_url": 'base_url = "https://api.example.invalid"',
        "api_key": f'api_key = "{SECRET}"',
    }
    del lines[missing]
    path = write_config(tmp_path / "config.toml", "\n".join(lines.values()) + "\n")

    with pytest.raises(ConfigError, match=f"{missing} がありません") as exc_info:
        load_config(env_for(path))
    assert SECRET not in str(exc_info.value)


@pytest.mark.parametrize(
    "content",
    [
        f'base_url = ""\napi_key = "{SECRET}"\n',
        'base_url = "https://api.example.invalid"\napi_key = "  "\n',
        'base_url = "https://api.example.invalid"\napi_key = 123\n',
    ],
)
def test_empty_or_non_string_value_is_rejected(tmp_path: Path, content: str) -> None:
    path = write_config(tmp_path / "config.toml", content)

    with pytest.raises(ConfigError, match="空でない文字列") as exc_info:
        load_config(env_for(path))
    assert SECRET not in str(exc_info.value)


@pytest.mark.parametrize(
    "base_url",
    ["http://api.example.invalid", "api.example.invalid", "ftp://api.example.invalid", "https://"],
)
def test_non_https_base_url_is_rejected(tmp_path: Path, base_url: str) -> None:
    path = write_config(tmp_path / "config.toml", valid_content(base_url))

    with pytest.raises(ConfigError, match="https://") as exc_info:
        load_config(env_for(path))
    assert SECRET not in str(exc_info.value)


def test_invalid_toml_does_not_leak_content(tmp_path: Path) -> None:
    path = write_config(tmp_path / "config.toml", f'api_key = "{SECRET}"\nbase_url = \n')

    with pytest.raises(ConfigError, match="TOMLとして読めません") as exc_info:
        load_config(env_for(path))
    assert SECRET not in str(exc_info.value)


def test_api_key_not_in_repr(tmp_path: Path) -> None:
    path = write_config(tmp_path / "config.toml", valid_content())

    config = load_config(env_for(path))

    assert SECRET not in repr(config)
    assert SECRET not in str(config)


def test_main_exits_with_message_on_config_error(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    path = write_config(tmp_path / "config.toml", valid_content(), mode=0o644)
    monkeypatch.setenv(CONFIG_ENV_VAR, str(path))

    with pytest.raises(SystemExit) as exc_info:
        main()

    assert exc_info.value.code == 1
    captured = capsys.readouterr()
    assert captured.out == ""
    assert "権限が広すぎます" in captured.err
    assert SECRET not in captured.err


def test_file_owned_by_other_user_is_rejected(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = write_config(tmp_path / "config.toml", valid_content())
    monkeypatch.setattr(os, "getuid", lambda: path.stat().st_uid + 1)

    with pytest.raises(ConfigError, match="所有者が実行ユーザーではありません") as exc_info:
        load_config(env_for(path))
    assert SECRET not in str(exc_info.value)


@pytest.mark.parametrize("dir_mode", [0o770, 0o707, 0o777, 0o1777])
def test_parent_dir_writable_by_others_is_rejected(tmp_path: Path, dir_mode: int) -> None:
    config_dir = tmp_path / "conf"
    config_dir.mkdir()
    path = write_config(config_dir / "config.toml", valid_content())
    os.chmod(config_dir, dir_mode)

    try:
        with pytest.raises(ConfigError, match="グループ・その他の書き込み権限") as exc_info:
            load_config(env_for(path))
    finally:
        os.chmod(config_dir, 0o700)
    assert str(config_dir) in str(exc_info.value)
    assert SECRET not in str(exc_info.value)


@pytest.mark.parametrize("dir_mode", [0o700, 0o755, 0o500])
def test_parent_dir_without_others_write_is_accepted(tmp_path: Path, dir_mode: int) -> None:
    config_dir = tmp_path / "conf"
    config_dir.mkdir()
    path = write_config(config_dir / "config.toml", valid_content())
    os.chmod(config_dir, dir_mode)

    try:
        assert load_config(env_for(path)).api_key == SECRET
    finally:
        os.chmod(config_dir, 0o700)


def test_symlink_target_dir_writable_by_others_is_rejected(tmp_path: Path) -> None:
    target_dir = tmp_path / "shared"
    target_dir.mkdir()
    target = write_config(target_dir / "config.toml", valid_content())
    os.chmod(target_dir, 0o777)
    link_dir = tmp_path / "conf"
    link_dir.mkdir(mode=0o700)
    link = link_dir / "config.toml"
    link.symlink_to(target)

    try:
        with pytest.raises(ConfigError, match="グループ・その他の書き込み権限") as exc_info:
            load_config(env_for(link))
    finally:
        os.chmod(target_dir, 0o700)
    assert str(target_dir) in str(exc_info.value)


def test_symlink_to_valid_file_is_accepted(tmp_path: Path) -> None:
    target = write_config(tmp_path / "real.toml", valid_content())
    link = tmp_path / "config.toml"
    link.symlink_to(target)

    assert load_config(env_for(link)).api_key == SECRET


def test_fifo_is_rejected_without_blocking(tmp_path: Path) -> None:
    path = tmp_path / "config.toml"
    os.mkfifo(path, 0o600)

    with pytest.raises(ConfigError, match="通常のファイルではありません"):
        load_config(env_for(path))


def test_permission_is_checked_on_opened_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """検査は開いたファイルに対して行い、パスを別途statし直さない（TOCTOU対策）。"""
    path = write_config(tmp_path / "config.toml", valid_content(), mode=0o644)

    def fail_stat(*args: object, **kwargs: object) -> None:
        raise AssertionError("Path.stat must not be used")

    monkeypatch.setattr(Path, "stat", fail_stat)

    with pytest.raises(ConfigError, match="権限が広すぎます"):
        load_config(env_for(path))


@pytest.mark.parametrize(
    "api_key",
    [
        "キー-abc",
        "abc\\u00e9def",
        "abc\\tdef",
        "abc\\ndef",
        "abc\\u0000def",
        "abc\\u007fdef",
        "abc\\u200bdef",
    ],
)
def test_api_key_with_non_printable_ascii_is_rejected(tmp_path: Path, api_key: str) -> None:
    content = f'base_url = "https://api.example.invalid"\napi_key = "{api_key}"\n'
    path = write_config(tmp_path / "config.toml", content)

    with pytest.raises(ConfigError, match="api_key に使えない文字") as exc_info:
        load_config(env_for(path))
    message = str(exc_info.value)
    assert "abc" not in message
    assert "キー" not in message


def test_api_key_with_all_printable_ascii_is_accepted(tmp_path: Path) -> None:
    api_key = "A-z_0.9~!$%&'()*+,/:;<=>?@[]^`{|}"
    content = f'base_url = "https://api.example.invalid"\napi_key = """{api_key}"""\n'
    path = write_config(tmp_path / "config.toml", content)

    assert load_config(env_for(path)).api_key == api_key


def test_main_exits_with_message_on_non_ascii_api_key(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    content = 'base_url = "https://api.example.invalid"\napi_key = "秘密のキー"\n'
    path = write_config(tmp_path / "config.toml", content)
    monkeypatch.setenv(CONFIG_ENV_VAR, str(path))

    with pytest.raises(SystemExit) as exc_info:
        main()

    assert exc_info.value.code == 1
    captured = capsys.readouterr()
    assert captured.out == ""
    assert "api_key に使えない文字" in captured.err
    assert "秘密のキー" not in captured.err


@pytest.mark.parametrize(
    "base_url",
    [
        "https://user:pw@api.example.invalid",
        "https://user@api.example.invalid",
        "https://:pw@api.example.invalid",
        "https://@api.example.invalid",
    ],
)
def test_base_url_with_userinfo_is_rejected(tmp_path: Path, base_url: str) -> None:
    path = write_config(tmp_path / "config.toml", valid_content(base_url))

    with pytest.raises(ConfigError, match="ユーザー名・パスワードは書けません") as exc_info:
        load_config(env_for(path))
    assert "pw" not in str(exc_info.value)
    assert SECRET not in str(exc_info.value)


@pytest.mark.parametrize(
    "base_url",
    [
        "https://api.example.invalid/?token=x",
        "https://api.example.invalid?",
        "https://api.example.invalid/#frag",
        "https://api.example.invalid#",
        "https://api.example.invalid/api?a=1#b",
    ],
)
def test_base_url_with_query_or_fragment_is_rejected(tmp_path: Path, base_url: str) -> None:
    path = write_config(tmp_path / "config.toml", valid_content(base_url))

    with pytest.raises(ConfigError, match="クエリ（\\?）・フラグメント（#）は書けません"):
        load_config(env_for(path))


def test_base_url_with_path_and_port_is_accepted(tmp_path: Path) -> None:
    path = write_config(
        tmp_path / "config.toml", valid_content("https://api.example.invalid:8443/api/")
    )

    assert load_config(env_for(path)).base_url == "https://api.example.invalid:8443/api"
