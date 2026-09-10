/* NIA/BI Risk Assessment Generator -- vanilla JS, no build step, no framework.
 * Everything lives in `state` in memory; nothing is persisted anywhere
 * (no localStorage, no server-side session) -- reload the page and the
 * session is gone, by design (PRD Section 9: stateless, session-only). */

const STEPS = ["mode", "upload", "facts", "assess", "decision", "draft"];
const STEP_LABELS = { mode: "Mode", upload: "Upload", facts: "Confirm facts", assess: "Risk assessment", decision: "Decision", draft: "Review & export" };

function addDays(dateStr, days) {
  const d = dateStr ? new Date(dateStr) : new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

const state = {
  step: "mode",
  mode: null,
  rules: null,
  sourceText: "",
  facts: {},
  extractWarning: null,
  aiWarning: null,
  mockPreview: null,
  llmMode: "mock",
  assessment: null,
  supplementNotice: null,
  draft: {
    case_reference: "",
    date: new Date().toISOString().slice(0, 10),
    preparer: "",
    grade: null,
    manageability: null,
    rationale_text: "",
    conditions_text: "",
    review_date: "",
    preparer_name: "",
    preparer_date: "",
  },
  decision: {
    outcome: null, // "Approved" | "Declined" | "Continue" | "Cease"
    declarant_name: "",
    case_reference: "",
    conditions_text: "",
    checkedStandard: [],
    reasons_text: "",
    reasons_warning: null,
    review_date: "",
    appeal_window_days: 21,
    appeal_recipient_title: "Head of Professional Standards Department",
    preparer_name: "",
  },
};

async function api(path, opts = {}) {
  const res = await fetch(path, opts);
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail || JSON.stringify(body);
    } catch (_) { /* not JSON */ }
    throw new Error(detail);
  }
  return res;
}

async function loadHealth() {
  const badge = document.getElementById("mode-badge");
  try {
    const res = await api("/api/health");
    const data = await res.json();
    state.llmMode = data.modes.llm;
    badge.textContent = `AI drafting: ${data.modes.llm} · OCR: ${data.modes.ocr}`;
  } catch (e) {
    badge.textContent = "AI drafting: unknown (health check failed)";
  }
}

function root() { return document.getElementById("app-root"); }

function stepPills() {
  const idx = STEPS.indexOf(state.step);
  return `<div class="steps">${STEPS.map((s, i) => {
    const cls = i === idx ? "active" : i < idx ? "done" : "";
    return `<span class="step-pill ${cls}">${i + 1}. ${STEP_LABELS[s]}</span>`;
  }).join("")}</div>`;
}

function render() {
  const r = root();
  r.innerHTML = stepPills() + `<div id="step-body"></div>`;
  const body = document.getElementById("step-body");
  if (state.step === "mode") renderMode(body);
  else if (state.step === "upload") renderUpload(body);
  else if (state.step === "facts") renderFacts(body);
  else if (state.step === "assess") renderAssess(body);
  else if (state.step === "decision") renderDecision(body);
  else if (state.step === "draft") renderDraft(body);
}

// ---------------- Step 1: Mode ----------------

function renderMode(body) {
  body.innerHTML = `
    <div class="panel">
      <h2>What are you assessing?</h2>
      <p>Pick a mode before uploading -- each has its own expected facts and grading criteria.</p>
      <div class="mode-cards">
        <div class="mode-card" id="pick-nia">
          <h3>Notifiable Inappropriate Association</h3>
          <p>A declared personal, family, social or prior-professional association that may need risk-assessing.</p>
        </div>
        <div class="mode-card" id="pick-bi">
          <h3>Business Interest</h3>
          <p>A declared outside business activity, directorship or financial interest.</p>
        </div>
      </div>
    </div>`;
  document.getElementById("pick-nia").onclick = () => selectMode("NIA");
  document.getElementById("pick-bi").onclick = () => selectMode("BI");
}

async function selectMode(mode) {
  state.mode = mode;
  const res = await api(`/api/rules/${mode}`);
  state.rules = await res.json();
  state.step = "upload";
  render();
}

// ---------------- Step 2: Upload ----------------

