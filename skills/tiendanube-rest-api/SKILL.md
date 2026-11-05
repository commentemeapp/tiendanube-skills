---
name: tiendanube-rest-api
description: "Apply when writing or reviewing code that calls the Tiendanube / Nuvemshop Admin REST API from an app or integration: building the base URL with the API version and store_id, choosing the api.tiendanube.com or api.nuvemshop.com.br host, sending the Authorization bearer header and the mandatory User-Agent, JSON bodies with Content-Type, handling 4xx and 5xx responses (400, 402, 403, 415, 422, 429), respecting the leaky bucket rate limit and its x-rate-limit headers, paginating with page, per_page, x-total-count and the Link header, common list filters (since_id, created_at_min, updated_at_min, fields, q) and picking between 2025-03, v1 and unstable. Use for a new API client, a sync job, or debugging failed calls."
license: MIT
compatibility: "Tiendanube / Nuvemshop Admin API, version 2025-03. Apps built by partners; not for the official Admin MCP."
metadata:
  author: commente.me
  version: "0.1.0"
---

# Admin REST API: requests, limits and pagination

## When this skill applies

Use this skill when code talks to the Tiendanube / Nuvemshop Admin API over HTTP on behalf of a store that installed the app: a backend integration, an ERP or marketplace connector, a sync worker or the server side of an Admin app.

- Building the request URL for a store (`/{version}/{store_id}/{resource}`)
- Writing the shared HTTP client: headers, JSON, retries, error mapping
- Reading large lists (orders, products, customers) page by page
- Staying under the rate limit in batch jobs
- Deciding which API version a new integration targets
- Diagnosing `400`, `402`, `403`, `415`, `422` or `429` responses

Do not use this skill for:

- Obtaining the access token, scopes and installation flow (use `tiendanube-oauth-apps`)
- Receiving and verifying event notifications (use `tiendanube-webhooks`)
- Resource-specific rules for products, variants and stock (use `tiendanube-catalog`) or orders and fulfillment orders (use `tiendanube-orders-fulfillment`)
- A headless storefront reading the public catalog: that is the Storefront API, which needs no app or OAuth
- A merchant who wants to manage the store by chatting with an AI agent: that is the official Admin MCP server, not code you write. These skills are for developers building apps and integrations.

## Decision rules

- Target `2025-03` for every new or production integration. It is the current stable version and the default of the reference. `v1` is legacy and only makes sense for code already built on it. `unstable` is for trying features that can still change; never ship production behavior that depends on it.
- Both brands share one API. `api.tiendanube.com` and `api.nuvemshop.com.br` accept the same paths; pick one and keep it in configuration, not hard-coded per call.
- The path always carries the version and then the store ID: `https://api.tiendanube.com/2025-03/{store_id}/products`. The store ID is the `user_id` returned when the token was issued.
- Only HTTPS is accepted.
- Endpoints that are not tied to a store (for example billing plans) use the Partner Action form `/{version}/apps/{app_id}/...` and authenticate with the app's client secret instead of a store token. Keep that path in a separate client.
- Use the HTTP verbs as documented: `GET` reads, `POST` creates, `PUT` replaces, `DELETE` removes, `HEAD` returns only headers. A `PUT` with no body needs `Content-Length: 0`.
- Bodies and responses are JSON with no root element and snake_case keys.
- Multi-language fields (for example `name`, `description`, `handle` on products and categories) always come back as an object keyed by language, even with a single active language. Read `x-main-language` to know the store's main language. On writes, send either an object per language or a plain string that applies to all languages.
- Read the store's plan and capabilities from `GET /store` (`plan_name`, `features`) before calling features that depend on the plan.
- There is no endpoint for the Admin's aggregate statistics or session counts. Build reports from paginated resources such as orders, customers and products.

## Hard constraints

### Constraint: Send Authorization, User-Agent and Content-Type on every call

Every request carries `Authorization: Bearer <access_token>` and a `User-Agent` that names the app and gives a contact URL or email. Requests with a body also send `Content-Type: application/json` (the reference spells out `application/json; charset=utf-8`).

**Why this matters**

A request without `User-Agent` is rejected with `400 Bad Request`. A `POST` or `PUT` without `Content-Type` gets `415 Unsupported Media Type`. The header name is `Authorization`, with the scheme `Bearer`, as in the curl examples of the introduction, the partner action guide and the ERP guide.

**Detection**

An HTTP client created without default headers, a `User-Agent` left as the library default, a token placed in the query string, or `fetch` calls with `body: JSON.stringify(...)` and no `Content-Type`.

**Correct**

```ts
const BASE = "https://api.tiendanube.com/2025-03";

async function nsRequest(storeId: string, token: string, path: string, init: RequestInit = {}) {
	return fetch(`${BASE}/${storeId}${path}`, {
		...init,
		headers: {
			Authorization: `Bearer ${token}`,
			"User-Agent": "Acme Sync (https://acme.example.com/contact)",
			"Content-Type": "application/json; charset=utf-8",
			...init.headers
		}
	});
}
```

**Wrong**

