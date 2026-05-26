import re

STT_REFUSAL_PATTERNS = (
    r"\bi(?:'m| am) sorry\b",
    r"\bcannot access\b",
    r"\bcan't access\b",
    r"\bunable to\b",
    r"\bcannot process\b",
    r"\bcan't process\b",
    r"\bunable to process\b",
    r"\baudio file",
    r"\baudio clip",
    r"\bexternal audio\b",
    r"\btranscription of the spoken words\b",
    r"\bprovide any questions.*text format\b",
    r"\btext-based (?:questions|interactions|format)\b",
    r"\bi(?:'m| am) unable to\b",
    r"\bi(?:'m| am) not able to\b",
)

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
    r"\bwould you\b",
    r"\bgive me\b",
    r"\bshare\b",
    r"\btalk about\b",
)

INTERVIEW_PROMPT_PATTERNS = (
    r"\btell me about yourself\b",
    r"\btell me about a time\b",
    r"\btell me about an time\b",
    r"\bdescribe a time\b",
    r"\bdescribe a situation\b",
    r"\bgive me an example\b",
    r"\bwalk me through\b",
    r"\bhow would you handle\b",
    r"\bwhat would you do\b",
    r"\bwhy should we hire\b",
    r"\bwhy do you want\b",
    r"\bwhat is your greatest\b",
    r"\bwhat are your strengths\b",
    r"\bwhat are your weaknesses\b",
)


def is_stt_refusal(text: str) -> bool:
    lowered = text.lower().strip()
    if not lowered:
        return True
    return any(re.search(pattern, lowered) for pattern in STT_REFUSAL_PATTERNS)


def is_valid_transcript(text: str) -> bool:
    cleaned = text.strip()
    if len(cleaned) < 3:
        return False
    return not is_stt_refusal(cleaned)


def looks_like_question(text: str) -> bool:
    lowered = text.lower().strip()
    if any(re.search(pattern, lowered) for pattern in INTERVIEW_PROMPT_PATTERNS):
        return True
    return any(re.search(pattern, lowered) for pattern in QUESTION_PATTERNS)


def should_trigger_coaching(text: str, forced: bool = False) -> bool:
    if forced:
        return is_valid_transcript(text)
    cleaned = text.strip()
    if not is_valid_transcript(cleaned):
        return False
    return looks_like_question(cleaned)
