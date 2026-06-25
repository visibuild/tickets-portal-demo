/**
 * tickets.ts — the tickets list (home page after viewer login).
 */
import {
  layout,
  esc,
  fmtDate,
  statusBadge,
  priorityBadge,
  type Theme,
} from "./layout";
import type { Role } from "../auth";
import type { TicketSummary, CompanyUser } from "../visibuild";
import type { TicketColumn, TicketColumnKey } from "../config";

const STATUSES = ["pending", "open", "resolved", "closed", "declined"] as const;

export interface TicketsPageOptions {
  theme: Theme;
  role: Role;
  tickets: TicketSummary[]; // already filtered by selected project + status
  locationNames: Map<string, string>;
  projectLabels: Map<string, string>;
  creators: Map<string, CompanyUser>; // userId -> raising user, for the "Raised by" column
  assignees: Map<string, string>; // ticketId -> assigned company name, for the "Assignee" column
  raisedByContactFallback: boolean; // fall back to the ticket's contact name in "Raised by"
  columns: TicketColumn[]; // configured columns, in display order
  projectOptions: { id: string; label: string }[];
  selectedProjectId: string;
  selectedStatus: string;
  statusCounts: Record<string, number>;
  totalCount: number; // total across current project filter, ignoring status
  showProjectColumn: boolean;
  configured: boolean;
  configHint: boolean; // admin + not configured -> point to Settings
  error?: string;
}

function locationCell(t: TicketSummary, names: Map<string, string>): string {
  const name = t.locationId ? names.get(t.locationId) : null;
  const value = name || t.address || "";
  return value ? esc(value) : '<span class="text-muted">—</span>';
}

/**
 * "Raised by" cell: the user's name (email as a tooltip), or email. When no user
 * resolved and the contact fallback is enabled, the ticket's contact name; else
 * "Unknown user".
 */
function creatorCell(t: TicketSummary, creators: Map<string, CompanyUser>, contactFallback: boolean): string {
  const user = t.createdByUserId ? creators.get(t.createdByUserId) : null;
  const name = user?.name?.trim();
  const email = user?.email?.trim();
  if (name) return email ? `<span title="${esc(email)}">${esc(name)}</span>` : esc(name);
  if (email) return esc(email);
  if (contactFallback && t.contactName?.trim()) return esc(t.contactName.trim());
  return '<span class="text-muted">Unknown user</span>';
}

