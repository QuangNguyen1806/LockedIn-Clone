import json
import os
import uuid
from pathlib import Path

import aiofiles
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import resolve_storage_path, settings
from app.deps import get_current_user
from app.database import get_db
from app.models import Document, JobQueue, User
from app.schemas import DocumentResponse

router = APIRouter(prefix="/documents", tags=["documents"])


def doc_to_response(doc: Document) -> DocumentResponse:
    return DocumentResponse(
        id=doc.id,
        userId=doc.user_id,
        kind=doc.kind,
        filename=doc.filename,
        parseStatus=doc.parse_status,
        parsedText=doc.parsed_text,
        createdAt=doc.created_at,
    )


@router.get("", response_model=list[DocumentResponse])
async def list_documents(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Document).where(Document.user_id == user.id).order_by(Document.created_at.desc())
    )
    return [doc_to_response(d) for d in result.scalars().all()]


@router.post("", response_model=DocumentResponse)
async def upload_document(
    kind: str = Form(...),
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if kind not in ("resume", "job_description"):
        raise HTTPException(status_code=400, detail="Invalid document kind")

    upload_root = Path(settings.upload_dir)
    upload_root.mkdir(parents=True, exist_ok=True)

    ext = Path(file.filename or "upload").suffix
    storage_name = f"{uuid.uuid4()}{ext}"
    storage_path = upload_root / storage_name

    content = await file.read()
    max_bytes = settings.max_upload_mb * 1024 * 1024
    if len(content) > max_bytes:
        raise HTTPException(status_code=400, detail="File too large")

    async with aiofiles.open(storage_path, "wb") as f:
        await f.write(content)

    doc = Document(
        user_id=user.id,
        kind=kind,
        filename=file.filename or storage_name,
        storage_path=str(storage_path.resolve()),
        parse_status="pending",
    )
    db.add(doc)
    await db.flush()

    job = JobQueue(
        job_type="parse_document",
        payload_json=json.dumps({"document_id": doc.id}),
        status="pending",
    )
    db.add(job)
    await db.commit()
    await db.refresh(doc)
    return doc_to_response(doc)


@router.post("/{document_id}/reparse", response_model=DocumentResponse)
async def reparse_document(
    document_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Document).where(Document.id == document_id, Document.user_id == user.id)
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if not resolve_storage_path(doc.storage_path).exists():
        raise HTTPException(status_code=400, detail="Stored file is missing. Upload the document again.")

    doc.parse_status = "pending"
    doc.parsed_text = None
    job = JobQueue(
        job_type="parse_document",
        payload_json=json.dumps({"document_id": doc.id}),
        status="pending",
    )
    db.add(job)
    await db.commit()
    await db.refresh(doc)
    return doc_to_response(doc)


@router.delete("/{document_id}")
async def delete_document(
    document_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Document).where(Document.id == document_id, Document.user_id == user.id)
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    if os.path.exists(doc.storage_path):
        os.remove(resolve_storage_path(doc.storage_path))
    await db.delete(doc)
    await db.commit()
    return {"ok": True}
