import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  tokenUrlFromApiUrl,
  parseTicketSummary,
  parseTicketDetail,
  parsePublicComments,
  parsePrivateComments,
  parseProjects,
  parseLocationMap,
  parseAttachments,
  parseCompanyUsers,
  parseCompanies,
  pickAssigneeVisi,
  listTickets,
  resetCaches,
} from "../src/visibuild";
import { defaultTicketBlocks, defaultTicketColumns, type AppConfig } from "../src/config";

describe("tokenUrlFromApiUrl", () => {
  it("strips /api/core/v1 and appends /oauth/token", () => {
    expect(tokenUrlFromApiUrl("https://app.apac.visibuild.com/api/core/v1")).toBe(
      "https://app.apac.visibuild.com/oauth/token",
    );
    expect(tokenUrlFromApiUrl("https://app.apac.visibuild.com/api/core/v1/")).toBe(
      "https://app.apac.visibuild.com/oauth/token",
    );
  });
});

describe("parseTicketSummary", () => {
  it("reads camelCase fields", () => {
    const t = parseTicketSummary({
      id: "t1", ticketNo: 7, title: "Door", status: "open", priority: "high",
      projectId: "p1", locationId: "l1", address: "Unit 2",
      createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-02-01T00:00:00Z",
    });
    expect(t).toMatchObject({ id: "t1", ticketNo: 7, title: "Door", projectId: "p1", locationId: "l1" });
  });

  it("falls back to snake_case fields", () => {
    const t = parseTicketSummary({
      id: "t2", ticket_no: 9, title: "Wall", status: "closed", priority: "low",
      project_id: "p2", location_id: "l2", created_at: "x", updated_at: "y",
    });
    expect(t).toMatchObject({ ticketNo: 9, projectId: "p2", locationId: "l2", createdAt: "x", updatedAt: "y" });
  });

  it("tolerates missing fields", () => {
    const t = parseTicketSummary({ id: "t3" });
    expect(t.title).toBe("");
    expect(t.ticketNo).toBeNull();
    expect(t.projectId).toBeNull();
    expect(t.contactName).toBeNull();
  });

  it("reads the contact name when present", () => {
    expect(parseTicketSummary({ id: "t4", contact: { name: "Callista Low", email: "c@x.com" } }).contactName).toBe("Callista Low");
    expect(parseTicketSummary({ id: "t5", contact: null }).contactName).toBeNull();
  });
});

describe("parseTicketDetail", () => {
  it("includes the description", () => {
    expect(parseTicketDetail({ id: "t", description: "hello" }).description).toBe("hello");
    expect(parseTicketDetail({ id: "t" }).description).toBeNull();
  });

  it("includes the AI summary across field-name variants", () => {
    expect(parseTicketDetail({ id: "t", aiSummary: "s1" }).aiSummary).toBe("s1");
    expect(parseTicketDetail({ id: "t", ai_summary: "s2" }).aiSummary).toBe("s2");
    expect(parseTicketDetail({ id: "t" }).aiSummary).toBeNull();
  });

  it("parses related visis in API order (with assignee fields) and tolerates none", () => {
    const t = parseTicketDetail({
      id: "t",
      visis: [
        { id: "v1", alias: "CT-1", title: "Old", type: "defect", status: "closed", updatedAt: "2025-01-01T00:00:00Z", projectId: "p1", assigneeId: "a1", assigneeType: "ProjectCompany" },
        { id: "v2", alias: "CT-2", title: "New", type: "inspection", status: "open", updatedAt: "2026-01-01T00:00:00Z" },
      ],
    });
    expect(t.relatedVisis.map((v) => v.id)).toEqual(["v1", "v2"]); // API order preserved
    expect(t.relatedVisis[0]).toMatchObject({ projectId: "p1", assigneeId: "a1", assigneeType: "ProjectCompany" });
    expect(parseTicketDetail({ id: "t" }).relatedVisis).toEqual([]);
  });

  it("picks the first open visi for the assignee (else the first)", () => {
    const visis = (s1: string, s2: string) =>
      parseTicketDetail({ id: "t", visis: [
        { id: "v1", status: s1 }, { id: "v2", status: s2 },
      ] }).relatedVisis;
    expect(pickAssigneeVisi(visis("closed", "open"))?.id).toBe("v2");
    expect(pickAssigneeVisi(visis("closed", "closed"))?.id).toBe("v1");
    expect(pickAssigneeVisi([])).toBeNull();
  });

  it("parseCompanies maps id -> name", () => {
    const entries = parseCompanies({ data: { companies: [{ id: "c1", name: "Glass 2 Go" }, { id: "c2", name: "Acme" }] } });
    expect(new Map(entries).get("c1")).toBe("Glass 2 Go");
    expect(parseCompanies({})).toEqual([]);
  });

  it("reads the creator and company across field-name variants", () => {
    expect(parseTicketDetail({ id: "t", createdByUserId: "u1", companyId: "c1" })).toMatchObject({
      createdByUserId: "u1", companyId: "c1",
    });
    expect(parseTicketDetail({ id: "t", created_by_user_id: "u2", created_by_company_id: "c2" })).toMatchObject({
      createdByUserId: "u2", companyId: "c2",
    });
    expect(parseTicketDetail({ id: "t", createdBy: { id: "u3", companyId: "c3" } })).toMatchObject({
      createdByUserId: "u3", companyId: "c3",
    });
  });

  it("leaves creator/company null when absent", () => {
    const t = parseTicketDetail({ id: "t" });
    expect(t.createdByUserId).toBeNull();
    expect(t.companyId).toBeNull();
  });
});