function renderUpload(body) {
  body.innerHTML = `
    <div class="panel">
      <h2>Upload the declaration document</h2>
      <p>PDF, Word (.docx), plain text, or an image of a scanned form.</p>
      <div class="field">
        <input type="file" id="file-input" accept=".pdf,.docx,.txt,.png,.jpg,.jpeg" />
      </div>
      <div id="upload-error"></div>
      <div class="btn-row">
        <button class="btn" id="extract-btn" disabled>Extract facts</button>
        <button class="btn btn-secondary" id="paste-instead-btn">Paste text instead</button>
        <button class="btn btn-secondary" id="back-to-mode-btn">Back</button>
      </div>
      <div id="paste-area" style="display:none; margin-top:16px;">
        <div class="field">
          <label>Paste the declaration text</label>
          <textarea id="paste-text" rows="10"></textarea>
        </div>
        <button class="btn" id="extract-pasted-btn">Extract facts from pasted text</button>
      </div>
    </div>`;

  const fileInput = document.getElementById("file-input");
  const extractBtn = document.getElementById("extract-btn");
  fileInput.onchange = () => { extractBtn.disabled = !fileInput.files.length; };
  extractBtn.onclick = () => doExtractFromFile(fileInput.files[0]);

  document.getElementById("paste-instead-btn").onclick = () => {
    document.getElementById("paste-area").style.display = "block";
  };
  document.getElementById("extract-pasted-btn").onclick = () => {
    const text = document.getElementById("paste-text").value;
    if (!text.trim()) return;
    doExtractFromText(text);
  };
  document.getElementById("back-to-mode-btn").onclick = () => { state.step = "mode"; render(); };
}

async function doExtractFromFile(file) {
  if (!file) return;
  const fd = new FormData();
  fd.append("mode", state.mode);
  fd.append("file", file);
  await runExtract(() => api("/api/extract", { method: "POST", body: fd }));
}

async function doExtractFromText(text) {
  const blob = new Blob([text], { type: "text/plain" });
  const fd = new FormData();
  fd.append("mode", state.mode);
  fd.append("file", blob, "pasted.txt");
  await runExtract(() => api("/api/extract", { method: "POST", body: fd }));
}

async function runExtract(call) {
  const errBox = document.getElementById("upload-error");
  errBox.innerHTML = `<div class="warning-box">Extracting… this may take a few seconds.</div>`;
  try {
    const res = await call();
    const data = await res.json();
    state.sourceText = data.source_text;
    state.facts = data.facts;
    state.extractWarning = data.extract_warning;
    state.aiWarning = data.ai_warning;
    state.mockPreview = data.mock_preview;
    state.llmMode = data.llm_mode;
    state.step = "facts";
    render();
  } catch (e) {
    errBox.innerHTML = `<div class="error-box">${escapeHtml(e.message)}</div>`;
  }
}

// ---------------- Step 3: Facts ----------------

