---
name: tiendanube-webhooks
description: "Apply when registering, receiving or reviewing Tiendanube / Nuvemshop webhooks in an app: choosing events (order, product, customer, category, app, checkout, fulfillment_order, location, billing), POST /webhooks and the scopes it needs, HTTPS endpoints, verifying the x-linkedstore-hmac-sha256 signature with the app's client_secret over the raw body, answering 2xx within 3 seconds, the retry schedule, duplicates and out-of-order delivery, thin payloads that require fetching the resource, app/uninstalled cleanup, and the required privacy (LGPD) webhooks app/store_redact, customer/redact and customers/data_request with their Postman testing tool. Use for a new webhook receiver, missing or duplicated events, or a failed signature check."
license: MIT
compatibility: "Tiendanube / Nuvemshop Admin API, version 2025-03. Apps built by partners; not for the official Admin MCP."
metadata:
  author: commente.me
  version: "0.1.0"
---

# Webhooks: events, signatures and privacy requests

## When this skill applies

Use this skill when an app wants to be told about store events instead of polling the Admin API, and when it must honor the privacy requests the platform forwards.

- Registering `order/paid`, `product/updated` or other events for a store
- Writing the HTTP endpoint that receives notifications
- Verifying that a notification really came from the platform
- Designing processing that survives retries, duplicates and reordering
- Implementing `app/store_redact`, `customer/redact` and `customers/data_request`
- Testing those privacy webhooks before a real request exists

Do not use this skill for:

- Getting the token that registration uses (use `tiendanube-oauth-apps`)
- The API calls that fetch the resource after an event (use `tiendanube-rest-api`)
- Order and fulfillment status semantics in depth (use `tiendanube-orders-fulfillment`)
- Reacting to store events from an AI chat: the official Admin MCP exposes tools for a merchant's conversation, not event subscriptions; webhooks are for app code

## Decision rules

- Register a webhook per store with `POST /webhooks` and a body `{ "event": "<category>/<action>", "url": "https://..." }`. The URL must be HTTPS and cannot be localhost or a Nuvemshop domain.
- Registering or updating an event that contains `product` or `category` needs a products scope; one that contains `order` needs an orders scope. Other events, and `GET` or `DELETE`, need no scope. More generally, webhooks are only available for resources the app was granted.
- Payloads are notifications, not data: they carry `store_id`, `event`, usually `id` and, for most events, `event_launch_ts` (Unix seconds). Fetch the resource from the API to get its current state.
- Choose the narrowest event. Every order event except `order/created` is also sent as `order/updated`, so subscribing to both `order/updated` and `order/paid` gives two notifications for one change. `order/custom_fields_updated` and `order/in_fraud_analysis` are not repeated as `order/updated`.
- `product/updated` covers stock, prices, variants, images, texts and publication, but not promotion discounts, product metafields or variant custom field values. There is no metafield event; for invoice data an integration stores in order metafields, watch `order/updated` and read the metafields.
- To follow carts that may be abandoned, use `checkout/updated` (grouped to at most one per cart every 5 seconds); `checkout/created` is not sent for storefront carts.
- `app/suspended` and `app/resumed` tell you when API access stops and returns for lack of payment. While suspended, webhooks are not delivered, so plan a resync on `app/resumed`. They are not sent when free days run out.
- `app/uninstalled` is followed immediately by the deletion of all your webhooks for that store.
- `app_subscription/updated` is delivered only to the app it concerns; act on `topic: "churn"` by stopping the paid service. `charge/*` events are store-level, so every subscribed app receives them; filter by `app_id`.
- The three privacy webhooks are not created through the API: their URLs are configured in the app's settings in the Partners Portal.

## Hard constraints

### Constraint: Verify the HMAC over the raw body with the client secret

Each request has an `x-linkedstore-hmac-sha256` header: the HMAC-SHA256 of the request body keyed with the app's `client_secret`, as a hex string in the reference's PHP example. Compute it over the bytes received, before any JSON parsing.

**Why this matters**

Without verification anyone who learns the URL can forge events. The store's `access_token` is not the signing key; a custom integration that only has an Admin-generated API token still needs the app credentials to verify. Re-serializing parsed JSON changes the bytes and breaks the comparison. Some frameworks expose the header as `HTTP_X_LINKEDSTORE_HMAC_SHA256`.

**Detection**

`express.json()` mounted before the webhook route, HMAC computed with the access token, comparison against `JSON.stringify(req.body)`, or no check at all.

**Correct**

