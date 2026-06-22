import React, { useState, useRef } from "react";

// ============================================================
// CONSTANTS  (REQ-002, REQ-003, REQ-004)
// ============================================================
const PAYMENT_TYPES = [
    { value: "card", label: "Card Payment" },
    { value: "eft", label: "EFT" },
    { value: "internal", label: "Internal Transfer" },
    { value: "debit_order", label: "Debit Order" },
    { value: "rtp", label: "Real-Time Payment" },
];
const ISSUE_CATEGORIES = [
    { value: "unauthorized", label: "Unauthorized Transaction" },
    { value: "duplicate", label: "Duplicate Payment" },
    { value: "incorrect_amount", label: "Incorrect Amount" },
    { value: "not_received", label: "Payment Not Received" },
    { value: "wrong_beneficiary", label: "Wrong Beneficiary" },
    { value: "fraud", label: "Suspected Fraud" },
];
const STATUSES = [
    { value: "completed", label: "Completed" },
    { value: "pending", label: "Pending" },
    { value: "reversed", label: "Reversed" },
    { value: "failed", label: "Failed" },
];
const PRIORITY_LABEL = { critical: "Critical", high: "High", medium: "Medium", low: "Low" };
const labelOf = (list, v) => (list.find((x) => x.value === v) || {}).label || v;

// ============================================================
// UTILS  (REQ-009 reference, ZAR formatting)
// ============================================================
const formatRand = (n) => "R" + Number(n).toLocaleString("en-ZA");
let seq = 0;
const generateReference = () => "DSP-" + String(2601 + seq++).padStart(5, "0");

// ============================================================
// ENGINE: age  (REQ-011, REQ-012)
// ============================================================
function ageInDays(dateStr) {
    const a = new Date(dateStr).setHours(0, 0, 0, 0);
    const b = new Date().setHours(0, 0, 0, 0);
    return Math.floor((b - a) / 86400000);
}
function ageBand(days) {
    if (days <= 3) return "Recent";
    if (days <= 7) return "Standard";
    if (days <= 30) return "Aged";
    return "Overdue";
}

// ============================================================
// ENGINE: priority  (REQ-014 to REQ-022)
// ============================================================
const RANK = { low: 1, medium: 2, high: 3, critical: 4 };
const atLeast = (cur, floor) => (RANK[floor] > RANK[cur] ? floor : cur);

function determinePriority(d) {
    // Hard overrides first
    if (d.issue === "fraud") return "critical"; // REQ-015
    if (d.issue === "unauthorized" && d.status !== "reversed") return "critical"; // REQ-016

    let p = "low"; // REQ-022 default
    if (d.amount > 50000) p = atLeast(p, "high"); // REQ-017
    if (d.age > 30) p = atLeast(p, "high"); // REQ-018
    if (d.issue === "wrong_beneficiary" && d.status === "completed") p = atLeast(p, "high"); // REQ-019
    if (d.amount >= 5000 && d.amount <= 50000) p = atLeast(p, "medium"); // REQ-020
    if (d.age >= 7 && d.age <= 30) p = atLeast(p, "medium"); // REQ-021
    return p;
}

