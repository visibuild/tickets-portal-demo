/**
 * visibuild.ts — read-only Visibuild Core API client.
 *
 * Everything is fetched live over HTTPS using an OAuth 2.0 client-credentials
 * token. Tokens, the project list, and per-project location maps are cached
 * in-memory per Worker isolate to cut repeat calls. No data is persisted.
 *
 * Endpoints used (see https://app.apac.visibuild.com/api/docs/core/v1):
 *   POST {base}/oauth/token
 *   GET  /tickets ? projectId & pageSize & next
 *   GET  /tickets/{id}
 *   GET  /tickets/{id}/comments
 *   GET  /projects
 *   GET  /projects/{projectId}/locations
 */
import type { AppConfig, LocationNameStyle } from "./config";
import type { Env } from "./env";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TicketSummary {
  id: string;
  ticketNo: number | null;
  title: string;
  status: string;
  priority: string;
  projectId: string | null;
  locationId: string | null;
  address: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  /** User who raised the ticket (resolved to a name/email via the company users endpoint). */
  createdByUserId: string | null;
  /** Company the ticket belongs to — the key for `/companies/{companyId}/users`. */
  companyId: string | null;
  /** Name from the ticket's contact object — present when raised directly by an external contact. */
  contactName: string | null;
  /** Visis (defects, inspections, NCRs, …) linked to this ticket, in the API's order. */
  relatedVisis: RelatedVisi[];
}

export interface TicketDetail extends TicketSummary {
  description: string | null;
  /** AI-generated summary of the ticket, when available. */
  aiSummary: string | null;
}

/** A visi linked to a ticket. The Core API embeds these in the ticket; it does not expose their comments. */
export interface RelatedVisi {
  id: string;
  alias: string | null; // e.g. "CT-39959"
  title: string;
  type: string | null; // defect, inspection, ncr, task, …
  status: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  projectId: string | null; // the visi's project (assignee maps are per-project)
  assigneeId: string | null; // a ProjectCompany or ProjectUser id
  assigneeType: string | null; // "ProjectCompany" | "ProjectUser"
}

/** A user record from `/companies/{companyId}/users`, reduced to display fields. */
export interface CompanyUser {
  id: string;
  name: string; // best available full name, possibly ""
  email: string; // possibly ""
}

export interface Comment {
  id: string;
  content: string;
  createdAt: string | null;
  userId: string | null;
}

export interface ProjectInfo {
  id: string;
  name: string;
  code: string | null;
}

export interface Attachment {
  id: string;
  url: string;
  filename: string;
  isImage: boolean;
  createdAt: string | null;
}

export class VisibuildError extends Error {
  status: number;
  detail: string;
  constructor(message: string, status = 0, detail = "") {
    super(message);
    this.name = "VisibuildError";
    this.status = status;
    this.detail = detail;
  }
}

// ---------------------------------------------------------------------------
// Pure parsers (unit-tested; tolerant of camelCase or snake_case)
// ---------------------------------------------------------------------------

export function tokenUrlFromApiUrl(apiUrl: string): string {
  const base = apiUrl.replace(/\/api\/core\/v1\/?$/, "").replace(/\/+$/, "");
  return `${base}/oauth/token`;
}

export function parseTicketSummary(t: any): TicketSummary {
  return {
    id: String(t.id),
    ticketNo: t.ticketNo ?? t.ticket_no ?? null,
    title: t.title ?? "",
    status: t.status ?? "",
    priority: t.priority ?? "",
    projectId: t.projectId ?? t.project_id ?? null,
    locationId: t.locationId ?? t.location_id ?? null,
    address: t.address ?? null,
    createdAt: t.createdAt ?? t.created_at ?? null,
    updatedAt: t.updatedAt ?? t.updated_at ?? null,
    createdByUserId:
      t.createdByUserId ??
      t.created_by_user_id ??
      t.createdById ??
      t.created_by_id ??
      t.createdBy?.id ??
      t.created_by?.id ??
      null,
    companyId:
      t.companyId ??
      t.company_id ??
      t.createdByCompanyId ??
      t.created_by_company_id ??
      t.company?.id ??
      t.createdBy?.companyId ??
      t.created_by?.company_id ??
      null,
    contactName:
      t.contact && typeof t.contact === "object"
        ? (t.contact.name ?? t.contact.fullName ?? t.contact.full_name ?? null)
        : null,
    relatedVisis: parseRelatedVisis(t),
  };
}

