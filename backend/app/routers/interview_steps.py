"""選考ステップ（InterviewStep）の作成・参照・更新・削除エンドポイント。"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import models
from app.database import get_db
from app.routers.ids import is_storable_id
from app.schemas import (
    InterviewStepCreate,
    InterviewStepPatchResponse,
    InterviewStepRead,
    InterviewStepUpdate,
)
from app.status_transitions import (
    INTERVIEW_STEP_PREP_STATUS_GRAPH,
    INTERVIEW_STEP_RESULT_GRAPH,
    CompanyStatus,
    InterviewStepPrepStatus,
    InterviewStepResult,
    check_backward_transition,
)

router = APIRouter(tags=["interview-steps"])

# 予定日の近い順で、予定日なしは末尾。同じ予定日同士の前後は問わない。
# 企業一覧の次回選考（next_step）も同じ規則で選ぶため共有する。
UPCOMING_ORDER = (models.InterviewStep.date.is_(None), models.InterviewStep.date.asc())


def _get_active_company_or_404(db: Session, company_id: int) -> models.Company:
    company = None
    if is_storable_id(company_id):
        company = (
            db.query(models.Company)
            .filter(models.Company.id == company_id, models.Company.is_deleted.is_(False))
            .first()
        )
    if company is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Company not found")
    return company


def _get_active_interview_step_or_404(db: Session, interview_step_id: int) -> models.InterviewStep:
    interview_step = None
    if is_storable_id(interview_step_id):
        interview_step = (
            db.query(models.InterviewStep)
            .filter(
                models.InterviewStep.id == interview_step_id,
                models.InterviewStep.is_deleted.is_(False),
            )
            .first()
        )
    if interview_step is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="InterviewStep not found"
        )
    return interview_step


def _reject_company_if_in_progress(company: models.Company) -> None:
    # 内定・お見送り・辞退の企業は上書きしない。commitは呼び出し元で選考ステップの
    # 変更と一緒に行い、どちらか一方だけが反映されないようにする。
    if company.status in (CompanyStatus.選考中, CompanyStatus.インターン参加):
        company.status = CompanyStatus.お見送り


@router.post(
    "/companies/{company_id}/interview-steps",
    response_model=InterviewStepRead,
    status_code=status.HTTP_201_CREATED,
)
def create_interview_step(
    company_id: int, payload: InterviewStepCreate, db: Session = Depends(get_db)
) -> models.InterviewStep:
    company = _get_active_company_or_404(db, company_id)
    interview_step = models.InterviewStep(company_id=company_id, **payload.model_dump())
    db.add(interview_step)
    if payload.result == InterviewStepResult.不通過:
        _reject_company_if_in_progress(company)
    db.commit()
    return interview_step


@router.get(
    "/companies/{company_id}/interview-steps",
    response_model=list[InterviewStepRead],
)
def list_interview_steps(
    company_id: int, db: Session = Depends(get_db)
) -> list[models.InterviewStep]:
    _get_active_company_or_404(db, company_id)
    return (
        db.query(models.InterviewStep)
        .filter(
            models.InterviewStep.company_id == company_id,
            models.InterviewStep.is_deleted.is_(False),
        )
        .all()
    )


@router.get("/interview-steps/upcoming", response_model=list[InterviewStepRead])
def list_upcoming_interview_steps(db: Session = Depends(get_db)) -> list[models.InterviewStep]:
    # 予定日(date)が未設定のステップは、締切管理という目的上「日程が近いもの」
    # ではないため除外はせず、一覧の末尾にまとめて含める（並び順の一貫性のため、
    # NULLかどうかを第一キー、dateを第二キーにして昇順ソートする）。
    # 親企業が論理削除済みの場合、企業経由(GET /companies/{id}/interview-steps)では
    # 404となり参照不能になるため、一貫性のため本エンドポイントでも除外する。
    # 結果が出た・準備が完了した・選考が終わった企業のステップは「予定」ではないため外す。
    # 予定日が過ぎていても結果が未定なら残す。next_stepにはこの絞り込みを入れない。
    return (
        db.query(models.InterviewStep)
        .join(models.Company, models.InterviewStep.company_id == models.Company.id)
        .filter(
            models.InterviewStep.is_deleted.is_(False),
            models.Company.is_deleted.is_(False),
            models.InterviewStep.result == InterviewStepResult.未定,
            models.InterviewStep.prep_status != InterviewStepPrepStatus.完了,
            models.Company.status.in_((CompanyStatus.選考中, CompanyStatus.インターン参加)),
        )
        .order_by(*UPCOMING_ORDER)
        .all()
    )


@router.patch("/interview-steps/{interview_step_id}", response_model=InterviewStepPatchResponse)
def update_interview_step(
    interview_step_id: int, payload: InterviewStepUpdate, db: Session = Depends(get_db)
) -> InterviewStepPatchResponse:
    interview_step = _get_active_interview_step_or_404(db, interview_step_id)

    update_data = payload.model_dump(exclude_unset=True)

    # prep_status・resultは独立した2つの状態遷移グラフを持つため、それぞれ
    # 個別に警告判定する。両方が同時に逆行した場合、警告メッセージを" / "区切りで
    # 1つのwarning文字列にまとめる（他のPatchResponseとの一貫性のためwarningの型は
    # str | Noneのまま維持し、list型に変えない技術判断。詳細はspec.md参照）。
    warnings: list[str] = []
    if (
        "prep_status" in update_data
        and update_data["prep_status"] != interview_step.prep_status
    ):
        prep_status_warning = check_backward_transition(
            INTERVIEW_STEP_PREP_STATUS_GRAPH,
            interview_step.prep_status,
            update_data["prep_status"],
        )
        if prep_status_warning is not None:
            warnings.append(prep_status_warning)
    if "result" in update_data and update_data["result"] != interview_step.result:
        result_warning = check_backward_transition(
            INTERVIEW_STEP_RESULT_GRAPH, interview_step.result, update_data["result"]
        )
        if result_warning is not None:
            warnings.append(result_warning)
    warning = " / ".join(warnings) if warnings else None

    # 不通過のまま更新した場合は対象外（手動で選考中に戻した企業を再びお見送りにしない）
    if (
        update_data.get("result") == InterviewStepResult.不通過
        and interview_step.result != InterviewStepResult.不通過
    ):
        _reject_company_if_in_progress(db.get_one(models.Company, interview_step.company_id))

    for field, value in update_data.items():
        setattr(interview_step, field, value)
    db.commit()
    db.refresh(interview_step)

    return InterviewStepPatchResponse(
        **InterviewStepRead.model_validate(interview_step).model_dump(), warning=warning
    )


@router.delete("/interview-steps/{interview_step_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_interview_step(interview_step_id: int, db: Session = Depends(get_db)) -> None:
    interview_step = _get_active_interview_step_or_404(db, interview_step_id)
    interview_step.is_deleted = True
    db.commit()
