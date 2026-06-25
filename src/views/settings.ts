/**
 * settings.ts — admin configuration page.
 *
 * One form posts to /settings with a `action` of "save" or "test". The OAuth
 * secret and viewer password fields are left blank when already set and only
 * overwrite the stored value when a new value is typed.
 */
import { layout, esc, type Theme } from "./layout";
import { TICKET_BLOCK_LABELS, TICKET_COLUMN_LABELS, type AppConfig } from "../config";
import type { ProjectInfo } from "../visibuild";

export interface SettingsPageOptions {
  theme: Theme;
  cfg: AppConfig;
  projects: ProjectInfo[] | null;
  projectsError?: string;
  message?: { kind: "success" | "error" | "info"; text: string };
  hasSecret: boolean;
  hasViewerPassword: boolean;
}

function projectsField(opts: SettingsPageOptions): string {
  if (opts.projects === null) {
    return `<p class="field-hint">${esc(
      opts.projectsError ||
        "Save your Visibuild credentials and run “Save & test connection” to load the project list.",
    )}</p>`;
  }
  if (opts.projects.length === 0) {
    return `<p class="field-hint">No projects were returned for these credentials.</p>`;
  }
  const exposed = new Set(opts.cfg.exposedProjectIds);
  const items = opts.projects
    .map(
      (p) => `<label class="checkbox-item">
        <input type="checkbox" name="projects" value="${esc(p.id)}"${exposed.has(p.id) ? " checked" : ""}>
        <span>${esc(p.name)}</span>
        ${p.code ? `<span class="code">${esc(p.code)}</span>` : ""}
      </label>`,
    )
    .join("");
  // Marker so the POST handler knows the checkbox list was actually shown and
  // an empty selection is intentional (rather than the list having failed to load).
  return `<input type="hidden" name="projectsPresent" value="1">
    <div class="actions-row" style="margin-bottom:10px">
      <button type="button" class="btn btn-ghost" data-select="all" data-target="projects">Select all</button>
      <button type="button" class="btn btn-ghost" data-select="none" data-target="projects">Clear</button>
    </div>
    <div class="checkbox-list">${items}</div>
    <p class="field-hint" style="margin-top:10px">If none are ticked, every project these credentials can access is shown.</p>`;
}

