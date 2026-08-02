"""選考ステップ（InterviewStep）の作成・参照・削除エンドポイント。

更新（PATCH、prep_status/resultの逆行遷移警告含む）は別タスクで扱う。
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import models
from app.database import get_db
from app.schemas import InterviewStepCreate, InterviewStepRead

router = APIRouter(tags=["interview-steps"])


def _get_active_company_or_404(db: Session, company_id: int) -> models.Company:
    company = (
        db.query(models.Company)
        .filter(models.Company.id == company_id, models.Company.is_deleted.is_(False))
        .first()
    )
    if company is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Company not found")
    return company


def _get_active_interview_step_or_404(db: Session, interview_step_id: int) -> models.InterviewStep:
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


@router.post(
    "/companies/{company_id}/interview-steps",
    response_model=InterviewStepRead,
    status_code=status.HTTP_201_CREATED,
)
def create_interview_step(
    company_id: int, payload: InterviewStepCreate, db: Session = Depends(get_db)
) -> models.InterviewStep:
    _get_active_company_or_404(db, company_id)
    interview_step = models.InterviewStep(company_id=company_id, **payload.model_dump())
    db.add(interview_step)
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


@router.delete("/interview-steps/{interview_step_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_interview_step(interview_step_id: int, db: Session = Depends(get_db)) -> None:
    interview_step = _get_active_interview_step_or_404(db, interview_step_id)
    interview_step.is_deleted = True
    db.commit()
