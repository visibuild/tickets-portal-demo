/**
 * config.ts — editable application configuration, stored as one JSON blob in KV.
 *
 * The operator sets these through the Settings page after logging in with the
 * admin password: the Visibuild credentials, the set of projects to expose, the
 * developer (viewer) password, and the branding.
 */
import type { Env } from "./env";

/** A single-ticket page content block: which one, and whether it's shown. */
export type TicketBlockKey =
  | "generalDetails"
  | "aiSummary"
  | "description"
  | "attachments"
  | "commentsPublic"
  | "commentsPrivate"
  | "activity";

export interface TicketBlock {
  key: TicketBlockKey;
  enabled: boolean;
}

export const TICKET_BLOCK_KEYS: TicketBlockKey[] = [
  "generalDetails",
  "aiSummary",
  "description",
  "attachments",
  "commentsPublic",
  "commentsPrivate",
  "activity",
];

/** Human labels for the settings checkboxes. */
export const TICKET_BLOCK_LABELS: Record<TicketBlockKey, string> = {
  generalDetails: "General details",
  aiSummary: "AI summary",
  description: "Description",
  attachments: "Attachments",
  commentsPublic: "Comments (public)",
  commentsPrivate: "Comments (private)",
  activity: "Activity (related visis)",
};

/** Default enabled state per block (private comments off; everything else on). */
const TICKET_BLOCK_DEFAULT_ENABLED: Record<TicketBlockKey, boolean> = {
  generalDetails: true,
  aiSummary: true,
  description: true,
  attachments: true,
  commentsPublic: true,
  commentsPrivate: false,
  activity: true,
};

// --- Tickets list columns (order + enabled) --------------------------------

export type TicketColumnKey =
  | "ticketNo"
  | "status"
  | "title"
  | "location"
  | "project"
  | "priority"
  | "raisedBy"
  | "assignee"
  | "updated";

export interface TicketColumn {
  key: TicketColumnKey;
  enabled: boolean;
}

export const TICKET_COLUMN_KEYS: TicketColumnKey[] = [
  "ticketNo",
  "status",
  "title",
  "location",
  "project",
  "priority",
  "raisedBy",
  "assignee",
  "updated",
];

export const TICKET_COLUMN_LABELS: Record<TicketColumnKey, string> = {
  ticketNo: "Number (#)",
  status: "Status",
  title: "Title",
  location: "Location",
  project: "Project",
  priority: "Priority",
  raisedBy: "Raised by",
  assignee: "Assignee",
  updated: "Updated",
};

/** Default: every column, in this order, enabled. */
export function defaultTicketColumns(): TicketColumn[] {
  return TICKET_COLUMN_KEYS.map((key) => ({ key, enabled: true }));
}

/**
 * Coerce a stored (possibly partial/untrusted) columns array to a full, ordered
 * list: keep known keys in their stored order, then append any columns missing
 * from the stored config (disabled, so a newly-added column is opt-in).
 */
function normalizeTicketColumns(stored: unknown): TicketColumn[] {
  if (!Array.isArray(stored)) return defaultTicketColumns();
  const seen = new Set<TicketColumnKey>();
  const out: TicketColumn[] = [];
  for (const item of stored) {
    const key = (item as { key?: unknown })?.key;
    if (typeof key !== "string" || !TICKET_COLUMN_KEYS.includes(key as TicketColumnKey)) continue;
    const k = key as TicketColumnKey;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ key: k, enabled: Boolean((item as { enabled?: unknown }).enabled) });
  }
  for (const key of TICKET_COLUMN_KEYS) {
    if (!seen.has(key)) out.push({ key, enabled: false });
  }
  return out;
}

export interface AppConfig {
  /** Visibuild API base URL, e.g. https://app.apac.visibuild.com/api/core/v1 */
  apiUrl: string;
  oauthClientId: string;
  oauthClientSecret: string;
  /** Project IDs the developer may see. Empty = every accessible project. */
  exposedProjectIds: string[];
  /** Password the developer enters at /login. */
  viewerPassword: string;
  /** Heading shown in the nav, e.g. a project or client name. */
  brandLabel: string;
  /** Optional logo image URL; falls back to the bundled icon when empty. */
  logoUrl: string;
  /** Optional favicon URL (may be hotlinked); falls back to the bundled icons when empty. */
  faviconUrl: string;
  /** Brand colour (hex). The rest of the palette derives from it. */
  primaryColor: string;
  /** Single-ticket page blocks, in display order, each enabled or not. */
  ticketBlocks: TicketBlock[];
  /** Tickets list columns, in display order, each enabled or not. */
  ticketColumns: TicketColumn[];
  /** When a ticket was raised directly (no Visibuild user), show the contact's name in "Raised by". */
  raisedByContactFallback: boolean;
  /** How locations display: the full nested path or just the leaf name. */
  locationNameStyle: LocationNameStyle;
}

