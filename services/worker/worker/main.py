import json
import os
import sys
import time
from pathlib import Path

# Share API models and config with the worker process.
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "api"))

import structlog
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

structlog.configure(
    processors=[
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.JSONRenderer(),
    ]
)
logger = structlog.get_logger()

API_ROOT = Path(__file__).resolve().parents[2] / "api"
DEFAULT_DB_PATH = API_ROOT / "lockedin.db"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=[".env", "../../.env"],
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url_sync: str = f"sqlite:///{DEFAULT_DB_PATH}"
    worker_poll_interval: int = 5
    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"
    use_mock_ai: bool = True


settings = Settings()
engine = create_engine(settings.database_url_sync)
SessionLocal = sessionmaker(bind=engine)


def parse_document_text(path: str) -> str:
    ext = Path(path).suffix.lower()
    if ext == ".pdf":
        from pypdf import PdfReader

        reader = PdfReader(path)
        return "\n".join(page.extract_text() or "" for page in reader.pages)
    if ext in (".docx", ".doc"):
        from docx import Document as DocxDocument

        doc = DocxDocument(path)
        return "\n".join(p.text for p in doc.paragraphs if p.text.strip())
    if ext in (".txt", ".md"):
        return Path(path).read_text(encoding="utf-8", errors="ignore")
    return Path(path).read_text(encoding="utf-8", errors="ignore")


def generate_summary(transcript: str) -> dict:
    from app.config import settings
    from app.services.gemini import gemini_generate_summary_sync

    if settings.use_mock_ai or settings.active_llm_provider == "mock":
        return {
            "summary": "Session covered key behavioral themes with opportunities to tighten examples.",
            "questions": ["Tell me about yourself.", "Describe a challenging project."],
            "feedbackBullets": [
                "Lead with outcomes, not background.",
                "Use one strong example per answer.",
                "Practice smoother transitions between topics.",
            ],
        }

    system = (
        "Analyze completed interview sessions. Return JSON with keys: "
        "summary, questions, feedbackBullets (3-5 items)."
    )

    if settings.active_llm_provider == "gemini":
        return gemini_generate_summary_sync(system, transcript)

    import httpx

    with httpx.Client(timeout=60.0) as client:
        resp = client.post(
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {settings.openai_api_key}"},
            json={
                "model": settings.openai_model,
                "response_format": {"type": "json_object"},
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": transcript},
                ],
            },
        )
        resp.raise_for_status()
        return json.loads(resp.json()["choices"][0]["message"]["content"])


def process_parse_document(db: Session, payload: dict) -> None:
    from app.config import resolve_storage_path
    from app.models import Document

    doc_id = payload["document_id"]
    doc = db.get(Document, doc_id)
    if not doc:
        return
    doc.parse_status = "processing"
    db.commit()
    try:
        storage_path = resolve_storage_path(doc.storage_path)
        if not storage_path.exists():
            raise FileNotFoundError(f"File not found: {storage_path}")
        text = parse_document_text(str(storage_path))
        doc.parsed_text = text[:50000]
        doc.parse_status = "completed"

        user_docs = db.execute(
            select(Document).where(Document.user_id == doc.user_id, Document.parse_status == "completed")
        ).scalars().all()
        resume_text = next((d.parsed_text for d in user_docs if d.kind == "resume" and d.parsed_text), None)
        jd_text = next(
            (d.parsed_text for d in user_docs if d.kind == "job_description" and d.parsed_text), None
        )
        if resume_text or jd_text:
            from app.models import Session as SessionModel

            sessions = db.execute(
                select(SessionModel).where(SessionModel.user_id == doc.user_id)
            ).scalars().all()
            for session in sessions:
                if resume_text and not session.resume_context:
                    session.resume_context = resume_text[:4000]
                if jd_text and not session.job_description_context:
                    session.job_description_context = jd_text[:4000]
    except Exception as exc:
        doc.parse_status = "failed"
        logger.error("parse_document_failed", document_id=doc_id, error=str(exc))
    db.commit()


def process_summarize_session(db: Session, payload: dict) -> None:
    from app.models import Session as SessionModel
    from app.models import SessionSummary, TranscriptSegment

    session_id = payload["session_id"]
    session = db.get(SessionModel, session_id)
    if not session:
        return

    existing = db.execute(
        select(SessionSummary).where(SessionSummary.session_id == session_id)
    ).scalar_one_or_none()
    if existing:
        return

    segments = db.execute(
        select(TranscriptSegment)
        .where(TranscriptSegment.session_id == session_id)
        .order_by(TranscriptSegment.created_at.asc())
    ).scalars().all()
    transcript = "\n".join(f"{s.speaker}: {s.text}" for s in segments)
    result = generate_summary(transcript)

    summary = SessionSummary(
        session_id=session_id,
        summary=result.get("summary", ""),
        questions_json=json.dumps(result.get("questions", [])),
        feedback_json=json.dumps(result.get("feedbackBullets", [])),
        prompt_version="v1",
    )
    db.add(summary)
    db.commit()
    logger.info("summary_created", session_id=session_id)


def process_jobs() -> None:
    from app.models import JobQueue

    with SessionLocal() as db:
        jobs = db.execute(
            select(JobQueue).where(JobQueue.status == "pending").order_by(JobQueue.created_at.asc()).limit(5)
        ).scalars().all()
        for job in jobs:
            job.status = "processing"
            job.attempts += 1
            db.commit()
            payload = json.loads(job.payload_json)
            try:
                if job.job_type == "parse_document":
                    process_parse_document(db, payload)
                elif job.job_type == "summarize_session":
                    process_summarize_session(db, payload)
                job.status = "completed"
            except Exception as exc:
                job.status = "failed"
                job.last_error = str(exc)
                logger.error("job_failed", job_id=job.id, error=str(exc))
            db.commit()


def main() -> None:
    logger.info("worker_started")
    while True:
        try:
            process_jobs()
        except Exception as exc:
            logger.error("worker_loop_error", error=str(exc))
        time.sleep(settings.worker_poll_interval)


if __name__ == "__main__":
    main()