function renderFacts(body) {
  const fields = state.rules.fields;
  let warnings = "";
  if (state.llmMode === "mock") {
    warnings += `<div class="warning-box">No AI provider is configured, so facts were not extracted automatically. Review the source text below and fill in each field yourself.</div>`;
  }
  if (state.extractWarning) warnings += `<div class="warning-box">${escapeHtml(state.extractWarning)}</div>`;
  if (state.aiWarning) warnings += `<div class="warning-box">${escapeHtml(state.aiWarning)}</div>`;

  const mockPreview = state.mockPreview
    ? `<details style="margin-bottom:16px;"><summary>Raw extracted text (read to fill fields manually)</summary><pre style="white-space:pre-wrap; font-size:12px;">${escapeHtml(state.mockPreview)}</pre></details>`
    : "";

  const rows = fields.map(f => {
    const entry = state.facts[f.key] || { value: "", quote: null, locator: null, source: "user" };
    const badge = entry.value
      ? `<span class="fact-badge ${entry.source === "extracted" ? "extracted" : "user"}">${entry.source === "extracted" ? "from document" : "manually entered"}</span>`
      : `<span class="fact-badge not-stated">not stated</span>`;
    const quoteBlock = entry.quote
      ? `<div class="fact-quote">&ldquo;${escapeHtml(entry.quote)}&rdquo; &mdash; ${escapeHtml(entry.locator || "")}</div>`
      : "";
    return `
      <div class="fact-row">
        <div class="fact-label">${f.required_for_sufficiency ? '<span class="fact-required">*</span> ' : ""}${escapeHtml(f.label)}${badge}</div>
        <div>
          <textarea data-key="${f.key}" rows="2">${escapeHtml(entry.value)}</textarea>
          ${quoteBlock}
        </div>
      </div>`;
  }).join("");

  body.innerHTML = `
    <div class="panel">
      <h2>Confirm declared facts</h2>
      <p><span class="fact-required">*</span> marks fields needed before a risk grade can be suggested. Edit anything that looks wrong -- extraction from a form is not always reliable.</p>
      ${warnings}
      ${mockPreview}
      <div id="facts-list">${rows}</div>
      <div class="btn-row">
        <button class="btn" id="continue-to-assess-btn">Continue to risk assessment</button>
        <button class="btn btn-secondary" id="add-doc-btn">Add a supplementary document</button>
        <button class="btn btn-secondary" id="back-to-upload-btn">Back</button>
      </div>
      <div id="supplement-area" style="display:none; margin-top:16px;">
        <div class="field">
          <input type="file" id="supplement-file" accept=".pdf,.docx,.txt,.png,.jpg,.jpeg" />
        </div>
        <button class="btn btn-secondary" id="supplement-extract-btn">Extract and merge (fills in blank fields only)</button>
      </div>
    </div>`;

  body.querySelectorAll("textarea[data-key]").forEach(ta => {
    ta.oninput = () => {
      const key = ta.dataset.key;
      const existing = state.facts[key] || { quote: null, locator: null };
      state.facts[key] = { value: ta.value, quote: existing.quote, locator: existing.locator, source: existing.value === ta.value ? existing.source : "user" };
    };
  });

  document.getElementById("continue-to-assess-btn").onclick = () => { state.step = "assess"; state.assessment = null; render(); runAssess(); };
  document.getElementById("back-to-upload-btn").onclick = () => { state.step = "upload"; render(); };
  document.getElementById("add-doc-btn").onclick = () => { document.getElementById("supplement-area").style.display = "block"; };
  document.getElementById("supplement-extract-btn").onclick = () => doSupplement();
}

async function doSupplement() {
  const fileInput = document.getElementById("supplement-file");
  const file = fileInput.files[0];
  if (!file) return;
  const fd = new FormData();
  fd.append("mode", state.mode);
  fd.append("file", file);
  try {
    const res = await api("/api/extract", { method: "POST", body: fd });
    const data = await res.json();
    let filled = 0;
    for (const [key, entry] of Object.entries(data.facts)) {
      const current = state.facts[key];
      if ((!current || !current.value) && entry.value) {
        state.facts[key] = entry;
        filled++;
      }
    }
    state.supplementNotice = `Supplementary document processed -- ${filled} previously-blank field(s) filled in. Existing entries were not overwritten.`;
    render();
  } catch (e) {
    alert("Could not process supplementary document: " + e.message);
  }
}

// ---------------- Step 4: Assess ----------------

async function runAssess(allowProvisional = false) {
  const body = document.getElementById("step-body");
  const factsPayload = {};
  for (const [k, v] of Object.entries(state.facts)) {
    factsPayload[k] = { value: v.value || "", quote: v.quote || null, locator: v.locator || null, source: v.source || "user" };
  }
  try {
    const res = await api("/api/assess", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: state.mode, facts: factsPayload, allow_provisional: allowProvisional }),
    });
    state.assessment = await res.json();
  } catch (e) {
    state.assessment = { error: e.message };
  }
  renderAssess(body);
}

