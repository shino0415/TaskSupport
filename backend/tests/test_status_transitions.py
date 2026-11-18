"""ステータス遷移警告ロジック（check_backward_transition）の単体テスト。

適用箇所5種（Assignment.status, CompanyTask.status, InterviewStep.prep_status,
InterviewStep.result, Company.status）
それぞれについて、境界値（同一ステータス、隣接遷移、
複数段飛び越え遷移、明確な逆行遷移、枝分かれ先同士の無関係な遷移）を、
各グラフの構造上該当するパターンのみ網羅する。

- Assignment.status / CompanyTask.status / InterviewStep.prep_status は分岐のない線形グラフのため、
  「枝分かれ先同士の遷移」パターンは対象外。
- InterviewStep.result は深さ2（未定→通過/不通過で終端）の浅いグラフのため、
  「複数段飛び越え遷移」は隣接遷移と区別がつかず対象外。
- Company.status は選考中→辞退が直接の辺と内定経由の両方で到達できるため、
  飛び越え遷移は順当な変更の中で検証する。選考中とインターン参加の間は
  どちら向きも警告しない例外があるため、APIが使う check_company_status_transition
  でも判定を検証する。
"""

import pytest

from app.status_transitions import (
    ASSIGNMENT_STATUS_GRAPH,
    COMPANY_STATUS_GRAPH,
    COMPANY_TASK_STATUS_GRAPH,
    INTERVIEW_STEP_PREP_STATUS_GRAPH,
    INTERVIEW_STEP_RESULT_GRAPH,
    CompanyStatus,
    check_backward_transition,
    check_company_status_transition,
)

# --- Assignment.status（線形、分岐なし） ---


def test_assignment_status_same_status_no_warning():
    for status in ("未着手", "取組中", "未提出", "提出済み"):
        assert check_backward_transition(ASSIGNMENT_STATUS_GRAPH, status, status) is None


def test_assignment_status_adjacent_forward_no_warning():
    graph = ASSIGNMENT_STATUS_GRAPH
    assert check_backward_transition(graph, "未着手", "取組中") is None
    assert check_backward_transition(graph, "取組中", "未提出") is None
    assert check_backward_transition(graph, "未提出", "提出済み") is None


def test_assignment_status_multi_step_forward_no_warning():
    graph = ASSIGNMENT_STATUS_GRAPH
    assert check_backward_transition(graph, "未着手", "未提出") is None
    assert check_backward_transition(graph, "未着手", "提出済み") is None
    assert check_backward_transition(graph, "取組中", "提出済み") is None


def test_assignment_status_backward_transition_returns_warning():
    graph = ASSIGNMENT_STATUS_GRAPH
    backward_pairs = [
        ("取組中", "未着手"),
        ("未提出", "取組中"),
        ("提出済み", "未提出"),
        ("未提出", "未着手"),
        ("提出済み", "取組中"),
        ("提出済み", "未着手"),
    ]
    for from_status, to_status in backward_pairs:
        warning = check_backward_transition(graph, from_status, to_status)
        assert warning is not None
        assert from_status in warning and to_status in warning


# --- CompanyTask.status（線形、分岐なし） ---


def test_company_task_status_same_status_no_warning():
    assert check_backward_transition(COMPANY_TASK_STATUS_GRAPH, "処理中", "処理中") is None


def test_company_task_status_adjacent_forward_no_warning():
    assert check_backward_transition(COMPANY_TASK_STATUS_GRAPH, "未着手", "処理中") is None
    assert check_backward_transition(COMPANY_TASK_STATUS_GRAPH, "処理中", "完了") is None


def test_company_task_status_multi_step_forward_no_warning():
    assert check_backward_transition(COMPANY_TASK_STATUS_GRAPH, "未着手", "完了") is None


def test_company_task_status_backward_transition_returns_warning():
    assert check_backward_transition(COMPANY_TASK_STATUS_GRAPH, "処理中", "未着手") is not None
    assert check_backward_transition(COMPANY_TASK_STATUS_GRAPH, "完了", "処理中") is not None
    assert check_backward_transition(COMPANY_TASK_STATUS_GRAPH, "完了", "未着手") is not None


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


