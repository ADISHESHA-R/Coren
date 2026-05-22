/**
 * Default shapes for site job workflow steps 4–7 (advance, technician payments,
 * tool issues, challenges). Backend stores JSON arrays; field names are stable
 * for reporting and can be mapped in the API layer if needed.
 */

export const ADVANCE_EXPENSE_ROW_COUNT = 8;
export const TECHNICIAN_PAYMENT_ROW_COUNT = 12;
export const TECHNICIAN_PAYMENT_SLOTS = 6;
export const TOOL_ISSUE_ROW_COUNT = 8;

/** Editable job-data tables can grow/shrink between these bounds (UI add/remove). */
export const WORKFLOW_JOB_TABLE_MIN_ROWS = 1;
export const WORKFLOW_JOB_TABLE_MAX_ROWS = 40;

/** Fallback when /api/meta/challenge-line-heads is empty (paper form). */
export const CHALLENGE_HEADS_FALLBACK = [
  { index: 1, label: "Transport" },
  { index: 2, label: "Un-Loading" },
  { index: 3, label: "Crane" },
  { index: 4, label: "Entry Passes" },
  { index: 5, label: "Safety Training" },
  { index: 6, label: "Eqmt Set up" },
  { index: 7, label: "Work Front Delay" },
  { index: 8, label: "Job Inspection" },
  { index: 9, label: "Job Clearance" },
  { index: 10, label: "Power" },
  { index: 11, label: "Welding" },
  { index: 12, label: "Coren Manpower" },
  { index: 13, label: "Eqmt Failure" },
  { index: 14, label: "Tool Damage" },
  { index: 15, label: "Non-Avlbty - Tools" },
  { index: 16, label: "Customer Clearance" },
  { index: 17, label: "Job related Issues" },
  { index: 18, label: "WCR" },
  { index: 19, label: "Eqmt Despatch" },
  { index: 20, label: "Work site Closed" },
  { index: 21, label: "Work Timing Restriction" },
  { index: 22, label: "Local Manpower Issue" },
];

export function emptyAdvanceExpenseRow(slNo) {
  return {
    slNo,
    dateAdvanceReceived: "",
    openingBalance: "",
    amount: "",
    foodAllow: "",
    conveyance: "",
    medical: "",
    additionalManpower: "",
    welding: "",
    siteExpenses: "",
    balanceInHand: "",
    dispersionDetails: "",
  };
}

export function emptyTechnicianPaymentRow(slNo) {
  const payments = Array.from({ length: TECHNICIAN_PAYMENT_SLOTS }, () => ({ date: "", amount: "" }));
  return { slNo, technicianName: "", technicianUserId: null, payments, totalPayment: "" };
}

export function emptyToolIssueRow(slNo) {
  return {
    slNo,
    packingListSlNo: "",
    itemDescription: "",
    missingDate: "",
    damageDate: "",
    repairDate: "",
    handledBy: "",
    handledByEmployeeUserId: null,
    issueDescription: "",
  };
}

export function emptyChallengeLineRow(headIndex, headLabel) {
  return {
    headIndex,
    headLabel,
    dateOfIncident: "",
    involved: "",
    involvedEmployeeUserId: null,
    challengesFaced: "",
    resolutionStatus: "",
  };
}

export function normalizeAdvanceLines(arr) {
  const a = Array.isArray(arr) ? arr : [];
  const rowCount = Math.min(
    WORKFLOW_JOB_TABLE_MAX_ROWS,
    Math.max(WORKFLOW_JOB_TABLE_MIN_ROWS, Math.max(ADVANCE_EXPENSE_ROW_COUNT, a.length)),
  );
  const rows = [];
  for (let i = 0; i < rowCount; i += 1) {
    const src = a[i] || {};
    const base = emptyAdvanceExpenseRow(i + 1);
    rows.push({
      ...base,
      ...src,
      slNo: i + 1,
      dateAdvanceReceived: src.dateAdvanceReceived ?? src.dateOfAdvanceReceived ?? "",
      openingBalance: src.openingBalance ?? src.openingBal ?? "",
      siteExpenses: src.siteExpenses ?? src.siteExpn ?? "",
      balanceInHand: src.balanceInHand ?? src.balInHand ?? "",
      dispersionDetails: src.dispersionDetails ?? src.detailsOfDispersion ?? "",
    });
  }
  return rows;
}