function renderAssess(body) {
  if (!state.assessment) {
    body.innerHTML = `<div class="panel"><p>Running assessment&hellip;</p></div>`;
    return;
  }
  const a = state.assessment;

  if (a.error) {
    body.innerHTML = `<div class="panel"><div class="error-box">${escapeHtml(a.error)}</div>
      <button class="btn btn-secondary" id="back-to-facts-btn">Back</button></div>`;
    document.getElementById("back-to-facts-btn").onclick = () => { state.step = "facts"; render(); };
    return;
  }

  if (!a.sufficient && !a.grade) {
    const missing = a.missing.map(m => `<li><strong>${escapeHtml(m.label)}</strong><div class="missing-why">${escapeHtml(m.why_it_matters)}</div></li>`).join("");
    body.innerHTML = `
      <div class="panel">
        <h2>Not enough information yet</h2>
        <p>The confirmed facts don't yet cover everything needed for a meaningful risk assessment. Missing:</p>
        <ul class="missing-list">${missing}</ul>
        <div class="btn-row">
          <button class="btn btn-secondary" id="back-to-facts-btn">Add missing information</button>
          <button class="btn" id="provisional-btn">Get a provisional assessment anyway</button>
        </div>
      </div>`;
    document.getElementById("back-to-facts-btn").onclick = () => { state.step = "facts"; render(); };
    document.getElementById("provisional-btn").onclick = () => { state.assessment = null; renderAssess(body); runAssess(true); };
    return;
  }

  if (!a.grade) {
    body.innerHTML = `<div class="panel">
      <div class="warning-box">${escapeHtml(a.warning || "No suggestion could be drafted.")}</div>
      <h2>Select a grade manually</h2>
      ${gradeSelector(null)}
      <div class="btn-row"><button class="btn" id="confirm-grade-btn">Continue with this grade</button>
      <button class="btn btn-secondary" id="back-to-facts-btn">Back</button></div>
    </div>`;
    wireGradeSelector(body, null);
    document.getElementById("back-to-facts-btn").onclick = () => { state.step = "facts"; render(); };
    return;
  }

  const provisionalTag = a.provisional ? `<div class="provisional-tag">Provisional -- based on incomplete information</div>` : "";
  const rationaleHtml = a.rationale.map(r => {
    const keys = r.supporting_fact_keys.map(k => {
      const label = (state.rules.fields.find(f => f.key === k) || {}).label || k;
      return escapeHtml(label);
    }).join(", ");
    return `<div class="rationale-item"><div>${escapeHtml(r.text)}</div>${keys ? `<div class="rationale-keys">Based on: ${keys}</div>` : ""}</div>`;
  }).join("") || "<p>(no rationale returned)</p>";

  const mitigations = a.mitigations.length
    ? `<ul>${a.mitigations.map(m => `<li>${escapeHtml(m)}</li>`).join("")}</ul>`
    : "<p>(none suggested)</p>";

  let manageabilityHtml = "";
  let manageabilityReasoningHtml = "";
  if (state.mode === "NIA" && a.manageability) {
    const cls = a.manageability === "Manageable" ? "Manageable" : "escalate";
    manageabilityHtml = `<span class="manageability-tag ${cls}">${escapeHtml(a.manageability)}</span>`;
    if (a.manageability_reasoning) {
      manageabilityReasoningHtml = `<p class="manageability-reasoning">${escapeHtml(a.manageability_reasoning)}</p>`;
    }
  }

  body.innerHTML = `
    <div class="panel">
      <h2>Suggested risk assessment</h2>
      <p>This is a suggestion only. Confirm or override the grade below before it is used in the document -- it is never finalised automatically.</p>
      ${provisionalTag}
      <div class="grade-display ${a.grade}">${a.grade}${manageabilityHtml}</div>
      ${manageabilityReasoningHtml}
      <h3>Rationale</h3>
      ${rationaleHtml}
      <h3>Suggested mitigations / conditions</h3>
      ${mitigations}
      <h3>Suggested review date</h3>
      <p>${escapeHtml(a.review_date_suggestion || "(none suggested)")}</p>
      <h3>Confirm the grade</h3>
      ${gradeSelector(a.grade)}
      <div class="btn-row">
        <button class="btn" id="confirm-grade-btn">Continue with this grade</button>
        <button class="btn btn-secondary" id="back-to-facts-btn">Back to facts</button>
      </div>
    </div>`;
  wireGradeSelector(body, a);
  document.getElementById("back-to-facts-btn").onclick = () => { state.step = "facts"; render(); };
}

function gradeSelector(suggested) {
  const grades = ["Low", "Medium", "High"];
  return `<div class="field">
    <select id="grade-select">
      <option value="">-- select a grade --</option>
      ${grades.map(g => `<option value="${g}" ${g === suggested ? "selected" : ""}>${g}</option>`).join("")}
    </select>
  </div>`;
}

