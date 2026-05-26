import json
import re
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import decode_token
from app.database import AsyncSessionLocal
from app.logging_config import logger
from app.models import AiOutput, JobQueue, Session, SessionStatus, TranscriptSegment, User
from app.services.ai import LLMService, STTService, TranscriptResult

router = APIRouter(tags=["realtime"])

PROMPT_VERSION = "v2"
MIN_FINAL_CHARS = 8

QUESTION_PATTERNS = (
    r"\?",
    r"\bwhat\b",
    r"\bwhy\b",
    r"\bhow\b",
    r"\bwhen\b",
    r"\bwhere\b",
    r"\bwho\b",
    r"\bwhich\b",
    r"\btell me\b",
    r"\bdescribe\b",
    r"\bwalk me\b",
    r"\bexplain\b",
    r"\bcan you\b",
    r"\bcould you\b",
)


def looks_like_question(text: str) -> bool:
    lowered = text.lower().strip()
    return any(re.search(pattern, lowered) for pattern in QUESTION_PATTERNS)


def build_system_prompt(session: Session) -> str:
    if session.strategy == "critique":
        parts = [
            "You are a real-time interview practice coach.",
            "Evaluate the user's spoken answer to the practice question.",
            "Respond with concise feedback bullets covering clarity, structure, and impact.",
            "Be constructive and specific.",
        ]
        tone_map = {
            "concise": "Keep feedback brief.",
            "conversational": "Use a supportive conversational tone.",
            "star": "Evaluate STAR structure explicitly.",
        }
        parts.append(tone_map.get(session.tone, tone_map["conversational"]))
        if session.custom_instructions:
            parts.append(f"Practice context: {session.custom_instructions}")
        return "\n".join(parts)

    tone_map = {
        "concise": "Keep answers brief and direct, under 120 words.",
        "conversational": "Use a natural, conversational tone.",
        "star": "Use STAR structure for behavioral answers.",
    }
    parts = [
        "You are a real-time interview and meeting copilot.",
        "When you detect a question directed at the user, respond immediately with:",
        "1) A suggested answer they can say aloud in first person.",
        "2) Two or three short bullet talking points.",
        "Be specific, practical, and grounded in the user's context when available.",
        tone_map.get(session.tone, tone_map["conversational"]),
    ]
    if session.mode == "behavioral":
        parts.append("Focus on behavioral interview questions.")
    elif session.mode == "technical":
        parts.append("Focus on technical interview questions with clear reasoning.")
    else:
        parts.append("Focus on professional meeting questions and discussion points.")
    if session.company:
        parts.append(f"Target company: {session.company}")
    if session.role:
        parts.append(f"Target role: {session.role}")
    if session.custom_instructions:
        parts.append(f"User instructions: {session.custom_instructions}")
    return "\n".join(parts)


def build_user_prompt(session: Session, latest_question: str, recent_lines: list[str]) -> str:
    parts = [
        "Latest question or prompt to answer:",
        latest_question,
        "",
        "Recent conversation:",
        "\n".join(recent_lines) or "(none)",
    ]
    if session.resume_context:
        parts.extend(["", "Resume context:", session.resume_context[:2000]])
    if session.job_description_context:
        parts.extend(["", "Job description:", session.job_description_context[:2000]])
    parts.append("\nProvide the suggested spoken answer now.")
    if session.strategy == "critique":
        parts[-1] = "\nProvide critique feedback bullets now."
    return "\n".join(parts)


async def emit(ws: WebSocket, event_type: str, session_id: str, payload: dict) -> None:
    await ws.send_json(
        {
            "type": event_type,
            "sessionId": session_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "payload": payload,
        }
    )


async def persist_and_emit_transcript(
    ws: WebSocket,
    db: AsyncSession,
    session_id: str,
    transcript: TranscriptResult,
) -> str:
    segment_id = str(uuid.uuid4())
    segment = TranscriptSegment(
        id=segment_id,
        session_id=session_id,
        speaker=transcript.speaker,
        text=transcript.text,
        is_final=transcript.is_final,
        timestamp_ms=int(datetime.now(timezone.utc).timestamp() * 1000),
    )
    db.add(segment)
    await db.commit()

    event_type = "transcript.final" if transcript.is_final else "transcript.partial"
    await emit(
        ws,
        event_type,
        session_id,
        {
            "segmentId": segment_id,
            "speaker": transcript.speaker,
            "text": transcript.text,
            "isFinal": transcript.is_final,
            "timestampMs": segment.timestamp_ms,
        },
    )
    return segment_id


