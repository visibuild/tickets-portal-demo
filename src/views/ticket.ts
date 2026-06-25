/**
 * ticket.ts — single ticket detail page.
 *
 * Which content blocks appear (general details, AI summary, description,
 * attachments, public/private comments) is configured per-site in Settings and
 * passed in via `opts.blocks`. The header (number, title, badges) always shows.
 */
import { layout, esc, fmtDate, statusBadge, priorityBadge, type Theme } from "./layout";
import type { Role } from "../auth";
import type { TicketDetail, Comment, Attachment, CompanyUser, RelatedVisi } from "../visibuild";
import { enabledTicketBlocks, type TicketBlock, type TicketBlockKey } from "../config";

export interface TicketPageOptions {
  theme: Theme;
  role: Role;
  ticket: TicketDetail;
  projectLabel: string | null;
  locationName: string | null;
  publicComments: Comment[];
  privateComments: Comment[];
  attachments: Attachment[];
  creator: CompanyUser | null; // user who raised the ticket, or null -> "Unknown user"
  assignee: string | null; // company assigned to the linked visi, or null
  raisedByContactFallback: boolean; // fall back to the ticket's contact name in "Raised by"
  blocks: TicketBlock[]; // which blocks to render, in display order
  backHref: string; // "Back to tickets" link, preserving the list's filters
  prevHref: string | null; // earlier ticket in the list (up), or null at the top
  nextHref: string | null; // later ticket in the list (down), or null at the bottom
}