function wireGradeSelector(body, a) {
  document.getElementById("confirm-grade-btn").onclick = () => {
    const grade = document.getElementById("grade-select").value;
    if (!grade) { alert("Select a grade to continue."); return; }
    state.draft.grade = grade;
    if (state.mode === "NIA") {
      state.draft.manageability = grade === "High" ? (a && a.manageability) || "Manageable" : "Manageable";
    } else {
      state.draft.manageability = null;
    }
    state.draft.rationale_text = a && a.rationale ? a.rationale.map(r => "- " + r.text).join("\n") : "";
    state.draft.conditions_text = a && a.mitigations ? a.mitigations.map(m => "- " + m).join("\n") : "";
    state.draft.review_date = (a && a.review_date_suggestion) || "";
    // Seed the decision step from what's already known -- the officer
    // still has to explicitly choose the outcome, this just avoids
    // re-typing the declarant's name and a sensible starting review date.
    state.decision.declarant_name = (state.facts.declarant_name || {}).value || "";
    state.decision.case_reference = state.draft.case_reference;
    state.decision.conditions_text = state.draft.conditions_text;
    state.decision.review_date = addDays(state.draft.date, 365);
    state.decision.appeal_window_days = (state.rules.letters && state.rules.letters.appeal_window_days) || 21;
    state.decision.appeal_recipient_title = (state.rules.letters && state.rules.letters.appeal_recipient_title) || "Head of Professional Standards Department";
    state.decision.preparer_name = state.draft.preparer;
    state.step = "decision";
    render();
  };
}

// ---------------- Step 5: Decision & letter to applicant ----------------

function renderDecision(body) {
  const dec = state.decision;
  const isBI = state.mode === "BI";
  const positiveLabel = isBI ? "Approve" : "Association may continue";
  const negativeLabel = isBI ? "Decline" : "Association must cease";
  const positiveValue = isBI ? "Approved" : "Continue";
  const negativeValue = isBI ? "Declined" : "Cease";
  const standardConditions = (state.rules.letters && state.rules.letters.standard_conditions) || [];

  const outcomeButtons = `
    <div class="mode-cards">
      <div class="mode-card ${dec.outcome === positiveValue ? "selected" : ""}" id="pick-positive">
        <h3>${escapeHtml(positiveLabel)}</h3>
      </div>
      <div class="mode-card ${dec.outcome === negativeValue ? "selected" : ""}" id="pick-negative">
        <h3>${escapeHtml(negativeLabel)}</h3>
      </div>
    </div>`;

  let detailHtml = "";
  if (dec.outcome === positiveValue) {
    const checklist = standardConditions.map((c, i) => `
      <div class="field" style="margin-bottom:6px;">
        <label style="display:flex; align-items:flex-start; gap:8px; font-weight:400;">
          <input type="checkbox" data-cond-idx="${i}" ${dec.checkedStandard.includes(c) ? "checked" : ""} style="margin-top:3px;">
          <span>${escapeHtml(c)}</span>
        </label>
      </div>`).join("");
    detailHtml = `
      <fieldset>
        <legend>Standard conditions (tick any that apply)</legend>
        ${checklist}
      </fieldset>
      <div class="field">
        <label>Conditions to include in the letter (edit freely)</label>
        <textarea id="dec-conditions" rows="5">${escapeHtml(dec.conditions_text)}</textarea>
      </div>
      <div class="field">
        <label>Review date</label>
        <input type="text" id="dec-review-date" value="${escapeHtml(dec.review_date)}">
      </div>`;
  } else if (dec.outcome === negativeValue) {
    detailHtml = `
      <div class="field">
        <button class="btn btn-secondary" id="draft-reasons-btn">Draft reasons with AI</button>
      </div>
      ${dec.reasons_warning ? `<div class="warning-box">${escapeHtml(dec.reasons_warning)}</div>` : ""}
      <div class="field">
        <label>Reasons for this decision (edit freely -- this is what the applicant will read)</label>
        <textarea id="dec-reasons" rows="6">${escapeHtml(dec.reasons_text)}</textarea>
      </div>
      <div class="field">
        <label>Appeal recipient</label>
        <input type="text" id="dec-appeal-recipient" value="${escapeHtml(dec.appeal_recipient_title)}">
      </div>
      <div class="field">
        <label>Appeal window (days)</label>
        <input type="text" id="dec-appeal-days" value="${escapeHtml(String(dec.appeal_window_days))}">
      </div>`;
  }

  body.innerHTML = `
    <div class="panel">
      <h2>Decision</h2>
      <p>This is the officer's decision, not the AI's -- the outcome below is what gets recorded and sent to the applicant. The AI can help draft the reasons for a ${isBI ? "decline" : "cease"} letter, but never chooses the outcome itself.</p>

      <div class="field"><label>Applicant's name</label><input type="text" id="dec-declarant-name" value="${escapeHtml(dec.declarant_name)}"></div>
      <div class="field"><label>Case reference (optional)</label><input type="text" id="dec-case-ref" value="${escapeHtml(dec.case_reference)}"></div>

      <h3>Outcome</h3>
      ${outcomeButtons}
      <div id="decision-detail" style="margin-top:16px;">${detailHtml}</div>

      <div class="btn-row">
        <button class="btn" id="continue-to-draft-btn" ${dec.outcome ? "" : "disabled"}>Continue to review &amp; export</button>
        <button class="btn btn-secondary" id="back-to-assess-from-decision-btn">Back</button>
      </div>
    </div>`;

  document.getElementById("dec-declarant-name").oninput = e => { dec.declarant_name = e.target.value; };
  document.getElementById("dec-case-ref").oninput = e => { dec.case_reference = e.target.value; };

  document.getElementById("pick-positive").onclick = () => { dec.outcome = positiveValue; render(); };
  document.getElementById("pick-negative").onclick = () => { dec.outcome = negativeValue; render(); };

  if (dec.outcome === positiveValue) {
    body.querySelectorAll("[data-cond-idx]").forEach(cb => {
      cb.onchange = () => {
        const text = standardConditions[Number(cb.dataset.condIdx)];
        if (cb.checked) {
          if (!dec.checkedStandard.includes(text)) dec.checkedStandard.push(text);
          const ta = document.getElementById("dec-conditions");
          ta.value = ta.value ? ta.value + "\n- " + text : "- " + text;
          dec.conditions_text = ta.value;
        } else {
          dec.checkedStandard = dec.checkedStandard.filter(c => c !== text);
        }
      };
    });
    document.getElementById("dec-conditions").oninput = e => { dec.conditions_text = e.target.value; };
    document.getElementById("dec-review-date").oninput = e => { dec.review_date = e.target.value; };
  } else if (dec.outcome === negativeValue) {
    document.getElementById("draft-reasons-btn").onclick = () => doDraftReasons(dec.outcome === "Declined" ? "Declined" : "Cease");
    document.getElementById("dec-reasons").oninput = e => { dec.reasons_text = e.target.value; };
    document.getElementById("dec-appeal-recipient").oninput = e => { dec.appeal_recipient_title = e.target.value; };
    document.getElementById("dec-appeal-days").oninput = e => { dec.appeal_window_days = parseInt(e.target.value, 10) || 21; };
  }

  document.getElementById("continue-to-draft-btn").onclick = () => {
    state.step = "draft";
    render();
  };
  document.getElementById("back-to-assess-from-decision-btn").onclick = () => { state.step = "assess"; render(); };
}

