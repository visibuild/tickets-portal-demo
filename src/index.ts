/**
 * index.ts — Cloudflare Worker entry point.
 *
 * A small Hono app that renders server-side HTML. Pages are gated by an
 * HMAC-signed session cookie (see auth.ts); all Visibuild data is fetched live
 * (see visibuild.ts). There is no database and no users table — just two
 * passwords (admin via the ADMIN_PASSWORD secret, viewer set in Settings).
 */
import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Env } from "./env";
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  createSessionToken,
  verifySessionToken,
  safeEqual,
  type Role,
  type Session,
} from "./auth";
import {
  loadConfig,
  saveConfig,
  hasCredentials,
  DEFAULT_PRIMARY,
  DEFAULT_BRAND,
  TICKET_BLOCK_KEYS,
  TICKET_COLUMN_KEYS,
  enabledTicketBlocks,
  type AppConfig,
  type TicketBlock,
  type TicketBlockKey,
  type TicketColumn,
  type TicketColumnKey,
} from "./config";
import * as vb from "./visibuild";
import { layout, esc, sanitizeHexColor, sanitizeLogoUrl, type Theme } from "./views/layout";
import { viewerLoginPage, adminLoginPage } from "./views/login";
import { ticketsPage, listQuery } from "./views/tickets";
import { ticketPage } from "./views/ticket";
import { settingsPage } from "./views/settings";

type Variables = { session: Session };
const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build the (sanitised) theme used to render every page. */
function themeFor(cfg: AppConfig): Theme {
  return {
    brandLabel: cfg.brandLabel || DEFAULT_BRAND,
    logoUrl: sanitizeLogoUrl(cfg.logoUrl),
    faviconUrl: sanitizeLogoUrl(cfg.faviconUrl),
    primaryColor: sanitizeHexColor(cfg.primaryColor, DEFAULT_PRIMARY),
  };
}

/** Shown when Visibuild rate-limits us (HTTP 429). See the Core API rate-limit docs. */
const RATE_LIMIT_MESSAGE =
  "This portal has made too many requests in a short time and Visibuild has temporarily paused them. Please wait 60 seconds before trying again.";

function isRateLimited(e: unknown): boolean {
  return e instanceof vb.VisibuildError && e.status === 429;
}

async function currentSession(c: { env: Env; req: any }): Promise<Session | null> {
  return verifySessionToken(c.env.SESSION_SECRET, getCookie(c as any, SESSION_COOKIE));
}

