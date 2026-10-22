"""URLパスのidに関する共通処理。"""

# SQLiteのINTEGERは符号付き64bitのため、範囲外の値をクエリに渡すとOverflowErrorで
# 500になる。範囲外のidは存在し得ないので、各ルーターはクエリ前に404として扱う。
_SQLITE_INT_MIN = -(2**63)
_SQLITE_INT_MAX = 2**63 - 1


def is_storable_id(value: int) -> bool:
    return _SQLITE_INT_MIN <= value <= _SQLITE_INT_MAX
