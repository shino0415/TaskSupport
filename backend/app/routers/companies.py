"""企業（Company）の作成・参照・更新・削除エンドポイント。"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import models
from app.database import get_db
from app.routers.ids import is_storable_id
from app.schemas import CompanyCreate, CompanyPatchResponse, CompanyRead, CompanyUpdate
from app.status_transitions import COMPANY_STATUS_GRAPH, check_backward_transition

router = APIRouter(prefix="/companies", tags=["companies"])


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


@router.post("", response_model=CompanyRead, status_code=status.HTTP_201_CREATED)
def create_company(payload: CompanyCreate, db: Session = Depends(get_db)) -> models.Company:
    company = models.Company(**payload.model_dump())
    db.add(company)
    db.commit()
    return company


@router.get("", response_model=list[CompanyRead])
def list_companies(db: Session = Depends(get_db)) -> list[models.Company]:
    return db.query(models.Company).filter(models.Company.is_deleted.is_(False)).all()


@router.get("/{company_id}", response_model=CompanyRead)
def get_company(company_id: int, db: Session = Depends(get_db)) -> models.Company:
    return _get_active_company_or_404(db, company_id)


@router.patch("/{company_id}", response_model=CompanyPatchResponse)
def update_company(
    company_id: int, payload: CompanyUpdate, db: Session = Depends(get_db)
) -> CompanyPatchResponse:
    company = _get_active_company_or_404(db, company_id)

    update_data = payload.model_dump(exclude_unset=True)

    warning = None
    if "status" in update_data and update_data["status"] != company.status:
        warning = check_backward_transition(
            COMPANY_STATUS_GRAPH, company.status, update_data["status"]
        )

    for field, value in update_data.items():
        setattr(company, field, value)
    db.commit()
    db.refresh(company)

    return CompanyPatchResponse(
        **CompanyRead.model_validate(company).model_dump(), warning=warning
    )


@router.delete("/{company_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_company(company_id: int, db: Session = Depends(get_db)) -> None:
    company = _get_active_company_or_404(db, company_id)
    company.is_deleted = True
    db.commit()
