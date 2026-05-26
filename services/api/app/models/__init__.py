import uuid
from datetime import datetime
from enum import Enum

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class SessionMode(str, Enum):
    behavioral = "behavioral"
    meeting = "meeting"
    technical = "technical"


class SessionStrategy(str, Enum):
    live_answer = "live_answer"
    critique = "critique"


class SessionStatus(str, Enum):
    draft = "draft"
    active = "active"
    paused = "paused"
    completed = "completed"
    failed = "failed"


class ToneStyle(str, Enum):
    concise = "concise"
    conversational = "conversational"
    star = "star"


class DocumentKind(str, Enum):
    resume = "resume"
    job_description = "job_description"


class ParseStatus(str, Enum):
    pending = "pending"
    processing = "processing"
    completed = "completed"
    failed = "failed"


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    hashed_password: Mapped[str] = mapped_column(String(255))
    display_name: Mapped[str] = mapped_column(String(255))
    headline: Mapped[str | None] = mapped_column(String(500), nullable=True)
    skills: Mapped[str | None] = mapped_column(Text, nullable=True)
    delete_data_on_session_end: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    sessions: Mapped[list["Session"]] = relationship(back_populates="user")
    documents: Mapped[list["Document"]] = relationship(back_populates="user")
    presets: Mapped[list["SessionPreset"]] = relationship(back_populates="user")


class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(32), default=SessionStatus.draft.value, index=True)
    mode: Mapped[str] = mapped_column(String(32), default=SessionMode.behavioral.value)
    company: Mapped[str | None] = mapped_column(String(255), nullable=True)
    role: Mapped[str | None] = mapped_column(String(255), nullable=True)
    tone: Mapped[str] = mapped_column(String(32), default=ToneStyle.conversational.value)
    custom_instructions: Mapped[str | None] = mapped_column(Text, nullable=True)
    resume_context: Mapped[str | None] = mapped_column(Text, nullable=True)
    job_description_context: Mapped[str | None] = mapped_column(Text, nullable=True)
    strategy: Mapped[str] = mapped_column(String(32), default=SessionStrategy.live_answer.value)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    user: Mapped["User"] = relationship(back_populates="sessions")
    transcript_segments: Mapped[list["TranscriptSegment"]] = relationship(back_populates="session")
    ai_outputs: Mapped[list["AiOutput"]] = relationship(back_populates="session")
    summary: Mapped["SessionSummary | None"] = relationship(back_populates="session", uselist=False)


class TranscriptSegment(Base):
    __tablename__ = "transcript_segments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"), index=True)
    speaker: Mapped[str] = mapped_column(String(32), default="unknown")
    text: Mapped[str] = mapped_column(Text)
    is_final: Mapped[bool] = mapped_column(Boolean, default=False)
    timestamp_ms: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    session: Mapped["Session"] = relationship(back_populates="transcript_segments")


class AiOutput(Base):
    __tablename__ = "ai_outputs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(32), default="suggestion")
    content: Mapped[str] = mapped_column(Text)
    prompt_version: Mapped[str] = mapped_column(String(32), default="v1")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    session: Mapped["Session"] = relationship(back_populates="ai_outputs")


class SessionSummary(Base):
    __tablename__ = "session_summaries"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    session_id: Mapped[str] = mapped_column(
        ForeignKey("sessions.id", ondelete="CASCADE"), unique=True, index=True
    )
    summary: Mapped[str] = mapped_column(Text)
    questions_json: Mapped[str] = mapped_column(Text, default="[]")
    feedback_json: Mapped[str] = mapped_column(Text, default="[]")
    prompt_version: Mapped[str] = mapped_column(String(32), default="v1")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    session: Mapped["Session"] = relationship(back_populates="summary")


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(32))
    filename: Mapped[str] = mapped_column(String(255))
    storage_path: Mapped[str] = mapped_column(String(500))
    parse_status: Mapped[str] = mapped_column(String(32), default=ParseStatus.pending.value)
    parsed_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped["User"] = relationship(back_populates="documents")


class JobQueue(Base):
    __tablename__ = "job_queue"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    job_type: Mapped[str] = mapped_column(String(64), index=True)
    payload_json: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(32), default="pending", index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class SessionPreset(Base):
    __tablename__ = "session_presets"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(255))
    is_favorite: Mapped[bool] = mapped_column(Boolean, default=False)
    mode: Mapped[str] = mapped_column(String(32), default=SessionMode.behavioral.value)
    tone: Mapped[str] = mapped_column(String(32), default=ToneStyle.conversational.value)
    company: Mapped[str | None] = mapped_column(String(255), nullable=True)
    role: Mapped[str | None] = mapped_column(String(255), nullable=True)
    custom_instructions: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    user: Mapped["User"] = relationship(back_populates="presets")


class PracticeQuestion(Base):
    __tablename__ = "practice_questions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    topic: Mapped[str] = mapped_column(String(255))
    difficulty: Mapped[str] = mapped_column(String(32), default="medium")
    text: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