```ts
import crypto from "node:crypto";

app.post("/webhooks/ns", express.raw({ type: "*/*" }), (req, res) => {
	const received = String(req.get("x-linkedstore-hmac-sha256") ?? "");
	const expected = crypto.createHmac("sha256", process.env.NS_CLIENT_SECRET!).update(req.body).digest("hex");
	const ok =
		received.length === expected.length && crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected));
	if (!ok) return res.sendStatus(401);
	queue.publish(JSON.parse(req.body.toString("utf8")));
	res.sendStatus(200);
});
```

**Wrong**

```ts
app.post("/webhooks/ns", express.json(), (req, res) => {
	const sig = crypto.createHmac("sha256", installation.accessToken).update(JSON.stringify(req.body)).digest("hex");
	// ...
});
```

### Constraint: Answer 2xx within 3 seconds and process later

The platform waits 3 seconds for any 2xx. On timeout or failure it retries: once right away, then at about 5, 10 and 15 minutes, then with waits growing by a factor of 1.4, for up to 16 attempts over 48 hours. A 2xx stops the retries.

**Why this matters**

Calling the API, writing to an ERP or sending emails inside the handler easily passes 3 seconds, which turns one event into many deliveries. Returning `200` with an error in the body is also discouraged by the platform's status conventions.

**Detection**

`await` on external calls before `res.send`, synchronous imports in the handler, or handlers that return 500 for business errors that a retry cannot fix.

**Correct**

```ts
res.sendStatus(200); // after verifying and enqueueing
// worker: fetch /orders/{id}, apply, record
```

**Wrong**

```ts
const order = await nsGet(storeId, `/orders/${id}`);
await erp.createInvoice(order); // may take 10 s
res.sendStatus(200);
```

### Constraint: Make processing idempotent and order independent

The same message can arrive more than once, and messages can be processed in a different order than they were queued. Deduplication is the integrator's responsibility.

**Why this matters**

Delivery runs on a distributed system. A CSV import can send several `product/updated` for one product; creating a product can send `product/updated` right after `product/created`; an `order/updated` can arrive before the `order/paid` that caused it. Applying payloads as deltas, or trusting arrival order, corrupts state.

**Detection**

Counters incremented per event, status machines that reject an "earlier" status, or inserts with no unique key on store and resource.

**Correct**

```ts
async function handle(evt: { store_id: number; event: string; id: number }) {
	const order = await nsGet(evt.store_id, `/orders/${evt.id}`); // current state wins
	await db.orders.upsert({ storeId: evt.store_id, orderId: order.id }, mapOrder(order));
}
```

**Wrong**

```ts
if (evt.event === "order/paid") await db.orders.insert({ id: evt.id, status: "paid" });
```

### Constraint: Implement the three privacy webhooks

Configure the Store Redact, Customer Redact and Customers Data Request URLs in the Partners Portal and act on each.

**Why this matters**

Apps store merchant and buyer data, so partners share the duty under data protection laws such as Brazil's LGPD to delete data or report what they hold when asked. All app URLs, these included, are required in the app settings.

- `app/store_redact`: sent after the merchant uninstalls the app; payload `{ store_id }`. Delete that store's data.
- `customer/redact`: payload with `store_id`, `customer` (`id`, `email`, `phone`, `identification`) and `orders_to_redact`. Sent after 5 days if the customer had no order in the last 6 months; otherwise held until 6 months have passed. Delete or anonymize that customer's data.
- `customers/data_request`: payload with `store_id`, `customer`, `orders_requested`, `checkouts_requested`, `drafts_orders_requested` and `data_request.id`. Send the report directly to the merchant.

**Detection**

Portal URLs pointing to a placeholder, handlers that only log, or redaction that skips the orders listed in `orders_to_redact`.

**Correct**

```ts
router.post("/privacy/customer-redact", verifyHmac, async (req, res) => {
	const { store_id, customer, orders_to_redact } = req.body;
	await jobs.enqueue("redact-customer", { store_id, customerId: customer.id, orders: orders_to_redact });
	res.sendStatus(200);
});
```

**Wrong**

```ts
router.post("/privacy/customer-redact", (_req, res) => res.sendStatus(200)); // nothing deleted
```

## Preferred pattern

```text
POST /webhooks/ns  ->  raw body  ->  HMAC check  ->  enqueue {store_id, event, id, event_launch_ts}  ->  200
worker             ->  load installation (app, store)  ->  GET resource  ->  upsert  ->  mark processed
```

Registration at install time, idempotent across reinstalls:

