"""案件（Project）の作成・参照・更新・削除エンドポイント。"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app import models
from app.database import get_db
from app.schemas import (
    ProjectCreate,
    ProjectPatchResponse,
    ProjectRead,
    ProjectStatus,
    ProjectUpdate,
)
from app.status_transitions import PROJECT_STATUS_GRAPH, check_backward_transition

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


@router.patch("/{project_id}", response_model=ProjectPatchResponse)
def update_project(
    project_id: int, payload: ProjectUpdate, db: Session = Depends(get_db)
) -> ProjectPatchResponse:
    project = _get_active_project_or_404(db, project_id)

    # exclude_unsetにより、リクエストに含まれなかったフィールドと明示的なnull
    # （deadline/memoのクリア）を区別する。
    update_data = payload.model_dump(exclude_unset=True)

    warning = None
    if "status" in update_data and update_data["status"] != project.status:
        warning = check_backward_transition(
            PROJECT_STATUS_GRAPH, project.status, update_data["status"]
        )

    for field, value in update_data.items():
        setattr(project, field, value)
    db.commit()
    db.refresh(project)

    return ProjectPatchResponse(**ProjectRead.model_validate(project).model_dump(), warning=warning)


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project(project_id: int, db: Session = Depends(get_db)) -> None:
    project = _get_active_project_or_404(db, project_id)
    project.is_deleted = True
    db.commit()
