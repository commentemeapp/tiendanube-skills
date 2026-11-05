---
name: tiendanube-orders-fulfillment
description: "Apply when writing code that reads or changes orders in a Tiendanube / Nuvemshop store through the Admin API: order status, payment_status and shipping_status, list filters, close, reopen and cancel, fulfillment orders and tracking events, draft orders, abandoned checkouts, order custom fields, order value history, disputes, invoices (NFe) stored in metafields and the Labels API. Use for ERP, WMS or logistics order import, shipment status updates in multi-location stores, or reviewing code that calls /orders, /draft_orders, /checkouts or /fulfillment-orders."
license: MIT
compatibility: "Tiendanube / Nuvemshop Admin API, version 2025-03. Apps and integrations built by partners."
metadata:
  author: commente.me
  version: "0.1.0"
---

# Orders and fulfillment

## When this skill applies

Use this skill when code imports, updates or ships orders through the Admin API (`https://api.tiendanube.com/2025-03/{store_id}/...`).

- Importing orders into an ERP, WMS or marketplace hub, by webhook or by period
- Moving shipments through their statuses and sending tracking codes and events
- Supporting stores with several locations, where one order has several fulfillment orders
- Creating orders or draft orders from outside channels (subscriptions, B2B, sales reps)
- Publishing invoices (NFe) and shipping labels for an order
- Reporting chargebacks (disputes) from a payment app

Do not use this skill for:

- Answering a merchant's questions about orders in a chat: that is the official Admin MCP (`list_orders`), not code
- Creating payment transactions and refund URLs (use `tiendanube-shipping-payment-apps`)
- Shipping rate callbacks for carriers (use `tiendanube-shipping-payment-apps`)
- Registering and verifying webhooks (use `tiendanube-webhooks`)

## Decision rules

- Identify orders by `id`, never by `number`. `number` is the sequential, customer-facing value; the ERP guide says it is not supported as an integration key. `products[].id` can exceed int32; store it as a 64-bit integer.
- The same `product_id` and `variant_id` may appear in several line items (for example, units with different `properties`). Do not merge lines by variant.
- Order `status` is `open`, `closed` or `cancelled`. `payment_status` is `authorized`, `pending`, `paid`, `partially_paid`, `abandoned`, `refunded`, `partially_refunded` or `voided`. `shipping_status` includes `unpacked`, `unshipped`, `shipped`, `delivered`, `partially_packed` and `partially_fulfilled`.
- Prefer webhooks (`order/created`, `order/paid`, `order/packed`, `order/fulfilled`, `order/cancelled`, `order/edited`) over polling, and subscribe only to the specific events you need instead of `order/updated`. For backfills, import by period with `created_at_min` and `created_at_max`.
- `GET /orders` returns 30 per page by default and a query is capped at 10,000 results; narrow by date range. Filters include `status`, `payment_status`, `shipping_status`, `channels` (`form`, `store`, `api`, `meli`, `pos`), `q`, `customer_ids`, `app_id` and `updated_at_min`.
- Use `contact_name`, `contact_email`, `contact_phone` and `contact_identification` for the buyer. `customer` is only returned with the `read_customers` scope.
- `PUT /orders/{id}` changes only `owner_note` and `status`. Use `POST /orders/{id}/close`, `/open` and `/cancel` for state changes. Cancel accepts `reason` (`customer`, `inventory`, `fraud`, `other`), `email` and `restock`, both defaulting to `true`.
- There is no "pay" endpoint. An order becomes `paid` when its payment app posts a successful `sale` or `capture` transaction event.
- Treat shipping data on the order (`order.shipping_*`, `shipped_at`) as deprecated: it mirrors only the first fulfillment order. Read `fulfillments` with `aggregates=fulfillment_orders`, or call `/orders/{id}/fulfillment-orders`.
- Shipping status is now set per fulfillment order with `PATCH /orders/{order_id}/fulfillment-orders/{id}`. `POST /orders/{id}/pack`, `/fulfill` and `/fulfillments` are deprecated and affect only the first fulfillment order.
- Mark a shipment delivered by posting a tracking event with status `delivered`, not by patching the fulfillment order to `DELIVERED`.
- Order and draft order creation: `inventory_behaviour: "bypass"` (default) does not reserve stock and creates one fulfillment order at the default location; `"claim"` reserves stock, splits into fulfillment orders by inventory and returns `422` ("Not enough stock for variant") when it cannot.
- Draft orders (`/draft_orders`, scopes `read_draft_orders` and `write_draft_orders`) produce a `checkout_url`; `POST /draft_orders/{id}/confirm` turns one into an order.
- Order custom fields work like catalog custom fields and are on the path to deprecation; `aggregates=custom_fields` on `GET /orders` returns them inline.