/** Filter context carried onto each ticket link so the detail page can page through the same list. */
export function listQuery(
  selectedProjectId: string,
  selectedStatus: string,
): string {
  const params = new URLSearchParams();
  if (selectedProjectId) params.set("project", selectedProjectId);
  if (selectedStatus) params.set("status", selectedStatus);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

function ticketHref(t: TicketSummary, opts: TicketsPageOptions): string {
  return `/tickets/${encodeURIComponent(t.id)}${listQuery(opts.selectedProjectId, opts.selectedStatus)}`;
}

/**
 * Column registry: label + header/cell renderers, keyed by column key. `hideSm`
 * collapses the column on narrow screens. The configured order/enabled set
 * (opts.columns) decides which appear and in what order.
 */
const COLUMNS: Record<
  TicketColumnKey,
  { label: string; hideSm: boolean; cell: (t: TicketSummary, opts: TicketsPageOptions) => string }
> = {
  ticketNo: {
    label: "#",
    hideSm: false,
    cell: (t, o) => `<td class="ticket-no"><a href="${ticketHref(t, o)}">#${esc(t.ticketNo ?? "—")}</a></td>`,
  },
  status: { label: "Status", hideSm: false, cell: (t) => `<td>${statusBadge(t.status)}</td>` },
  title: {
    label: "Title",
    hideSm: false,
    cell: (t, o) => `<td class="ticket-title"><a href="${ticketHref(t, o)}">${esc(t.title || "Untitled")}</a></td>`,
  },
  location: {
    label: "Location",
    hideSm: false,
    cell: (t, o) => `<td class="ticket-loc">${locationCell(t, o.locationNames)}</td>`,
  },
  project: {
    label: "Project",
    hideSm: true,
    cell: (t, o) => `<td class="ticket-project hide-sm">${esc(o.projectLabels.get(t.projectId ?? "") ?? "—")}</td>`,
  },
  priority: { label: "Priority", hideSm: true, cell: (t) => `<td class="hide-sm">${priorityBadge(t.priority)}</td>` },
  raisedBy: {
    label: "Raised by",
    hideSm: true,
    cell: (t, o) => `<td class="ticket-user hide-sm">${creatorCell(t, o.creators, o.raisedByContactFallback)}</td>`,
  },
  assignee: {
    label: "Assignee",
    hideSm: true,
    cell: (t, o) => {
      const name = o.assignees.get(t.id);
      return `<td class="ticket-assignee hide-sm">${name ? esc(name) : '<span class="text-muted">—</span>'}</td>`;
    },
  },
  updated: {
    label: "Updated",
    hideSm: true,
    cell: (t) => `<td class="ticket-date hide-sm">${fmtDate(t.updatedAt)}</td>`,
  },
};

/** Enabled columns in configured order. The Project column is also suppressed in single-project views. */
function effectiveColumns(opts: TicketsPageOptions): TicketColumnKey[] {
  return opts.columns
    .filter((c) => c.enabled)
    .map((c) => c.key)
    .filter((key) => key !== "project" || opts.showProjectColumn);
}

function row(t: TicketSummary, opts: TicketsPageOptions, columns: TicketColumnKey[]): string {
  const cells = columns.map((key) => COLUMNS[key].cell(t, opts)).join("\n    ");
  return `<tr class="ticket-row" data-href="${ticketHref(t, opts)}">
    ${cells}
  </tr>`;
}

function pill(label: string, status: string, opts: TicketsPageOptions): string {
  const params = new URLSearchParams();
  if (opts.selectedProjectId) params.set("project", opts.selectedProjectId);
  if (status) params.set("status", status);
  const qs = params.toString();
  const active = opts.selectedStatus === status ? " active" : "";
  const count = status ? (opts.statusCounts[status] ?? 0) : opts.totalCount;
  return `<a class="pill${active}" href="/${qs ? "?" + qs : ""}">${esc(label)}<span class="count">${count}</span></a>`;
}

function projectFilter(opts: TicketsPageOptions): string {
  if (opts.projectOptions.length <= 1) return "";
  const options = [
    `<option value=""${opts.selectedProjectId === "" ? " selected" : ""}>All projects</option>`,
    ...opts.projectOptions.map(
      (p) =>
        `<option value="${esc(p.id)}"${opts.selectedProjectId === p.id ? " selected" : ""}>${esc(p.label)}</option>`,
    ),
  ].join("");
  return `<form class="header-filter" method="get" action="/">
    ${opts.selectedStatus ? `<input type="hidden" name="status" value="${esc(opts.selectedStatus)}">` : ""}
    <select id="project" name="project" aria-label="Project" data-autosubmit>${options}</select>
    <noscript><button type="submit" class="btn btn-ghost">Apply</button></noscript>
  </form>`;
}

function refreshHref(opts: TicketsPageOptions): string {
  const params = new URLSearchParams();
  params.set("refresh", "1");
  if (opts.selectedProjectId) params.set("project", opts.selectedProjectId);
  if (opts.selectedStatus) params.set("status", opts.selectedStatus);
  return `/?${params.toString()}`;
}

const REFRESH_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>`;

function table(opts: TicketsPageOptions): string {
  if (opts.tickets.length === 0) {
    return `<div class="table-wrap"><div class="empty-state">
      <div class="empty-title">No tickets to show</div>
      <div class="empty-body">${
        opts.selectedStatus || opts.selectedProjectId
          ? "No tickets match the current filters."
          : "There are no tickets recorded for this project yet."
      }</div>
    </div></div>`;
  }
  const columns = effectiveColumns(opts);
  const head = `<tr>${columns
    .map((key) => `<th${COLUMNS[key].hideSm ? ' class="hide-sm"' : ""}>${esc(COLUMNS[key].label)}</th>`)
    .join("")}</tr>`;
  return `<div class="table-wrap"><table class="tickets-table">
    <thead>${head}</thead>
    <tbody>${opts.tickets.map((t) => row(t, opts, columns)).join("")}</tbody>
  </table></div>`;
}

export function ticketsPage(opts: TicketsPageOptions): string {
  let body: string;

  if (!opts.configured) {
    body = `<div class="container">
      <div class="page-header">
        <h1 class="page-title">${esc(opts.theme.brandLabel)}</h1>
      </div>
      <div class="message info">${
        opts.configHint
          ? `This site isn't connected to Visibuild yet. Open <a href="/settings">Settings</a> to add your Visibuild credentials and choose the projects to show.`
          : `This site isn't ready yet. Please check back shortly.`
      }</div>
    </div>`;
    return layout({
      title: opts.theme.brandLabel,
      body,
      theme: opts.theme,
      nav: { role: opts.role, active: "tickets" },
    });
  }

  body = `<div class="container container--wide">
    <div class="page-header page-header--row">
      <div>
        <h1 class="page-title">Tickets</h1>
      </div>
      <div class="header-actions">
        ${projectFilter(opts)}
        <a class="btn btn-ghost" href="${refreshHref(opts)}" title="Check Visibuild for new tickets">${REFRESH_ICON} Refresh</a>
      </div>
    </div>
    ${opts.error ? `<div class="message error">${esc(opts.error)}</div>` : ""}
    <div class="filter-pills">
      ${pill("All", "", opts)}
      ${STATUSES.map((s) => pill(s.charAt(0).toUpperCase() + s.slice(1), s, opts)).join("")}
    </div>
    ${table(opts)}
  </div>`;

  return layout({
    title: opts.theme.brandLabel,
    body,
    theme: opts.theme,
    nav: { role: opts.role, active: "tickets" },
  });
}
