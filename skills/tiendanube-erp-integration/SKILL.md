---
name: tiendanube-erp-integration
description: "Apply when connecting an ERP, OMS, WMS or PIM to a Tiendanube / Nuvemshop store, or when migrating catalog and customers from another platform: the official ERP guide (authentication, API usage, catalog, inventory and locations, orders, order editing, invoices, labels, webhooks), deciding which system owns each piece of data, two-way sync without loops, initial load and incremental sync within the leaky-bucket rate limit, idempotent writes keyed by SKU and Order ID, multi-location stock, and importing categories, products, variants and customers. Use for designing the sync, writing the jobs and webhook handlers, or reviewing an integration before certification."
license: MIT
compatibility: "Nuvemshop / Tiendanube Admin API version 2025-03 (REST, JSON, OAuth 2 authorization code), called from a backend owned by the integrator. Some flows referenced by the guide (order edit, Labels API, new Custom Fields API) are documented as unstable."
metadata:
  author: commente.me
  version: "0.1.0"
---

# ERP, OMS and WMS integration, and store migration

## When this skill applies

Use this skill when a backend system keeps a store's catalog, stock, orders or customers in step with Nuvemshop, or loads them once from somewhere else.

- Planning which system is the source of truth for products, prices, stock, orders, invoices and customers
- Writing the initial load and the incremental sync jobs
- Handling order webhooks and reflecting order edits made on either side
- Pushing stock per location and tracking codes per shipment (multi-inventory)
- Attaching invoices to orders and following label status
- Migrating categories, products, variants and customers from another platform

Do not use this skill for:

- The OAuth install flow, scopes and token storage in depth (use `tiendanube-oauth-apps`)
- Field-by-field catalog modeling, images and visibility (use `tiendanube-catalog`)
- Fulfillment order details, tracking events and shipping carriers (use `tiendanube-orders-fulfillment` and `tiendanube-shipping-payment-apps`)
- Webhook registration, verification and delivery mechanics in general (use `tiendanube-webhooks`)

## Decision rules

- Decide ownership per field before writing code. The guide does not prescribe a split; this one is our recommendation, built from the flows it describes:

  | Data                                           | Owner                        | Direction                                                |
  | ---------------------------------------------- | ---------------------------- | -------------------------------------------------------- |
  | Category tree, product master data, SKU, price | ERP or PIM                   | ERP to store                                             |
  | Stock per location                             | ERP or WMS                   | ERP to store                                             |
  | Orders and their initial content               | Store (checkout)             | store to ERP                                             |
  | Order edits before packing                     | whichever side made the edit | both, through `order/edited` or `POST /orders/{id}/edit` |
  | Invoices, tracking                             | ERP or carrier               | ERP to store                                             |
  | Customers                                      | agreed per field             | both, with one owner per field                           |
  | `accepts_marketing`                            | store (read-only in the API) | store to ERP                                             |

- Use the Order ID (internal numeric id) as the order key. The order `number` shown to shoppers is not accepted for integration.
- Use the variant `sku` as the catalog sync key only when it is present and unambiguous; otherwise keep an explicit mapping of external id to product and variant id.
- Drive orders by webhooks (`order/created`, `order/updated`, `order/edited`, and cancellation), not by polling alone. The payload carries `store_id`, `event` and `id`; fetch the resource with `GET` before acting.
- Subscribe to `app/suspended` and `app/uninstalled` (required by the guide) and to `app/resumed`. On suspension stop calling that store; on resume run a full resync, since webhooks are not delivered while access is suspended.
- Initial load: page through lists with `per_page` up to 200 and follow the `Link` header instead of building URLs. Incremental: `updated_at_min` on products, orders and customers; `updatedAtMin` (camelCase) on categories.
- `updatedAtMin` never returns deleted categories. Listen to `category/deleted` and run a periodic full sync to catch missed events.
- Plan for multi-inventory (MultiCD) from day one: stock goes into `inventory_levels` with a `location_id`; tracking codes go to `POST /orders/{id}/fulfillment-orders/{id}/fulfill`.
- Batch price and stock with `PATCH /products/stock-price` (up to 50 variants per call across products) instead of one `PUT` per variant.
- Single-language stores can send `"name": "Acme Tee"`; multilingual stores send an object keyed by language. Reads always return the object form; `x-main-language` gives the main one.
- Native tax fields (NCM, CEST, origin, CST) are not exposed by the Admin API. Keep fiscal metadata in app-owned metafields; it does not fill the native invoice fields.
- Labels API access depends on the `fulfillment_order_label_api` feature (Next stores); others get `403`. Read `plan_name` and `features` from `GET /store`.

