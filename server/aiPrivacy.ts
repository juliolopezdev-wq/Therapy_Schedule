import { getDb } from "./db";
import { patients, therapists } from "../drizzle/schema";

// Everything sent to a remote model goes through here. Patients become random per-request codes
// (P-AB12), room numbers and MRNs are dropped, and calendar dates become days relative to today.
// Replies are decoded back so staff still see real names and dates.

export type PatientRef = { id: number; name: string; roomNumber: string | null; mrn: string | null };

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DAY_MS = 86_400_000;
const CODE_RE = /\bP-[A-Z2-9]{4}\b/g;
const RELATIVE_RE = /\btoday(?:([+-])(\d{1,3}))?(?:[ T](\d{1,2}):(\d{2}))?(?: \((?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)\))?/g;

// words we never treat as a name even if a patient happens to have them as a first/last name
const COMMON_WORDS = new Set(["will", "may", "mark", "grace", "joy", "hope", "faith", "june", "april", "rose", "bill", "art", "sunny", "white", "black", "brown", "green", "young", "long", "king", "day", "rehab", "team", "room", "patient", "therapy"]);

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function randomCode(used: Set<string>) {
  for (;;) {
    let code = "P-";
    for (let i = 0; i < 4; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    if (!used.has(code)) return code;
  }
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

// calendar day number, so DST changes don't shift offsets
function dayNumber(date: Date) {
  return Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS);
}

export class AiPseudonymizer {
  private codeById = new Map<number, string>();
  private patientByCode = new Map<string, PatientRef>();
  private idsByName = new Map<string, number[]>();
  private nameTokens: { token: string; ids: number[] }[] = [];
  private rooms = new Set<string>();
  private staffNames: string[];
  private mrns: string[] = [];
  private today: number;

  constructor(
    private patientList: PatientRef[],
    staffNames: string[],
    private referenceDate: Date = new Date(),
  ) {
    this.today = dayNumber(referenceDate);
    this.staffNames = staffNames.filter((n) => n.trim().length >= 3).sort((a, b) => b.length - a.length);
    const used = new Set<string>();
    const staffTokens = new Set(staffNames.flatMap((n) => n.toLowerCase().split(/\s+/)));
    const tokenIds = new Map<string, number[]>();

    for (const p of patientList) {
      const code = randomCode(used);
      used.add(code);
      this.codeById.set(p.id, code);
      this.patientByCode.set(code, p);

      const fullName = p.name.trim().toLowerCase();
      if (fullName) this.idsByName.set(fullName, [...(this.idsByName.get(fullName) ?? []), p.id]);
      for (const token of p.name.split(/[\s,]+/)) {
        const lower = token.toLowerCase();
        if (lower.length < 3 || staffTokens.has(lower) || COMMON_WORDS.has(lower)) continue;
        tokenIds.set(token, [...(tokenIds.get(token) ?? []), p.id]);
      }
      if (p.roomNumber?.trim()) this.rooms.add(p.roomNumber.trim());
      if (p.mrn && p.mrn.trim().length >= 4) this.mrns.push(p.mrn.trim());
    }
    // longest first so "Ann Marie" is replaced before "Ann"
    this.nameTokens = Array.from(tokenIds).map(([token, ids]) => ({ token, ids })).sort((a, b) => b.token.length - a.token.length);
  }

  private withStaffMasked(text: string, fn: (masked: string) => string) {
    const found: string[] = [];
    let masked = text;
    for (const name of this.staffNames) {
      masked = masked.replace(new RegExp(`\\b${escapeRegex(name)}\\b`, "gi"), (m) => `\u0000${found.push(m) - 1}\u0000`);
    }
    return fn(masked).replace(/\u0000(\d+)\u0000/g, (_m, i) => found[Number(i)]);
  }

  codeFor(patientId: number) {
    return this.codeById.get(patientId) ?? "P-????";
  }

  private codeForIds(ids: number[]) {
    // two patients sharing a name can't be told apart from text alone
    return ids.length === 1 ? this.codeFor(ids[0]) : "[patient]";
  }

  private relativeDay(date: Date, time?: string) {
    const offset = dayNumber(date) - this.today;
    let label = offset === 0 ? "today" : `today${offset > 0 ? "+" : ""}${offset}`;
    if (time) label += ` ${time}`;
    return label;
  }

  private dateFromOffset(offset: number) {
    const d = new Date(this.referenceDate);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + offset);
    return d;
  }

  // nearest year to today, for dates written without one ("Oct 28")
  private guessYear(month: number, day: number) {
    const year = this.referenceDate.getFullYear();
    const candidates = [year - 1, year, year + 1].map((y) => new Date(y, month, day));
    return candidates.sort((a, b) => Math.abs(a.getTime() - this.referenceDate.getTime()) - Math.abs(b.getTime() - this.referenceDate.getTime()))[0];
  }

  encodeDates(text: string) {
    // ISO dates and datetimes: 2026-10-28, 2026-10-28T09:00:00, 2026-10-28T14:00:00.000Z
    text = text.replace(
      /\b(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?\b/g,
      (match, y, m, d, hh, mm, zone) => {
        if (hh === undefined) return this.relativeDay(new Date(Number(y), Number(m) - 1, Number(d)));
        const date = zone ? new Date(match) : new Date(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm));
        if (Number.isNaN(date.getTime())) return match;
        return this.relativeDay(date, `${pad(date.getHours())}:${pad(date.getMinutes())}`);
      },
    );
    // 10/28/2026 or 10/28
    text = text.replace(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/g, (match, m, d, y) => {
      const month = Number(m) - 1;
      const day = Number(d);
      if (month > 11 || day < 1 || day > 31) return match;
      const date = y ? new Date(Number(y), month, day) : this.guessYear(month, day);
      return this.relativeDay(date);
    });
    // Wed, Oct 28 / October 28, 2026 / Oct 28
    text = text.replace(
      /\b(?:(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)[a-z]*,?\s+)?(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?\b/g,
      (match, mon, d, y) => {
        const month = MONTHS.indexOf(mon.toLowerCase());
        const day = Number(d);
        if (month < 0 || day < 1 || day > 31) return match;
        const date = y ? new Date(Number(y), month, day) : this.guessYear(month, day);
        return this.relativeDay(date);
      },
    );
    return text;
  }

  encodeText(text: string, options: { bareRooms?: boolean } = {}) {
    if (!text) return text;
    let out = text;

    // patient references that carry an id: "Room 204 (Jane Doe, id 12)", "[id 12] Room 204 (Jane Doe)",
    // "Room 204 Jane Doe (id 12)", "patient 12's"
    out = out.replace(/Room\s+\S+\s+\(([^()]*?), id (\d+)\)/g, (m, _name, id) => this.codeFor(Number(id)));
    out = out.replace(/\[id (\d+)\]\s+Room\s+\S+\s+\(([^()]*?)\)/g, (m, id) => this.codeFor(Number(id)));
    out = out.replace(/Room\s+\S+\s+([^()\n,;]+?)\s+\(id (\d+)\)/g, (m, _name, id) => this.codeFor(Number(id)));
    out = out.replace(/\bpatient (\d+)(?=\b)/gi, (m, id) => (this.codeById.has(Number(id)) ? this.codeFor(Number(id)) : m));

    // "Room 204 (Jane Doe)" and plain full names
    out = out.replace(/Room\s+\S+\s+\(([^()]+)\)/g, (m, name) => {
      const ids = this.idsByName.get(name.trim().toLowerCase());
      return ids ? this.codeForIds(ids) : m;
    });
    for (const [name, ids] of Array.from(this.idsByName)) {
      out = out.replace(new RegExp(`\\b${escapeRegex(name)}\\b`, "gi"), this.codeForIds(ids));
    }
    // single first/last names, e.g. "when can Doe get PT?" -- staff names are set aside first
    // so "Sam Doe-Lee" survives a patient named Doe
    out = this.withStaffMasked(out, (masked) => {
      for (const { token, ids } of this.nameTokens) {
        masked = masked.replace(new RegExp(`\\b${escapeRegex(token)}\\b`, "gi"), this.codeForIds(ids));
      }
      return masked;
    });

    for (const mrn of this.mrns) out = out.replace(new RegExp(escapeRegex(mrn), "gi"), "[MRN removed]");
    for (const room of Array.from(this.rooms)) {
      out = out.replace(new RegExp(`\\b(?:Room|Rm\\.?)\\s*#?\\s*${escapeRegex(room)}\\b`, "gi"), "[room]");
      if (options.bareRooms) out = out.replace(new RegExp(`(?<![\\w:.-])${escapeRegex(room)}(?![\\w:.-]| ?min)`, "g"), "[room]");
    }

    return this.encodeDates(out);
  }

  // walk tool-result JSON so ids and names are replaced structurally, not by guessing
  private encodeValue(value: unknown, key?: string, parent?: Record<string, unknown>): unknown {
    if (Array.isArray(value)) return value.map((v) => this.encodeValue(v, key));
    if (value && typeof value === "object") {
      const obj = value as Record<string, unknown>;
      const isPatient = "roomNumber" in obj && "name" in obj && typeof obj.id === "number" && !("patientId" in obj);
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) {
        if (k === "roomNumber" || k === "mrn") continue;
        if (isPatient && k === "id") result.patientCode = this.codeFor(v as number);
        else if (isPatient && k === "name") continue;
        else result[k] = this.encodeValue(v, k, obj);
      }
      return result;
    }
    if ((key === "patientId" || key === "previousAdmissionId") && typeof value === "number") return this.codeFor(value);
    if (key === "patientIds" && typeof value === "number") return this.codeFor(value);
    if (key === "patientName" && typeof value === "string") {
      const id = parent?.patientId;
      return typeof id === "number" ? this.codeFor(id) : this.encodeText(value);
    }
    if (typeof value === "string") return this.encodeText(value);
    return value;
  }

  encodeToolResult(json: string) {
    try {
      return JSON.stringify(this.encodeValue(JSON.parse(json)));
    } catch {
      return this.encodeText(json);
    }
  }

  // tool schemas: patientId becomes a code string, ISO dates become relative days
  encodeTools<T>(tools: T): T {
    const walk = (node: unknown, key?: string): unknown => {
      if (Array.isArray(node)) return node.map((n) => walk(n));
      if (!node || typeof node !== "object") return node;
      const obj = node as Record<string, unknown>;
      if (key === "patientId") return { type: "string", description: "Patient code, e.g. P-AB12." };
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) {
        if (k === "description" && typeof v === "string") {
          result[k] = v
            .replace(/ISO 8601 datetime(, e\.g\. [\dT:-]+)?/g, 'Relative day and 24h time, e.g. "today+1 09:00"')
            .replace(/ISO 8601 date(, e\.g\. [\d-]+)?/g, 'Relative day, e.g. "today", "today+2"')
            .replace(/The patient's numeric ID/g, "The patient's code");
        } else {
          result[k] = walk(v, k);
        }
      }
      return result;
    };
    return walk(tools) as T;
  }

  encodeMessages<M extends { role: string; content: string; tool_calls?: { function: { name: string; arguments: unknown } }[] }>(messages: M[]): M[] {
    return messages.map((m) => {
      const content = m.role === "tool" ? this.encodeToolResult(m.content) : this.encodeText(m.content, { bareRooms: m.role === "user" });
      const encoded = { ...m, content };
      if (m.tool_calls) {
        encoded.tool_calls = m.tool_calls.map((call) => ({
          ...call,
          function: { ...call.function, arguments: this.encodeValue(call.function.arguments) },
        }));
      }
      return encoded;
    });
  }

  privacyNotice() {
    return 'Privacy mode: patients appear only as codes like P-AB12 and calendar dates are written relative to today ("today", "today+2", "today-1 14:00"). Always refer to patients by their code and to days in that relative form. Use the code wherever a tool asks for a patientId. Room numbers and names are intentionally withheld; never ask for them.';
  }

  // ---- inbound ----

  decodeText(text: string) {
    let out = text.replace(CODE_RE, (code) => {
      const p = this.patientByCode.get(code);
      if (!p) return code;
      return p.roomNumber ? `Room ${p.roomNumber} (${p.name})` : p.name;
    });
    out = out.replace(RELATIVE_RE, (match, sign, n, hh, mm) => {
      // plain "today" in a sentence stays as is
      if (!sign && hh === undefined) return match;
      const offset = sign ? (sign === "-" ? -1 : 1) * Number(n) : 0;
      const date = this.dateFromOffset(offset);
      let label = offset === 0 ? "today" : `${WEEKDAYS[date.getDay()]}, ${date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
      if (hh !== undefined) {
        date.setHours(Number(hh), Number(mm));
        label += ` ${date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
      }
      return label;
    });
    return out;
  }

  private decodeArg(value: unknown, key?: string): unknown {
    if (Array.isArray(value)) return value.map((v) => this.decodeArg(v, key));
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, this.decodeArg(v, k)]));
    }
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    if (key === "patientId" || key === "patientIds") {
      const p = this.patientByCode.get(trimmed.toUpperCase());
      if (p) return p.id;
      if (/^\d+$/.test(trimmed)) return Number(trimmed);
      throw new Error(`Unknown patient code "${trimmed}". No changes were applied.`);
    }
    const relative = /^today(?:([+-])(\d{1,3}))?(?:[ T](\d{1,2}):(\d{2}))?$/.exec(trimmed);
    if (relative) {
      const [, sign, n, hh, mm] = relative;
      const date = this.dateFromOffset(sign ? (sign === "-" ? -1 : 1) * Number(n) : 0);
      const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
      return hh === undefined ? day : `${day}T${pad(Number(hh))}:${mm}:00`;
    }
    // free-text arguments (notes, reasons) go into our own DB, so restore real names there
    return this.decodeText(value);
  }

  decodeToolCall<C extends { function: { name: string; arguments: unknown } }>(call: C): C {
    let args = call.function.arguments;
    if (typeof args === "string") {
      try {
        args = JSON.parse(args);
      } catch {
        // leave unparseable arguments for executeTool to reject
      }
    }
    return { ...call, function: { ...call.function, arguments: this.decodeArg(args) } };
  }

  // last line of defense: refuse to send if a known identifier survived encoding
  findLeaks(payload: string): string[] {
    const leaks: string[] = [];
    const lower = payload.toLowerCase();
    for (const name of Array.from(this.idsByName.keys())) if (name.length >= 3 && new RegExp(`\\b${escapeRegex(name)}\\b`).test(lower)) leaks.push("patient name");
    const unmasked = this.withStaffMasked(payload, (masked) => masked.replace(/\u0000\d+\u0000/g, " "));
    for (const { token } of this.nameTokens) if (new RegExp(`\\b${escapeRegex(token)}\\b`, "i").test(unmasked)) leaks.push("patient name");
    for (const mrn of this.mrns) if (lower.includes(mrn.toLowerCase())) leaks.push("MRN");
    for (const room of Array.from(this.rooms)) if (new RegExp(`\\b(?:Room|Rm\\.?)\\s*#?\\s*${escapeRegex(room)}\\b`, "i").test(payload)) leaks.push("room number");
    if (/\b\d{4}-\d{2}-\d{2}\b/.test(payload)) leaks.push("calendar date");
    return Array.from(new Set(leaks));
  }
}

export async function loadAiPseudonymizer(referenceDate: Date = new Date()) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [patientRows, staffRows] = await Promise.all([
    db.select({ id: patients.id, name: patients.name, roomNumber: patients.roomNumber, mrn: patients.mrn }).from(patients),
    db.select({ name: therapists.name }).from(therapists),
  ]);
  return new AiPseudonymizer(patientRows, staffRows.map((t) => t.name), referenceDate);
}