## Hard constraints

### Constraint: Send shipment status and tracking to each fulfillment order

In stores with several locations an order has several fulfillment orders. Status, tracking code and tracking events belong to each of them.

**Why this matters**

The deprecated order-level endpoints update only the first fulfillment order, so the second shipment never shows as dispatched and the customer never sees its tracking. Apps that call them lose the "multi inventory ready" status; merchants are warned when they add a location or install the app.

**Detection**

Calls to `POST /orders/{id}/fulfill`, `/pack` or `/fulfillments`, or `shipping_tracking_number` sent to `POST /orders`.

**Correct**

```js
const fos = await api.get(`/orders/${orderId}/fulfillment-orders`);
for (const fo of fos) {
	const parcel = wms.parcelFor(orderId, fo.id);
	if (!parcel) continue;
	await api.patch(`/orders/${orderId}/fulfillment-orders/${fo.id}`, {
		status: "DISPATCHED",
		tracking_info: { code: parcel.code, url: parcel.url, notify_customer: true }
	});
}
```

**Wrong**

```js
await api.post(`/orders/${orderId}/fulfill`, {
	shipping_tracking_number: "AC123456789XX",
	notify_customer: true
});
```

### Constraint: Respect the fulfillment order status workflow

Statuses are `UNPACKED`, `IN_PREPARATION`, `PACKED`, `READY_FOR_PICKUP`, `DISPATCHED` and `DELIVERED`. Moving forward may skip steps; moving back is rejected except `IN_PREPARATION` to `UNPACKED` and, for `ship` and `pickup`, `PACKED` to `UNPACKED`.

**Why this matters**

Valid statuses depend on `shipping.type`: `ship` rejects `READY_FOR_PICKUP`; `non-shippable` rejects `PACKED` and `READY_FOR_PICKUP`; a `pickup` with `shipping.extras.shippable: false` rejects `DISPATCHED`. After dispatch, destination, shipping and recipient cannot change, and after packing the assigned location cannot change.

**Detection**

A status mapper that sends the same status sequence for every order, or that tries to reopen a dispatched shipment.

**Correct**

```js
const next = fo.shipping.type === "ship" ? "DISPATCHED" : "READY_FOR_PICKUP";
await api.patch(`/orders/${orderId}/fulfillment-orders/${fo.id}`, { status: next });
```

**Wrong**

```js
await api.patch(`/orders/${orderId}/fulfillment-orders/${fo.id}`, { status: "UNPACKED" }); // after DISPATCHED
```

### Constraint: Post tracking events only after dispatch, without duplicates

`POST .../fulfillment-orders/{id}/tracking-events` requires the fulfillment order to be `DISPATCHED`. Each event needs `status` and `description`; `address`, `geolocation`, `happened_at` and `estimated_delivery_at` are nullable. Tracking events are limited to 100 per fulfillment order.

**Why this matters**

An event identical to an existing one (same status, description, address, geolocation and dates) is rejected with `400`; with `happened_at` the duplicate window is 60 seconds, without it any identical event is rejected. A `delivered` event moves the fulfillment order to `DELIVERED` and sets `fulfilled_at` to that event's `happened_at`.

**Detection**

A carrier poller that re-posts the full event history on every run, or posts events before dispatch.

**Correct**

```js
for (const ev of carrierEvents.filter((e) => !alreadySent(fo.id, e.externalId))) {
	await api.post(`/orders/${orderId}/fulfillment-orders/${fo.id}/tracking-events`, {
		status: ev.status, // in_transit, out_for_delivery, delivered, ...
		description: ev.text,
		address: ev.where ?? null,
		geolocation: null,
		happened_at: ev.at,
		estimated_delivery_at: null
	});
	markSent(fo.id, ev.externalId);
}
```