async def generate_coaching(
    ws: WebSocket,
    db: AsyncSession,
    session: Session,
    session_id: str,
    latest_question: str,
    recent_transcript: list[str],
) -> None:
    output_id = str(uuid.uuid4())
    content_parts: list[str] = []
    system_prompt = build_system_prompt(session)
    user_prompt = build_user_prompt(session, latest_question, recent_transcript)

    async for token in LLMService().stream_coaching(system_prompt, user_prompt):
        content_parts.append(token)
        await emit(
            ws,
            "suggestion.partial",
            session_id,
            {
                "outputId": output_id,
                "content": "".join(content_parts),
                "isFinal": False,
            },
        )

    final_content = "".join(content_parts)
    output_kind = "critique" if session.strategy == "critique" else "suggestion"
    ai_output = AiOutput(
        id=output_id,
        session_id=session_id,
        kind=output_kind,
        content=final_content,
        prompt_version=PROMPT_VERSION,
    )
    db.add(ai_output)
    await db.commit()

    await emit(
        ws,
        "suggestion.final",
        session_id,
        {
            "outputId": output_id,
            "content": final_content,
            "isFinal": True,
        },
    )


async def enqueue_summarize(db: AsyncSession, session_id: str) -> None:
    job = JobQueue(
        job_type="summarize_session",
        payload_json=json.dumps({"session_id": session_id}),
        status="pending",
    )
    db.add(job)


async def flush_audio_buffer(
    ws: WebSocket,
    db: AsyncSession,
    session_id: str,
    stt: STTService,
    audio_buffer: list[str],
    encoding: str,
    sample_rate: int,
    process_final_question,
) -> None:
    if not audio_buffer:
        return
    combined = "".join(audio_buffer)
    audio_buffer.clear()
    try:
        transcript = await stt.transcribe_chunk(combined, sample_rate, encoding=encoding)
    except Exception as exc:
        logger.error("stt_failed", session_id=session_id, error=str(exc))
        await emit(
            ws,
            "error",
            session_id,
            {
                "code": "STT_ERROR",
                "message": str(exc),
                "recoverable": True,
            },
        )
        return
    if not transcript:
        return
    await persist_and_emit_transcript(ws, db, session_id, transcript)
    if transcript.is_final:
        await process_final_question(transcript.text, speaker=transcript.speaker or "interviewer")