describe("parseCompanyUsers", () => {
  it("builds full names, falls back to first/last, and reads email variants", () => {
    const users = parseCompanyUsers({
      data: {
        users: [
          { id: "u1", name: "Jordan Smith", email: "jordan@example.com" },
          { id: "u2", first_name: "Sam", last_name: "Lee", email_address: "sam@example.com" },
          { userId: "u3" },
        ],
      },
    });
    expect(users).toEqual([
      { id: "u1", name: "Jordan Smith", email: "jordan@example.com" },
      { id: "u2", name: "Sam Lee", email: "sam@example.com" },
      { id: "u3", name: "", email: "" },
    ]);
  });

  it("tolerates an empty or missing envelope", () => {
    expect(parseCompanyUsers({})).toEqual([]);
    expect(parseCompanyUsers({ data: { users: [] } })).toEqual([]);
  });
});

describe("parsePublicComments", () => {
  const data = {
    data: {
      comments: [
        { id: "c2", content: "second", commentType: "public", createdAt: "2026-02-01T00:00:00Z" },
        { id: "c1", content: "first", commentType: "public", createdAt: "2026-01-01T00:00:00Z" },
        { id: "c3", content: "secret", commentType: "private", createdAt: "2026-03-01T00:00:00Z" },
      ],
    },
  };

  it("keeps only public comments", () => {
    const comments = parsePublicComments(data);
    expect(comments).toHaveLength(2);
    expect(comments.find((c) => c.content === "secret")).toBeUndefined();
  });

  it("sorts oldest first", () => {
    const comments = parsePublicComments(data);
    expect(comments.map((c) => c.id)).toEqual(["c1", "c2"]);
  });

  it("returns [] for empty/missing data", () => {
    expect(parsePublicComments({})).toEqual([]);
    expect(parsePublicComments({ data: {} })).toEqual([]);
  });
});

describe("parsePrivateComments", () => {
  const data = {
    data: {
      comments: [
        { id: "c2", content: "pub", commentType: "public", createdAt: "2026-02-01T00:00:00Z" },
        { id: "c3", content: "secret", commentType: "private", createdAt: "2026-03-01T00:00:00Z" },
        { id: "c4", content: "internal", commentType: "internal", createdAt: "2026-01-01T00:00:00Z" },
      ],
    },
  };

  it("keeps every non-public comment, oldest first", () => {
    const comments = parsePrivateComments(data);
    expect(comments.map((c) => c.id)).toEqual(["c4", "c3"]);
    expect(comments.find((c) => c.content === "pub")).toBeUndefined();
  });
});

describe("parseProjects", () => {
  it("maps and sorts by name", () => {
    const projects = parseProjects({ data: { projects: [
      { id: "b", name: "Beta", code: "B" },
      { id: "a", name: "Alpha" },
    ] } });
    expect(projects.map((p) => p.name)).toEqual(["Alpha", "Beta"]);
    expect(projects[1].code).toBe("B");
    expect(projects[0].code).toBeNull();
  });
});