export function normalizeTechnicianPaymentLines(arr) {
  const a = Array.isArray(arr) ? arr : [];
  const rowCount = Math.min(
    WORKFLOW_JOB_TABLE_MAX_ROWS,
    Math.max(WORKFLOW_JOB_TABLE_MIN_ROWS, Math.max(TECHNICIAN_PAYMENT_ROW_COUNT, a.length)),
  );
  const rows = [];
  for (let i = 0; i < rowCount; i += 1) {
    const src = a[i] || {};
    const payments = Array.from({ length: TECHNICIAN_PAYMENT_SLOTS }, (_, j) => {
      const p = Array.isArray(src.payments) ? src.payments[j] : null;
      if (p && typeof p === "object") return { date: p.date ?? "", amount: p.amount ?? "" };
      const k = j + 1;
      return {
        date: src[`paymentDate${k}`] ?? src[`date${k}`] ?? "",
        amount: src[`paymentAmount${k}`] ?? src[`amount${k}`] ?? "",
      };
    });
    const tid = src.technicianUserId ?? src.employeeUserId ?? src.userId;
    const technicianUserId =
      tid != null && tid !== "" && Number.isFinite(Number(tid)) ? Number(tid) : null;
    rows.push({
      slNo: i + 1,
      technicianName: src.technicianName ?? src.name ?? "",
      technicianUserId,
      payments,
      totalPayment: src.totalPayment ?? src.total ?? "",
    });
  }
  return rows;
}

export function normalizeToolIssueLines(arr) {
  const a = Array.isArray(arr) ? arr : [];
  const rowCount = Math.min(
    WORKFLOW_JOB_TABLE_MAX_ROWS,
    Math.max(WORKFLOW_JOB_TABLE_MIN_ROWS, Math.max(TOOL_ISSUE_ROW_COUNT, a.length)),
  );
  const rows = [];
  for (let i = 0; i < rowCount; i += 1) {
    const src = a[i] || {};
    const hid = src.handledByEmployeeUserId ?? src.handledByUserId;
    const handledByEmployeeUserId =
      hid != null && hid !== "" && Number.isFinite(Number(hid)) ? Number(hid) : null;
    rows.push({
      ...emptyToolIssueRow(i + 1),
      ...src,
      slNo: i + 1,
      handledByEmployeeUserId,
    });
  }
  return rows;
}

/** Resolve challenge heads list (API or static fallback). */
export function resolveChallengeHeads(apiHeads) {
  if (Array.isArray(apiHeads) && apiHeads.length > 0) return apiHeads;
  return CHALLENGE_HEADS_FALLBACK;
}

export function normalizeChallengeLines(savedArr, heads) {
  const list = resolveChallengeHeads(heads);
  const byIndex = new Map();
  if (Array.isArray(savedArr)) {
    for (const row of savedArr) {
      const idx = row.headIndex ?? row.index ?? row.challengeHeadIndex;
      if (idx != null) byIndex.set(Number(idx), row);
    }
  }
  return list.map((h) => {
    const idx = h.index != null ? Number(h.index) : null;
    const prev = idx != null ? byIndex.get(idx) : null;
    return {
      ...emptyChallengeLineRow(idx ?? 0, h.label || ""),
      ...prev,
      headIndex: idx ?? 0,
      headLabel: h.label || prev?.headLabel || "",
    };
  });
}

/**
 * Challenge lines for one row per catalog head, plus saved rows whose headIndex is not in the catalog
 * (e.g. user-added lines). `workflowSupplemental` is UI-only and stripped before PUT.
 */
export function buildChallengeLineWorkflowState(savedArr, heads) {
  const base = normalizeChallengeLines(savedArr, heads);
  const list = resolveChallengeHeads(heads);
  const catalogIdx = new Set(list.map((h) => Number(h.index)).filter((n) => Number.isFinite(n)));
  const used = new Set(base.map((r) => Number(r.headIndex)));
  const extras = [];
  if (Array.isArray(savedArr)) {
    for (const row of savedArr) {
      const idx = Number(row.headIndex ?? row.index ?? row.challengeHeadIndex);
      if (!Number.isFinite(idx)) continue;
      if (catalogIdx.has(idx)) continue;
      if (used.has(idx)) continue;
      used.add(idx);
      const label = String(row.headLabel ?? row.label ?? "Additional").trim() || "Additional";
      extras.push({
        ...emptyChallengeLineRow(idx, label),
        ...row,
        headIndex: idx,
        headLabel: label,
        workflowSupplemental: true,
      });
    }
  }
  return [...base, ...extras];
}

export function stripChallengeLineForApi(row) {
  if (!row || typeof row !== "object") return row;
  const { workflowSupplemental: _omitUi, ...rest } = row;
  return rest;
}

export const BEHAVIOUR_MEMBER_SLOTS = 8;
export const BEHAVIOUR_MEMBER_MIN = 1;
export const BEHAVIOUR_MEMBER_MAX = 16;
export const BEHAVIOUR_ISSUE_ROWS = [
  { slNo: 1, label: "Late to Site" },
  { slNo: 2, label: "Not listening to Sr's instruction" },
  { slNo: 3, label: "Safety violation" },
  { slNo: 4, label: "Absent without notice" },
  { slNo: 5, label: "Conflict with team / customer" },
  { slNo: 6, label: "Sub-standard work quality" },
  { slNo: 7, label: "Alcohol / substance at site" },
  { slNo: 8, label: "Other (describe in remarks column)" },
];

