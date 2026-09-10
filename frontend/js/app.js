/* NIA/BI Risk Assessment Generator -- vanilla JS, no build step, no framework.
 * Everything lives in `state` in memory; nothing is persisted anywhere
 * (no localStorage, no server-side session) -- reload the page and the
 * session is gone, by design (PRD Section 9: stateless, session-only). */

const STEPS = ["mode", "upload", "facts", "assess", "draft"];
const STEP_LABELS = { mode: "Mode", upload: "Upload", facts: "Confirm facts", assess: "Risk assessment", draft: "Review & export" };

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
    state.step = "draft";
    render();
  };
}

// ---------------- Step 5: Draft & export ----------------

function renderDraft(body) {
  const factsSummaryRows = state.rules.fields.map(f => {
    const entry = state.facts[f.key] || { value: "" };
    return `<tr><td>${escapeHtml(f.label)}</td><td>${escapeHtml(entry.value || "(not stated)")}</td></tr>`;
  }).join("");

  body.innerHTML = `
    <div class="panel">
      <h2>Review and edit the draft</h2>
      <p>Everything below is editable. Nothing is saved until you export.</p>

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

      <h3>Export</h3>
      <div class="export-choice">
        <button class="btn" id="export-docx-btn">Export as Word (.docx)</button>
        <button class="btn" id="export-pdf-btn">Export as PDF</button>
      </div>
      <div id="export-status"></div>

      <div class="btn-row">
        <button class="btn btn-secondary" id="back-to-assess-btn">Back to assessment</button>
        <button class="btn btn-secondary" id="start-over-btn">Start a new assessment</button>
      </div>
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

  document.getElementById("export-docx-btn").onclick = () => doExport("docx");
  document.getElementById("export-pdf-btn").onclick = () => doExport("pdf");
  document.getElementById("back-to-assess-btn").onclick = () => { state.step = "assess"; render(); };
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

// ---------------- Utilities ----------------

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

loadHealth();
render();