async function doDraftReasons(decisionOutcome) {
  const dec = state.decision;
  dec.reasons_warning = "Drafting…";
  render();
  try {
    const res = await api("/api/decision-letter-reasons", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: state.mode, decision: decisionOutcome, rationale_text: state.draft.rationale_text }),
    });
    const data = await res.json();
    dec.reasons_text = data.reasons_text || "";
    dec.reasons_warning = data.warning || null;
  } catch (e) {
    dec.reasons_warning = "Could not draft reasons: " + e.message;
  }
  render();
}

// ---------------- Step 6: Draft & export ----------------

function renderDraft(body) {
  const factsSummaryRows = state.rules.fields.map(f => {
    const entry = state.facts[f.key] || { value: "" };
    return `<tr><td>${escapeHtml(f.label)}</td><td>${escapeHtml(entry.value || "(not stated)")}</td></tr>`;
  }).join("");

  const dec = state.decision;
  const isPositive = dec.outcome === "Approved" || dec.outcome === "Continue";

  body.innerHTML = `
    <div class="panel">
      <h2>Risk assessment report</h2>
      <p>Everything below is editable. Nothing is saved until you export. This document is for the internal case record.</p>

      <fieldset>
        <legend>Header</legend>
        <div class="field"><label>Case reference (optional)</label><input type="text" id="d-case-ref" value="${escapeHtml(state.draft.case_reference)}"></div>
        <div class="field"><label>Date</label><input type="text" id="d-date" value="${escapeHtml(state.draft.date)}"></div>
        <div class="field"><label>Preparer</label><input type="text" id="d-preparer" value="${escapeHtml(state.draft.preparer)}"></div>
      </fieldset>

      <fieldset>
        <legend>Declared facts summary</legend>
        <table style="width:100%; border-collapse:collapse; font-size:13px;">${factsSummaryRows}</table>
      </fieldset>

      <fieldset>
        <legend>Risk grading</legend>
        <div class="grade-display ${state.draft.grade}">${state.draft.grade}</div>
        ${state.mode === "NIA" ? `<div class="field"><label>Manageability</label>
          <select id="d-manageability">
            <option value="Manageable" ${state.draft.manageability === "Manageable" ? "selected" : ""}>Manageable</option>
            <option value="Escalate for manageability review" ${state.draft.manageability === "Escalate for manageability review" ? "selected" : ""}>Escalate for manageability review</option>
          </select></div>` : ""}
      </fieldset>

      <fieldset>
        <legend>Rationale</legend>
        <textarea id="d-rationale" rows="6">${escapeHtml(state.draft.rationale_text)}</textarea>
      </fieldset>

      <fieldset>
        <legend>Recommended conditions/mitigations</legend>
        <textarea id="d-conditions" rows="4">${escapeHtml(state.draft.conditions_text)}</textarea>
      </fieldset>

      <fieldset>
        <legend>Recommended review date</legend>
        <input type="text" id="d-review-date" value="${escapeHtml(state.draft.review_date)}">
      </fieldset>

      <fieldset>
        <legend>Sign-off</legend>
        <div class="field"><label>Preparer name</label><input type="text" id="d-preparer-name" value="${escapeHtml(state.draft.preparer_name)}"></div>
        <div class="field"><label>Preparer date</label><input type="text" id="d-preparer-date" value="${escapeHtml(state.draft.preparer_date)}"></div>
        <p style="color:var(--text-muted); font-size:13px;">Reviewing officer name/date are left blank in the exported document for manual completion.</p>
      </fieldset>

      <h3>Export report</h3>
      <div class="export-choice">
        <button class="btn" id="export-report-docx-btn">Export as Word (.docx)</button>
        <button class="btn" id="export-report-pdf-btn">Export as PDF</button>
      </div>
      <div id="export-report-status"></div>
    </div>

    <div class="panel">
      <h2>Letter to applicant</h2>
      <p>Outcome: <strong>${escapeHtml(dec.outcome || "(not set)")}</strong>. Everything below is editable -- review before sending, including whether the level of detail in the reasons is appropriate to disclose.</p>

      <fieldset>
        <legend>Header</legend>
        <div class="field"><label>Date</label><input type="text" id="l-date" value="${escapeHtml(state.draft.date)}"></div>
        <div class="field"><label>Applicant's name</label><input type="text" id="l-declarant-name" value="${escapeHtml(dec.declarant_name)}"></div>
        <div class="field"><label>Case reference (optional)</label><input type="text" id="l-case-ref" value="${escapeHtml(dec.case_reference)}"></div>
      </fieldset>

      ${isPositive ? `
      <fieldset>
        <legend>Conditions</legend>
        <textarea id="l-conditions" rows="4">${escapeHtml(dec.conditions_text)}</textarea>
      </fieldset>
      <fieldset>
        <legend>Review date</legend>
        <input type="text" id="l-review-date" value="${escapeHtml(dec.review_date)}">
      </fieldset>` : `
      <fieldset>
        <legend>Reasons</legend>
        <textarea id="l-reasons" rows="5">${escapeHtml(dec.reasons_text)}</textarea>
      </fieldset>
      <fieldset>
        <legend>Appeal</legend>
        <div class="field"><label>Recipient</label><input type="text" id="l-appeal-recipient" value="${escapeHtml(dec.appeal_recipient_title)}"></div>
        <div class="field"><label>Window (days)</label><input type="text" id="l-appeal-days" value="${escapeHtml(String(dec.appeal_window_days))}"></div>
      </fieldset>`}

      <fieldset>
        <legend>Sign-off</legend>
        <div class="field"><label>Preparer name</label><input type="text" id="l-preparer-name" value="${escapeHtml(dec.preparer_name)}"></div>
      </fieldset>

      <h3>Export letter</h3>
      <div class="export-choice">
        <button class="btn" id="export-letter-docx-btn">Export as Word (.docx)</button>
        <button class="btn" id="export-letter-pdf-btn">Export as PDF</button>
      </div>
      <div id="export-letter-status"></div>
    </div>

    <div class="btn-row">
      <button class="btn btn-secondary" id="back-to-decision-btn">Back to decision</button>
      <button class="btn btn-secondary" id="start-over-btn">Start a new assessment</button>
    </div>`;

  const bind = (id, key) => document.getElementById(id).oninput = e => { state.draft[key] = e.target.value; };
  bind("d-case-ref", "case_reference");
  bind("d-date", "date");
  bind("d-preparer", "preparer");
  bind("d-rationale", "rationale_text");
  bind("d-conditions", "conditions_text");
  bind("d-review-date", "review_date");
  bind("d-preparer-name", "preparer_name");
  bind("d-preparer-date", "preparer_date");
  const mSelect = document.getElementById("d-manageability");
  if (mSelect) mSelect.onchange = e => { state.draft.manageability = e.target.value; };

  const bindDec = (id, key) => document.getElementById(id).oninput = e => { dec[key] = e.target.value; };
  document.getElementById("l-date").oninput = e => { state.draft.date = e.target.value; };
  bindDec("l-declarant-name", "declarant_name");
  bindDec("l-case-ref", "case_reference");
  bindDec("l-preparer-name", "preparer_name");
  if (isPositive) {
    bindDec("l-conditions", "conditions_text");
    bindDec("l-review-date", "review_date");
  } else {
    bindDec("l-reasons", "reasons_text");
    bindDec("l-appeal-recipient", "appeal_recipient_title");
    document.getElementById("l-appeal-days").oninput = e => { dec.appeal_window_days = parseInt(e.target.value, 10) || 21; };
  }

  document.getElementById("export-report-docx-btn").onclick = () => doExport("docx");
  document.getElementById("export-report-pdf-btn").onclick = () => doExport("pdf");
  document.getElementById("export-letter-docx-btn").onclick = () => doExportLetter("docx");
  document.getElementById("export-letter-pdf-btn").onclick = () => doExportLetter("pdf");
  document.getElementById("back-to-decision-btn").onclick = () => { state.step = "decision"; render(); };
  document.getElementById("start-over-btn").onclick = () => {
    if (confirm("Discard this session and start a new assessment?")) location.reload();
  };
}