describe("parseAttachments", () => {
  it("classifies by extension and derives a filename", () => {
    const atts = parseAttachments({ data: { attachments: [
      { id: "a1", url: "https://cdn.x/p/photo.JPG?sig=abc", key: "p/photo.JPG" },
      { id: "a2", url: "https://cdn.x/p/report.pdf", key: "p/report.pdf" },
    ] } });
    expect(atts).toHaveLength(2);
    expect(atts[0]).toMatchObject({ isImage: true, filename: "photo.JPG" });
    expect(atts[1]).toMatchObject({ isImage: false, filename: "report.pdf" });
  });

  it("treats unknown/extensionless attachments as images (optimistic)", () => {
    const atts = parseAttachments({ data: { attachments: [
      { id: "a3", url: "https://cdn.x/blob/abc123?token=xyz", key: "blob/abc123" },
    ] } });
    expect(atts[0].isImage).toBe(true);
  });

  it("ignores entries without a url and tolerates empty data", () => {
    expect(parseAttachments({ data: { attachments: [{ id: "x" }] } })).toEqual([]);
    expect(parseAttachments({})).toEqual([]);
  });
});

describe("listTickets caching", () => {
  const cfg: AppConfig = {
    apiUrl: "https://api.test/api/core/v1", oauthClientId: "id", oauthClientSecret: "s",
    exposedProjectIds: [], viewerPassword: "", brandLabel: "", logoUrl: "", faviconUrl: "", primaryColor: "#000000",
    ticketBlocks: defaultTicketBlocks(), ticketColumns: defaultTicketColumns(),
    raisedByContactFallback: false, locationNameStyle: "nested",
  };
  const realFetch = globalThis.fetch;
  let ticketFetches = 0;

  beforeEach(() => {
    resetCaches();
    ticketFetches = 0;
    globalThis.fetch = (async (url: any) => {
      const u = String(url);
      if (u.includes("/oauth/token")) {
        return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }), { status: 200 });
      }
      if (u.includes("/tickets")) {
        ticketFetches++;
        return new Response(
          JSON.stringify({
            data: { tickets: [{ id: "t1", ticketNo: 1, title: "A", status: "open", priority: "low", projectId: "p1", createdAt: "x", updatedAt: "y" }] },
            pagination: { next: null },
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 200 });
    }) as any;
  });
  afterEach(() => { globalThis.fetch = realFetch; });

  it("serves the second call from cache and re-fetches on force", async () => {
    expect(await listTickets(cfg, {})).toHaveLength(1);
    expect(ticketFetches).toBe(1);
    await listTickets(cfg, {}); // cached
    expect(ticketFetches).toBe(1);
    await listTickets(cfg, { force: true }); // Refresh -> re-fetch
    expect(ticketFetches).toBe(2);
  });

  it("applies the status filter to cached data without re-fetching", async () => {
    await listTickets(cfg, {});
    expect(ticketFetches).toBe(1);
    expect(await listTickets(cfg, { status: "open" })).toHaveLength(1);
    expect(await listTickets(cfg, { status: "closed" })).toHaveLength(0);
    expect(ticketFetches).toBe(1);
  });

  it("re-throws a 429 (rate limit) instead of swallowing it", async () => {
    globalThis.fetch = (async (url: any) => {
      const u = String(url);
      if (u.includes("/oauth/token")) {
        return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }), { status: 200 });
      }
      return new Response("rate limited", { status: 429 });
    }) as any;
    await expect(listTickets(cfg, { force: true })).rejects.toMatchObject({ status: 429 });
  });
});

describe("parseLocationMap", () => {
  it("prefers the API's nestedName over the leaf name", () => {
    const map = parseLocationMap({ data: { locations: [
      { id: "l1", name: "Pre-work", nestedName: "Demolition / Pre-work" },
      { id: "l2", name: "Unit 5" },
    ] } });
    expect(map.get("l1")).toBe("Demolition / Pre-work");
    expect(map.get("l2")).toBe("Unit 5");
  });

  it("uses the leaf name when the style is 'leaf'", () => {
    const map = parseLocationMap({ data: { locations: [
      { id: "l1", name: "Pre-work", nestedName: "Demolition / Pre-work" },
    ] } }, "leaf");
    expect(map.get("l1")).toBe("Pre-work");
  });

  it("skips locations with no usable name (no UUID fallback)", () => {
    const map = parseLocationMap({ data: { locations: [{ id: "l3" }] } });
    expect(map.has("l3")).toBe(false);
  });
});