## Hard constraints

### Constraint: Stay inside the leaky bucket of each store

Throttle per store and app: the default bucket holds 40 requests and drains 2 per second (x10 on Next and Evolution). Read `x-rate-limit-remaining` and `x-rate-limit-reset`, and back off on `429`.

**Why this matters**

Requests beyond the bucket are rejected with `429`, not queued. An initial load that fires hundreds of calls in parallel loses most of them, and a retry storm keeps the bucket full for every other job of that store.

**Detection**

`Promise.all` over a full catalog, no per-store queue, retries without delay, or the same limit applied to all stores regardless of plan.

**Correct**

```js
async function call(store, req) {
	await store.bucket.take(); // one queue per store_id + app
	const res = await fetch(req);
	store.bucket.sync(res.headers.get("x-rate-limit-remaining"), res.headers.get("x-rate-limit-reset"));
	if (res.status === 429) {
		await sleep(Number(res.headers.get("x-rate-limit-reset")) || 1000);
		return call(store, req);
	}
	return res;
}
```

**Wrong**

```js
await Promise.all(skus.map((sku) => fetch(`${base}/products/sku/${sku}`, opts)));
```

### Constraint: Make every write and every webhook handler idempotent

Look up before creating (by SKU, Order ID or email), record processed events, and answer the webhook with `200` before doing slow work. The guide only asks for a fast `200`; the deduplication pattern is our recommendation.

**Why this matters**

The guide asks for a fast `200` to avoid retries from the sender, so a slow handler receives the same event again. A create that is not guarded produces duplicate products or customers, and `402` or `422` mid-batch leaves partial state that the rerun must skip.

**Detection**

`POST /products` with no prior `GET /products/sku/{sku}`, `POST /customers` with no prior `GET /customers?email=`, or a handler that calls the ERP synchronously before responding.

**Correct**

```js
app.post("/hooks/orders", (req, res) => {
	res.sendStatus(200);
	queue.add(
		{ store: req.body.store_id, event: req.body.event, id: req.body.id },
		{ jobId: `${req.body.store_id}:${req.body.event}:${req.body.id}` }
	);
});
// worker: GET /orders/{id}, then upsert in the ERP by Order ID
```

**Wrong**

```js
app.post("/hooks/orders", async (req, res) => {
	await erp.createSalesOrder(req.body); // payload has only the id; duplicates on retry
	res.sendStatus(200);
});
```

### Constraint: Read before you replace on full-replacement fields

On `PUT /categories/{id}`, send `name`, `description`, `handle`, `seo_title` and `seo_description` back with their current values. On `PUT /products/{id}`, omit `categories` unless you mean to change them, and never send `variants` or `images`.

**Why this matters**

Those category fields are replaced as a whole, so leaving one out clears it in every language. An empty `categories` array removes the product from its category. `variants` or `images` on a product `PUT` returns `422` and nothing in the request is applied.

**Detection**

A partial category `PUT` built from the ERP diff only, `"categories": []` in a price update, or a product `PUT` that carries a `variants` array.

**Correct**

```js
const current = await get(`/categories/${id}`);
await put(`/categories/${id}`, {
	...pick(current, ["name", "description", "handle", "seo_title", "seo_description"]),
	name: { ...current.name, es: "Acme Hogar" }
});
```

**Wrong**

```json
{ "name": { "es": "Acme Hogar" } }
```

### Constraint: Treat variant ids as replaceable

After `product/updated`, fetch the product again and reconcile its variants before writing stock or price.

**Why this matters**

When a merchant edits the attributes of a product in the Admin, the platform rebuilds its variants under new ids, even with the same SKU, and recreated variants can start with unlimited stock. Writes to an old id fail or hit nothing, and the store can oversell.

**Detection**

A mapping table updated only at creation time, or stock writes that never check `stock_management` and current variant ids.

**Correct**

```js
const product = await get(`/products/${id}`);
for (const v of product.variants) mapping.upsert({ productId: id, variantId: v.id, sku: v.sku });
// unmatched or duplicated SKUs go to a manual review queue
```