```ts
await fetch(`https://api.tiendanube.com/2025-03/${storeId}/products?access_token=${token}`, {
	method: "POST",
	body: JSON.stringify({ name: "Acme mug" })
});
```

### Constraint: Respect the leaky bucket and back off on 429

The limit is counted per store and app pair with a leaky bucket: by default a bucket of 40 requests that drains at 2 requests per second. Stores on the Next and Evolution plans get ten times that. Requests that arrive with the bucket full receive `429 Too Many Requests` and are lost.

**Why this matters**

Firing many requests in parallel does not make them faster: 20 queued requests still take about 10 seconds. Sending 50 at once means 10 fail immediately. Sustained traffic above 2 per second fills the bucket and then starts losing requests.

**Detection**

`Promise.all` over hundreds of IDs, a worker pool sized without regard to the limit, retry loops on `429` with no delay, or code that ignores the `x-rate-limit-*` headers.

**Correct**

```ts
async function throttled(storeId: string, token: string, path: string, init?: RequestInit) {
	for (let attempt = 0; attempt < 5; attempt++) {
		const res = await nsRequest(storeId, token, path, init);
		const remaining = Number(res.headers.get("x-rate-limit-remaining") ?? "1");
		const resetMs = Number(res.headers.get("x-rate-limit-reset") ?? "0");
		if (res.status !== 429) {
			if (remaining <= 1 && resetMs > 0) await sleep(resetMs);
			return res;
		}
		await sleep(Math.max(resetMs, 1000));
	}
	throw new Error("Rate limit retries exhausted");
}
```

**Wrong**

```ts
await Promise.all(productIds.map((id) => nsRequest(storeId, token, `/products/${id}`)));
```

Headers: `x-rate-limit-limit` (bucket size), `x-rate-limit-remaining` (requests left before the bucket is full), `x-rate-limit-reset` (milliseconds until the bucket is empty). They are lowercase.

### Constraint: Paginate explicitly and follow the Link header

Ask for pages with `page` (1-based) and `per_page` (maximum 200). Read the total from `x-total-count` and the next URL from the `Link` header (`rel="next"`, `prev`, `first`, `last`). The documentation asks clients to use those URLs rather than building their own.

**Why this matters**

A single call returns only the first page, so code that never asks for page 2 silently drops data. A `per_page` above 200 is rejected (the product reference says with `422`). Some resources set their own page size, and some lists, such as the fulfillment orders of an order, come back whole and do not accept `page` at all. `GET /orders` also refuses queries whose result exceeds 10,000 items, so large exports must be narrowed with filters.

**Detection**

A list call with no loop, a loop that stops when a page has fewer than 30 items while asking for another size, `per_page=500`, or a full export of orders with no date filter.

**Correct**

```ts
async function* listAll(storeId: string, token: string, first: string) {
	let url: string | null = `${BASE}/${storeId}${first}`;
	while (url) {
		const res = await throttled(storeId, token, url.replace(`${BASE}/${storeId}`, ""));
		if (!res.ok) throw await toApiError(res);
		yield* (await res.json()) as unknown[];
		url = nextLink(res.headers.get("link")); // parse rel="next"
	}
}

for await (const order of listAll(storeId, token, "/orders?per_page=200&updated_at_min=2025-01-01T00:00:00-03:00")) {
	// upsert
}
```

**Wrong**

```ts
const orders = await (await nsRequest(storeId, token, "/orders?per_page=1000")).json();
```

### Constraint: Map error codes to the right action

Treat each status as a different signal instead of one generic failure.

**Why this matters**

- `400`: malformed JSON (`{"error": "Problems parsing JSON"}`) or missing `User-Agent`. Fix the request; retrying will not help.
- `401`: the token is not valid. Tokens do not expire on their own; they stop working when a new one is issued for the same app and store or the app is uninstalled. Mark the installation as needing reinstall.
- `402 Payment Required`: the store stopped paying its plan or your app's recurring price. Every call fails until payment resumes, so tell the merchant instead of showing a server error. Creating a product can also return `402` when the plan's product limit is reached.
- `403`: the app lacks the scope for the resource, or the store's plan lacks the feature (for example the Labels API).
- `415`: missing `Content-Type`.
- `422`: semantic validation; the body lists errors per field.
- `429`: rate limit (see above).
- `5xx` (`500`, `502`, `503`, `504`): retrying later is the client's responsibility.

**Detection**

`if (!res.ok) throw new Error("API error")` with no status branch, retries on `400` or `422`, or `402` surfaced as "something went wrong".

**Correct**

```ts
switch (res.status) {
	case 402:
		return markStoreSuspended(storeId);
	case 401:
		return markNeedsReinstall(storeId);
	case 403:
		return reportMissingScopeOrFeature(storeId, path);
	case 422:
		return rejectWithFieldErrors(await res.json());
	case 429:
	case 500:
	case 502:
	case 503:
	case 504:
		return scheduleRetry();
	default:
		if (!res.ok) throw await toApiError(res);
}
```

**Wrong**

```ts
if (!res.ok) {
	await sleep(1000);
	return nsRequest(storeId, token, path, init);
}
```

## Preferred pattern

One client per installation, created from the stored record (store ID, token) and shared by every job:

```text
src/tiendanube/
├── client.ts       (base URL from config, headers, throttling, error mapping)
├── paginate.ts     (Link header parsing, per_page=200, filters)
├── errors.ts       (ApiError with status, body, store_id, path)
└── partner.ts      (/{version}/apps/{app_id} calls with the client secret)
```

For incremental syncs, filter instead of re-reading everything. List endpoints such as orders and products accept `since_id`, `created_at_min` / `created_at_max`, `updated_at_min` / `updated_at_max` (ISO 8601), `fields` (comma-separated, to shrink responses) and `q` (text search; its meaning depends on the resource). Keep the last `updated_at` you processed per store and pass it on the next run.

```bash
curl -H 'Authorization: Bearer ACCESS_TOKEN' \
     -H 'User-Agent: Acme Sync (ops@example.com)' \
     'https://api.nuvemshop.com.br/2025-03/123456/products?fields=id,name,variants&updated_at_min=2025-06-01T00:00:00-03:00&per_page=200'
