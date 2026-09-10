"""
Step 6 -- decision letter to the applicant. The decision itself (approve/
decline for BI; continue/cease for NIA) is never drafted or suggested by
the AI -- it is a human choice the officer makes explicitly, same as the
risk grade. This module only drafts the *reasons* paragraph for a decline
or cease letter, translating the internal rationale into plain,
applicant-facing language.

Data minimisation: this call receives only the already-confirmed rationale
text (which the officer has already seen and could have edited in the
previous step) -- never the raw declared facts, quotes or locators. There
is nothing here for the letter-drafting prompt to need beyond why the
decision was reached.
"""
import re

from . import llm

MAX_CHARS = 4000


def _build_prompt(mode: str, decision: str, rationale_text: str) -> str:
    mode_label = "notifiable association" if mode == "NIA" else "business interest"
    outcome_word = "cease" if decision == "Cease" else "decline"
    return f"""You are drafting the "reasons" paragraph of a formal letter from a UK \
police Professional Standards Department to an officer, informing them that \
their {mode_label} declaration has been {outcome_word}d.

Rewrite the internal rationale below into 2-4 plain-English sentences \
suitable to send directly to the officer. Rules:
- Do not invent any reason not present in the internal rationale below.
- Do not use internal jargon, fact-key names, or citation markers.
- Be direct but professional -- the officer is entitled to know why.
- Do not soften the outcome, but do not editorialise beyond the rationale given.
- Do not address the letter or add a greeting/sign-off -- just the reasons paragraph.

INTERNAL RATIONALE:
{rationale_text.strip()[:MAX_CHARS]}"""


def _mock_reasons(decision: str) -> str:
    action = "cease" if decision == "Cease" else "decline"
    return (
        f"[OFFLINE PLACEHOLDER -- no AI provider configured. Draft the reasons for this "
        f"{action} decision manually, using the rationale already recorded in the risk "
        f"assessment.]"
    )


async def draft_applicant_reasons(mode: str, decision: str, rationale_text: str) -> dict:
    if not rationale_text or not rationale_text.strip():
        return {"reasons_text": "", "warning": "No rationale text was carried over from the risk assessment -- write the reasons manually."}

    if llm.mode() != "live":
        return {"reasons_text": _mock_reasons(decision), "warning": None}

    result = await llm.chat(_build_prompt(mode, decision, rationale_text), max_output_tokens=500)
    text = result.text.strip()
    if not text:
        return {
            "reasons_text": "",
            "warning": "The AI could not draft the reasons paragraph. Write it manually, using the rationale already recorded in the risk assessment.",
        }
    text = re.sub(r"^```[a-z]*\n?|```$", "", text).strip()
    return {"reasons_text": text, "warning": None}