```bash
curl -X POST 'https://api.tiendanube.com/2025-03/123456/webhooks' \
  -H 'Authorization: Bearer ACCESS_TOKEN' \
  -H 'User-Agent: Acme Sync (ops@example.com)' \
  -H 'Content-Type: application/json' \
  -d '{ "event": "order/paid", "url": "https://hooks.example.com/webhooks/ns" }'
```

List with `GET /webhooks` (filters `event`, `url`, `since_id`, dates, `page`, `per_page`) before creating, change the URL with `PUT /webhooks/{id}`, remove with `DELETE /webhooks/{id}`. An invalid event or URL returns `422` with errors per field.

On `app/uninstalled`, stop scheduled jobs for that store and mark the installation inactive; the platform already deleted the webhooks. Keep events of other apps of yours in the same store untouched: uninstalling one app does not remove another app's webhooks.

Development: a request inspection service such as RequestCatcher shows what is sent. For the privacy webhooks, whose real triggers depend on time or Admin actions, use the LGPD Webhooks Test Postman collection: set its variables to your app and the URLs registered in the portal, run the request for each event, and check the payload in your backend. Its coverage is partial: it induces the notification but does not change any store data, and the `data_request` object is still being defined.

## Common failure modes

- Parsing JSON before checking the HMAC, so valid signatures never match.
- Using the access token as the HMAC key.
- Comparing the header in a case-sensitive way against a framework-renamed key and treating every request as unsigned.
- Doing the work inline and causing retries that then look like duplicates.
- Subscribing to `order/updated` and every specific order event, then double-processing.
- Expecting `product/updated` for promotion discounts or metafield changes.
- Expecting webhooks during an `app/suspended` period and not resyncing after `app/resumed`.
- Registering `localhost` or a tunnel on a Nuvemshop domain during development.
- Registering webhooks again on every reinstall instead of checking `GET /webhooks` first.

## Review checklist

- [ ] Endpoint is HTTPS and reads the raw body
- [ ] `x-linkedstore-hmac-sha256` is checked with the client secret before parsing
- [ ] Handler answers 2xx within 3 seconds and pushes work to a queue
- [ ] Workers fetch current state and upsert; duplicates and reordering are harmless
- [ ] Subscribed events are the minimum set, with no overlapping order events
- [ ] App has the scope each subscribed event needs
- [ ] Store Redact, Customer Redact and Data Request URLs are set and do real work
- [ ] Privacy handlers were exercised with the LGPD testing collection
- [ ] `app/uninstalled`, `app/suspended` and `app/resumed` are handled

## Related skills

- [`tiendanube-oauth-apps`](../tiendanube-oauth-apps/SKILL.md): client secret, install and reinstall flow, portal URLs
- [`tiendanube-rest-api`](../tiendanube-rest-api/SKILL.md): fetching the resource after the event, rate limits
- [`tiendanube-orders-fulfillment`](../tiendanube-orders-fulfillment/SKILL.md): order and fulfillment order events in context
- [`tiendanube-catalog`](../tiendanube-catalog/SKILL.md): product events and variant ID changes
- [`tiendanube-erp-integration`](../tiendanube-erp-integration/SKILL.md): event-driven order import

## Reference

- [Webhook](https://nuvemshop.dev/en-US/api/resources/2025-03/webhook.md): events, parameters, HMAC verification, retry policy, idempotency, required privacy webhooks, endpoints and scopes
- [LGPD Webhooks Testing Tool](https://nuvemshop.dev/en-US/api/utils/lgpd-webhooks-testing-tool.md): Postman collection to trigger the three privacy webhooks and its limits
- [Order Webhooks](https://nuvemshop.dev/en-US/apps/erp-guide/orders/webhooks.md): registration, listing, update and delete for order events, and processing steps
- [Frequently asked questions about the API](https://nuvemshop.dev/en-US/api/faq.md): required webhooks, signing key, no metafield event
- [Introduction](https://nuvemshop.dev/en-US/api/getting-started.md): webhooks not called during a 402 suspension, app/suspended and app/resumed
- [Authentication](https://nuvemshop.dev/en-US/api/authentication.md): webhooks limited to granted scopes, privacy webhook URLs in the app settings, per app and store isolation
- [HTTP Status Patterns](https://nuvemshop.dev/en-US/apps/http-status.md): avoid 200 responses that carry errors
- [Changelog 2025-03](https://nuvemshop.dev/en-US/api/resources/2025-03/CHANGELOG.md): lowercase signature header, newer events such as order/in_preparation and charge events
