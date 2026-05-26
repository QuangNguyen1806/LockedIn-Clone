import json
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.deps import get_current_user
from app.database import get_db
from app.models import AiOutput, Document, JobQueue, Session, SessionStatus, SessionSummary, TranscriptSegment, User
from app.schemas import (
    AiOutputResponse,
    CreateSessionRequest,
    MetricsResponse,
    SessionConfigSchema,
    SessionDetailResponse,
    SessionResponse,
    SessionSummaryResponse,
    TranscriptSegmentResponse,
    UpdateSessionRequest,
)

router = APIRouter(prefix="/sessions", tags=["sessions"])


def session_config(session: Session) -> SessionConfigSchema:
    return SessionConfigSchema(
        mode=session.mode,
        company=session.company,
        role=session.role,
        tone=session.tone,
        customInstructions=session.custom_instructions,
        resumeContext=session.resume_context,
        jobDescriptionContext=session.job_description_context,
    )


def session_to_response(session: Session, question_count: int = 0) -> SessionResponse:
    return SessionResponse(
        id=session.id,
        userId=session.user_id,
        title=session.title,
        status=session.status,
        strategy=session.strategy or "live_answer",
        config=session_config(session),
        startedAt=session.started_at,
        endedAt=session.ended_at,
        createdAt=session.created_at,
        updatedAt=session.updated_at,
        questionCount=question_count,
    )


async def latest_document_text(db: AsyncSession, user_id: str, kind: str) -> str | None:
    result = await db.execute(
        select(Document)
        .where(Document.user_id == user_id, Document.kind == kind, Document.parsed_text.isnot(None))
        .order_by(Document.created_at.desc())
        .limit(1)
    )
    doc = result.scalar_one_or_none()
    return doc.parsed_text if doc else None


@router.get("", response_model=list[SessionResponse])
async def list_sessions(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Session).where(Session.user_id == user.id).order_by(Session.created_at.desc())
    )
    sessions = result.scalars().all()
    session_ids = [session.id for session in sessions]
    counts: dict[str, int] = {}
    if session_ids:
        count_rows = await db.execute(
            select(AiOutput.session_id, func.count())
            .where(
                AiOutput.session_id.in_(session_ids),
                AiOutput.kind.in_(["suggestion", "critique"]),
            )
            .group_by(AiOutput.session_id)
        )
        counts = {row[0]: int(row[1]) for row in count_rows.all()}
    return [session_to_response(session, counts.get(session.id, 0)) for session in sessions]