const MOVE_UP = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>`;
const MOVE_DOWN = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;

/**
 * A reorderable, toggleable list. Each row submits a hidden `${orderName}` input
 * (always, in DOM order) plus a `${checkboxName}` checkbox (only when ticked),
 * so the POST handler gets both the order and the enabled set. The up/down
 * buttons reorder the DOM rows (see app.js); without JS, enable/disable still works.
 */
function reorderableField(args: {
  present: string;
  checkboxName: string;
  orderName: string;
  items: { key: string; label: string; enabled: boolean }[];
  hint: string;
}): string {
  const rows = args.items
    .map((it) => {
      const id = `${args.checkboxName}_${it.key}`;
      return `<div class="column-item" data-column-row>
        <input type="hidden" name="${esc(args.orderName)}" value="${esc(it.key)}">
        <input type="checkbox" id="${esc(id)}" name="${esc(args.checkboxName)}" value="${esc(it.key)}"${it.enabled ? " checked" : ""}>
        <label for="${esc(id)}">${esc(it.label)}</label>
        <span class="column-move">
          <button type="button" class="icon-btn" data-move="up" aria-label="Move ${esc(it.label)} up">${MOVE_UP}</button>
          <button type="button" class="icon-btn" data-move="down" aria-label="Move ${esc(it.label)} down">${MOVE_DOWN}</button>
        </span>
      </div>`;
    })
    .join("");
  return `<input type="hidden" name="${esc(args.present)}" value="1">
    <div class="checkbox-list column-list">${rows}</div>
    <p class="field-hint" style="margin-top:10px">${args.hint}</p>`;
}

function ticketBlocksField(opts: SettingsPageOptions): string {
  return reorderableField({
    present: "blocksPresent",
    checkboxName: "blocks",
    orderName: "blockOrder",
    items: opts.cfg.ticketBlocks.map((b) => ({ key: b.key, label: TICKET_BLOCK_LABELS[b.key], enabled: b.enabled })),
    hint: "Tick to show a section; use the arrows to reorder. The ticket number, title, and status are always shown.",
  });
}

function columnsField(opts: SettingsPageOptions): string {
  return reorderableField({
    present: "columnsPresent",
    checkboxName: "columns",
    orderName: "columnOrder",
    items: opts.cfg.ticketColumns.map((c) => ({ key: c.key, label: TICKET_COLUMN_LABELS[c.key], enabled: c.enabled })),
    hint: "Tick to show a column; use the arrows to reorder. The Project column only appears when more than one project is in view.",
  });
}

export function settingsPage(opts: SettingsPageOptions): string {
  const { cfg } = opts;
  const msg = opts.message
    ? `<div class="message ${opts.message.kind}">${esc(opts.message.text)}</div>`
    : "";

  const body = `<div class="container container--sm">
    <div class="page-header">
      <h1 class="page-title">Settings</h1>
      <p class="page-subtitle">Connect Visibuild, choose which projects to show, and set the developer password.</p>
    </div>
    ${msg}
    <form method="post" action="/settings" autocomplete="off">
      <div class="card">
        <p class="form-section-title">Branding</p>
        <div class="form-group">
          <label for="brandLabel">Site name</label>
          <input type="text" id="brandLabel" name="brandLabel" value="${esc(cfg.brandLabel)}" placeholder="e.g. Post-completion portal">
          <p class="field-hint">Shown in the header and on the sign-in pages.</p>
        </div>
        <div class="form-group">
          <label for="logoUrl">Logo URL</label>
          <input type="url" id="logoUrl" name="logoUrl" value="${esc(cfg.logoUrl)}" placeholder="https://example.com/logo.png">
          <p class="field-hint">Optional. A direct link to an image (PNG/SVG). Leave blank to use the default icon.</p>
        </div>
        <div class="form-group">
          <label for="faviconUrl">Favicon URL</label>
          <input type="url" id="faviconUrl" name="faviconUrl" value="${esc(cfg.faviconUrl)}" placeholder="https://example.com/favicon.ico">
          <p class="field-hint">Optional. A direct link to a favicon (ICO/PNG/SVG); it may be hotlinked from another site. Leave blank to use the default.</p>
        </div>
        <div class="form-group">
          <label for="primaryColor">Primary colour</label>
          <div class="color-row">
            <input type="color" id="primaryColor" name="primaryColor" value="${esc(cfg.primaryColor)}">
            <code>${esc(cfg.primaryColor)}</code>
          </div>
          <p class="field-hint">The brand colour. Buttons, highlights, and accents are derived from it automatically.</p>
        </div>

        <p class="form-section-title">Visibuild connection</p>
        <div class="form-group">
          <label for="apiUrl">API base URL</label>
          <input type="text" id="apiUrl" name="apiUrl" value="${esc(cfg.apiUrl)}" placeholder="https://app.apac.visibuild.com/api/core/v1">
        </div>
        <div class="form-group">
          <label for="oauthClientId">OAuth client ID</label>
          <input type="text" id="oauthClientId" name="oauthClientId" value="${esc(cfg.oauthClientId)}" placeholder="Your Visibuild client ID">
        </div>
        <div class="form-group">
          <label for="oauthClientSecret">OAuth client secret</label>
          <input type="password" id="oauthClientSecret" name="oauthClientSecret" placeholder="${
            opts.hasSecret ? "•••••••• (leave blank to keep)" : "Your Visibuild client secret"
          }">
          <p class="field-hint">Create credentials in Visibuild under Company settings → API (Client Credentials grant, read scope).</p>
        </div>

        <p class="form-section-title">Projects to show</p>
        ${projectsField(opts)}

        <p class="form-section-title">Tickets list columns</p>
        ${columnsField(opts)}

        <div class="form-group" style="margin-top:18px">
          <label class="checkbox-item" style="cursor:pointer">
            <input type="checkbox" name="raisedByContactFallback" value="1"${opts.cfg.raisedByContactFallback ? " checked" : ""}>
            <span>Display contact in <em>Raised by</em> if raised directly</span>
          </label>
          <p class="field-hint">When a ticket was raised directly by a contact (no Visibuild user), show the contact’s name instead of “Unknown user”.</p>
        </div>

        <div class="form-group">
          <label for="locationNameStyle">Location names</label>
          <select id="locationNameStyle" name="locationNameStyle">
            <option value="nested"${opts.cfg.locationNameStyle === "nested" ? " selected" : ""}>Full nested path (e.g. North Tower &gt; Level 3 &gt; Apartment 314)</option>
            <option value="leaf"${opts.cfg.locationNameStyle === "leaf" ? " selected" : ""}>Name only (e.g. Apartment 314)</option>
          </select>
          <p class="field-hint">How locations are shown in the tickets list and on each ticket.</p>
        </div>

        <p class="form-section-title">Ticket page blocks</p>
        ${ticketBlocksField(opts)}

        <p class="form-section-title">Developer access</p>
        <div class="form-group">
          <label for="viewerPassword">Viewer password</label>
          <input type="password" id="viewerPassword" name="viewerPassword" placeholder="${
            opts.hasViewerPassword ? "•••••••• (leave blank to keep)" : "Set a password for developers"
          }">
          <p class="field-hint">${
            opts.hasViewerPassword
              ? "A viewer password is set. Developers use it at the sign-in page."
              : "No viewer password set yet — developers cannot sign in until you set one."
          }</p>
        </div>

        <div class="actions-row">
          <button type="submit" class="btn btn-primary" name="action" value="save">Save</button>
          <button type="submit" class="btn btn-ghost" name="action" value="test">Save &amp; test connection</button>
        </div>
      </div>
    </form>
  </div>`;

  return layout({
    title: "Settings · " + opts.theme.brandLabel,
    body,
    theme: opts.theme,
    nav: { role: "admin", active: "settings" },
  });
}