async function doExport(format) {
  const status = document.getElementById("export-status");
  status.innerHTML = `<div class="warning-box">Generating ${format.toUpperCase()}…</div>`;
  const draft = {
    mode: state.mode,
    case_reference: state.draft.case_reference,
    date: state.draft.date,
    preparer: state.draft.preparer,
    facts_summary: state.rules.fields.map(f => ({ label: f.label, value: (state.facts[f.key] || {}).value || "" })),
    grade: state.draft.grade,
    manageability: state.mode === "NIA" ? state.draft.manageability : null,
    rationale_text: state.draft.rationale_text,
    conditions_text: state.draft.conditions_text,
    review_date: state.draft.review_date,
    policy_basis: state.rules.policy_basis,
    preparer_name: state.draft.preparer_name,
    preparer_date: state.draft.preparer_date,
  };
  try {
    const res = await api("/api/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draft, format }),
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `risk-assessment.${format}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    status.innerHTML = `<div class="warning-box">Downloaded. Nothing was saved on the server.</div>`;
  } catch (e) {
    status.innerHTML = `<div class="error-box">Export failed: ${escapeHtml(e.message)}</div>`;
  }
}

async function doExportLetter(format) {
  const status = document.getElementById("export-letter-status");
  status.innerHTML = `<div class="warning-box">Generating ${format.toUpperCase()}…</div>`;
  const dec = state.decision;
  const letter = {
    mode: state.mode,
    decision: dec.outcome,
    date: state.draft.date,
    declarant_name: dec.declarant_name,
    case_reference: dec.case_reference,
    grade: state.draft.grade,
    conditions_text: dec.conditions_text,
    reasons_text: dec.reasons_text,
    review_date: dec.review_date,
    appeal_window_days: dec.appeal_window_days,
    appeal_recipient_title: dec.appeal_recipient_title,
    preparer_name: dec.preparer_name,
  };
  try {
    const res = await api("/api/export-letter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ letter, format }),
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `decision-letter.${format}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    status.innerHTML = `<div class="warning-box">Downloaded. Nothing was saved on the server.</div>`;
  } catch (e) {
    status.innerHTML = `<div class="error-box">Export failed: ${escapeHtml(e.message)}</div>`;
  }
}

// ---------------- Utilities ----------------

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

loadHealth();
render();
