from collections.abc import AsyncIterator
from dataclasses import dataclass

from app.config import settings
from app.services.gemini import GeminiLLMService, gemini_generate_summary, gemini_transcribe_audio
from app.realtime.transcript_utils import is_valid_transcript
from app.services.stt_errors import sanitize_stt_error


@dataclass
class TranscriptResult:
    text: str
    is_final: bool
    speaker: str = "unknown"


class STTService:
    async def transcribe_chunk(
        self,
        audio_b64: str,
        sample_rate: int,
        encoding: str = "webm",
    ) -> TranscriptResult | None:
        provider = settings.active_stt_provider
        if settings.use_mock_ai or provider == "mock":
            return MockSTTService().transcribe_from_chunk(audio_b64)
        if provider == "gemini":
            return await GeminiSTTService().transcribe_chunk(audio_b64, sample_rate, encoding)
        return await DeepgramSTTService().transcribe_chunk(audio_b64, sample_rate, encoding)


class MockSTTService:
    _phrases = [
        "Tell me about a time you handled a difficult stakeholder.",
        "What is your greatest strength?",
        "How do you prioritize when everything is urgent?",
        "Describe a project where you had to learn something quickly.",
    ]
    _index = 0

    def transcribe_from_chunk(self, _audio_b64: str) -> TranscriptResult:
        phrase = self._phrases[self._index % len(self._phrases)]
        self._index += 1
        return TranscriptResult(text=phrase, is_final=True, speaker="interviewer")


class GeminiSTTService:
    async def transcribe_chunk(
        self,
        audio_b64: str,
        _sample_rate: int,
        encoding: str = "webm",
    ) -> TranscriptResult | None:
        mime_map = {
            "webm": "audio/webm",
            "wav": "audio/wav",
            "mp4": "audio/mp4",
            "m4a": "audio/mp4",
        }
        mime = mime_map.get(encoding, "audio/webm")
        try:
            text = await gemini_transcribe_audio(audio_b64, mime_type=mime)
        except Exception as exc:
            raise RuntimeError(sanitize_stt_error(exc)) from exc
        if not text or len(text) < 3 or not is_valid_transcript(text):
            return None
        return TranscriptResult(text=text, is_final=True, speaker="interviewer")


class DeepgramSTTService:
    async def transcribe_chunk(
        self,
        audio_b64: str,
        sample_rate: int,
        encoding: str = "webm",
    ) -> TranscriptResult | None:
        import base64

        import httpx

        audio_bytes = base64.b64decode(audio_b64)
        content_type = {
            "webm": "audio/webm",
            "wav": "audio/wav",
            "mp4": "audio/mp4",
            "m4a": "audio/mp4",
        }.get(encoding, "audio/webm")
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                "https://api.deepgram.com/v1/listen",
                params={
                    "model": "nova-2",
                    "smart_format": "true",
                    "language": "en-US",
                    "punctuate": "true",
                    "filler_words": "false",
                },
                headers={
                    "Authorization": f"Token {settings.deepgram_api_key}",
                    "Content-Type": content_type,
                },
                content=audio_bytes,
            )
            resp.raise_for_status()
            data = resp.json()
            alt = data.get("results", {}).get("channels", [{}])[0].get("alternatives", [{}])[0]
            text = alt.get("transcript", "").strip()
            if not text:
                return None
            return TranscriptResult(text=text, is_final=True, speaker="interviewer")


class LLMService:
    async def stream_coaching(
        self,
        system_prompt: str,
        user_prompt: str,
    ) -> AsyncIterator[str]:
        provider = settings.active_llm_provider
        if settings.use_mock_ai or provider == "mock":
            async for token in MockLLMService().stream(system_prompt, user_prompt):
                yield token
            return
        if provider == "gemini":
            async for token in GeminiLLMService().stream(system_prompt, user_prompt):
                yield token
            return
        async for token in OpenAILLMService().stream(system_prompt, user_prompt):
            yield token


class MockLLMService:
    async def stream(self, _system: str, user_prompt: str) -> AsyncIterator[str]:
        response = (
            "Suggested answer:\n"
            "In my previous role, I led a cross-functional initiative that improved delivery speed by 25%. "
            "I aligned stakeholders early, set clear milestones, and communicated progress weekly.\n\n"
            "Talking points:\n"
            "- Name the situation and your role\n"
            "- Share a measurable outcome\n"
            "- Mention one lesson learned"
        )
        for word in response.split(" "):
            yield word + " "
            import asyncio

            await asyncio.sleep(0.02)


class OpenAILLMService:
    async def stream(self, system_prompt: str, user_prompt: str) -> AsyncIterator[str]:
        import httpx

        async with httpx.AsyncClient(timeout=60.0) as client:
            async with client.stream(
                "POST",
                "https://api.openai.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {settings.openai_api_key}"},
                json={
                    "model": settings.openai_model,
                    "stream": True,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt},
                    ],
                },
            ) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    payload = line[6:]
                    if payload == "[DONE]":
                        break
                    import json

                    data = json.loads(payload)
                    delta = data["choices"][0]["delta"].get("content")
                    if delta:
                        yield delta


class SummaryLLMService:
    async def generate_summary(self, transcript: str) -> dict:
        if settings.use_mock_ai or settings.active_llm_provider == "mock":
            return _mock_summary()

        system = (
            "Analyze completed interview sessions. Return JSON with keys: "
            "summary (string), questions (string[]), feedbackBullets (string[], 3-5 items)."
        )
        user = f"Analyze this transcript:\n\n{transcript}"

        if settings.active_llm_provider == "gemini":
            return await gemini_generate_summary(system, user)

        import httpx

        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {settings.openai_api_key}"},
                json={
                    "model": settings.openai_model,
                    "response_format": {"type": "json_object"},
                    "messages": [
                        {"role": "system", "content": system},
                        {"role": "user", "content": user},
                    ],
                },
            )
            resp.raise_for_status()
            import json

            content = resp.json()["choices"][0]["message"]["content"]
            return json.loads(content)


def _mock_summary() -> dict:
    return {
        "summary": "Practice session covered behavioral questions with room to improve structure and pacing.",
        "questions": [
            "Tell me about a time you handled a difficult stakeholder.",
            "What is your greatest strength?",
        ],
        "feedbackBullets": [
            "Use STAR structure more consistently.",
            "Add measurable outcomes to your examples.",
            "Pause briefly before answering complex questions.",
            "Reduce filler words during transitions.",
        ],
    }
