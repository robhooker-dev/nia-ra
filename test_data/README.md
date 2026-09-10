# Synthetic test declarations

Six entirely fictional declaration documents for exercising the app end to
end -- no real people, no real force, no real cases. Three NIA, three BI,
spread across the grading range so the whole workflow (including the
insufficiency path and the NIA manageability indicator) gets exercised.

These are a starting point for calibrating the app's own judgement against
what the rules file in `backend/rules/` says it *should* do -- not a fixed
answer key. If a run disagrees with the expected grade below, that's a
useful signal to look at either the facts as extracted or the rules file's
wording, not necessarily a bug.

| File | Expected grade | Notes |
|---|---|---|
| `NIA-1-low-risk.docx` | Low | Historic, no contact in ~3 years, no access concern, proactive. |
| `NIA-2-medium-risk.docx` | Medium | Ongoing family contact, associate's company had a regulatory investigation (no charges), limited access. |
| `NIA-3-high-escalate.docx` | High, **Escalate for manageability review** | Ongoing relationship, associate has asked the declarant for police-system information (leverage), declarant holds covert/intelligence access, only came to light via vetting review. Deliberately stacks multiple Section 6.2.1 escalation triggers. |
| `BI-1-low-risk.docx` | Low | Minimal hours, no connection to policing duties. |
| `BI-2-medium-risk.docx` | Medium | Hours approaching the 48-hour WTR threshold, plausible perception-of-conflict with some clients. |
| `BI-3-high-risk.docx` | High | Business overlaps directly with the declarant's Economic Crime Unit access, hours well over the WTR threshold, and a **prior approval condition has been breached** -- the IOPC-flagged pattern the BI rules file specifically calls out. |

Generated with `python-docx` from
`generate_test_docs.py` (kept in the session scratchpad, not checked in --
regenerate by asking if you need to tweak the scenarios).
