import { describe, it, expect } from "vitest";
import { ticketPage } from "../src/views/ticket";
import { ticketsPage } from "../src/views/tickets";
import { layout, sanitizeHexColor, sanitizeLogoUrl, type Theme } from "../src/views/layout";
import { defaultTicketBlocks, defaultTicketColumns } from "../src/config";
import type { TicketDetail, TicketSummary } from "../src/visibuild";

const theme: Theme = { brandLabel: "511SRC", logoUrl: "", faviconUrl: "", primaryColor: "#5c7e6a" };
const allBlocks = defaultTicketBlocks().map((b) => ({ ...b, enabled: true }));

const detail: TicketDetail = {
  id: "t1", ticketNo: 101, title: "Cracked <tile>", status: "open", priority: "high",
  projectId: "p1", locationId: "l1", address: "Lobby",
  createdAt: "2026-05-01T03:00:00Z", updatedAt: "2026-06-01T05:30:00Z",
  description: "Line one\nLine two with <script>alert(1)</script>",
  aiSummary: "Tile cracked near the lobby entrance; low risk.",
  createdByUserId: "u1", companyId: "co1", contactName: "Callista Low",
  relatedVisis: [
    { id: "v1", alias: "CT-39959", title: "Broken glass", type: "defect", status: "open", createdAt: "2025-05-20T02:20:39Z", updatedAt: "2026-05-01T07:00:51Z", projectId: "p1", assigneeId: "pc1", assigneeType: "ProjectCompany" },
  ],
};

describe("ticketPage", () => {
  const html = ticketPage({
    theme,
    role: "viewer",
    ticket: detail,
    projectLabel: "511SRC (511)",
    locationName: "A / Ground / Lobby",
    publicComments: [{ id: "c1", content: "Public note <b>", createdAt: "2026-06-02T04:00:00Z", userId: "u1" }],
    privateComments: [{ id: "c9", content: "Internal note", createdAt: "2026-06-03T04:00:00Z", userId: "u2" }],
    attachments: [
      { id: "a1", url: "https://cdn.example.com/p/crack.jpg", filename: "crack.jpg", isImage: true, createdAt: "2026-06-01T00:00:00Z" },
      { id: "a2", url: "https://cdn.example.com/p/report.pdf", filename: "report.pdf", isImage: false, createdAt: "2026-06-01T00:00:00Z" },
    ],
    creator: { id: "u1", name: "Jordan Smith", email: "jordan@example.com" },
    assignee: "Glass 2 Go",
    raisedByContactFallback: false,
    blocks: allBlocks,
    backHref: "/",
    prevHref: "/tickets/t0",
    nextHref: "/tickets/t2",
  });

  it("shows the core fields", () => {
    expect(html).toContain("Ticket #101");
    expect(html).toContain("A / Ground / Lobby");
    expect(html).toContain("Public note");
  });

  it("shows the AI summary and no longer renders the ID row", () => {
    expect(html).toContain("AI summary");
    expect(html).toContain("Tile cracked near the lobby entrance");
    expect(html).not.toContain("<dt>ID</dt>");
  });

  it("renders public and private comments under distinct headings when both are enabled", () => {
    expect(html).toContain("Public comments");
    expect(html).toContain("Private comments");
    expect(html).toContain("Internal note");
  });

  it("renders the Activity feed from related visis", () => {
    expect(html).toContain("<h3>Activity</h3>");
    expect(html).toContain("CT-39959");
    expect(html).toContain("Broken glass");
    expect(html).toContain("Defect"); // type is sentence-cased
  });

  it("shows the assignee company in Details", () => {
    expect(html).toContain("Assignee");
    expect(html).toContain("Glass 2 Go");
  });

  it("renders image attachments as thumbnails and other files as links", () => {
    expect(html).toContain('class="att-thumb"');
    expect(html).toContain('<img src="https://cdn.example.com/p/crack.jpg"');
    expect(html).toContain('href="https://cdn.example.com/p/report.pdf"');
    expect(html).toContain("report.pdf");
  });

  it("escapes HTML to prevent injection", () => {
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Cracked &lt;tile&gt;");
  });

  it("shows the raising user's name and email", () => {
    expect(html).toContain("Raised by");
    expect(html).toContain("Jordan Smith");
    expect(html).toContain("jordan@example.com");
  });

  it("does not render phone or cost fields", () => {
    expect(html.toLowerCase()).not.toContain("phone");
    expect(html.toLowerCase()).not.toContain("cost");
  });
});

