"""企業タスク（CompanyTask）の作成・参照・更新・削除エンドポイント。

稼働ログ（WorkLog）・時給換算に関するエンドポイントは持たない（決定事項
「企業タスク（CompanyTask）の稼働ログ対象範囲」参照）。ステータスはTask
（案件配下）と同一集合のため、既存のTASK_STATUS_GRAPHをそのまま再利用する。
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import models
from app.database import get_db
from app.schemas import (
    CompanyTaskCreate,
    CompanyTaskPatchResponse,
    CompanyTaskRead,
    CompanyTaskUpdate,
)
from app.status_transitions import TASK_STATUS_GRAPH, check_backward_transition

router = APIRouter(tags=["company-tasks"])


def _get_active_company_or_404(db: Session, company_id: int) -> models.Company:
    company = (
        db.query(models.Company)
        .filter(models.Company.id == company_id, models.Company.is_deleted.is_(False))
        .first()
    )
    if company is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Company not found")
    return company


def _get_active_company_task_or_404(db: Session, company_task_id: int) -> models.CompanyTask:
    company_task = (
        db.query(models.CompanyTask)
        .filter(
            models.CompanyTask.id == company_task_id,
            models.CompanyTask.is_deleted.is_(False),
        )
        .first()
    )
    if company_task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="CompanyTask not found")
    return company_task


@router.post(
    "/companies/{company_id}/company-tasks",
    response_model=CompanyTaskRead,
    status_code=status.HTTP_201_CREATED,
)
def create_company_task(
    company_id: int, payload: CompanyTaskCreate, db: Session = Depends(get_db)
) -> models.CompanyTask:
    _get_active_company_or_404(db, company_id)
    company_task = models.CompanyTask(company_id=company_id, **payload.model_dump())
    db.add(company_task)
    db.commit()
    return company_task


@router.get(
    "/companies/{company_id}/company-tasks",
    response_model=list[CompanyTaskRead],
)
def list_company_tasks(
    company_id: int, db: Session = Depends(get_db)
) -> list[models.CompanyTask]:
    _get_active_company_or_404(db, company_id)
    return (
        db.query(models.CompanyTask)
        .filter(
            models.CompanyTask.company_id == company_id,
            models.CompanyTask.is_deleted.is_(False),
        )
        .all()
    )


@router.patch("/company-tasks/{company_task_id}", response_model=CompanyTaskPatchResponse)
def update_company_task(
    company_task_id: int, payload: CompanyTaskUpdate, db: Session = Depends(get_db)
) -> CompanyTaskPatchResponse:
    company_task = _get_active_company_task_or_404(db, company_task_id)

    update_data = payload.model_dump(exclude_unset=True)

    warning = None
    if "status" in update_data and update_data["status"] != company_task.status:
        warning = check_backward_transition(
            TASK_STATUS_GRAPH, company_task.status, update_data["status"]
        )

    for field, value in update_data.items():
        setattr(company_task, field, value)
    db.commit()
    db.refresh(company_task)

    return CompanyTaskPatchResponse(
        **CompanyTaskRead.model_validate(company_task).model_dump(), warning=warning
    )


@router.delete("/company-tasks/{company_task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_company_task(company_task_id: int, db: Session = Depends(get_db)) -> None:
    company_task = _get_active_company_task_or_404(db, company_task_id)
    company_task.is_deleted = True
    db.commit()