**Wrong**

```js
await patch("/products/stock-price", [{ id, variants: [{ id: cachedVariantId, inventory_levels: [{ stock: 10 }] }] }]);
```

### Constraint: Send stock and tracking per location

On multi-location stores, every `inventory_levels` entry carries `stock` and its `location_id`, and the tracking code goes to the fulfillment order it belongs to.

**Why this matters**

The variant `stock` is an aggregate kept for compatibility. A tracking code sent to `POST /orders/{id}/fulfill` is attached to the first fulfillment order, which may be the wrong shipment. An `inventory_levels` entry without `stock` returns `422`.

**Detection**

Stock pushed as a single number, `inventory_levels` without `location_id` on a store with several locations, or tracking posted at order level.

**Correct**

```json
[
	{
		"id": 5100,
		"variants": [
			{
				"id": 9100,
				"inventory_levels": [
					{ "location_id": "01HACMEWH1", "stock": 12 },
					{ "location_id": "01HACMEWH2", "stock": 3 }
				]
			}
		]
	}
]
```

**Wrong**

```json
[{ "id": 5100, "variants": [{ "id": 9100, "stock": 15 }] }]
```

### Constraint: Edit orders only while unpacked

Apply ERP-side changes with `POST /orders/{id}/edit` only while the fulfillment order is `UNPACKED`, and never leave a fulfillment order without products.

**Why this matters**

Editable state ends at packing; a dispatched order cannot return to unpacked. Item changes recalculate shipping, and every edit emits `order/edited` and `order/updated`, which your own handler will receive.

**Detection**

Edits sent for `PACKED` or `DISPATCHED` orders, removal of the last item of a fulfillment order, or a handler that re-sends the store's own edit back to the store.

**Correct**

```js
if (fo.status === "UNPACKED" && itemsLeftAfter(fo, change) > 0) await post(`/orders/${orderId}/edit`, change);
else await erp.flagForManualHandling(orderId);
```

**Wrong**

```js
await post(`/orders/${orderId}/edit`, change); // regardless of fulfillment status
```

## Preferred pattern

```text
install  -> store token + user_id (store id); register webhooks; read GET /store and /locations
initial  -> categories (parents first) -> products with variants -> stock per location -> customers
         (paged, per-store queue, checkpoint after each page)
ongoing  -> ERP changes: PATCH /products/stock-price in batches of 50 variants
            store changes: webhooks -> queue -> GET resource -> upsert by key
            safety net: updated_at_min / updatedAtMin sweep + periodic full reconcile
orders   -> order/created -> ERP; invoice and tracking back; edits only while UNPACKED
```

Echo suppression for two-way sync: store, per record, the `updated_at` and a hash of the fields you last wrote. When a webhook brings a record whose owned fields match what you wrote, skip it.

Migration from another platform:

- Create categories parent first and keep a map from old id to new id for `parent`.
- Create products with variants; a product has at most 3 attributes and each variant has as many `values` as there are `attributes`. Send up to 9 images at creation and the rest with `POST /products/{id}/images`.
- Stop the batch instead of retrying on `402` (product limit of the plan) or on the `422` returned when the store reaches 100000 products.
- Create customers with `POST /customers`; decide `send_email_invite` deliberately so an import does not mail every shopper. Marketing consent cannot be written through the API.
- Customers with orders cannot be deleted, so rehearse the import on a test store first.
- Customer custom fields (`/customers/custom-fields`) still work but are being deprecated in favor of the new Custom Fields API; `PUT /customers/{id}/custom-fields/values` overwrites the customer's associations.

## Common failure modes

- Omitting `User-Agent` (`400`) or `Content-Type` on writes (`415`).
- Assuming list pagination defaults: request `per_page` explicitly and stop on the `Link` header.
- Filtering categories with `updated_at_min`: the snake case form is ignored silently and returns everything.
- Treating `402` as transient: it means the store or app is unpaid or the plan limit was reached.
- Writing price or stock on the product of a product without variants: those fields live on its single variant.
- Keying orders by `number`, or creating ERP orders from the webhook payload without `GET /orders/{id}`.
- Ignoring the 30-minute timeout that marks labels in `STARTED` or `IN_PROGRESS` as `FAILED`.
- Converting product image URLs by extension: images can be served as WebP; check `Content-Type`.