describe("ticketPage — block configuration", () => {
  const base = {
    theme, role: "viewer" as const, ticket: detail,
    projectLabel: "P", locationName: "L",
    publicComments: [{ id: "c1", content: "Public note", createdAt: "x", userId: "u1" }],
    privateComments: [{ id: "c9", content: "Internal note", createdAt: "y", userId: "u2" }],
    attachments: [], creator: null, assignee: null, raisedByContactFallback: false,
    backHref: "/", prevHref: null, nextHref: null,
  };

  it("hides blocks that are toggled off", () => {
    const html = ticketPage({
      ...base,
      blocks: defaultTicketBlocks().map((b) => ({ ...b, enabled: false })),
    });
    expect(html).not.toContain("<h3>Details</h3>");
    expect(html).not.toContain("AI summary");
    expect(html).not.toContain("<h3>Description</h3>");
    expect(html).not.toContain("Public note");
    expect(html).not.toContain("Internal note");
    expect(html).not.toContain("<h3>Activity</h3>");
    // The header always renders.
    expect(html).toContain("Ticket #101");
  });

  it("titles the public block 'Comments' when private is disabled", () => {
    const html = ticketPage({
      ...base,
      blocks: defaultTicketBlocks(), // commentsPrivate disabled by default
    });
    expect(html).toContain("<h3>Comments</h3>");
    expect(html).not.toContain("Private comments");
    expect(html).not.toContain("Internal note");
  });

  it("renders blocks in the configured order", () => {
    const html = ticketPage({
      ...base,
      blocks: [
        { key: "description", enabled: true },
        { key: "generalDetails", enabled: true },
        { key: "aiSummary", enabled: false },
        { key: "attachments", enabled: false },
        { key: "commentsPublic", enabled: false },
        { key: "commentsPrivate", enabled: false },
        { key: "activity", enabled: false },
      ],
    });
    // Description card precedes the Details card under this custom order.
    expect(html.indexOf("<h3>Description</h3>")).toBeLessThan(html.indexOf("<h3>Details</h3>"));
  });
});

describe("ticketPage — Raised by fallback", () => {
  const opts = {
    theme, role: "viewer" as const, ticket: detail,
    projectLabel: null, locationName: null, publicComments: [], privateComments: [], attachments: [],
    creator: null, assignee: null, blocks: allBlocks, backHref: "/", prevHref: null, nextHref: null,
  };

  it("shows 'Unknown user' when no creator and the contact fallback is off", () => {
    const html = ticketPage({ ...opts, raisedByContactFallback: false });
    expect(html).toContain("Raised by");
    expect(html).toContain("Unknown user");
    expect(html).not.toContain("Callista Low");
  });

  it("falls back to the contact name when enabled", () => {
    const html = ticketPage({ ...opts, raisedByContactFallback: true });
    expect(html).toContain("Callista Low");
    expect(html).not.toContain("Unknown user");
  });
});