**Wrong**

```js
for (const ev of carrierEvents) await postEvent(ev); // every run, no deduplication
```

### Constraint: Keep the NFe metafield a single JSON list

Invoices are not a native resource. They live in one `Order` metafield with `namespace: "nfe"` and `key: "list"`, whose `value` is a JSON-encoded array of `{key, link, fulfillment_order_id}`.

**Why this matters**

Other apps (for example, a carrier that needs the NFe to ship) read that exact format. Creating a second metafield or overwriting the list hides invoices issued for other fulfillment orders.

**Detection**

`POST /metafields` for every invoice without first reading the existing list, or a `value` that is not valid JSON.

**Correct**

```js
const [mf] = await api.get(`/metafields/orders?per_page=1&owner_id=${orderId}&namespace=nfe&key=list&fields=id,value`);
const list = mf ? JSON.parse(mf.value) : [];
list.push({ key: accessKey, link: xmlUrl, fulfillment_order_id: foId });
const value = JSON.stringify(list);
mf
	? await api.put(`/metafields/${mf.id}`, { value })
	: await api.post("/metafields", { namespace: "nfe", key: "list", value, owner_resource: "Order", owner_id: orderId });
```

**Wrong**

```js
await api.post("/metafields", {
	namespace: "nfe",
	key: "list",
	value: `[{"key":"${accessKey}"}]`,
	owner_resource: "Order",
	owner_id: orderId
});
```

## Preferred pattern

```text
order/created or order/paid webhook
  -> GET /orders/{id}?aggregates=fulfillment_orders
  -> if fulfillments is empty, retry later (fulfillment orders can be created after the order)
  -> store order id, line ids (int64), one record per fulfillment order and its assigned_location
WMS picks and packs per fulfillment order
  -> PATCH .../fulfillment-orders/{id} {status: PACKED}
  -> PATCH .../fulfillment-orders/{id} {status: DISPATCHED, tracking_info}
  -> POST  .../tracking-events (deduplicated) until delivered
ERP issues invoice -> append to the nfe/list metafield with fulfillment_order_id
order/edited webhook -> reload the order; edits only happen while the fulfillment order is UNPACKED
```

Order value changes: `GET /orders/{id}/history/values` lists edits and refunds. In a `PAID` entry, a positive `total_paid_diff` is a payment by the customer and a negative one a refund by the merchant. An empty history is not proof that no refund happened; reconcile with the payment provider when needed. `GET /orders/{id}/history/editions` gives a change log of each edition.

Abandoned checkouts (`GET /checkouts`, `read_orders`): created when the shopper reaches the second checkout step, listable for 30 days, deleted after 90. `POST /checkouts/{cart_id}/coupon` attaches a coupon to a recovery link.

Labels API: only for stores whose `GET /store` features include `fulfillment_order_label_api` (otherwise `403`). `POST /fulfillment-orders/labels` takes up to 50 fulfillment orders and calls the carrier's `callback_labels_url`. Follow `fulfillment_order/label_status_updated`; labels stuck in `STARTED` or `IN_PROGRESS` for 30 minutes become `FAILED`, and documents can be downloaded for 3 months.

Disputes (payment apps, `write_payments`): `POST /orders/{order_id}/transactions/{transaction_id}/disputes` starts in `needs_response`, up to three per transaction. Every create and update must send `retained_total`, between `0.00` and the disputed amount, excluding fees. `won` and `lost` are terminal.

## Common failure modes

- Keying the ERP on `number`, which the platform does not support as an integration identifier.
- Parsing `products[].id` as int32 and failing on large values.
- Treating `fulfillments: []` as "no shipment" instead of retrying.
- Setting `inventory_behaviour` to `claim` without handling the `422`, or leaving `bypass` and expecting stock to drop.
- Subscription apps creating recurring orders via API without payment context: the docs advise creating them as paid and putting the external id and URL in `owner_note`.
- Using `total_paid` or `total_paid_by_customer` as the net amount after refunds.
- Updating a dispute without `retained_total`, or including chargeback fees in it.
- Reading `billing_customer_type: "company"` and `billing_document_type: "cuit"` only in Argentina, where they signal a "Factura A" request.