async function issueSession(c: any, role: Role): Promise<void> {
  const token = await createSessionToken(c.env.SESSION_SECRET, role);
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

function buildProjectOptions(cfg: AppConfig, labels: Map<string, string>): { id: string; label: string }[] {
  const ids = cfg.exposedProjectIds.length > 0 ? cfg.exposedProjectIds : [...labels.keys()];
  return ids
    .map((id) => ({ id, label: labels.get(id) ?? id }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

// ---------------------------------------------------------------------------
// Global middleware: security headers + auth gates
// ---------------------------------------------------------------------------

app.use("*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "same-origin");
  c.header("X-Frame-Options", "DENY");
  // Scripts only from our own origin (no inline scripts — behaviour lives in
  // /app.js). Inline styles allowed (low-risk; used for the injected --primary).
  // Fonts come from Google Fonts; the logo may be any https/data image.
  c.header(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "img-src 'self' https: data:",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "script-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
    ].join("; "),
  );
});

const requireViewer = async (c: any, next: any) => {
  const s = await currentSession(c);
  if (!s) return c.redirect("/login");
  c.set("session", s);
  await next();
};

const requireAdmin = async (c: any, next: any) => {
  const s = await currentSession(c);
  if (!s || s.role !== "admin") return c.redirect("/settings/login");
  c.set("session", s);
  await next();
};

// ---------------------------------------------------------------------------
// Health check (unauthenticated)
// ---------------------------------------------------------------------------

app.get("/healthz", (c) => c.text("ok"));

// ---------------------------------------------------------------------------
// Auth: viewer login
// ---------------------------------------------------------------------------

app.get("/login", async (c) => {
  if (await currentSession(c)) return c.redirect("/");
  const cfg = await loadConfig(c.env);
  return c.html(viewerLoginPage(themeFor(cfg)));
});

app.post("/login", async (c) => {
  const cfg = await loadConfig(c.env);
  const form = await c.req.formData();
  const pw = String(form.get("password") ?? "");

  let role: Role | null = null;
  if (c.env.ADMIN_PASSWORD && safeEqual(pw, c.env.ADMIN_PASSWORD)) role = "admin";
  else if (cfg.viewerPassword && safeEqual(pw, cfg.viewerPassword)) role = "viewer";

  if (!role) return c.html(viewerLoginPage(themeFor(cfg), "Incorrect password."), 401);
  await issueSession(c, role);
  return c.redirect("/");
});

// ---------------------------------------------------------------------------
// Auth: admin login + logout
// ---------------------------------------------------------------------------

app.get("/settings/login", async (c) => {
  const s = await currentSession(c);
  if (s?.role === "admin") return c.redirect("/settings");
  const cfg = await loadConfig(c.env);
  return c.html(adminLoginPage(themeFor(cfg)));
});

app.post("/settings/login", async (c) => {
  const cfg = await loadConfig(c.env);
  const form = await c.req.formData();
  const pw = String(form.get("password") ?? "");
  if (!(c.env.ADMIN_PASSWORD && safeEqual(pw, c.env.ADMIN_PASSWORD))) {
    return c.html(adminLoginPage(themeFor(cfg), "Incorrect password."), 401);
  }
  await issueSession(c, "admin");
  return c.redirect("/settings");
});

app.post("/logout", (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.redirect("/login");
});

// ---------------------------------------------------------------------------
// Tickets list (home)
// ---------------------------------------------------------------------------

app.get("/", requireViewer, async (c) => {
  const cfg = await loadConfig(c.env);
  const session = c.get("session");
  const theme = themeFor(cfg);

  if (!hasCredentials(cfg)) {
    return c.html(
      ticketsPage({
        theme,
        role: session.role,
        tickets: [],
        locationNames: new Map(),
        projectLabels: new Map(),
        creators: new Map(),
        assignees: new Map(),
        raisedByContactFallback: cfg.raisedByContactFallback,
        columns: cfg.ticketColumns,
        projectOptions: [],
        selectedProjectId: "",
        selectedStatus: "",
        statusCounts: {},
        totalCount: 0,
        showProjectColumn: false,
        configured: false,
        configHint: session.role === "admin",
      }),
    );
  }

  const exposed = cfg.exposedProjectIds;
  const requestedProject = c.req.query("project") ?? "";
  const effectiveProject =
    requestedProject && (exposed.length === 0 || exposed.includes(requestedProject)) ? requestedProject : "";
  const selectedStatus = c.req.query("status") ?? "";

  // Refresh: drop the cached Visibuild data and reload (POST-redirect-GET so the
  // ?refresh flag doesn't stick in history / on reload).
  if (c.req.query("refresh") !== undefined) {
    vb.clearDataCaches();
    const params = new URLSearchParams();
    if (effectiveProject) params.set("project", effectiveProject);
    if (selectedStatus) params.set("status", selectedStatus);
    const qs = params.toString();
    return c.redirect(qs ? `/?${qs}` : "/");
  }

  try {
    const all = await vb.listTickets(cfg, { projectId: effectiveProject || undefined });
    const statusCounts: Record<string, number> = {};
    for (const t of all) statusCounts[t.status] = (statusCounts[t.status] ?? 0) + 1;
    const tickets = selectedStatus ? all.filter((t) => t.status === selectedStatus) : all;

    const projectIdsInView = [...new Set(all.map((t) => t.projectId).filter(Boolean) as string[])];
    const columnOn = (key: string) => cfg.ticketColumns.some((c) => c.key === key && c.enabled);
    const [locationNames, projectLabels, creators, assignees] = await Promise.all([
      vb.loadLocationNames(cfg, projectIdsInView).catch(() => new Map<string, string>()),
      vb.getProjectLabels(cfg).catch(() => new Map<string, string>()),
      columnOn("raisedBy")
        ? vb.loadTicketCreators(c.env, cfg, tickets).catch(() => new Map<string, vb.CompanyUser>())
        : Promise.resolve(new Map<string, vb.CompanyUser>()),
      columnOn("assignee")
        ? vb.loadTicketAssignees(c.env, cfg, tickets).catch(() => new Map<string, string>())
        : Promise.resolve(new Map<string, string>()),
    ]);
    const projectOptions = buildProjectOptions(cfg, projectLabels);
    const showProjectColumn = effectiveProject === "" && exposed.length !== 1;

    return c.html(
      ticketsPage({
        theme,
        role: session.role,
        tickets,
        locationNames,
        projectLabels,
        creators,
        assignees,
        raisedByContactFallback: cfg.raisedByContactFallback,
        columns: cfg.ticketColumns,
        projectOptions,
        selectedProjectId: effectiveProject,
        selectedStatus,
        statusCounts,
        totalCount: all.length,
        showProjectColumn,
        configured: true,
        configHint: false,
      }),
    );
  } catch (e) {
    const err = e instanceof vb.VisibuildError ? e.message : (e as Error).message;
    return c.html(
      ticketsPage({
        theme,
        role: session.role,
        tickets: [],
        locationNames: new Map(),
        projectLabels: new Map(),
        creators: new Map(),
        assignees: new Map(),
        raisedByContactFallback: cfg.raisedByContactFallback,
        columns: cfg.ticketColumns,
        projectOptions: [],
        selectedProjectId: effectiveProject,
        selectedStatus,
        statusCounts: {},
        totalCount: 0,
        showProjectColumn: false,
        configured: true,
        configHint: false,
        error: isRateLimited(e)
          ? RATE_LIMIT_MESSAGE
          : session.role === "admin"
            ? `Couldn't load tickets from Visibuild: ${err}. Check the connection in Settings.`
            : "Couldn't load tickets right now. Please try again shortly.",
      }),
    );
  }
});

// ---------------------------------------------------------------------------
// Ticket detail
// ---------------------------------------------------------------------------

app.get("/tickets/:id", requireViewer, async (c) => {
  const cfg = await loadConfig(c.env);
  const session = c.get("session");
  const theme = themeFor(cfg);
  if (!hasCredentials(cfg)) return c.redirect("/");

  const id = c.req.param("id");
  let ticket: vb.TicketDetail | null;
  try {
    ticket = await vb.getTicket(cfg, id);
  } catch (e) {
    if (isRateLimited(e)) {
      return messagePage(c, 429, theme, session, "Too many requests", RATE_LIMIT_MESSAGE);
    }
    const err = e instanceof vb.VisibuildError ? e.message : (e as Error).message;
    return messagePage(c, 502, theme, session, "Couldn't load this ticket", err);
  }
  if (!ticket) return messagePage(c, 404, theme, session, "Ticket not found", "This ticket doesn't exist or isn't available.");

  // Never reveal a ticket outside the exposed project set. A ticket with no
  // projectId is treated as "not in the set" whenever an allow-list is configured.
  if (cfg.exposedProjectIds.length > 0) {
    const allowed = ticket.projectId != null && cfg.exposedProjectIds.includes(ticket.projectId);
    if (!allowed) {
      return messagePage(c, 404, theme, session, "Ticket not found", "This ticket isn't available.");
    }
  }

  // Only fetch what the configured blocks actually render — a disabled block
  // costs no API calls.
  const blockOn = enabledTicketBlocks(cfg.ticketBlocks);
  const wantComments = blockOn.has("commentsPublic") || blockOn.has("commentsPrivate");
  const [comments, attachments, locationName, projectLabels, creator, assignee] = await Promise.all([
    wantComments
      ? vb.getTicketComments(cfg, id).catch(() => ({ public: [], private: [] }))
      : Promise.resolve({ public: [] as vb.Comment[], private: [] as vb.Comment[] }),
    blockOn.has("attachments") ? vb.getAttachments(cfg, id).catch(() => []) : Promise.resolve([]),
    blockOn.has("generalDetails")
      ? vb.getLocationName(cfg, ticket.projectId, ticket.locationId).catch(() => null)
      : Promise.resolve(null),
    blockOn.has("generalDetails")
      ? vb.getProjectLabels(cfg).catch(() => new Map<string, string>())
      : Promise.resolve(new Map<string, string>()),
    blockOn.has("generalDetails") ? vb.getTicketCreator(c.env, cfg, ticket).catch(() => null) : Promise.resolve(null),
    blockOn.has("generalDetails") ? vb.getTicketAssignee(c.env, cfg, ticket).catch(() => null) : Promise.resolve(null),
  ]);

  const projectLabel = ticket.projectId ? projectLabels.get(ticket.projectId) ?? null : null;

  // Page through the same list the user was viewing. The project/status filters
  // ride along on the link query so prev/next match the on-screen order.
  const requestedProject = c.req.query("project") ?? "";
  const navProject =
    requestedProject && (cfg.exposedProjectIds.length === 0 || cfg.exposedProjectIds.includes(requestedProject))
      ? requestedProject
      : "";
  const navStatus = c.req.query("status") ?? "";
  const navQuery = listQuery(navProject, navStatus);

  let prevHref: string | null = null;
  let nextHref: string | null = null;
  try {
    const list = await vb.listTickets(cfg, {
      projectId: navProject || undefined,
      status: navStatus || undefined,
    });
    const idx = list.findIndex((t) => t.id === id);
    if (idx !== -1) {
      if (idx > 0) prevHref = `/tickets/${encodeURIComponent(list[idx - 1].id)}${navQuery}`;
      if (idx < list.length - 1) nextHref = `/tickets/${encodeURIComponent(list[idx + 1].id)}${navQuery}`;
    }
  } catch {
    // Navigation is best-effort; the page still renders without arrows.
  }

  return c.html(
    ticketPage({
      theme,
      role: session.role,
      ticket,
      projectLabel,
      locationName,
      publicComments: comments.public,
      privateComments: comments.private,
      attachments,
      creator,
      assignee,
      raisedByContactFallback: cfg.raisedByContactFallback,
      blocks: cfg.ticketBlocks,
      backHref: `/${navQuery}`,
      prevHref,
      nextHref,
    }),
  );
});

function messagePage(
  c: any,
  status: number,
  theme: Theme,
  session: Session,
  title: string,
  text: string,
): Response {
  const body = `<div class="container">
    <div class="page-header"><h1 class="page-title">${esc(title)}</h1></div>
    <div class="message info">${esc(text)}</div>
    <p style="margin-top:16px"><a class="btn btn-ghost" href="/">&larr; Back to tickets</a></p>
  </div>`;
  return c.html(
    layout({ title: `${title} · ${theme.brandLabel}`, body, theme, nav: { role: session.role, active: "tickets" } }),
    status,
  );
}

// ---------------------------------------------------------------------------
// Settings (admin)
// ---------------------------------------------------------------------------

async function loadProjectsForSettings(cfg: AppConfig): Promise<{ projects: vb.ProjectInfo[] | null; error?: string }> {
  if (!hasCredentials(cfg)) return { projects: null };
  try {
    return { projects: await vb.getProjects(cfg) };
  } catch (e) {
    const error = e instanceof vb.VisibuildError ? e.message : (e as Error).message;
    return { projects: null, error: `Couldn't load projects: ${error}` };
  }
}

app.get("/settings", requireAdmin, async (c) => {
  const cfg = await loadConfig(c.env);
  const { projects, error } = await loadProjectsForSettings(cfg);
  return c.html(
    settingsPage({
      theme: themeFor(cfg),
      cfg,
      projects,
      projectsError: error,
      hasSecret: Boolean(cfg.oauthClientSecret),
      hasViewerPassword: Boolean(cfg.viewerPassword),
    }),
  );
});

app.post("/settings", requireAdmin, async (c) => {
  const form = await c.req.formData();
  const action = String(form.get("action") ?? "save");
  const current = await loadConfig(c.env);

  const patch: Partial<AppConfig> = {
    brandLabel: (String(form.get("brandLabel") ?? "")).trim() || DEFAULT_BRAND,
    apiUrl: (String(form.get("apiUrl") ?? "")).trim() || current.apiUrl,
    oauthClientId: (String(form.get("oauthClientId") ?? "")).trim(),
    logoUrl: sanitizeLogoUrl(String(form.get("logoUrl") ?? "")),
    faviconUrl: sanitizeLogoUrl(String(form.get("faviconUrl") ?? "")),
    primaryColor: sanitizeHexColor(String(form.get("primaryColor") ?? ""), DEFAULT_PRIMARY),
    raisedByContactFallback: Boolean(form.get("raisedByContactFallback")),
    locationNameStyle: String(form.get("locationNameStyle") ?? "") === "leaf" ? "leaf" : "nested",
  };
  const secret = String(form.get("oauthClientSecret") ?? "").trim();
  if (secret) patch.oauthClientSecret = secret;
  const viewerPassword = String(form.get("viewerPassword") ?? "").trim();
  if (viewerPassword) patch.viewerPassword = viewerPassword;
  // Only touch exposed projects if the checkbox list was actually rendered.
  if (form.get("projectsPresent")) {
    patch.exposedProjectIds = form.getAll("projects").map(String);
  }
  // Ticket-page blocks: hidden `blockOrder` inputs carry the (reordered) order
  // of every block; `blocks` carries just the enabled ones.
  if (form.get("blocksPresent")) {
    const enabled = new Set(form.getAll("blocks").map(String));
    const known = new Set<string>(TICKET_BLOCK_KEYS);
    const seen = new Set<TicketBlockKey>();
    const ordered: TicketBlock[] = [];
    for (const raw of form.getAll("blockOrder").map(String)) {
      if (!known.has(raw) || seen.has(raw as TicketBlockKey)) continue;
      const key = raw as TicketBlockKey;
      seen.add(key);
      ordered.push({ key, enabled: enabled.has(key) });
    }
    for (const key of TICKET_BLOCK_KEYS) if (!seen.has(key)) ordered.push({ key, enabled: false });
    patch.ticketBlocks = ordered;
  }
  // Tickets list columns: hidden `columnOrder` inputs carry the (drag-reordered)
  // order of every column; `columns` carries just the enabled ones.
  if (form.get("columnsPresent")) {
    const enabled = new Set(form.getAll("columns").map(String));
    const known = new Set<string>(TICKET_COLUMN_KEYS);
    const seen = new Set<TicketColumnKey>();
    const ordered: TicketColumn[] = [];
    for (const raw of form.getAll("columnOrder").map(String)) {
      if (!known.has(raw) || seen.has(raw as TicketColumnKey)) continue;
      const key = raw as TicketColumnKey;
      seen.add(key);
      ordered.push({ key, enabled: enabled.has(key) });
    }
    // Any column the form somehow omitted keeps its place at the end, disabled.
    for (const key of TICKET_COLUMN_KEYS) if (!seen.has(key)) ordered.push({ key, enabled: false });
    patch.ticketColumns = ordered;
  }

  const cfg = await saveConfig(c.env, patch);
  vb.resetCaches(); // pick up new credentials / project selection immediately

  let message: { kind: "success" | "error" | "info"; text: string };
  if (action === "test") {
    const res = await vb.testConnection(cfg);
    message = { kind: res.ok ? "success" : "error", text: res.message };
  } else {
    message = { kind: "success", text: "Settings saved." };
  }

  const { projects, error } = await loadProjectsForSettings(cfg);
  return c.html(
    settingsPage({
      theme: themeFor(cfg),
      cfg,
      projects,
      projectsError: error,
      message,
      hasSecret: Boolean(cfg.oauthClientSecret),
      hasViewerPassword: Boolean(cfg.viewerPassword),
    }),
  );
});

// ---------------------------------------------------------------------------
// Fallback
// ---------------------------------------------------------------------------

app.notFound(async (c) => {
  const theme = themeFor(await loadConfig(c.env));
  const body = `<div class="login-wrap"><div class="login-card">
    <span class="brand-icon brand-icon--lg"><img src="/app-icon.png" alt=""></span>
    <div class="login-title">Page not found</div>
    <div class="login-sub">The page you're looking for doesn't exist.</div>
    <a class="btn btn-primary btn-block" href="/">Go to tickets</a>
  </div></div>`;
  return c.html(layout({ title: "Not found", body, theme }), 404);
});

export default app;