```

Before relying on a field, check the version's changelog: each Admin API version has its own reference and changelog, and the changelog documents when behavior moved from `unstable` to `2025-03` or stayed only in `unstable`.

## Common failure modes

- Mixing versions in one client (`v1` in some calls, `2025-03` in others) and getting different payload shapes.
- Copying `unstable` examples (resources such as Checkout SDK, Store Media or Custom Objects are listed only there) into production code.
- Using the store's domain or the Admin URL instead of the numeric store ID in the path.
- Treating localized fields as strings and saving `[object Object]`.
- Assuming a list returns everything because the first page looked complete.
- Hard-coding the plan rate limit: Next and Evolution stores have a larger bucket, so read the headers.
- Showing a generic error on `402` while the store or app subscription is suspended; the `app/suspended` and `app/resumed` webhooks tell you when to stop and resume.
- Using a token from a demo store against a client store; tokens belong to one app and store pair.

## Review checklist

- [ ] Base URL comes from configuration and includes `2025-03` and the store ID
- [ ] Every call sends `Authorization: Bearer`, a real `User-Agent` with contact, and `Content-Type` when there is a body
- [ ] Concurrency is bounded and `429` is retried with a delay based on `x-rate-limit-reset`
- [ ] List reads loop over pages with `per_page` at most 200 and follow `Link`
- [ ] Large order exports use date or ID filters to stay under 10,000 results
- [ ] `402`, `401`, `403`, `422` and `5xx` each have their own handling
- [ ] No production path depends on `unstable` endpoints
- [ ] Multi-language fields are handled as objects

## Related skills

- [`tiendanube-oauth-apps`](../tiendanube-oauth-apps/SKILL.md): where the token and store ID used here come from
- [`tiendanube-webhooks`](../tiendanube-webhooks/SKILL.md): events instead of polling, and `app/suspended`
- [`tiendanube-catalog`](../tiendanube-catalog/SKILL.md): products, variants, stock and sparse fieldsets
- [`tiendanube-orders-fulfillment`](../tiendanube-orders-fulfillment/SKILL.md): order filters and fulfillment orders
- [`tiendanube-erp-integration`](../tiendanube-erp-integration/SKILL.md): end-to-end sync design on top of this client

## Reference

- [Introduction](https://nuvemshop.dev/en-US/api/getting-started.md): base URL, hosts, headers, JSON, client and server errors, rate limit, pagination, verbs, languages, 402 suspension
- [Versioning](https://nuvemshop.dev/en-US/api/versioning.md): 2025-03 as stable default, v1 legacy, unstable, same paths on both hosts
- [Frequently asked questions about the API](https://nuvemshop.dev/en-US/api/faq.md): 403 causes, per app and store tokens, plan-dependent features, reporting limits
- [HTTP Status Patterns](https://nuvemshop.dev/en-US/apps/http-status.md): meaning of the 2xx, 4xx and 5xx codes used by the Admin API
- [API Resources (unstable)](https://nuvemshop.dev/en-US/api/resources/unstable.md): resources that exist only in the unstable version
- [API Resources (v1)](https://nuvemshop.dev/en-US/api/resources/v1.md): resources of the legacy version
- [Changelog 2025-03](https://nuvemshop.dev/en-US/api/resources/2025-03/CHANGELOG.md): lowercase rate limit headers, 10,000-item order limit, features kept only in unstable
- [API Usage Control](https://nuvemshop.dev/en-US/apps/erp-guide/api-usage.md): rate limit and pagination as seen by ERP integrations
- [Authentication for Partner Actions](https://nuvemshop.dev/en-US/api/guides/authentication-for-partner-actions.md): /apps/{app_id} paths authenticated with the client secret
- [Order](https://nuvemshop.dev/en-US/api/resources/2025-03/order.md): list filters and the 10,000-item limit on GET /orders
- [Product](https://nuvemshop.dev/en-US/api/resources/2025-03/product.md): per_page default 30, maximum 200 and 422 above it, list filters
