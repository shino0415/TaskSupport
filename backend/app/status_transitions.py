"""ステータス遷移の警告ロジック（共通の純粋関数）。

授業系・選考系のPATCHエンドポイントから共通で呼ばれる想定。ステータス変更は
ブロックせず、明確な逆行遷移を検知した場合のみ警告メッセージを返す。

「見送り」「不通過」のような分岐的な結果ステータスを1本の順序リストに無理やり
押し込まないよう、各ステータスから遷移してよい先（forward_edges）を個別に定義
した状態遷移グラフとして持ち、判定は単純なindex比較ではなくグラフ上の到達可能性
で行う（詳細はspec.md「## ステータス遷移の警告ロジック」を参照）。

ステータス集合は`Literal[*GRAPH]`のような動的アンパックではなく、StrEnumとして
定義する。Pydanticのバリデーションでは同じように機能しつつ、静的型チェッカー
（Pylance/Pyright）がLiteralの動的生成を解釈できず警告を出す問題を避けられる。
"""

from collections import deque
from enum import StrEnum


class CompanyTaskStatus(StrEnum):
    未着手 = "未着手"
    処理中 = "処理中"
    完了 = "完了"


class InterviewStepPrepStatus(StrEnum):
    準備中 = "準備中"
    準備万端 = "準備万端"
    完了 = "完了"


class InterviewStepResult(StrEnum):
    未定 = "未定"
    通過 = "通過"
    不通過 = "不通過"


# --- 適用箇所ごとの状態遷移グラフ（確定） ---

COMPANY_TASK_STATUS_GRAPH: dict[CompanyTaskStatus, list[CompanyTaskStatus]] = {
    CompanyTaskStatus.未着手: [CompanyTaskStatus.処理中],
    CompanyTaskStatus.処理中: [CompanyTaskStatus.完了],
    CompanyTaskStatus.完了: [],
}

INTERVIEW_STEP_PREP_STATUS_GRAPH: dict[InterviewStepPrepStatus, list[InterviewStepPrepStatus]] = {
    InterviewStepPrepStatus.準備中: [InterviewStepPrepStatus.準備万端],
    InterviewStepPrepStatus.準備万端: [InterviewStepPrepStatus.完了],
    InterviewStepPrepStatus.完了: [],
}

INTERVIEW_STEP_RESULT_GRAPH: dict[InterviewStepResult, list[InterviewStepResult]] = {
    InterviewStepResult.未定: [InterviewStepResult.通過, InterviewStepResult.不通過],
    InterviewStepResult.通過: [],
    InterviewStepResult.不通過: [],
}


def check_backward_transition[StatusT: str](
    forward_edges: dict[StatusT, list[StatusT]], from_status: StatusT, to_status: StatusT
) -> str | None:
    """明確な逆行遷移（to_statusがfrom_statusの前段階であるとグラフ上で判別できる場合）のみ
    警告メッセージを返す。順当な遷移（隣接・複数段飛び越え含む）や、
    枝分かれ先同士の無関係な遷移ではNoneを返す。

    forward_edgesはEnumキーの辞書（各グラフ）だけでなく、素の文字列（呼び出し元が
    DBから読み出した値等）も引数に取れるよう、str境界のジェネリックで扱う。
    """
    if to_status == from_status:
        return None
    if _is_reachable(forward_edges, from_status, to_status):
        return None
    if _is_reachable(forward_edges, to_status, from_status):
        return f"{from_status} から {to_status} への変更です。意図的な変更か確認してください。"
    return None


def _is_reachable[StatusT: str](
    forward_edges: dict[StatusT, list[StatusT]], start: StatusT, goal: StatusT
) -> bool:
    """startからgoalへforward_edgesを辿って到達できるか（幅優先探索で判定）"""
    visited = {start}
    queue = deque([start])
    while queue:
        current = queue.popleft()
        for neighbor in forward_edges.get(current, []):
            if neighbor == goal:
                return True
            if neighbor not in visited:
                visited.add(neighbor)
                queue.append(neighbor)
    return False
