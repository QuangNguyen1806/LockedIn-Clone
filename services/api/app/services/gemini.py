import json
import re
from collections.abc import AsyncIterator

import httpx

from app.config import settings

GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models"


def _gemini_url(model: str, stream: bool = False) -> str:
    action = "streamGenerateContent" if stream else "generateContent"
    return f"{GEMINI_BASE}/{model}:{action}?key={settings.gemini_api_key}"


def _gemini_body(system_prompt: str, user_prompt: str, json_mode: bool = False) -> dict:
    body: dict = {
        "systemInstruction": {"parts": [{"text": system_prompt}]},
        "contents": [{"role": "user", "parts": [{"text": user_prompt}]}],
    }
    if json_mode:
        body["generationConfig"] = {"responseMimeType": "application/json"}
    return body


def _extract_text(payload: dict) -> str:
    candidates = payload.get("candidates") or []
    if not candidates:
        return ""
    parts = candidates[0].get("content", {}).get("parts") or []
    return "".join(part.get("text", "") for part in parts if part.get("text"))


def _parse_json_response(text: str) -> dict:
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if match:
            return json.loads(match.group(0))
        raise


class GeminiLLMService:
    async def stream(self, system_prompt: str, user_prompt: str) -> AsyncIterator[str]:
        url = _gemini_url(settings.gemini_model, stream=True) + "&alt=sse"
        async with httpx.AsyncClient(timeout=60.0) as client:
            async with client.stream(
                "POST",
                url,
                json=_gemini_body(system_prompt, user_prompt),
            ) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    data = json.loads(line[6:])
                    chunk = _extract_text(data)
                    if chunk:
                        yield chunk


async def gemini_generate_summary(system_prompt: str, user_prompt: str) -> dict:
    url = _gemini_url(settings.gemini_model, stream=False)
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(
            url,
            json=_gemini_body(system_prompt, user_prompt, json_mode=True),
        )
        resp.raise_for_status()
        text = _extract_text(resp.json())
        return _parse_json_response(text)


def gemini_generate_summary_sync(system_prompt: str, user_prompt: str) -> dict:
    url = _gemini_url(settings.gemini_model, stream=False)
    with httpx.Client(timeout=60.0) as client:
        resp = client.post(
            url,
            json=_gemini_body(system_prompt, user_prompt, json_mode=True),
        )
        resp.raise_for_status()
        text = _extract_text(resp.json())
        return _parse_json_response(text)


async def gemini_transcribe_audio(audio_b64: str, mime_type: str = "audio/webm") -> str:
    model = settings.gemini_stt_model or "gemini-2.0-flash"
    url = _gemini_url(model, stream=False)
    body = {
        "contents": [
            {
                "role": "user",
                "parts": [
                    {
                        "inline_data": {
                            "mime_type": mime_type,
                            "data": audio_b64,
                        }
                    },
                    {
                        "text": (
                            "You are a speech-to-text engine for live job interviews. "
                            "Transcribe only the exact words spoken in the attached audio. "
                            "The speaker is usually an interviewer asking behavioral or technical questions "
                            "(for example: tell me about yourself, tell me about a time you worked on a team). "
                            "Output the transcript verbatim with no labels, apologies, or commentary. "
                            "If the audio is silent or unintelligible, output nothing."
                        )
                    },
                ],
            }
        ],
        "generationConfig": {"temperature": 0.1},
    }
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(url, json=body)
        if resp.status_code >= 400:
            detail = resp.text[:240].replace(settings.gemini_api_key, "***")
            raise RuntimeError(
                f"Gemini transcription failed ({resp.status_code}). "
                "Try speaking again, or set DEEPGRAM_API_KEY for better speech recognition."
            ) from None
        return _extract_text(resp.json()).strip()
