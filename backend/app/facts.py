"""
Fact extraction from an uploaded declaration's text -- Step 2 of the
workflow. One LLM call per document, asking for exactly the fields this
mode's rules file defines, each with a locator and a verbatim quote.

Quote-then-locate anti-hallucination gate (PRD Section 6.3): every quote
the model returns is checked against the actual source text. A quote that
cannot be found verbatim is discarded -- the field comes back empty rather
than guessed at, and feeds into the sufficiency check like any other
missing fact. This is enforced here in code, not left to the prompt.
"""
import json
import re

from . import llm

MAX_CHARS = 15000  # keep the prompt small and the cost bounded


def _normalise(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip().lower()


def _locate_page(source_text: str, char_index: int) -> str:
    """Given an index into source_text, find the nearest preceding
    [[page N]] marker."""
    marker_re = re.compile(r"\[\[page (\d+)\]\]")
    last_page = "1"
    for m in marker_re.finditer(source_text):
        if m.start() > char_index:
            break
        last_page = m.group(1)
    return f"page {last_page}"


def _find_quote(source_text: str, quote: str) -> str | None:
    """Returns a locator string if the quote is found verbatim (modulo
    whitespace) in source_text, else None."""
    if not quote or not quote.strip():
        return None
    idx = source_text.find(quote)
    if idx == -1:
        # Try whitespace-normalised match as a fallback for models that
        # reflow line breaks inside an otherwise-verbatim quote.
        norm_source = _normalise(source_text)
        norm_quote = _normalise(quote)
        if norm_quote and norm_quote in norm_source:
            # Approximate the original index by locating the first word.
            first_word = quote.strip().split()[0] if quote.strip().split() else ""
            idx = source_text.find(first_word) if first_word else -1
            if idx == -1:
                return "location approximate"
            return _locate_page(source_text, idx)
        return None
    return _locate_page(source_text, idx)


def _build_prompt(mode: str, rules: dict, text: str) -> str:
    field_lines = "\n".join(f'- "{f["key"]}": {f["label"]}' for f in rules["fields"])
    return f"""You are helping a UK police Counter Corruption Unit practitioner extract \
declared facts from an uploaded {rules['label']} declaration document, to populate a \
draft risk assessment. Read the document text below (page breaks marked \
[[page N]]) and extract values for exactly these fields:

{field_lines}

For EVERY field, respond with an object containing:
  "value": a short factual statement in your own words, or "" if the document does not state this,
  "quote": a short VERBATIM quote (exact substring, unmodified) from the document text that supports "value", or "" if none/not applicable.

Respond with ONLY a single JSON object, no other text, no markdown fences, \
shaped exactly like:
{{"field_key": {{"value": "...", "quote": "..."}}, ...}}

Rules:
- Never invent a fact not present in the text. If a field is not addressed \
in the document, its value must be "".
- The quote MUST be copied exactly from the document text -- do not \
paraphrase, correct spelling, or reflow it. A quote that does not appear \
verbatim in the text is worse than no quote at all.
- Keep each quote short (under ~200 characters) -- the smallest verbatim \
fragment that supports the value.

DOCUMENT TEXT:
{text}"""


def _mock_result(rules: dict, text: str) -> dict:
    preview = text.strip()[:800]
    return {
        f["key"]: {"value": "", "quote": None, "locator": None, "source": "extracted"}
        for f in rules["fields"]
    } | {"_mock_preview": preview}


async def extract_facts(mode: str, rules: dict, source_text: str) -> dict:
    """Returns {field_key: {"value","quote","locator","source"}, ...} plus,
    in mock mode only, "_mock_preview" (raw text for the user to read)."""
    truncated = source_text.strip()[:MAX_CHARS]

    if llm.mode() != "live":
        return _mock_result(rules, truncated)

    result = await llm.chat(_build_prompt(mode, rules, truncated), max_output_tokens=2500)
    raw = result.text.strip()
    if raw.startswith("```"):
        raw = raw.strip("`")
        if raw.lower().startswith("json"):
            raw = raw[4:]
        raw = raw.strip()

    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        blank = {f["key"]: {"value": "", "quote": None, "locator": None, "source": "extracted"} for f in rules["fields"]}
        blank["_warning"] = "The AI's response could not be read as structured data. Fields have been left blank -- fill them in manually."
        return blank

    out = {}
    for field in rules["fields"]:
        key = field["key"]
        entry = data.get(key) or {}
        value = str(entry.get("value") or "").strip()
        quote = str(entry.get("quote") or "").strip()
        locator = _find_quote(truncated, quote) if quote else None
        if quote and locator is None:
            # Anti-hallucination gate: unlocatable quote -> treat as not
            # extracted, never silently keep the value anyway.
            value, quote = "", ""
        out[key] = {
            "value": value,
            "quote": quote or None,
            "locator": locator,
            "source": "extracted",
        }
    return out
