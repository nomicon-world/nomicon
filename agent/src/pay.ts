/**
 * The x402 payment endpoint. POST /pay/{pr} answers 402 with the quoted fee;
 * a request carrying a valid PAYMENT-SIGNATURE is verified and settled through
 * the facilitator, and the settled transaction is handed to the runtime.
 * The pull request number lives in the resource URL, which is what binds a
 * payment to a submission (Law 5, PROTOCOL.md).
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import { createCdpFacilitatorClient } from "@coinbase/cdp-sdk/x402";
import { x402HTTPResourceServer, type HTTPAdapter, type HTTPRequestContext } from "@x402/core/http";
import { registerExactEvmScheme } from "@x402/evm/exact/server";
import type { PaymentNotice } from "./ports.js";
import type { LedgerEvent } from "./ledger.js";
import type { QuestionsIndex } from "./questions.js";
import { RateLimiter, clientIp } from "./limits.js";

/** head: the commit the quote covers; currentHead: the pull request's head as the agent last saw it, when known. */
export interface OpenQuote { pr: number; feeMicro: bigint; destination: string; expires: number; head?: string; currentHead?: string }

/** Who verifies and settles payments: a plain facilitator URL (x402.org settles testnets only), or Coinbase's, which settles Base mainnet and needs a CDP API key. */
export type FacilitatorChoice = { kind: "url"; url: string } | { kind: "cdp"; apiKeyId: string; apiKeySecret: string };

export function facilitatorFor(choice: FacilitatorChoice): HTTPFacilitatorClient {
  // The CDP SDK is typed against the CommonJS build of @x402/core; the class is the same, the declarations are not.
  if (choice.kind === "cdp") return createCdpFacilitatorClient({ apiKeyId: choice.apiKeyId, apiKeySecret: choice.apiKeySecret }) as unknown as HTTPFacilitatorClient;
  return new HTTPFacilitatorClient({ url: choice.url });
}

export function describeFacilitator(choice: FacilitatorChoice): string {
  return choice.kind === "cdp" ? "Coinbase CDP facilitator" : choice.url;
}

export interface PayServerOptions {
  network: "eip155:8453" | "eip155:84532";
  facilitator: FacilitatorChoice;
  /** Current open quote for a pull request, or null. */
  quoteFor(pr: number): OpenQuote | null;
  /** Constitution Article 8: true while the owner has paused payments or the whole agent. */
  paymentsPaused?: () => boolean;
  onPaid(notice: PaymentNotice): Promise<void>;
  now(): number;
  publicBaseUrl: string;
  /** Law 12 feed: ledger events after an id. */
  feed(since: number): LedgerEvent[];
  /** Law 12: the open-questions index. */
  questions(): QuestionsIndex;
  /** paths.json: the ways to take part. */
  paths?(): Promise<unknown>;
  /** A job card for an option at a place on the World map (paths.json, Law 12 map). */
  job?(option: string, node: string | null): Promise<Record<string, unknown>>;
  /** Folder holding the pay page (pay.page) and its module (x402pay.js), served here rather than on the hosting platform's pages. */
  webDir?: string;
  /** Per-client limits. `trustProxy` reads X-Forwarded-For; only behind a proxy that sets it. */
  limits?: { trustProxy?: boolean; getPerMinute?: number; payPerMinute?: number };
}

function adapterFor(req: IncomingMessage, url: URL): HTTPAdapter {
  const h = (name: string) => {
    const v = req.headers[name.toLowerCase()];
    return Array.isArray(v) ? v[0] : v;
  };
  return {
    getHeader: h,
    getMethod: () => req.method ?? "GET",
    getPath: () => url.pathname,
    getUrl: () => url.toString(),
    getAcceptHeader: () => h("accept") ?? "",
    getUserAgent: () => h("user-agent") ?? "",
    getQueryParams: () => Object.fromEntries(url.searchParams.entries()),
    getQueryParam: (n) => url.searchParams.get(n) ?? undefined,
  };
}

