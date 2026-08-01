"""ステータス遷移の警告ロジック（共通の純粋関数）。

案件系・選考系のPATCHエンドポイントから共通で呼ばれる想定。ステータス変更は
ブロックせず、明確な逆行遷移を検知した場合のみ警告メッセージを返す。

「見送り」「不通過」のような分岐的な結果ステータスを1本の順序リストに無理やり
押し込まないよう、各ステータスから遷移してよい先（forward_edges）を個別に定義
した状態遷移グラフとして持ち、判定は単純なindex比較ではなくグラフ上の到達可能性
で行う（詳細はspec.md「## ステータス遷移の警告ロジック」を参照）。
"""

from collections import deque

# --- 適用箇所ごとの状態遷移グラフ（確定） ---

PROJECT_STATUS_GRAPH: dict[str, list[str]] = {
    "提案中": ["契約中", "見送り"],
    "契約中": ["納品済み", "見送り"],
    "納品済み": ["完了"],
    "完了": [],
    "見送り": [],
}

TASK_STATUS_GRAPH: dict[str, list[str]] = {
    "未着手": ["処理中"],
    "処理中": ["完了"],
    "完了": [],
}

INTERVIEW_STEP_PREP_STATUS_GRAPH: dict[str, list[str]] = {
    "準備中": ["準備万端"],
    "準備万端": ["完了"],
    "完了": [],
}

INTERVIEW_STEP_RESULT_GRAPH: dict[str, list[str]] = {
    "未定": ["通過", "不通過"],
    "通過": [],
    "不通過": [],
}


def check_backward_transition(
    forward_edges: dict[str, list[str]], from_status: str, to_status: str
) -> str | None:
    """明確な逆行遷移（to_statusがfrom_statusの前段階であるとグラフ上で判別できる場合）のみ
    警告メッセージを返す。順当な遷移（隣接・複数段飛び越え含む）や、
    枝分かれ先同士の無関係な遷移ではNoneを返す。"""
    if to_status == from_status:
        return None
    if _is_reachable(forward_edges, from_status, to_status):
        return None
    if _is_reachable(forward_edges, to_status, from_status):
        return f"{from_status} から {to_status} への変更です。意図的な変更か確認してください。"
    return None


def _is_reachable(forward_edges: dict[str, list[str]], start: str, goal: str) -> bool:
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