@router.post("", response_model=SessionResponse)
async def create_session(
    body: CreateSessionRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    resume_context = body.config.resumeContext
    job_description_context = body.config.jobDescriptionContext
    if not resume_context:
        resume_context = await latest_document_text(db, user.id, "resume")
    if not job_description_context:
        job_description_context = await latest_document_text(db, user.id, "job_description")

    session = Session(
        user_id=user.id,
        title=body.title,
        status=SessionStatus.draft.value,
        mode=body.config.mode,
        company=body.config.company,
        role=body.config.role,
        tone=body.config.tone,
        custom_instructions=body.config.customInstructions,
        resume_context=resume_context,
        job_description_context=job_description_context,
        strategy=body.strategy or "live_answer",
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return session_to_response(session)


@router.get("/metrics", response_model=MetricsResponse)
async def session_metrics(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    total = await db.scalar(select(func.count()).select_from(Session).where(Session.user_id == user.id))
    completed = await db.scalar(
        select(func.count())
        .select_from(Session)
        .where(Session.user_id == user.id, Session.status == SessionStatus.completed.value)
    )
    sessions = (
        await db.execute(
            select(Session).where(
                Session.user_id == user.id,
                Session.started_at.isnot(None),
                Session.ended_at.isnot(None),
            )
        )
    ).scalars().all()
    duration_minutes = 0
    durations: list[int] = []
    for s in sessions:
        if s.started_at and s.ended_at:
            minutes = int((s.ended_at - s.started_at).total_seconds() // 60)
            duration_minutes += minutes
            durations.append(minutes)

    question_count = await db.scalar(
        select(func.count())
        .select_from(AiOutput)
        .join(Session, AiOutput.session_id == Session.id)
        .where(Session.user_id == user.id, AiOutput.kind == "suggestion")
    )

    now = datetime.now(timezone.utc)
    sessions_by_week: list[dict] = []
    for week_offset in range(4):
        week_start = now - timedelta(days=7 * (week_offset + 1))
        week_end = now - timedelta(days=7 * week_offset)
        count = await db.scalar(
            select(func.count())
            .select_from(Session)
            .where(
                Session.user_id == user.id,
                Session.created_at >= week_start,
                Session.created_at < week_end,
            )
        )
        sessions_by_week.append(
            {
                "weekStart": week_start.date().isoformat(),
                "count": count or 0,
            }
        )

    avg_duration = round(sum(durations) / len(durations), 1) if durations else 0
    return MetricsResponse(
        totalSessions=total or 0,
        completedSessions=completed or 0,
        totalDurationMinutes=duration_minutes,
        sessionsByWeek=list(reversed(sessions_by_week)),
        avgDuration=avg_duration,
        questionsAnswered=question_count or 0,
    )


@router.get("/{session_id}", response_model=SessionDetailResponse)
async def get_session(
    session_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Session)
        .options(
            selectinload(Session.transcript_segments),
            selectinload(Session.ai_outputs),
            selectinload(Session.summary),
        )
        .where(Session.id == session_id, Session.user_id == user.id)
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    summary = None
    if session.summary:
        summary = SessionSummaryResponse(
            id=session.summary.id,
            sessionId=session.summary.session_id,
            summary=session.summary.summary,
            questions=json.loads(session.summary.questions_json),
            feedbackBullets=json.loads(session.summary.feedback_json),
            promptVersion=session.summary.prompt_version,
            createdAt=session.summary.created_at,
        )

    return SessionDetailResponse(
        **session_to_response(
            session,
            sum(1 for output in session.ai_outputs if output.kind in ("suggestion", "critique")),
        ).model_dump(),
        transcript=[
            TranscriptSegmentResponse(
                id=t.id,
                sessionId=t.session_id,
                speaker=t.speaker,
                text=t.text,
                isFinal=t.is_final,
                timestampMs=t.timestamp_ms,
                createdAt=t.created_at,
            )
            for t in session.transcript_segments
        ],
        aiOutputs=[
            AiOutputResponse(
                id=o.id,
                sessionId=o.session_id,
                kind=o.kind,
                content=o.content,
                promptVersion=o.prompt_version,
                createdAt=o.created_at,
            )
            for o in session.ai_outputs
        ],
        summary=summary,
    )


@router.patch("/{session_id}", response_model=SessionResponse)
async def update_session(
    session_id: str,
    body: UpdateSessionRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Session).where(Session.id == session_id, Session.user_id == user.id)
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if body.mode is not None:
        session.mode = body.mode
    if body.tone is not None:
        session.tone = body.tone
    if body.customInstructions is not None:
        session.custom_instructions = body.customInstructions
    if body.company is not None:
        session.company = body.company
    if body.role is not None:
        session.role = body.role
    await db.commit()
    await db.refresh(session)
    return session_to_response(session)


@router.post("/{session_id}/start", response_model=SessionResponse)
async def start_session(
    session_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Session).where(Session.id == session_id, Session.user_id == user.id)
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    session.status = SessionStatus.active.value
    session.started_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(session)
    return session_to_response(session)


@router.post("/{session_id}/end", response_model=SessionResponse)
async def end_session(
    session_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Session)
        .options(selectinload(Session.transcript_segments), selectinload(Session.ai_outputs))
        .where(Session.id == session_id, Session.user_id == user.id)
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    session.status = SessionStatus.completed.value
    session.ended_at = datetime.now(timezone.utc)
    await enqueue_summarize(db, session.id)
    await db.commit()
    if user.delete_data_on_session_end:
        for segment in list(session.transcript_segments):
            await db.delete(segment)
        for output in list(session.ai_outputs):
            await db.delete(output)
        await db.commit()
    await db.refresh(session)
    return session_to_response(session)


@router.post("/{session_id}/refresh-context", response_model=SessionResponse)
async def refresh_session_context(
    session_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Session).where(Session.id == session_id, Session.user_id == user.id)
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    resume_context = await latest_document_text(db, user.id, "resume")
    job_description_context = await latest_document_text(db, user.id, "job_description")
    if resume_context:
        session.resume_context = resume_context[:4000]
    if job_description_context:
        session.job_description_context = job_description_context[:4000]
    await db.commit()
    await db.refresh(session)
    return session_to_response(session)


@router.delete("/{session_id}")
async def delete_session(
    session_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Session).where(Session.id == session_id, Session.user_id == user.id)
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    await db.delete(session)
    await db.commit()
    return {"ok": True}


async def enqueue_summarize(db: AsyncSession, session_id: str) -> None:
    job = JobQueue(
        job_type="summarize_session",
        payload_json=json.dumps({"session_id": session_id}),
        status="pending",
    )
    db.add(job)