# --- Company.status（インターン参加・選考中から内定/お見送り/辞退へ分岐、内定から辞退へ） ---


def test_company_status_graph_covers_all_statuses():
    assert set(COMPANY_STATUS_GRAPH) == set(CompanyStatus)


def test_company_status_same_status_no_warning():
    for status in COMPANY_STATUS_GRAPH:
        assert check_backward_transition(COMPANY_STATUS_GRAPH, status, status) is None


@pytest.mark.parametrize(
    ("from_status", "to_status"),
    [("選考中", "内定"), ("選考中", "お見送り"), ("選考中", "辞退"), ("内定", "辞退")],
)
def test_company_status_forward_no_warning(from_status, to_status):
    assert check_backward_transition(COMPANY_STATUS_GRAPH, from_status, to_status) is None


@pytest.mark.parametrize("from_status", ["内定", "お見送り", "辞退"])
def test_company_status_backward_to_in_progress_returns_warning(from_status):
    assert (
        check_backward_transition(COMPANY_STATUS_GRAPH, from_status, "選考中")
        == f"{from_status} から 選考中 への変更です。意図的な変更か確認してください。"
    )


def test_company_status_declined_to_offer_returns_warning():
    assert (
        check_backward_transition(COMPANY_STATUS_GRAPH, "辞退", "内定")
        == "辞退 から 内定 への変更です。意図的な変更か確認してください。"
    )


@pytest.mark.parametrize(
    ("from_status", "to_status"),
    [("内定", "お見送り"), ("お見送り", "内定"), ("お見送り", "辞退"), ("辞退", "お見送り")],
)
def test_company_status_unrelated_branch_no_warning(from_status, to_status):
    assert check_backward_transition(COMPANY_STATUS_GRAPH, from_status, to_status) is None


# --- Company.status の判定（check_company_status_transition、インターン参加の例外を含む） ---


def test_company_transition_same_status_no_warning():
    for status in CompanyStatus:
        assert check_company_status_transition(status, status) is None


@pytest.mark.parametrize(
    ("from_status", "to_status"), [("選考中", "インターン参加"), ("インターン参加", "選考中")]
)
def test_company_transition_between_in_progress_and_internship_no_warning(
    from_status, to_status
):
    assert check_company_status_transition(from_status, to_status) is None


@pytest.mark.parametrize("to_status", ["内定", "お見送り", "辞退"])
def test_company_transition_from_internship_no_warning(to_status):
    assert check_company_status_transition("インターン参加", to_status) is None


@pytest.mark.parametrize("from_status", ["内定", "お見送り", "辞退"])
def test_company_transition_finished_to_internship_returns_warning(from_status):
    assert (
        check_company_status_transition(from_status, "インターン参加")
        == f"{from_status} から インターン参加 への変更です。意図的な変更か確認してください。"
    )


@pytest.mark.parametrize(
    ("from_status", "to_status", "expected_warning"),
    [
        ("選考中", "内定", False),
        ("選考中", "お見送り", False),
        ("選考中", "辞退", False),
        ("内定", "辞退", False),
        ("内定", "お見送り", False),
        ("お見送り", "内定", False),
        ("お見送り", "辞退", False),
        ("辞退", "お見送り", False),
        ("内定", "選考中", True),
        ("お見送り", "選考中", True),
        ("辞退", "選考中", True),
        ("辞退", "内定", True),
    ],
)
def test_company_transition_existing_rules_unchanged(from_status, to_status, expected_warning):
    warning = check_company_status_transition(from_status, to_status)
    if expected_warning:
        assert warning == (
            f"{from_status} から {to_status} への変更です。意図的な変更か確認してください。"
        )
    else:
        assert warning is None


def test_internship_exception_is_not_part_of_the_shared_graph_check():
    # 例外は企業の選考状態の判定に限るため、共通関数とグラフそのものは従来の判定のまま
    assert check_backward_transition(COMPANY_STATUS_GRAPH, "選考中", "インターン参加") is not None
