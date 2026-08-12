"""ステータス遷移警告ロジック（check_backward_transition）の単体テスト。

適用箇所4種（Project.status, Task.status, InterviewStep.prep_status,
InterviewStep.result）それぞれについて、境界値（同一ステータス、隣接遷移、
複数段飛び越え遷移、明確な逆行遷移、枝分かれ先同士の無関係な遷移）を、
各グラフの構造上該当するパターンのみ網羅する。

- Task.status / InterviewStep.prep_status は分岐のない線形グラフのため、
  「枝分かれ先同士の遷移」パターンは対象外。
- InterviewStep.result は深さ2（未定→通過/不通過で終端）の浅いグラフのため、
  「複数段飛び越え遷移」は隣接遷移と区別がつかず対象外。
"""

from app.status_transitions import (
    INTERVIEW_STEP_PREP_STATUS_GRAPH,
    INTERVIEW_STEP_RESULT_GRAPH,
    PROJECT_STATUS_GRAPH,
    TASK_STATUS_GRAPH,
    check_backward_transition,
)

# --- Project.status ---


def test_project_status_same_status_no_warning():
    assert check_backward_transition(PROJECT_STATUS_GRAPH, "提案中", "提案中") is None


def test_project_status_adjacent_forward_no_warning():
    assert check_backward_transition(PROJECT_STATUS_GRAPH, "提案中", "契約中") is None
    assert check_backward_transition(PROJECT_STATUS_GRAPH, "契約中", "納品済み") is None


def test_project_status_multi_step_forward_no_warning():
    assert check_backward_transition(PROJECT_STATUS_GRAPH, "提案中", "納品済み") is None
    assert check_backward_transition(PROJECT_STATUS_GRAPH, "提案中", "完了") is None


def test_project_status_backward_transition_returns_warning():
    warning = check_backward_transition(PROJECT_STATUS_GRAPH, "契約中", "提案中")
    assert warning is not None
    assert "契約中" in warning
    assert "提案中" in warning

    assert check_backward_transition(PROJECT_STATUS_GRAPH, "納品済み", "契約中") is not None
    assert check_backward_transition(PROJECT_STATUS_GRAPH, "完了", "納品済み") is not None
    assert check_backward_transition(PROJECT_STATUS_GRAPH, "見送り", "提案中") is not None


def test_project_status_unrelated_branch_no_warning():
    assert check_backward_transition(PROJECT_STATUS_GRAPH, "完了", "見送り") is None
    assert check_backward_transition(PROJECT_STATUS_GRAPH, "見送り", "完了") is None


# --- Task.status（線形、分岐なし） ---


def test_task_status_same_status_no_warning():
    assert check_backward_transition(TASK_STATUS_GRAPH, "処理中", "処理中") is None


def test_task_status_adjacent_forward_no_warning():
    assert check_backward_transition(TASK_STATUS_GRAPH, "未着手", "処理中") is None
    assert check_backward_transition(TASK_STATUS_GRAPH, "処理中", "完了") is None


def test_task_status_multi_step_forward_no_warning():
    assert check_backward_transition(TASK_STATUS_GRAPH, "未着手", "完了") is None


def test_task_status_backward_transition_returns_warning():
    assert check_backward_transition(TASK_STATUS_GRAPH, "処理中", "未着手") is not None
    assert check_backward_transition(TASK_STATUS_GRAPH, "完了", "処理中") is not None
    assert check_backward_transition(TASK_STATUS_GRAPH, "完了", "未着手") is not None


# --- InterviewStep.prep_status（線形、分岐なし） ---


def test_prep_status_same_status_no_warning():
    assert check_backward_transition(
        INTERVIEW_STEP_PREP_STATUS_GRAPH, "準備万端", "準備万端"
    ) is None


def test_prep_status_adjacent_forward_no_warning():
    assert check_backward_transition(INTERVIEW_STEP_PREP_STATUS_GRAPH, "準備中", "準備万端") is None
    assert check_backward_transition(INTERVIEW_STEP_PREP_STATUS_GRAPH, "準備万端", "完了") is None


def test_prep_status_multi_step_forward_no_warning():
    assert check_backward_transition(INTERVIEW_STEP_PREP_STATUS_GRAPH, "準備中", "完了") is None


def test_prep_status_backward_transition_returns_warning():
    graph = INTERVIEW_STEP_PREP_STATUS_GRAPH
    assert check_backward_transition(graph, "準備万端", "準備中") is not None
    assert check_backward_transition(graph, "完了", "準備万端") is not None
    assert check_backward_transition(graph, "完了", "準備中") is not None


# --- InterviewStep.result ---


def test_result_same_status_no_warning():
    assert check_backward_transition(INTERVIEW_STEP_RESULT_GRAPH, "未定", "未定") is None


def test_result_adjacent_forward_no_warning():
    assert check_backward_transition(INTERVIEW_STEP_RESULT_GRAPH, "未定", "通過") is None
    assert check_backward_transition(INTERVIEW_STEP_RESULT_GRAPH, "未定", "不通過") is None


def test_result_backward_transition_returns_warning():
    assert check_backward_transition(INTERVIEW_STEP_RESULT_GRAPH, "通過", "未定") is not None
    assert check_backward_transition(INTERVIEW_STEP_RESULT_GRAPH, "不通過", "未定") is not None


def test_result_unrelated_branch_no_warning():
    assert check_backward_transition(INTERVIEW_STEP_RESULT_GRAPH, "通過", "不通過") is None
    assert check_backward_transition(INTERVIEW_STEP_RESULT_GRAPH, "不通過", "通過") is None