@router.websocket("/ws/sessions/{session_id}")
async def session_websocket(websocket: WebSocket, session_id: str):
    token = websocket.query_params.get("token")
    if not token:
        await websocket.close(code=4401)
        return
    user_id = decode_token(token)
    if not user_id:
        await websocket.close(code=4401)
        return

    await websocket.accept()
    stt = STTService()
    recent_transcript: list[str] = []
    coaching_in_progress = False
    pending_question: str | None = None
    audio_buffer: list[str] = []
    last_partial_question = ""
    last_heard_text = ""
    last_encoding = "webm"
    last_sample_rate = 16000

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Session)
            .options(
                selectinload(Session.user),
                selectinload(Session.transcript_segments),
                selectinload(Session.ai_outputs),
            )
            .where(Session.id == session_id, Session.user_id == user_id)
        )
        session = result.scalar_one_or_none()
        if not session:
            await emit(
                websocket,
                "error",
                session_id,
                {"code": "NOT_FOUND", "message": "Session not found", "recoverable": False},
            )
            await websocket.close(code=4404)
            return

        if session.status == SessionStatus.draft.value:
            session.status = SessionStatus.active.value
            session.started_at = datetime.now(timezone.utc)
            await db.commit()

        await emit(websocket, "session.started", session_id, {"status": "active"})

        async def append_transcript_line(speaker: str, text: str) -> None:
            nonlocal recent_transcript
            prefix = "user" if speaker == "user" else "interviewer"
            recent_transcript.append(f"{prefix}: {text}")
            recent_transcript = recent_transcript[-8:]

        async def process_final_question(
            question: str,
            forced: bool = False,
            speaker: str = "interviewer",
        ) -> None:
            nonlocal coaching_in_progress, pending_question, last_heard_text

            cleaned = question.strip()
            last_heard_text = cleaned
            min_chars = MIN_FINAL_CHARS if not forced else 4
            if len(cleaned) < min_chars:
                return

            if speaker == "user":
                await append_transcript_line("user", cleaned)
                return

            if not forced and not looks_like_question(cleaned) and len(cleaned) < 20:
                await append_transcript_line("interviewer", cleaned)
                return

            await append_transcript_line("interviewer", cleaned)

            if coaching_in_progress:
                pending_question = cleaned
                return

            coaching_in_progress = True
            try:
                await generate_coaching(
                    websocket, db, session, session_id, cleaned, recent_transcript
                )
            except Exception as exc:
                logger.error("coaching_failed", error=str(exc))
                await emit(
                    websocket,
                    "error",
                    session_id,
                    {
                        "code": "LLM_ERROR",
                        "message": str(exc),
                        "recoverable": True,
                    },
                )
            finally:
                coaching_in_progress = False
                if pending_question and pending_question != cleaned:
                    next_question = pending_question
                    pending_question = None
                    await process_final_question(next_question)
                else:
                    pending_question = None

        try:
            while True:
                raw = await websocket.receive_text()
                message = json.loads(raw)

                if message.get("type") == "ping":
                    await emit(websocket, "pong", session_id, {})
                    continue

                if message.get("type") == "control":
                    action = message.get("action")
                    if action == "stop":
                        session.status = SessionStatus.completed.value
                        session.ended_at = datetime.now(timezone.utc)
                        await enqueue_summarize(db, session.id)
                        await db.commit()
                        if session.user and session.user.delete_data_on_session_end:
                            for segment in list(session.transcript_segments):
                                await db.delete(segment)
                            for output in list(session.ai_outputs):
                                await db.delete(output)
                            await db.commit()
                        await emit(websocket, "session.ended", session_id, {"status": "completed"})
                        break
                    if action == "mark_question" and last_heard_text:
                        await process_final_question(last_heard_text, forced=True)
                    continue

                if message.get("type") == "transcript":
                    text = (message.get("text") or "").strip()
                    if not text:
                        continue
                    is_final = bool(message.get("isFinal", True))
                    speaker = message.get("speaker") or "interviewer"
                    result = TranscriptResult(text=text, is_final=is_final, speaker=speaker)
                    if is_final:
                        last_heard_text = text
                        await persist_and_emit_transcript(websocket, db, session_id, result)
                        await process_final_question(text, speaker=speaker)
                    else:
                        last_partial_question = text
                        last_heard_text = text
                        await emit(
                            websocket,
                            "transcript.partial",
                            session_id,
                            {
                                "segmentId": str(uuid.uuid4()),
                                "speaker": speaker,
                                "text": text,
                                "isFinal": False,
                                "timestampMs": int(datetime.now(timezone.utc).timestamp() * 1000),
                            },
                        )
                    continue

                if message.get("type") != "audio":
                    continue

                last_encoding = message.get("encoding", "webm")
                last_sample_rate = message.get("sampleRate", 16000)
                audio_buffer.append(message.get("data", ""))
                if len(audio_buffer) < 1:
                    continue

                combined = "".join(audio_buffer)
                audio_buffer.clear()

                try:
                    transcript = await stt.transcribe_chunk(
                        combined,
                        last_sample_rate,
                        encoding=last_encoding,
                    )
                except Exception as exc:
                    logger.error("stt_failed", session_id=session_id, error=str(exc))
                    await emit(
                        websocket,
                        "error",
                        session_id,
                        {
                            "code": "STT_ERROR",
                            "message": str(exc),
                            "recoverable": True,
                        },
                    )
                    continue

                if not transcript:
                    continue

                last_heard_text = transcript.text
                await persist_and_emit_transcript(websocket, db, session_id, transcript)
                if transcript.is_final:
                    await process_final_question(
                        transcript.text,
                        speaker=transcript.speaker or "interviewer",
                    )

        except WebSocketDisconnect:
            logger.info("websocket_disconnected", session_id=session_id)
        except Exception as exc:
            logger.error("websocket_error", session_id=session_id, error=str(exc))
            await emit(
                websocket,
                "error",
                session_id,
                {"code": "INTERNAL", "message": str(exc), "recoverable": True},
            )
        finally:
            try:
                await flush_audio_buffer(
                    websocket,
                    db,
                    session_id,
                    stt,
                    audio_buffer,
                    last_encoding,
                    last_sample_rate,
                    process_final_question,
                )
            except Exception as exc:
                logger.info("audio_flush_skipped", session_id=session_id, error=str(exc))