export function parseTicketDetail(t: any): TicketDetail {
  return {
    ...parseTicketSummary(t),
    description: t.description ?? null,
    aiSummary: t.aiSummary ?? t.ai_summary ?? t.aiSummaryText ?? t.ai_summary_text ?? null,
  };
}

/** Parse the ticket's embedded `visis` array, keeping the API's order. */
export function parseRelatedVisis(t: any): RelatedVisi[] {
  const arr: any[] = Array.isArray(t?.visis) ? t.visis : [];
  return arr
    .filter((v) => v && (v.id ?? v.visiId) != null)
    .map((v) => ({
      id: String(v.id ?? v.visiId),
      alias: v.alias ?? null,
      title: v.title ?? "",
      type: v.type ?? v.category ?? null,
      status: v.status ?? null,
      createdAt: v.createdAt ?? v.created_at ?? null,
      updatedAt: v.updatedAt ?? v.updated_at ?? null,
      projectId: v.projectId ?? v.project_id ?? null,
      assigneeId: v.assigneeId ?? v.assignee_id ?? null,
      assigneeType: v.assigneeType ?? v.assignee_type ?? null,
    }));
}

/** Choose the visi whose assignee represents the ticket: the first open one, else the first. */
export function pickAssigneeVisi(visis: RelatedVisi[]): RelatedVisi | null {
  if (visis.length === 0) return null;
  return visis.find((v) => v.status === "open") ?? visis[0];
}

/** Parse `/companies` -> [companyId, name] pairs. */
export function parseCompanies(data: any): [string, string][] {
  const arr: any[] = data?.data?.companies ?? [];
  return arr.filter((c) => c && c.id != null).map((c) => [String(c.id), String(c.name ?? "")]);
}

/** Parse a company users response. Tolerant of camelCase/snake_case and name shapes. */
export function parseCompanyUsers(data: any): CompanyUser[] {
  const arr: any[] = data?.data?.users ?? data?.users ?? [];
  return arr
    .filter((u) => u && (u.id ?? u.userId ?? u.user_id) != null)
    .map((u) => {
      const first = u.firstName ?? u.first_name ?? "";
      const last = u.lastName ?? u.last_name ?? "";
      const full = String(u.name ?? u.fullName ?? u.full_name ?? `${first} ${last}`).trim();
      return {
        id: String(u.id ?? u.userId ?? u.user_id),
        name: full,
        email: String(u.email ?? u.emailAddress ?? u.email_address ?? "").trim(),
      };
    });
}

/** A parsed comment carrying its visibility, used to split public vs private. */
interface TypedComment extends Comment {
  commentType: string;
}

/** Parse every comment in a response (with its type), oldest first. */
export function parseComments(data: any): TypedComment[] {
  const arr: any[] = data?.data?.comments ?? [];
  return arr
    .map((c) => ({
      id: String(c.id),
      content: c.content ?? "",
      createdAt: c.createdAt ?? c.created_at ?? null,
      userId: c.userId ?? c.user_id ?? null,
      commentType: String(c.commentType ?? c.comment_type ?? ""),
    }))
    .sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
}

/** Parse a comments response, keeping only public comments, oldest first. */
export function parsePublicComments(data: any): Comment[] {
  return parseComments(data)
    .filter((c) => c.commentType === "public")
    .map(stripCommentType);
}