## Review checklist

- [ ] Orders are keyed by `id`; line ids are 64-bit
- [ ] Import uses specific webhooks and period-based backfills, with pagination and date ranges under 10,000 results
- [ ] Shipping data is read from fulfillment orders, not from `order.shipping_*`
- [ ] No calls to `/pack`, `/fulfill` or `/fulfillments`; status changes follow the workflow per `shipping.type`
- [ ] Tracking events are sent only after `DISPATCHED`, deduplicated, and `delivered` closes the shipment
- [ ] `inventory_behaviour` is chosen on purpose when creating orders
- [ ] NFe data is appended to the single `nfe/list` metafield
- [ ] Label and dispute flows check feature flags, scopes and required fields

## Related skills

- `tiendanube-webhooks`: registering `order/*` and `fulfillment_order/*` events and verifying them
- `tiendanube-catalog`: locations, inventory levels and metafields used by orders
- `tiendanube-shipping-payment-apps`: transactions, refunds and carrier callbacks that feed order status
- `tiendanube-erp-integration`: end-to-end order sync for ERPs
- `tiendanube-rest-api`: pagination, rate limits and error handling

## Reference

- [Order](https://nuvemshop.dev/en-US/api/resources/2025-03/order.md): properties and statuses, list filters and limits, create parameters and inventory_behaviour, close, open, cancel, value history, NFe metafield, import best practices
- [Fulfillment Order](https://nuvemshop.dev/en-US/api/resources/2025-03/fulfillment-order.md): status workflow per shipping type, PATCH restrictions, tracking events and duplicate rules, Labels API
- [Draft Order](https://nuvemshop.dev/en-US/api/resources/2025-03/draft-order.md): scopes, create parameters, payment statuses, confirm endpoint
- [Transaction](https://nuvemshop.dev/en-US/api/resources/2025-03/transaction.md): payment confirmation through transaction events
- [Disputes](https://nuvemshop.dev/en-US/api/resources/2025-03/disputes.md): states and transitions, retained_total rules, endpoints and scope
- [Order Custom Fields](https://nuvemshop.dev/en-US/api/resources/2025-03/orders/custom-fields.md): endpoints, overwrite semantics, deprecation notice
- [Abandoned Checkout](https://nuvemshop.dev/en-US/api/resources/2025-03/abandoned-checkout.md): retention windows, filters, coupon endpoint
- [Multi inventory: access order](https://nuvemshop.dev/en-US/api/guides/multi-inventory/access-order.md): deprecated order shipping fields, aggregates, empty fulfillments retry
- [Multi inventory: create order](https://nuvemshop.dev/en-US/api/guides/multi-inventory/create-order.md): claim versus bypass and fulfillment order creation
- [Multi inventory overview](https://nuvemshop.dev/en-US/api/guides/multi-inventory/multi-inventory.md): deprecated endpoints, shipping status mapping, multi inventory ready approval
- [ERP guide: orders overview](https://nuvemshop.dev/en-US/apps/erp-guide/orders/overview.md): order id versus number
- [ERP guide: order management](https://nuvemshop.dev/en-US/apps/erp-guide/orders/management.md): order and fulfillment order operations for ERPs
- [ERP guide: order editing](https://nuvemshop.dev/en-US/apps/erp-guide/orders/edit-order.md): order/edited webhook, edits only while UNPACKED
- [ERP guide: invoices](https://nuvemshop.dev/en-US/apps/erp-guide/orders/invoices.md): invoice creation through metafields
- [ERP guide: labels](https://nuvemshop.dev/en-US/apps/erp-guide/orders/label.md): label limits, carrier response times
- [ERP guide: order webhooks](https://nuvemshop.dev/en-US/apps/erp-guide/orders/webhooks.md): webhook handling for orders
- [Admin MCP](https://nuvemshop.dev/en-US/ai-agents/admin-mcp.md): conversational order queries, out of scope for code
