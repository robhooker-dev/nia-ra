"""
Anthropic-or-mock chat. Called over raw httpx -- no SDK version drift.

Degrade-loud: with no API key, chat() returns a deterministic mock marked
"[OFFLINE PLACEHOLDER]". Callers that need structured JSON back (fact
extraction, risk grading) must handle mock mode explicitly rather than try
to parse the placeholder text as JSON -- see extract.py / assess.py.

Gotchas (learned the hard way on sibling apps in this portfolio):
  - Set proxy=None on outbound httpx calls -- inheriting the corporate
    proxy from the shell has produced intermittent 407s on some networks.
  - An empty completion is usually truncation (stop_reason "max_tokens"),
    not a refusal -- surface stop_reason, never return blank.
  - The response's content list can contain a "thinking" block before the
    "text" block -- always filter by type, never assume content[0] is text.
"""
import httpx

from . import config

ANTHROPIC_API_VERSION = "2023-06-01"


def mode() -> str:
    return "live" if config.anthropic_configured() else "mock"


class LLMResult:
    def __init__(self, text: str, finish_reason: str, mode_used: str):
        self.text = text
        self.finish_reason = finish_reason
        self.mode_used = mode_used


async def chat(prompt: str, max_output_tokens: int = 1500) -> LLMResult:
    if not config.anthropic_configured():
        return LLMResult(text="", finish_reason="mock", mode_used="mock")

    headers = {
        "x-api-key": config.ANTHROPIC_API_KEY,
        "anthropic-version": ANTHROPIC_API_VERSION,
        "Content-Type": "application/json",
    }
    body = {
        "model": config.ANTHROPIC_MODEL,
        "max_tokens": max_output_tokens,
        "messages": [{"role": "user", "content": prompt}],
    }

    async with httpx.AsyncClient(proxy=None, timeout=90.0) as client:
        try:
            resp = await client.post("https://api.anthropic.com/v1/messages", headers=headers, json=body)
            resp.raise_for_status()
        except httpx.HTTPStatusError as e:
            return LLMResult(
                text="", finish_reason=f"error:{e.response.status_code}", mode_used="live",
            )
        except httpx.RequestError as e:
            return LLMResult(
                text="", finish_reason=f"error:{e.__class__.__name__}", mode_used="live",
            )

    data = resp.json()
    stop_reason = data.get("stop_reason", "unknown")
    text = "".join(block.get("text", "") for block in (data.get("content") or []) if block.get("type") == "text")

    return LLMResult(text=text, finish_reason=stop_reason, mode_used="live")
