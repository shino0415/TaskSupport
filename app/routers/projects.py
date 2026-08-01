"""案件（Project）の作成・参照・削除エンドポイント。

ステータス更新（PATCH）は別タスクで扱うため、ここには含めない。
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app import models
from app.database import get_db
from app.schemas import ProjectCreate, ProjectRead, ProjectStatus

router = APIRouter(prefix="/projects", tags=["projects"])


def _get_active_project_or_404(db: Session, project_id: int) -> models.Project:
    project = (
        db.query(models.Project)
        .filter(models.Project.id == project_id, models.Project.is_deleted.is_(False))
        .first()
    )
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return project


@router.post("", response_model=ProjectRead, status_code=status.HTTP_201_CREATED)
def create_project(payload: ProjectCreate, db: Session = Depends(get_db)) -> models.Project:
    project = models.Project(**payload.model_dump())
    db.add(project)
    db.commit()
    return project


@router.get("", response_model=list[ProjectRead])
def list_projects(
    project_status: ProjectStatus | None = Query(default=None, alias="status"),
    db: Session = Depends(get_db),
) -> list[models.Project]:
    query = db.query(models.Project).filter(models.Project.is_deleted.is_(False))
    if project_status is not None:
        query = query.filter(models.Project.status == project_status)
    return query.all()


@router.get("/{project_id}", response_model=ProjectRead)
def get_project(project_id: int, db: Session = Depends(get_db)) -> models.Project:
    return _get_active_project_or_404(db, project_id)


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project(project_id: int, db: Session = Depends(get_db)) -> None:
    project = _get_active_project_or_404(db, project_id)
    project.is_deleted = True
    db.commit()