// ============================================================
// ENGINE: action  (REQ-024 to REQ-039)  first-match-wins
// ============================================================
function recommendAction(d) {
    if (d.status === "reversed")
        return { action: "Confirm the reversal with the customer and close the dispute.", disposition: "Resolve immediately" }; // REQ-025
    if (d.status === "failed")
        return { action: "Confirm the transaction failure with the customer. No debit occurred.", disposition: "Resolve immediately" }; // REQ-026
    if (d.issue === "fraud")
        return { action: "Immediately block the card or channel, initiate a fraud investigation, and file a suspicious activity report.", disposition: "Escalate" }; // REQ-027
    if (d.issue === "unauthorized" && d.type === "debit_order")
        return { action: "Initiate a debit order dispute reversal and block future debits from the originator.", disposition: "Refer to another team" }; // REQ-028
    if (d.issue === "unauthorized" && d.type === "card")
        return { action: "Initiate a chargeback process and block the compromised card.", disposition: "Refer to another team" }; // REQ-029
    if (d.issue === "unauthorized" && (d.type === "eft" || d.type === "internal"))
        return { action: "Escalate to investigations and initiate a recall request.", disposition: "Escalate" }; // REQ-030
    if (d.issue === "duplicate" && d.amount <= 5000)
        return { action: "Process an immediate reversal.", disposition: "Resolve immediately" }; // REQ-031
    if (d.issue === "duplicate" && d.amount > 5000)
        return { action: "Verify the duplicate with transaction evidence, then process reversal with supervisor approval.", disposition: "Investigate further" }; // REQ-032
    if (d.issue === "incorrect_amount" && d.type === "debit_order")
        return { action: "Dispute the debit order amount and reverse the full amount.", disposition: "Refer to another team" }; // REQ-033
    if (d.issue === "incorrect_amount")
        return { action: "Investigate the amount discrepancy against the original instruction on file.", disposition: "Investigate further" }; // REQ-034
    if (d.issue === "not_received" && d.age <= 3)
        return { action: "Advise the customer of standard processing timelines and monitor for 48 hours.", disposition: "Investigate further" }; // REQ-035
    if (d.issue === "not_received" && d.type === "rtp")
        return { action: "Trace the payment and escalate to payments operations for immediate investigation.", disposition: "Escalate" }; // REQ-036
    if (d.issue === "not_received" && d.age > 3)
        return { action: "Initiate a payment trace with the receiving institution.", disposition: "Investigate further" }; // REQ-037
    if (d.issue === "wrong_beneficiary" && d.age <= 1)
        return { action: "Attempt a same-day recall before end of clearing window.", disposition: "Resolve immediately" }; // REQ-038
    if (d.issue === "wrong_beneficiary" && d.age > 1)
        return { action: "Initiate an inter-bank recall request and advise the customer of recovery timelines.", disposition: "Refer to another team" }; // REQ-039
    return { action: "Investigate the dispute against transaction records and determine the appropriate resolution.", disposition: "Investigate further" };
}

// ============================================================
// ENGINE: routing  (REQ-041 to REQ-048)  first-match-wins
// ============================================================
function routeTeam(d) {
    if (d.issue === "fraud") return "Fraud Investigations Unit"; // REQ-042
    if (d.issue === "unauthorized" && d.type === "card") return "Card Disputes Team"; // REQ-043
    if (d.issue === "unauthorized" && d.type === "debit_order") return "Debit Order Disputes Team"; // REQ-044
    if (d.type === "rtp") return "Real-Time Payments Support"; // REQ-045
    if (d.issue === "wrong_beneficiary") return "Payment Recall Team"; // REQ-046
    if (d.amount > 50000) return "Senior Disputes Resolution"; // REQ-047
    return "General Disputes Queue"; // REQ-048
}

// ============================================================
// ENGINE: sla  (REQ-050 to REQ-055)
// ============================================================
function assignSLA(d, priority) {
    if (d.issue === "fraud") return "4 hours"; // REQ-051
    if (priority === "critical") return "24 hours"; // REQ-052
    if (priority === "high") return "3 business days"; // REQ-053
    if (priority === "medium") return "5 business days"; // REQ-054
    return "10 business days"; // REQ-055
}

// ============================================================
// ENGINE: reason  (REQ-040, REQ-060)
// ============================================================
function buildReasonText(d, priority) {
    const bits = [];
    if (d.issue === "fraud") bits.push("the case is flagged as suspected fraud");
    else if (d.issue === "unauthorized" && d.status !== "reversed")
        bits.push("it is an unauthorized transaction that has not been reversed");
    if (d.amount > 50000) bits.push("a high-value amount above R50,000");
    if (d.age > 30) bits.push("an age exceeding 30 days");
    else if (d.age >= 7) bits.push("an age in the 7 to 30 day band");
    if (d.issue === "wrong_beneficiary" && d.status === "completed")
        bits.push("a completed payment to the wrong beneficiary");
    if (d.amount >= 5000 && d.amount <= 50000) bits.push("a mid-range amount between R5,000 and R50,000");

    if (bits.length === 0)
        return `Priority is ${PRIORITY_LABEL[priority]} as no elevated-priority conditions were met.`;
    return `Priority is ${PRIORITY_LABEL[priority]} because ${bits.join(", ")}.`;
}