## Review checklist

- [ ] Every field has one owner and one sync direction, written down
- [ ] Requests go through a per-store queue that honors the rate-limit headers and `429`
- [ ] Creates are guarded by lookups; webhook handlers answer `200` first and dedupe by event and id
- [ ] `app/suspended`, `app/uninstalled` and `app/resumed` are handled
- [ ] Stock is sent per `location_id`; tracking goes to the right fulfillment order
- [ ] Category and product `PUT` bodies preserve full-replacement fields and categories
- [ ] Variant mappings are refreshed after `product/updated`
- [ ] Order edits check `UNPACKED`; echoes of your own writes are skipped
- [ ] Migration was rehearsed on a test store, with invites and plan limits checked

## Related skills

- [`tiendanube-rest-api`](../tiendanube-rest-api/SKILL.md): base URL, versioning, errors and pagination
- [`tiendanube-oauth-apps`](../tiendanube-oauth-apps/SKILL.md): authorization code flow and scopes
- [`tiendanube-webhooks`](../tiendanube-webhooks/SKILL.md): registering and verifying webhooks
- [`tiendanube-catalog`](../tiendanube-catalog/SKILL.md): products, variants, images and custom fields
- [`tiendanube-orders-fulfillment`](../tiendanube-orders-fulfillment/SKILL.md): fulfillment orders, tracking events, labels
- [`tiendanube-shipping-payment-apps`](../tiendanube-shipping-payment-apps/SKILL.md): carrier side of labels and shipping

## Reference

- [ERP Integration Guide](https://nuvemshop.dev/en-US/apps/erp-guide/overview.md): scope of the guide, locations per plan, customer sync
- [Best Practices](https://nuvemshop.dev/en-US/apps/erp-guide/guidelines.md): MultiCD, tracking per fulfillment order, required app webhooks
- [API Usage Control](https://nuvemshop.dev/en-US/apps/erp-guide/api-usage.md): leaky bucket, rate-limit headers, pagination
- [Authentication](https://nuvemshop.dev/en-US/apps/erp-guide/authentication.md): authorization code, non-expiring token, `user_id`
- [Catalog](https://nuvemshop.dev/en-US/apps/erp-guide/catalog/overview.md): multilingual fields for single-language stores
- [Product Management](https://nuvemshop.dev/en-US/apps/erp-guide/catalog/products.md): products, variants, images
- [Category](https://nuvemshop.dev/en-US/apps/erp-guide/catalog/categories.md): `parent`, full-replacement fields, `updatedAtMin`, deletions
- [Custom Fields in Product Variants](https://nuvemshop.dev/en-US/apps/erp-guide/catalog/custom-fields.md): variant custom field operations
- [Inventory](https://nuvemshop.dev/en-US/apps/erp-guide/inventory.md): locations, priorities, default location
- [Order Management Overview](https://nuvemshop.dev/en-US/apps/erp-guide/orders/overview.md): Order ID vs number, webhooks first
- [Order Management](https://nuvemshop.dev/en-US/apps/erp-guide/orders/management.md): list, update, cancel, fulfillment orders
- [Order Editing](https://nuvemshop.dev/en-US/apps/erp-guide/orders/edit-order.md): `UNPACKED` rule, `order/edited`, ERP-side edit
- [Invoice Management](https://nuvemshop.dev/en-US/apps/erp-guide/orders/invoices.md): invoices as order metafields
- [Label Issuance](https://nuvemshop.dev/en-US/apps/erp-guide/orders/label.md): label statuses, timeouts, limits
- [Order Webhooks](https://nuvemshop.dev/en-US/apps/erp-guide/orders/webhooks.md): payload shape and `200` response
- [Introduction](https://nuvemshop.dev/en-US/api/getting-started.md): base URL, `User-Agent`, errors, rate limit, pagination, languages, `402`, plan features
- [Product](https://nuvemshop.dev/en-US/api/resources/2025-03/product.md): SKU sync, variant id changes, `stock-price`, limits, tax fields
- [Customer](https://nuvemshop.dev/en-US/api/resources/2025-03/customer.md): filters, create options, read-only consent, delete rule
- [Customer Custom Fields](https://nuvemshop.dev/en-US/api/resources/2025-03/customers/custom-fields.md): deprecation path and value overwrite