export function emptyBehaviourState() {
  const members = Array.from({ length: BEHAVIOUR_MEMBER_SLOTS }, () => "");
  const memberEmployeeUserIds = Array.from({ length: BEHAVIOUR_MEMBER_SLOTS }, () => null);
  const matrix = BEHAVIOUR_ISSUE_ROWS.map(() =>
    Array.from({ length: BEHAVIOUR_MEMBER_SLOTS }, () => ({ checked: false, date: "" })),
  );
  return { members, memberEmployeeUserIds, matrix, remarks: "" };
}

/** Parse behaviour report API payload into editable state. */
export function parseBehaviourReport(raw) {
  let obj = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw || "{}");
    } catch {
      return emptyBehaviourState();
    }
  }
  if (!obj || typeof obj !== "object") return emptyBehaviourState();

  if (Array.isArray(obj.matrix) && Array.isArray(obj.members)) {
    let colCount = obj.members.length;
    for (const mr of obj.matrix) {
      if (Array.isArray(mr)) colCount = Math.max(colCount, mr.length);
    }
    colCount = Math.min(BEHAVIOUR_MEMBER_MAX, Math.max(BEHAVIOUR_MEMBER_MIN, colCount));
    const members = Array.from({ length: colCount }, (_, i) => String(obj.members[i] ?? "").trim());
    const rawIds = Array.isArray(obj.memberEmployeeUserIds) ? obj.memberEmployeeUserIds : [];
    const memberEmployeeUserIds = Array.from({ length: colCount }, (_, i) => {
      const v = rawIds[i];
      if (v == null || v === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    });
    const matrix = BEHAVIOUR_ISSUE_ROWS.map((_, ri) => {
      const row = Array.isArray(obj.matrix[ri]) ? obj.matrix[ri] : [];
      return Array.from({ length: colCount }, (_, ci) => {
        const cell = row[ci];
        if (cell && typeof cell === "object") {
          return { checked: Boolean(cell.checked), date: cell.date != null ? String(cell.date) : "" };
        }
        return { checked: false, date: "" };
      });
    });
    return { members, memberEmployeeUserIds, matrix, remarks: String(obj.remarks ?? "") };
  }

  return emptyBehaviourState();
}

export function serializeBehaviourReport(state) {
  const memberEmployeeUserIds = Array.isArray(state.memberEmployeeUserIds)
    ? state.memberEmployeeUserIds.map((v) => (v != null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null))
    : [];
  return {
    version: 1,
    members: state.members,
    memberEmployeeUserIds,
    matrix: state.matrix,
    remarks: state.remarks ?? "",
  };
}

/** Grow or shrink member columns; preserves cell data where columns overlap. */
export function resizeBehaviourMemberColumns(state, newCount) {
  const n = Math.min(BEHAVIOUR_MEMBER_MAX, Math.max(BEHAVIOUR_MEMBER_MIN, newCount));
  const members = Array.from({ length: n }, (_, i) => String(state.members[i] ?? "").trim());
  const prevIds = Array.isArray(state.memberEmployeeUserIds) ? state.memberEmployeeUserIds : [];
  const memberEmployeeUserIds = Array.from({ length: n }, (_, i) => prevIds[i] ?? null);
  const matrix = BEHAVIOUR_ISSUE_ROWS.map((_, ri) => {
    const oldRow = state.matrix[ri] || [];
    return Array.from({ length: n }, (_, ci) => {
      const c = oldRow[ci];
      if (c && typeof c === "object") {
        return { checked: Boolean(c.checked), date: c.date != null ? String(c.date) : "" };
      }
      return { checked: false, date: "" };
    });
  });
  return { ...state, members, memberEmployeeUserIds, matrix, remarks: state.remarks ?? "" };
}

/** Parse customer feedback admin payload for display / local edit mirror. */
export function parseCustomerFeedbackRecord(fb) {
  if (!fb || typeof fb !== "object") return null;
  let extra = {};
  try {
    const raw = fb.feedbackJson;
    if (typeof raw === "string" && raw.trim()) extra = JSON.parse(raw);
    else if (raw && typeof raw === "object") extra = raw;
  } catch {
    extra = {};
  }
  return {
    certificateClientStatus: fb.certificateClientStatus ?? "NONE",
    customerFeedbackApprovedAt: fb.customerFeedbackApprovedAt ?? null,
    name: extra.name ?? "",
    email: extra.email ?? "",
    phone: extra.phone ?? "",
    companyName: extra.companyName ?? "",
    productQuality: extra.productQuality ?? "",
    customerService: extra.customerService ?? "",
    machiningQuality: extra.machiningQuality ?? "",
    pricing: extra.pricing ?? "",
    shippingDelivery: extra.shippingDelivery ?? "",
    otherCategoryNote: extra.otherCategoryNote ?? "",
    specificFeedback: extra.specificFeedback ?? "",
    suggestions: extra.suggestions ?? "",
    likelihoodRecommend: extra.likelihoodRecommend != null ? String(extra.likelihoodRecommend) : "",
    additionalComments: extra.additionalComments ?? "",
    rawJson: typeof fb.feedbackJson === "string" ? fb.feedbackJson : JSON.stringify(fb.feedbackJson ?? {}),
  };
}