describe("ticketsPage", () => {
  const tickets: TicketSummary[] = [
    { id: "t1", ticketNo: 1, title: "A", status: "open", priority: "low", projectId: "p1", locationId: "l1", address: null, createdAt: "x", updatedAt: "y", createdByUserId: "u1", companyId: "co1", contactName: null, relatedVisis: [] },
  ];
  it("renders rows, the Raised by column, and a not-configured hint when appropriate", () => {
    const ok = ticketsPage({
      theme, role: "viewer", tickets, locationNames: new Map([["l1", "Lobby"]]),
      projectLabels: new Map(), creators: new Map([["u1", { id: "u1", name: "Jordan Smith", email: "jordan@example.com" }]]), assignees: new Map(),
      raisedByContactFallback: false, columns: defaultTicketColumns(),
      projectOptions: [], selectedProjectId: "", selectedStatus: "",
      statusCounts: { open: 1 }, totalCount: 1, showProjectColumn: false, configured: true, configHint: false,
    });
    expect(ok).toContain("Lobby");
    expect(ok).toContain('href="/tickets/t1"');
    expect(ok).toContain("Raised by");
    expect(ok).toContain("Jordan Smith");

    const unconfigured = ticketsPage({
      theme, role: "admin", tickets: [], locationNames: new Map(),
      projectLabels: new Map(), creators: new Map(), assignees: new Map(), raisedByContactFallback: false, columns: defaultTicketColumns(),
      projectOptions: [], selectedProjectId: "", selectedStatus: "",
      statusCounts: {}, totalCount: 0, showProjectColumn: false, configured: false, configHint: true,
    });
    expect(unconfigured).toContain("isn't connected to Visibuild yet");
  });

  it("shows 'Unknown user' when the creator can't be resolved", () => {
    const html = ticketsPage({
      theme, role: "viewer", tickets, locationNames: new Map(),
      projectLabels: new Map(), creators: new Map(), assignees: new Map(), raisedByContactFallback: false, columns: defaultTicketColumns(),
      projectOptions: [], selectedProjectId: "", selectedStatus: "",
      statusCounts: { open: 1 }, totalCount: 1, showProjectColumn: false, configured: true, configHint: false,
    });
    expect(html).toContain("Unknown user");
  });

  it("falls back to the contact name in the Raised by column when enabled", () => {
    const contactTickets: TicketSummary[] = [
      { ...tickets[0], createdByUserId: null, contactName: "Callista Low" },
    ];
    const html = ticketsPage({
      theme, role: "viewer", tickets: contactTickets, locationNames: new Map(),
      projectLabels: new Map(), creators: new Map(), assignees: new Map(), raisedByContactFallback: true, columns: defaultTicketColumns(),
      projectOptions: [], selectedProjectId: "", selectedStatus: "",
      statusCounts: { open: 1 }, totalCount: 1, showProjectColumn: false, configured: true, configHint: false,
    });
    expect(html).toContain("Callista Low");
    expect(html).not.toContain("Unknown user");
  });

  it("honours column enable/disable and order", () => {
    const html = ticketsPage({
      theme, role: "viewer", tickets, locationNames: new Map([["l1", "Lobby"]]),
      projectLabels: new Map(), creators: new Map(), assignees: new Map(), raisedByContactFallback: false,
      columns: [
        { key: "title", enabled: true },
        { key: "ticketNo", enabled: true },
        { key: "status", enabled: false },
        { key: "location", enabled: false },
        { key: "project", enabled: false },
        { key: "priority", enabled: false },
        { key: "raisedBy", enabled: false },
        { key: "updated", enabled: false },
      ],
      projectOptions: [], selectedProjectId: "", selectedStatus: "",
      statusCounts: { open: 1 }, totalCount: 1, showProjectColumn: false, configured: true, configHint: false,
    });
    // Title header precedes the # header (custom order), and disabled columns are gone.
    expect(html.indexOf("<th>Title</th>")).toBeGreaterThanOrEqual(0);
    expect(html.indexOf("<th>Title</th>")).toBeLessThan(html.indexOf("<th>#</th>"));
    expect(html).not.toContain("Raised by");
    expect(html).not.toContain("Lobby");
  });
});

describe("favicon", () => {
  it("uses the bundled favicons when no URL is set", () => {
    const html = layout({ title: "T", body: "", theme });
    expect(html).toContain('href="/favicon-32.png"');
    expect(html).not.toContain('rel="icon" href=');
  });

  it("uses (and escapes) a custom favicon URL when set", () => {
    const html = layout({ title: "T", body: "", theme: { ...theme, faviconUrl: "https://cdn.example.com/fav.ico" } });
    expect(html).toContain('<link rel="icon" href="https://cdn.example.com/fav.ico">');
    expect(html).toContain('<link rel="apple-touch-icon" href="https://cdn.example.com/fav.ico">');
    expect(html).not.toContain("/favicon-32.png");
  });
});

describe("theme sanitisers", () => {
  it("accepts valid 6-digit hex and rejects anything else", () => {
    expect(sanitizeHexColor("#A1B2C3", "#000000")).toBe("#a1b2c3");
    expect(sanitizeHexColor("red", "#000000")).toBe("#000000");
    expect(sanitizeHexColor("#fff", "#000000")).toBe("#000000"); // 3-digit not allowed
    // CSS injection attempt must fall back to the default.
    expect(sanitizeHexColor("#000} body{display:none", "#123456")).toBe("#123456");
    expect(sanitizeHexColor("", "#123456")).toBe("#123456");
  });

  it("accepts http(s) URLs and rejects other schemes", () => {
    expect(sanitizeLogoUrl("https://x.com/logo.png")).toBe("https://x.com/logo.png");
    expect(sanitizeLogoUrl("http://x.com/logo.png")).toBe("http://x.com/logo.png");
    expect(sanitizeLogoUrl("javascript:alert(1)")).toBe("");
    expect(sanitizeLogoUrl("data:image/png;base64,AAAA")).toBe("");
    expect(sanitizeLogoUrl("not a url")).toBe("");
    expect(sanitizeLogoUrl("")).toBe("");
  });
});