/** "nested" -> "Demolition / Pre-work"; "leaf" -> "Pre-work". */
export type LocationNameStyle = "nested" | "leaf";

/** Default: every block in this order, with private comments off. */
export function defaultTicketBlocks(): TicketBlock[] {
  return TICKET_BLOCK_KEYS.map((key) => ({ key, enabled: TICKET_BLOCK_DEFAULT_ENABLED[key] }));
}

/** The set of enabled block keys, for quick membership checks. */
export function enabledTicketBlocks(blocks: TicketBlock[]): Set<TicketBlockKey> {
  return new Set(blocks.filter((b) => b.enabled).map((b) => b.key));
}

/**
 * Coerce a stored (possibly partial/untrusted) blocks value to a full, ordered
 * list. Accepts both the current array shape and the legacy object shape
 * (`{ generalDetails: true, … }`), so saved configs keep working.
 */
function normalizeTicketBlocks(stored: unknown): TicketBlock[] {
  // Current shape: ordered array of { key, enabled }.
  if (Array.isArray(stored)) {
    const seen = new Set<TicketBlockKey>();
    const out: TicketBlock[] = [];
    for (const item of stored) {
      const key = (item as { key?: unknown })?.key;
      if (typeof key !== "string" || !TICKET_BLOCK_KEYS.includes(key as TicketBlockKey)) continue;
      const k = key as TicketBlockKey;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ key: k, enabled: Boolean((item as { enabled?: unknown }).enabled) });
    }
    // Append any block missing from the stored order, using its default state.
    for (const key of TICKET_BLOCK_KEYS) {
      if (!seen.has(key)) out.push({ key, enabled: TICKET_BLOCK_DEFAULT_ENABLED[key] });
    }
    return out;
  }
  // Legacy shape: object of booleans, keyed by block. Keep the default order.
  if (stored && typeof stored === "object") {
    const s = stored as Record<string, unknown>;
    return TICKET_BLOCK_KEYS.map((key) => ({
      key,
      enabled: typeof s[key] === "boolean" ? (s[key] as boolean) : TICKET_BLOCK_DEFAULT_ENABLED[key],
    }));
  }
  return defaultTicketBlocks();
}

const CONFIG_KEY = "config";
const FALLBACK_API_URL = "https://app.apac.visibuild.com/api/core/v1";
export const DEFAULT_PRIMARY = "#5C7E6A";
export const DEFAULT_BRAND = "Post-completion portal";

export function defaultConfig(env: Env): AppConfig {
  return {
    apiUrl: env.DEFAULT_API_URL || FALLBACK_API_URL,
    oauthClientId: "",
    oauthClientSecret: "",
    exposedProjectIds: [],
    viewerPassword: "",
    brandLabel: DEFAULT_BRAND,
    logoUrl: "",
    faviconUrl: "",
    primaryColor: DEFAULT_PRIMARY,
    ticketBlocks: defaultTicketBlocks(),
    ticketColumns: defaultTicketColumns(),
    raisedByContactFallback: false,
    locationNameStyle: "nested",
  };
}

export async function loadConfig(env: Env): Promise<AppConfig> {
  const base = defaultConfig(env);
  const raw = await env.CONFIG.get(CONFIG_KEY);
  if (!raw) return base;
  try {
    const stored = JSON.parse(raw) as Partial<AppConfig>;
    return {
      ...base,
      ...stored,
      exposedProjectIds: Array.isArray(stored.exposedProjectIds)
        ? stored.exposedProjectIds.map(String)
        : base.exposedProjectIds,
      ticketBlocks: normalizeTicketBlocks(stored.ticketBlocks),
      ticketColumns: normalizeTicketColumns(stored.ticketColumns),
      raisedByContactFallback: Boolean(stored.raisedByContactFallback),
      locationNameStyle: stored.locationNameStyle === "leaf" ? "leaf" : "nested",
    };
  } catch {
    return base;
  }
}

export async function saveConfig(env: Env, patch: Partial<AppConfig>): Promise<AppConfig> {
  const current = await loadConfig(env);
  const next: AppConfig = { ...current, ...patch };
  await env.CONFIG.put(CONFIG_KEY, JSON.stringify(next));
  return next;
}

/** True once the Visibuild connection can be attempted. */
export function hasCredentials(cfg: AppConfig): boolean {
  return Boolean(cfg.apiUrl && cfg.oauthClientId && cfg.oauthClientSecret);
}
