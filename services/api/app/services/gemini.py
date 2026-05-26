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
    url = _gemini_url(settings.gemini_model, stream=False)
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
                            "Transcribe the spoken words in this audio clip exactly. "
                            "Return only the transcript text with no labels or commentary. "
                            "If the clip is silent or unintelligible, return an empty string."
                        )
                    },
                ],
            }
        ],
        "generationConfig": {"temperature": 0.1},
    }
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(url, json=body)
        resp.raise_for_status()
        return _extract_text(resp.json()).strip()