// ============================================================
// ORCHESTRATOR  (assess.js)
// ============================================================
function assess(d) {
    const priority = determinePriority(d);
    const { action, disposition } = recommendAction(d);
    return {
        priority,
        disposition,
        action,
        team: routeTeam(d),
        sla: assignSLA(d, priority),
        reason: buildReasonText(d, priority),
    };
}

// ============================================================
// THEME
// ============================================================
const PRIORITY_THEME = {
    critical: { border: "#E24B4A", badgeBg: "#F7C1C1", badgeText: "#791F1F", dot: "#E24B4A", cardBg: "#FCEBEB", dispText: "#791F1F" },
    high: { border: "#D85A30", badgeBg: "#F5C4B3", badgeText: "#712B13", dot: "#D85A30", cardBg: "#FAECE7", dispText: "#712B13" },
    medium: { border: "#EF9F27", badgeBg: "#FAC775", badgeText: "#633806", dot: "#EF9F27", cardBg: "#FAEEDA", dispText: "#633806" },
    low: { border: "#639922", badgeBg: "#C0DD97", badgeText: "#27500A", dot: "#639922", cardBg: "#EAF3DE", dispText: "#27500A" },
};

const EMPTY_FORM = { name: "", account: "", type: "", amount: "", date: "", status: "", issue: "", notes: "" };