/** Parse a comments response, keeping only non-public (private/internal) comments. */
export function parsePrivateComments(data: any): Comment[] {
  return parseComments(data)
    .filter((c) => c.commentType !== "public")
    .map(stripCommentType);
}

function stripCommentType({ commentType, ...c }: TypedComment): Comment {
  return c;
}

// -- Attachments ------------------------------------------------------------

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|avif|bmp|svg|heic|heif)(?=$|\?|#)/i;
const FILE_EXT = /\.(pdf|docx?|xlsx?|pptx?|csv|txt|zip|rar|7z|mp4|mov|m4v|avi|webm|json|xml)(?=$|\?|#)/i;

function baseName(s: string): string {
  if (!s) return "";
  let path = s;
  try {
    path = new URL(s).pathname;
  } catch {
    /* not an absolute URL — treat as a plain key/path */
  }
  const seg = (path.split("/").filter(Boolean).pop() ?? "").split("?")[0];
  try {
    return decodeURIComponent(seg);
  } catch {
    return seg;
  }
}

/**
 * Decide whether an attachment should be shown as an image. Known image
 * extensions -> image; known document/video extensions -> file; anything
 * unknown (incl. extensionless signed URLs) -> image, optimistically, since
 * ticket attachments are overwhelmingly photos. The UI falls back to a download
 * link if such an image fails to load.
 */
function classifyImage(url: string, key: string): boolean {
  if (IMAGE_EXT.test(url) || IMAGE_EXT.test(key)) return true;
  if (FILE_EXT.test(url) || FILE_EXT.test(key)) return false;
  return true;
}

export function parseAttachments(data: any): Attachment[] {
  const arr: any[] = data?.data?.attachments ?? [];
  return arr
    .filter((a) => a && a.url)
    .map((a) => {
      const url = String(a.url);
      const key = String(a.key ?? "");
      const fromUrl = baseName(url);
      const filename = /\.[a-z0-9]{2,5}$/i.test(fromUrl) ? fromUrl : baseName(key) || fromUrl || "attachment";
      return {
        id: String(a.id ?? a.attachmentId ?? url),
        url,
        filename,
        isImage: classifyImage(url, key),
        createdAt: a.createdAt ?? a.created_at ?? null,
      };
    });
}

export function parseProjects(data: any): ProjectInfo[] {
  const arr: any[] = data?.data?.projects ?? [];
  return arr
    .map((p) => ({ id: String(p.id), name: p.name ?? "", code: p.code ?? null }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function parseLocationMap(data: any, style: LocationNameStyle = "nested"): Map<string, string> {
  const map = new Map<string, string>();
  for (const l of data?.data?.locations ?? []) {
    const nested = l.nestedName ?? l.nestedPathName ?? l.namePath ?? null; // "Demolition / Pre-work"
    const leaf = l.name ?? null; // "Pre-work"
    const name = style === "leaf" ? leaf ?? nested : nested ?? leaf;
    if (name) map.set(String(l.id), String(name));
  }
  return map;
}

// ---------------------------------------------------------------------------
// In-memory caches (best-effort, per isolate)
// ---------------------------------------------------------------------------

interface CachedToken { token: string; exp: number }
const tokenCache = new Map<string, CachedToken>();
const TOKEN_MARGIN = 60;

const projectsCache = new Map<string, { exp: number; data: ProjectInfo[] }>();
const locationCache = new Map<string, { exp: number; map: Map<string, string> }>();
const ticketsCache = new Map<string, { exp: number; data: TicketSummary[] }>();
// Company users change rarely, so we cache them as hard as we can: per-isolate in
// memory, then in KV (with an edge cacheTtl) so the lookup survives isolate
// recycling and we almost never hit the rate-limited users endpoint.
const companyUsersCache = new Map<string, { exp: number; map: Map<string, CompanyUser> }>();
// Company names and the per-project assignee maps (ProjectCompany/ProjectUser id
// -> company name) change rarely, so they're cached as hard as the company users.
const companiesCache = new Map<string, { exp: number; map: Map<string, string> }>();
const assigneeCache = new Map<string, { exp: number; map: Map<string, string> }>();
const PROJECTS_TTL = 6 * 3600; // projects change rarely — 6 hours
const LOCATION_TTL = 6 * 3600; // locations change rarely — 6 hours
const TICKETS_TTL = 3600; // 1 hour — back-navigation is instant; Refresh forces a re-fetch
const COMPANY_USERS_TTL = 24 * 3600; // in-memory: 24 hours
const COMPANY_USERS_KV_TTL = 7 * 24 * 3600; // KV: 7 days
const COMPANY_USERS_KV_PREFIX = "users:";
const COMPANIES_KV_KEY = "companies";
const ASSIGNEES_KV_PREFIX = "assignees:";

function now(): number { return Math.floor(Date.now() / 1000); }
function credKey(cfg: AppConfig): string { return `${cfg.apiUrl}|${cfg.oauthClientId}`; }

/** Clear cached Visibuild data (tickets, locations, projects) but keep the token. */
export function clearDataCaches(): void {
  ticketsCache.clear();
  locationCache.clear();
  projectsCache.clear();
  companyUsersCache.clear();
  companiesCache.clear();
  assigneeCache.clear();
}

/** Clear all caches including the token (used on settings change and by tests). */
export function resetCaches(): void {
  clearDataCaches();
  tokenCache.clear();
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

export async function getToken(cfg: AppConfig): Promise<string> {
  const key = credKey(cfg);
  const cached = tokenCache.get(key);
  if (cached && cached.exp - TOKEN_MARGIN > now()) return cached.token;

  const res = await fetch(tokenUrlFromApiUrl(cfg.apiUrl), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: cfg.oauthClientId,
      client_secret: cfg.oauthClientSecret,
      scope: "read",
    }).toString(),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new VisibuildError(`OAuth token request failed (HTTP ${res.status})`, res.status, detail);
  }
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new VisibuildError("OAuth response did not contain an access token", res.status);
  tokenCache.set(key, { token: data.access_token, exp: now() + (data.expires_in ?? 3600) });
  return data.access_token;
}

async function apiGet(cfg: AppConfig, path: string, token: string, sp?: URLSearchParams): Promise<any> {
  const base = cfg.apiUrl.replace(/\/+$/, "");
  const qs = sp && [...sp.keys()].length ? `?${sp.toString()}` : "";
  const res = await fetch(`${base}${path}${qs}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new VisibuildError(`Visibuild API error (HTTP ${res.status}) on ${path}`, res.status, detail);
  }
  return res.json();
}

/** Walk seek-based pagination, collecting each page's items via `pick`. */
async function paginate<T>(
  cfg: AppConfig,
  path: string,
  token: string,
  pick: (data: any) => T[],
  pageSize = 200,
): Promise<T[]> {
  const out: T[] = [];
  let next: string | null = null;
  do {
    const sp = new URLSearchParams({ pageSize: String(pageSize) });
    if (next) sp.set("next", next);
    const data = await apiGet(cfg, path, token, sp);
    out.push(...pick(data));
    next = data?.pagination?.next ?? null;
  } while (next);
  return out;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function testConnection(cfg: AppConfig): Promise<{ ok: boolean; message: string }> {
  try {
    await getToken(cfg);
    return { ok: true, message: "Connected to Visibuild successfully." };
  } catch (e) {
    if (e instanceof VisibuildError) {
      return { ok: false, message: e.detail ? `${e.message}: ${e.detail.slice(0, 200)}` : e.message };
    }
    return { ok: false, message: (e as Error).message || "Connection failed" };
  }
}

export async function getProjects(cfg: AppConfig): Promise<ProjectInfo[]> {
  const key = credKey(cfg);
  const cached = projectsCache.get(key);
  if (cached && cached.exp > now()) return cached.data;
  const token = await getToken(cfg);
  const projects = await paginate<ProjectInfo>(cfg, "/projects", token, parseProjects, 500);
  projects.sort((a, b) => a.name.localeCompare(b.name));
  projectsCache.set(key, { exp: now() + PROJECTS_TTL, data: projects });
  return projects;
}

export interface ListTicketsOptions {
  /** Restrict to a single project (must be within the exposed set). */
  projectId?: string;
  /** Restrict to a single status. */
  status?: string;
  /** Bypass the in-memory cache and fetch fresh from Visibuild. */
  force?: boolean;
}

/** Fetch the full (status-agnostic) ticket set for the given project filter. */
async function fetchTicketsFresh(cfg: AppConfig, projectId?: string): Promise<TicketSummary[]> {
  const token = await getToken(cfg);

  let projectIds: (string | undefined)[];
  if (projectId) {
    projectIds = [projectId];
  } else if (cfg.exposedProjectIds.length > 0) {
    projectIds = cfg.exposedProjectIds;
  } else {
    projectIds = [undefined]; // every accessible project
  }

  // Isolate per-project failures so one inaccessible project never blanks the
  // whole list — other projects still render. Rate-limit (429) errors are
  // re-thrown so the page can show the "wait 60 seconds" message.
  const pages = await Promise.all(
    projectIds.map((pid) =>
      paginateTickets(cfg, token, pid).catch((err) => {
        if (err instanceof VisibuildError && err.status === 429) throw err;
        console.error(`Failed to fetch tickets for project ${pid ?? "(all)"}:`, err);
        return [] as TicketSummary[];
      }),
    ),
  );
  let tickets = pages.flat();

  // Safety net: if an exposed set is configured, never leak other projects
  // (including tickets with no projectId at all).
  if (cfg.exposedProjectIds.length > 0) {
    const allow = new Set(cfg.exposedProjectIds);
    tickets = tickets.filter((t) => t.projectId != null && allow.has(t.projectId));
  }

  tickets.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  return tickets;
}

/**
 * List tickets for the given project filter. The full set is cached in memory
 * per Worker isolate so back-navigation is instant; pass `force` (the Refresh
 * button) to re-check Visibuild. The status filter is applied to the cached set.
 */
export async function listTickets(cfg: AppConfig, opts: ListTicketsOptions = {}): Promise<TicketSummary[]> {
  const key = `${credKey(cfg)}|${opts.projectId ?? "ALL"}`;
  const cached = ticketsCache.get(key);

  let tickets: TicketSummary[];
  if (!opts.force && cached && cached.exp > now()) {
    tickets = cached.data;
  } else {
    tickets = await fetchTicketsFresh(cfg, opts.projectId);
    ticketsCache.set(key, { exp: now() + TICKETS_TTL, data: tickets });
  }

  return opts.status ? tickets.filter((t) => t.status === opts.status) : tickets;
}

async function paginateTickets(
  cfg: AppConfig,
  token: string,
  projectId: string | undefined,
): Promise<TicketSummary[]> {
  const out: TicketSummary[] = [];
  let next: string | null = null;
  do {
    const sp = new URLSearchParams({ pageSize: "200" });
    if (projectId) sp.set("projectId", projectId);
    if (next) sp.set("next", next);
    const data = await apiGet(cfg, "/tickets", token, sp);
    for (const t of data?.data?.tickets ?? []) out.push(parseTicketSummary(t));
    next = data?.pagination?.next ?? null;
  } while (next);
  return out;
}

export async function getTicket(cfg: AppConfig, id: string): Promise<TicketDetail | null> {
  const token = await getToken(cfg);
  const data = await apiGet(cfg, `/tickets/${encodeURIComponent(id)}`, token);
  const t = data?.data?.ticket;
  return t ? parseTicketDetail(t) : null;
}

/**
 * Load the userId -> user map for one company, cached as hard as possible:
 * in-memory per isolate, then KV (edge-cached), only falling through to the
 * Visibuild users endpoint on a genuine cold cache. All ticket creators share a
 * company, so in practice this resolves to a single cached map.
 */
async function loadCompanyUsers(
  env: Env,
  cfg: AppConfig,
  companyId: string,
): Promise<Map<string, CompanyUser>> {
  const memo = companyUsersCache.get(companyId);
  if (memo && memo.exp > now()) return memo.map;

  const kvKey = `${COMPANY_USERS_KV_PREFIX}${companyId}`;
  try {
    const raw = await env.CONFIG.get(kvKey, { cacheTtl: 3600 });
    if (raw) {
      const map = new Map<string, CompanyUser>(JSON.parse(raw) as [string, CompanyUser][]);
      companyUsersCache.set(companyId, { exp: now() + COMPANY_USERS_TTL, map });
      return map;
    }
  } catch {
    /* KV miss or parse failure — fetch fresh below */
  }

  const token = await getToken(cfg);
  const users = await paginate<CompanyUser>(
    cfg,
    `/companies/${encodeURIComponent(companyId)}/users`,
    token,
    parseCompanyUsers,
    200,
  );
  const map = new Map(users.map((u) => [u.id, u]));
  companyUsersCache.set(companyId, { exp: now() + COMPANY_USERS_TTL, map });
  try {
    await env.CONFIG.put(kvKey, JSON.stringify([...map.entries()]), {
      expirationTtl: COMPANY_USERS_KV_TTL,
    });
  } catch {
    /* best-effort write; the in-memory cache still serves this isolate */
  }
  return map;
}

/**
 * Resolve the user who raised a ticket to a display record, or null when the
 * ticket carries no creator/company or the user can't be found. Never throws —
 * the page falls back to "Unknown user".
 */
export async function getTicketCreator(
  env: Env,
  cfg: AppConfig,
  ticket: TicketDetail,
): Promise<CompanyUser | null> {
  if (!ticket.createdByUserId || !ticket.companyId) return null;
  try {
    const map = await loadCompanyUsers(env, cfg, ticket.companyId);
    return map.get(ticket.createdByUserId) ?? null;
  } catch {
    return null;
  }
}

/**
 * Build a combined userId -> user map covering every company referenced by the
 * given tickets, so the list can show "Raised by" without a per-row lookup. In
 * practice all tickets share one company, so this loads a single (cached) map.
 * Failures for individual companies are ignored.
 */
export async function loadTicketCreators(
  env: Env,
  cfg: AppConfig,
  tickets: TicketSummary[],
): Promise<Map<string, CompanyUser>> {
  const companyIds = [...new Set(tickets.map((t) => t.companyId).filter(Boolean) as string[])];
  const combined = new Map<string, CompanyUser>();
  const maps = await Promise.all(
    companyIds.map((cid) => loadCompanyUsers(env, cfg, cid).catch(() => new Map<string, CompanyUser>())),
  );
  for (const m of maps) for (const [k, v] of m) combined.set(k, v);
  return combined;
}

/** Load (and hard-cache) the global companyId -> name map. */
async function loadCompanies(env: Env, cfg: AppConfig): Promise<Map<string, string>> {
  const key = credKey(cfg);
  const memo = companiesCache.get(key);
  if (memo && memo.exp > now()) return memo.map;
  try {
    const raw = await env.CONFIG.get(COMPANIES_KV_KEY, { cacheTtl: 3600 });
    if (raw) {
      const map = new Map<string, string>(JSON.parse(raw) as [string, string][]);
      companiesCache.set(key, { exp: now() + COMPANY_USERS_TTL, map });
      return map;
    }
  } catch {
    /* fall through */
  }
  const token = await getToken(cfg);
  const entries = await paginate<[string, string]>(cfg, "/companies", token, parseCompanies, 200);
  const map = new Map(entries);
  companiesCache.set(key, { exp: now() + COMPANY_USERS_TTL, map });
  try {
    await env.CONFIG.put(COMPANIES_KV_KEY, JSON.stringify([...map.entries()]), { expirationTtl: COMPANY_USERS_KV_TTL });
  } catch {
    /* best-effort */
  }
  return map;
}

/**
 * Build (and hard-cache) a map of visi-assignee id -> company name for one
 * project. Keys cover both ProjectCompany ids and ProjectUser ids (resolved
 * through their project company), so a visi's assigneeId resolves directly.
 */
async function loadAssigneeCompanies(env: Env, cfg: AppConfig, projectId: string): Promise<Map<string, string>> {
  const memo = assigneeCache.get(projectId);
  if (memo && memo.exp > now()) return memo.map;

  const kvKey = `${ASSIGNEES_KV_PREFIX}${projectId}`;
  try {
    const raw = await env.CONFIG.get(kvKey, { cacheTtl: 3600 });
    if (raw) {
      const map = new Map<string, string>(JSON.parse(raw) as [string, string][]);
      assigneeCache.set(projectId, { exp: now() + COMPANY_USERS_TTL, map });
      return map;
    }
  } catch {
    /* fall through */
  }

  const companies = await loadCompanies(env, cfg);
  const token = await getToken(cfg);
  const pid = encodeURIComponent(projectId);
  // projectCompanyId -> companyId
  const projectCompanies = await paginate<[string, string]>(
    cfg,
    `/projects/${pid}/companies`,
    token,
    (data) => (data?.data?.projectCompanies ?? []).filter((c: any) => c?.id != null).map((c: any) => [String(c.id), String(c.companyId ?? c.company_id ?? "")]),
    200,
  );
  // projectUserId -> projectCompanyId
  const projectUsers = await paginate<[string, string]>(
    cfg,
    `/projects/${pid}/users`,
    token,
    (data) => (data?.data?.projectUsers ?? []).filter((u: any) => u?.id != null).map((u: any) => [String(u.id), String(u.projectCompanyId ?? u.project_company_id ?? "")]),
    200,
  );

  const pcToName = new Map<string, string>();
  const map = new Map<string, string>();
  for (const [pcId, companyId] of projectCompanies) {
    const name = companies.get(companyId) ?? "";
    pcToName.set(pcId, name);
    if (name) map.set(pcId, name); // visi assigned directly to a ProjectCompany
  }
  for (const [puId, pcId] of projectUsers) {
    const name = pcToName.get(pcId) ?? "";
    if (name) map.set(puId, name); // visi assigned to a ProjectUser -> their company
  }

  assigneeCache.set(projectId, { exp: now() + COMPANY_USERS_TTL, map });
  try {
    await env.CONFIG.put(kvKey, JSON.stringify([...map.entries()]), { expirationTtl: COMPANY_USERS_KV_TTL });
  } catch {
    /* best-effort */
  }
  return map;
}

/**
 * Resolve the company assigned to a ticket's representative visi (first open
 * one, else first). Returns null when there's no linked visi or it can't be
 * resolved. Never throws.
 */
export async function getTicketAssignee(env: Env, cfg: AppConfig, ticket: TicketSummary): Promise<string | null> {
  const visi = pickAssigneeVisi(ticket.relatedVisis);
  if (!visi || !visi.assigneeId || !visi.projectId) return null;
  try {
    const map = await loadAssigneeCompanies(env, cfg, visi.projectId);
    return map.get(visi.assigneeId) ?? null;
  } catch {
    return null;
  }
}

/**
 * Build a ticketId -> assignee-company-name map for a list of tickets, loading
 * the (cached) per-project assignee maps for each project in view.
 */
export async function loadTicketAssignees(
  env: Env,
  cfg: AppConfig,
  tickets: TicketSummary[],
): Promise<Map<string, string>> {
  const chosen = tickets
    .map((t) => ({ ticketId: t.id, visi: pickAssigneeVisi(t.relatedVisis) }))
    .filter((x) => x.visi?.assigneeId && x.visi?.projectId) as {
    ticketId: string;
    visi: RelatedVisi;
  }[];
  const projectIds = [...new Set(chosen.map((x) => x.visi.projectId as string))];
  const maps = new Map<string, Map<string, string>>();
  await Promise.all(
    projectIds.map(async (pid) => {
      try {
        maps.set(pid, await loadAssigneeCompanies(env, cfg, pid));
      } catch {
        /* skip this project */
      }
    }),
  );
  const out = new Map<string, string>();
  for (const { ticketId, visi } of chosen) {
    const name = maps.get(visi.projectId as string)?.get(visi.assigneeId as string);
    if (name) out.set(ticketId, name);
  }
  return out;
}

/**
 * Fetch a ticket's comments once and split them into public and private buckets
 * (each oldest first), so the ticket page can show either or both without
 * issuing two requests.
 */
export async function getTicketComments(
  cfg: AppConfig,
  id: string,
): Promise<{ public: Comment[]; private: Comment[] }> {
  const token = await getToken(cfg);
  const all = await paginate<TypedComment>(
    cfg,
    `/tickets/${encodeURIComponent(id)}/comments`,
    token,
    parseComments,
  );
  all.sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
  return {
    public: all.filter((c) => c.commentType === "public").map(stripCommentType),
    private: all.filter((c) => c.commentType !== "public").map(stripCommentType),
  };
}

export async function getAttachments(cfg: AppConfig, id: string): Promise<Attachment[]> {
  const token = await getToken(cfg);
  const attachments = await paginate<Attachment>(
    cfg,
    `/tickets/${encodeURIComponent(id)}/attachments`,
    token,
    parseAttachments,
  );
  return attachments.sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
}

/** Load (and cache) the locationId -> name map for one project. */
export async function loadLocationMap(cfg: AppConfig, projectId: string): Promise<Map<string, string>> {
  const cached = locationCache.get(projectId);
  if (cached && cached.exp > now()) return cached.map;
  const token = await getToken(cfg);
  const style = cfg.locationNameStyle;
  const pages = await paginate<[string, string]>(
    cfg,
    `/projects/${encodeURIComponent(projectId)}/locations`,
    token,
    (data) => [...parseLocationMap(data, style).entries()],
    500,
  );
  const map = new Map(pages);
  locationCache.set(projectId, { exp: now() + LOCATION_TTL, map });
  return map;
}

/**
 * Build a combined locationId -> name map across several projects, fetched in
 * parallel. Failures for individual projects are ignored so one bad project
 * never breaks the list.
 */
export async function loadLocationNames(
  cfg: AppConfig,
  projectIds: string[],
): Promise<Map<string, string>> {
  const combined = new Map<string, string>();
  const maps = await Promise.all(
    projectIds.map((pid) => loadLocationMap(cfg, pid).catch(() => new Map<string, string>())),
  );
  for (const m of maps) for (const [k, v] of m) combined.set(k, v);
  return combined;
}

/** Resolve a single ticket's locationId to a human name (nested path if available). */
export async function getLocationName(
  cfg: AppConfig,
  projectId: string | null,
  locationId: string | null,
): Promise<string | null> {
  if (!projectId || !locationId) return null;
  const map = await loadLocationMap(cfg, projectId);
  return map.get(locationId) ?? null;
}

/** Map projectId -> "Name (code)" for display. */
export async function getProjectLabels(cfg: AppConfig): Promise<Map<string, string>> {
  const projects = await getProjects(cfg);
  const map = new Map<string, string>();
  for (const p of projects) map.set(p.id, p.code ? `${p.name} (${p.code})` : p.name);
  return map;
}