const CHEVRON_UP = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>`;
const CHEVRON_DOWN = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;

function pager(prevHref: string | null, nextHref: string | null): string {
  const btn = (href: string | null, icon: string, label: string) =>
    href
      ? `<a class="pager-btn" href="${esc(href)}" title="${label}" aria-label="${label}">${icon}</a>`
      : `<span class="pager-btn pager-btn--disabled" aria-hidden="true">${icon}</span>`;
  return `<div class="detail-pager">
    ${btn(prevHref, CHEVRON_UP, "Previous ticket")}
    ${btn(nextHref, CHEVRON_DOWN, "Next ticket")}
  </div>`;
}

/**
 * Render the ticket's creator as "Name <email>", name, or email. When no user
 * resolved and the contact fallback is enabled, show the contact name; else
 * "Unknown user".
 */
function creatorCell(creator: CompanyUser | null, contactName: string | null, contactFallback: boolean): string {
  const name = creator?.name?.trim();
  const email = creator?.email?.trim();
  if (name && email) return `${esc(name)} <span class="text-muted">&lt;${esc(email)}&gt;</span>`;
  if (name) return esc(name);
  if (email) return esc(email);
  if (contactFallback && contactName?.trim()) return esc(contactName.trim());
  return '<span class="text-muted">Unknown user</span>';
}

function attachmentsCard(attachments: Attachment[]): string {
  if (attachments.length === 0) return "";
  const images = attachments.filter((a) => a.isImage);
  const files = attachments.filter((a) => !a.isImage);

  const grid = images.length
    ? `<div class="att-grid">${images
        .map(
          (a) => `<a class="att-thumb" href="${esc(a.url)}" target="_blank" rel="noopener noreferrer" data-filename="${esc(a.filename)}">
            <img src="${esc(a.url)}" alt="${esc(a.filename)}" loading="lazy">
          </a>`,
        )
        .join("")}</div>`
    : "";

  const list = files.length
    ? `<ul class="att-files">${files
        .map(
          (a) => `<li><a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">${esc(a.filename)}</a></li>`,
        )
        .join("")}</ul>`
    : "";

  return `<div class="detail-card">
    <h3>Attachments</h3>
    ${grid}${list}
  </div>`;
}

/** Humanise a visi type/status token, e.g. "incorrect_works" -> "Incorrect works". */
function humanise(s: string | null): string {
  const t = (s ?? "").replace(/_/g, " ").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "";
}

/**
 * Activity feed: the ticket's related visis. The Core API embeds visi metadata
 * but not their comments, so each item shows alias, title, type, status, and the
 * last-updated date. Renders nothing when the ticket has no related visis.
 */
function activityCard(visis: RelatedVisi[]): string {
  if (visis.length === 0) return "";
  const items = [...visis]
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "")) // most recently updated first
    .map((v) => {
      // type/status are escaped; fmtDate already returns safe HTML (a <time> element).
      const meta = [esc(humanise(v.type)), esc(humanise(v.status)), fmtDate(v.updatedAt)]
        .filter(Boolean)
        .join(" · ");
      return `<div class="visi-item">
        <div class="visi-head">
          ${v.alias ? `<span class="visi-alias">${esc(v.alias)}</span>` : ""}
          <span class="visi-title">${esc(v.title || "Untitled")}</span>
        </div>
        <div class="visi-meta">${meta}</div>
      </div>`;
    })
    .join("");
  return `<div class="detail-card">
    <h3>Activity</h3>
    <div class="visi-list">${items}</div>
  </div>`;
}

function commentsCard(title: string, comments: Comment[]): string {
  const inner =
    comments.length === 0
      ? `<p class="text-muted">No comments.</p>`
      : `<div class="comment-list">${comments
          .map(
            (c) => `<div class="comment">
              <div class="comment-meta">${fmtDate(c.createdAt)}</div>
              <div class="comment-body">${esc(c.content)}</div>
            </div>`,
          )
          .join("")}</div>`;
  return `<div class="detail-card">
    <h3>${esc(title)}</h3>
    ${inner}
  </div>`;
}

export function ticketPage(opts: TicketPageOptions): string {
  const t = opts.ticket;
  const locationLine = opts.locationName || t.address || null;
  const enabled = enabledTicketBlocks(opts.blocks);

  // Each block renders its card (or "" when it has no content). The configured
  // order in opts.blocks decides which appear and in what sequence.
  const cardFor: Record<TicketBlockKey, () => string> = {
    generalDetails: () => `<div class="detail-card">
        <h3>Details</h3>
        <dl class="detail-dl">
          ${opts.projectLabel ? `<dt>Project</dt><dd>${esc(opts.projectLabel)}</dd>` : ""}
          <dt>Location</dt><dd>${locationLine ? esc(locationLine) : '<span class="text-muted">—</span>'}</dd>
          ${
            opts.locationName && t.address && opts.locationName !== t.address
              ? `<dt>Address</dt><dd>${esc(t.address)}</dd>`
              : ""
          }
          <dt>Raised by</dt><dd>${creatorCell(opts.creator, t.contactName, opts.raisedByContactFallback)}</dd>
          <dt>Assignee</dt><dd>${opts.assignee ? esc(opts.assignee) : '<span class="text-muted">—</span>'}</dd>
          <dt>Created</dt><dd>${fmtDate(t.createdAt)}</dd>
          <dt>Updated</dt><dd>${fmtDate(t.updatedAt)}</dd>
        </dl>
      </div>`,
    aiSummary: () =>
      t.aiSummary
        ? `<div class="detail-card">
        <h3>AI summary</h3>
        <div class="detail-desc">${esc(t.aiSummary)}</div>
      </div>`
        : "",
    description: () => `<div class="detail-card">
        <h3>Description</h3>
        <div class="detail-desc">${
          t.description ? esc(t.description) : '<span class="text-muted">No description provided.</span>'
        }</div>
      </div>`,
    attachments: () => attachmentsCard(opts.attachments),
    commentsPublic: () =>
      commentsCard(enabled.has("commentsPrivate") ? "Public comments" : "Comments", opts.publicComments),
    commentsPrivate: () => commentsCard("Private comments", opts.privateComments),
    activity: () => activityCard(t.relatedVisis),
  };

  const cards = opts.blocks
    .filter((b) => b.enabled)
    .map((b) => cardFor[b.key]())
    .filter(Boolean)
    .join("\n");

  const body = `<div class="container container--sm" style="max-width:760px">
    <div class="detail-top">
      <a class="detail-back" href="${esc(opts.backHref)}">&larr; Back to tickets</a>
      ${pager(opts.prevHref, opts.nextHref)}
    </div>

    <div class="detail-header">
      <div class="detail-no">Ticket #${esc(t.ticketNo ?? "—")}</div>
      <h1 class="detail-title">${esc(t.title || "Untitled")}</h1>
      <div class="detail-badges">${statusBadge(t.status)}${priorityBadge(t.priority)}</div>
    </div>

    <div class="detail-grid">
      ${cards}
    </div>
  </div>`;

  return layout({
    title: `Ticket #${t.ticketNo ?? ""} · ${opts.theme.brandLabel}`,
    body,
    theme: opts.theme,
    nav: { role: opts.role, active: "tickets" },
  });
}