export default function App() {
    const [form, setForm] = useState(EMPTY_FORM);
    const [errors, setErrors] = useState({});
    const [current, setCurrent] = useState(null);
    const [log, setLog] = useState([]);
    const recRef = useRef(null);

    const today = new Date().toISOString().split("T")[0];
    const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

    function validate() {
        const e = {};
        if (!form.name.trim()) e.name = "Customer name is required";
        if (!form.account.trim()) e.account = "Account number is required";
        if (!form.type) e.type = "Payment type is required";
        if (!(parseFloat(form.amount) > 0)) e.amount = "Enter an amount greater than zero"; // REQ-007
        if (!form.date || form.date > today) e.date = "Date is required and cannot be in the future"; // REQ-006
        if (!form.status) e.status = "Transaction status is required";
        if (!form.issue) e.issue = "Issue category is required";
        return e;
    }

    function handleAssess() {
        const e = validate();
        setErrors(e);
        if (Object.keys(e).length) return; // REQ-005, REQ-073

        const reference = generateReference(); // REQ-009
        const age = ageInDays(form.date); // REQ-011
        const dispute = { ...form, amount: parseFloat(form.amount), age };
        const result = assess(dispute);

        setCurrent({ reference, dispute, result });
        setLog((l) => [
            { reference, name: form.name, amount: dispute.amount, type: form.type, issue: form.issue, age, priority: result.priority, team: result.team, capturedAt: new Date() },
            ...l,
        ]); // REQ-062, REQ-065

        // REQ-069 auto-scroll
        setTimeout(() => recRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
    }

    function handleReset() {
        setForm(EMPTY_FORM);
        setErrors({});
        setCurrent(null);
    } // REQ-070

    return (
        <div style={S.page}>
            <div style={S.wrap}>
                <header style={{ marginBottom: 20 }}>
                    <h1 style={S.h1}>Payment dispute triage</h1>
                    <p style={S.sub}>Capture a dispute, get a recommended action, routing, and SLA</p>
                </header>

                {/* CAPTURE FORM */}
                <section style={S.card}>
                    <div style={S.cardTitle}>New dispute</div>

                    <div style={S.secLabel}>Customer details</div>
                    <div style={S.grid2}>
                        <Field label="Customer name" error={errors.name}>
                            <input style={inp(errors.name)} value={form.name} onChange={set("name")} />
                        </Field>
                        <Field label="Account number" error={errors.account}>
                            <input style={inp(errors.account)} value={form.account} onChange={set("account")} />
                        </Field>
                    </div>

                    <div style={S.secLabel}>Transaction details</div>
                    <div style={S.grid2}>
                        <Field label="Payment type" error={errors.type}>
                            <select style={inp(errors.type)} value={form.type} onChange={set("type")}>
                                <option value="">Select...</option>
                                {PAYMENT_TYPES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                        </Field>
                        <Field label="Amount (R)" error={errors.amount}>
                            <input type="number" min="0" step="0.01" style={inp(errors.amount)} value={form.amount} onChange={set("amount")} />
                        </Field>
                        <Field label="Transaction date" error={errors.date}>
                            <input type="date" max={today} style={inp(errors.date)} value={form.date} onChange={set("date")} />
                        </Field>
                        <Field label="Transaction status" error={errors.status}>
                            <select style={inp(errors.status)} value={form.status} onChange={set("status")}>
                                <option value="">Select...</option>
                                {STATUSES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                        </Field>
                    </div>

                    <div style={S.secLabel}>Dispute details</div>
                    <Field label="Issue category" error={errors.issue}>
                        <select style={inp(errors.issue)} value={form.issue} onChange={set("issue")}>
                            <option value="">Select...</option>
                            {ISSUE_CATEGORIES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                    </Field>
                    <div style={{ marginTop: 12 }}>
                        <Field label="Notes (optional)">
                            <textarea style={{ ...inp(), minHeight: 64, resize: "vertical" }} value={form.notes} onChange={set("notes")} placeholder="Additional context..." />
                        </Field>
                    </div>

                    <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
                        <button style={S.btnPrimary} onClick={handleAssess}>Run triage</button>
                        <button style={S.btnGhost} onClick={handleReset}>Reset</button>
                    </div>
                </section>

                {/* RECOMMENDATION CARD */}
                <div ref={recRef}>
                    {current && <RecommendationCard {...current} />}
                </div>

                {/* SESSION LOG */}
                <SessionLog log={log} />
            </div>
        </div>
    );
}

function Field({ label, error, children }) {
    return (
        <div>
            <label style={S.label}>{label}</label>
            {children}
            {error && <div style={S.errMsg}>{error}</div>}
        </div>
    );
}

function RecommendationCard({ reference, dispute, result }) {
    const t = PRIORITY_THEME[result.priority];
    return (
        <section style={{ ...S.recCard, background: t.cardBg, borderLeft: `4px solid ${t.border}` }}>
            <div style={S.recTop}>
                <div>
                    <div style={{ ...S.recDisp, color: t.dispText }}>{result.disposition}</div>
                    <div style={S.recRef}>{reference}</div>
                </div>
                <span style={{ ...S.badge, background: t.badgeBg, color: t.badgeText }}>{PRIORITY_LABEL[result.priority]} priority</span>
            </div>

            <div style={S.recActionBox}>
                <div style={S.recActionLabel}>Recommended action</div>
                <div style={S.recActionText}>{result.action}</div>
            </div>

            <div style={S.recMetaGrid}>
                <Meta label="Routing team" value={result.team} />
                <Meta label="Resolution SLA" value={result.sla} />
                <Meta label="Dispute age" value={`${dispute.age} days (${ageBand(dispute.age)})`} />
                <Meta label="Amount" value={formatRand(dispute.amount)} />
            </div>

            <div style={S.recReason}>{result.reason}</div>
        </section>
    );
}

function Meta({ label, value }) {
    return (
        <div style={S.recMeta}>
            <div style={S.recMetaLabel}>{label}</div>
            <div style={S.recMetaVal}>{value}</div>
        </div>
    );
}

function SessionLog({ log }) {
    return (
        <section style={S.card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                <div style={{ ...S.cardTitle, marginBottom: 0 }}>Session log</div>
                <span style={S.logCount}>{log.length === 1 ? "1 dispute" : `${log.length} disputes`}</span>
            </div>
            {log.length === 0 ? (
                <div style={S.logEmpty}>No disputes logged yet. Capture your first one above.</div>
            ) : (
                log.map((e) => {
                    const t = PRIORITY_THEME[e.priority];
                    const time = e.capturedAt.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" });
                    return (
                        <div key={e.reference} style={S.logItem}>
                            <div style={{ ...S.logDot, background: t.dot }} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={S.logLine1}>
                                    <span style={S.logName}>{e.name}</span>
                                    <span style={S.logRef}>{e.reference}</span>
                                </div>
                                <div style={S.logLine2}>{labelOf(ISSUE_CATEGORIES, e.issue)} · {labelOf(PAYMENT_TYPES, e.type)} · {e.age}d old</div>
                                <div style={S.logLine3}>{e.team}</div>
                            </div>
                            <div style={{ textAlign: "right", flexShrink: 0 }}>
                                <div style={S.logAmount}>{formatRand(e.amount)}</div>
                                <div style={S.logTime}>{time}</div>
                            </div>
                        </div>
                    );
                })
            )}
        </section>
    );
}

// ============================================================
// STYLES
// ============================================================
const inp = (err) => ({
    width: "100%", fontSize: 13, padding: "9px 10px", borderRadius: 8,
    border: `1px solid ${err ? "#E24B4A" : "#d8d8d2"}`, background: "#fff",
    color: "#1a1a1a", fontFamily: "inherit", boxSizing: "border-box",
});
const S = {
    page: { background: "#faf9f5", minHeight: "100vh", padding: "24px 16px", fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif", color: "#1a1a1a" },
    wrap: { maxWidth: 680, margin: "0 auto" },
    h1: { fontSize: 22, fontWeight: 500, margin: 0 },
    sub: { fontSize: 13, color: "#6b6b66", margin: "4px 0 0" },
    card: { background: "#fff", border: "1px solid #ece9e1", borderRadius: 12, padding: 20, marginBottom: 16 },
    cardTitle: { fontSize: 16, fontWeight: 500, marginBottom: 16 },
    secLabel: { fontSize: 11, fontWeight: 500, color: "#6b6b66", textTransform: "uppercase", letterSpacing: "0.05em", margin: "16px 0 10px" },
    grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 },
    label: { display: "block", fontSize: 12, color: "#6b6b66", marginBottom: 4 },
    errMsg: { fontSize: 11, color: "#A32D2D", marginTop: 3 },
    btnPrimary: { flex: 1, padding: "10px 16px", borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: "pointer", border: "none", background: "#378ADD", color: "#fff" },
    btnGhost: { padding: "10px 16px", borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: "pointer", border: "1px solid #d8d8d2", background: "transparent", color: "#6b6b66" },
    recCard: { borderRadius: 12, padding: 20, marginBottom: 16 },
    recTop: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14, flexWrap: "wrap", gap: 8 },
    recDisp: { fontSize: 18, fontWeight: 500, marginBottom: 2 },
    recRef: { fontSize: 12, fontFamily: "ui-monospace, monospace", color: "#6b6b66" },
    badge: { fontSize: 11, fontWeight: 500, padding: "3px 10px", borderRadius: 20 },
    recActionBox: { background: "rgba(255,255,255,0.6)", borderRadius: 8, padding: "12px 14px", marginBottom: 12 },
    recActionLabel: { fontSize: 11, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em", color: "#6b6b66", marginBottom: 4 },
    recActionText: { fontSize: 14, lineHeight: 1.5, color: "#1a1a1a" },
    recMetaGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, margin: "14px 0" },
    recMeta: { background: "rgba(255,255,255,0.5)", borderRadius: 8, padding: "10px 12px" },
    recMetaLabel: { fontSize: 11, color: "#6b6b66", marginBottom: 2 },
    recMetaVal: { fontSize: 14, fontWeight: 500, color: "#1a1a1a" },
    recReason: { fontSize: 12, lineHeight: 1.5, color: "#555", fontStyle: "italic" },
    logCount: { fontSize: 12, color: "#6b6b66", background: "#f1efe8", padding: "3px 10px", borderRadius: 20 },
    logEmpty: { textAlign: "center", padding: "32px 16px", color: "#6b6b66", fontSize: 13 },
    logItem: { display: "flex", alignItems: "flex-start", gap: 10, padding: "12px 0", borderBottom: "1px solid #ece9e1" },
    logDot: { width: 8, height: 8, borderRadius: "50%", marginTop: 6, flexShrink: 0 },
    logLine1: { display: "flex", alignItems: "center", gap: 8, marginBottom: 3, flexWrap: "wrap" },
    logName: { fontSize: 13, fontWeight: 500, color: "#1a1a1a" },
    logRef: { fontSize: 11, fontFamily: "ui-monospace, monospace", color: "#9b9b94" },
    logLine2: { fontSize: 12, color: "#6b6b66" },
    logLine3: { fontSize: 11, color: "#9b9b94", marginTop: 2 },
    logAmount: { fontSize: 13, fontWeight: 500, color: "#1a1a1a" },
    logTime: { fontSize: 11, color: "#9b9b94", marginTop: 2 },
};