export async function createPayServer(opts: PayServerOptions): Promise<{ server: Server; http: x402HTTPResourceServer }> {
  const facilitator = facilitatorFor(opts.facilitator);
  const core = registerExactEvmScheme(new x402ResourceServer(facilitator), { networks: [opts.network] });
  const prOf = (path: string): number | null => {
    const m = /^\/pay\/(\d+)$/.exec(path);
    return m ? Number(m[1]) : null;
  };
  const http = new x402HTTPResourceServer(core, {
    "POST /pay/[pr]": {
      accepts: {
        scheme: "exact",
        network: opts.network,
        payTo: (ctx) => {
          const q = opts.quoteFor(prOf(ctx.path) ?? -1);
          if (!q) throw new Error("no open quote");
          return q.destination;
        },
        price: (ctx) => {
          const q = opts.quoteFor(prOf(ctx.path) ?? -1);
          if (!q) throw new Error("no open quote");
          return (Number(q.feeMicro) / 1_000_000).toFixed(6);
        },
        maxTimeoutSeconds: 600,
      },
      description: "Nomicon publication fee for one pull request",
      mimeType: "application/json",
    },
  });
  await http.initialize();

  const getLimit = new RateLimiter(opts.limits?.getPerMinute ?? 120);
  const payLimit = new RateLimiter(opts.limits?.payPerMinute ?? 10);
  const server = createServer({ maxHeaderSize: 32 * 1024 }, async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", opts.publicBaseUrl);
    const pr = prOf(url.pathname);
    // Browsers on any origin, such as the site's pay page, may read and pay; the x402 headers must be visible to them.
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-expose-headers", "payment-required, payment-response");
    if (req.method === "OPTIONS") {
      res.writeHead(204, { "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "content-type, payment-signature", "access-control-max-age": "600" });
      res.end(); return;
    }
    const json = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { "content-type": "application/json", ...headers });
      res.end(JSON.stringify(body));
    };
    const ip = clientIp(req, opts.limits?.trustProxy ?? false);
    const limiter = req.method === "POST" && pr !== null ? payLimit : getLimit;
    if (!limiter.allow(ip, Date.now())) return json(429, { error: "too many requests" }, { "retry-after": "60" });
    if ((req.url ?? "").length > 2048) return json(414, { error: "request too long" });
    if (req.method === "GET" && url.pathname === "/feed") {
      const since = Number(url.searchParams.get("since") ?? "0") || 0;
      const events = opts.feed(since);
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      return res.end(JSON.stringify({ since, events }, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
    }
    // The pay page lives on this server, next to the endpoint it pays, not on the hosting platform (its pages may not host payments).
    if (req.method === "GET" && opts.webDir && (url.pathname === "/pay.html" || url.pathname === "/x402pay.js")) {
      const page = url.pathname === "/pay.html";
      let body: string;
      try { body = await readFile(join(opts.webDir, page ? "pay.page" : "x402pay.js"), "utf8"); } catch { return json(404, { error: "not found" }); }
      res.writeHead(200, {
        "content-type": page ? "text/html; charset=utf-8" : "text/javascript; charset=utf-8", "cache-control": "no-cache", "x-content-type-options": "nosniff",
        ...(page ? { "content-security-policy": "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://raw.githubusercontent.com https://api.github.com; base-uri 'none'; form-action 'none'; frame-ancestors 'none'", "referrer-policy": "no-referrer" } : {}),
      });
      return res.end(body);
    }
    if (req.method === "GET" && url.pathname === "/questions") return json(200, opts.questions(), { "cache-control": "no-store", "access-control-allow-origin": "*" });
    if (req.method === "GET" && url.pathname === "/paths" && opts.paths) return json(200, await opts.paths(), { "cache-control": "max-age=60", "access-control-allow-origin": "*" });
    if (req.method === "GET" && url.pathname === "/job" && opts.job) {
      const option = (url.searchParams.get("do") ?? "").slice(0, 64), node = url.searchParams.get("node")?.slice(0, 200) ?? null;
      if (!option) return json(400, { error: "name an option with ?do=<option id> from paths.json; add &node=<node id> for a place on the map" }, { "access-control-allow-origin": "*" });
      const card = await opts.job(option, node);
      return json(card["error"] ? 404 : 200, card, { "cache-control": "no-store", "access-control-allow-origin": "*" });
    }
    if (req.method === "GET" && url.pathname === "/") return json(200, { service: "nomicon-agent", endpoints: ["POST /pay/{pr}", "GET /pay.html (pay a quote with a browser wallet)", "GET /feed?since=<event id>", "GET /questions", "GET /paths", "GET /job?do=<option>&node=<node id>"] });
    if (req.method !== "POST" || pr === null) return json(404, { error: "not found" });
    if (opts.paymentsPaused?.()) return json(503, { error: "payments are paused under Constitution Article 8; the quote's validity is extended by the pause, so nothing is lost by waiting" }, { "retry-after": "3600" });
    const q = opts.quoteFor(pr);
    if (!q) return json(404, { error: "no open quote for this pull request" });
    if (q.expires < opts.now()) return json(410, { error: "quote expired; the agent will issue a new one" });
    if (q.head && q.currentHead && q.head !== q.currentHead) return json(409, { error: "the pull request changed after this quote; the agent withdraws it and quotes the current version on its next pass" });
    const ctx: HTTPRequestContext = { adapter: adapterFor(req, url), path: url.pathname, method: "POST" };
    try {
      const result = await http.processHTTPRequest(ctx);
      if (result.type === "payment-error") {
        res.writeHead(result.response.status, result.response.headers);
        res.end(typeof result.response.body === "string" ? result.response.body : JSON.stringify(result.response.body ?? {}));
        return;
      }
      if (result.type === "no-payment-required") return json(500, { error: "route misconfigured" });
      const settled = await http.processSettlement(result.paymentPayload, result.paymentRequirements, result.declaredExtensions, { request: ctx }, undefined, result.beforeHandlerSettlement);
      if (!settled.success) {
        res.writeHead(settled.response.status, settled.response.headers);
        res.end(JSON.stringify(settled.response.body ?? { error: settled.errorReason }));
        return;
      }
      // The money has moved. Recording must not be lost to a transient failure, so retry, then say exactly what to do.
      let recorded = false, lastErr: unknown = null;
      for (let attempt = 0; attempt < 5 && !recorded; attempt++) {
        try {
          await opts.onPaid({ pr, tx: settled.transaction, payer: settled.payer ?? "", amountMicro: BigInt(result.paymentRequirements.amount), network: settled.network, acceptedWhileOpen: true });
          recorded = true;
        } catch (e) { lastErr = e; await new Promise((r) => setTimeout(r, 500 * (attempt + 1))); }
      }
      if (!recorded) {
        console.error(`PAYMENT SETTLED BUT NOT RECORDED: pr ${pr} tx ${settled.transaction}: ${(lastErr as Error).message}. Record it with: nomicon record-payment ${pr} ${settled.transaction}`);
        return json(500, { error: "payment settled but not yet recorded; keep this transaction hash, the operator records it", pr, transaction: settled.transaction, network: settled.network });
      }
      json(200, { pr, transaction: settled.transaction, network: settled.network }, settled.headers);
    } catch (e) {
      json(500, { error: (e as Error).message });
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  return { server, http };
}
