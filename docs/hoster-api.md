# MSM Hoster API — Store & Billing Integration Reference

This document serves as the comprehensive technical reference for integrating external store platforms and billing systems with the Maunting Service Manager (MSM). Setup procedures within the web panel and operational details are documented in [self-hosting.md](self-hosting.md#hoster-and-shop-integration); this document focuses strictly on the API contract between store platforms and MSM.

The same content is available in dual languages inside the panel under **Documentation → Hoster API** (`/docs/hoster-api`).

> [!NOTE]
> Die deutschsprachige Fassung dieser Dokumentation befindet sich unter [docs/de-docs/hoster-api.md](de-docs/hoster-api.md).
>
> **Without an explicit integration configured, none of the endpoints described below are active.** A default self-hosted MSM deployment has no exposed external endpoints that operate without an authorized integration API key.

---

## Contents

1. [Core Principles](#core-principles)
2. [Authentication](#authentication)
3. [External API](#external-api)
4. [State Machine](#state-machine)
5. [Error Handling & Status Codes](#error-handling--status-codes)
6. [Webhooks](#webhooks)
7. [Signature Verification](#signature-verification)
8. [One-Click Handoff](#one-click-handoff)
9. [Panel Administration (Admin Endpoints)](#panel-administration-admin-endpoints)
10. [Operational Best Practices](#operational-best-practices)

---

## Core Principles

The external billing system sends **desired states, not operational commands**. Rather than instructing "start instance", it submits "this contract must be active". This design guarantees true idempotency: a command received twice due to a network timeout could lead to race conditions, while an identical desired state received multiple times has zero unintended side effects.

The external system deliberately **does not specify internal MSM infrastructure parameters**: no node IDs, no host port assignments, and no disk mount locations. It references an external product key; MSM resolves the associated blueprint, hardware limits, node assignment, and network ports automatically.

All actions initiated via the Hoster API route through the identical backend services used by direct panel interactions (`server_provisioning_service`, `server_action_service`, `server_deletion_service`). No path bypasses role-based access control (RBAC), host capacity validation, dynamic port allocation, or the Guardian monitoring engine.

---

## Authentication

All endpoints under `/api/hoster/v1/` require an integration API key provided in the request header:

```http
X-MSM-Hoster-Key: <api-key>
```

**Browser cookies and session tokens are strictly rejected.** Standard browser sessions cannot invoke these routes, and CORS headers are omitted intentionally — calls must originate server-to-server from the backend of your billing platform. Attempting calls directly from browser developer consoles will fail by design.

MSM only persists the SHA-256 hash of the generated API key. The raw plaintext key is displayed exactly once upon generation inside the panel and cannot be retrieved again.

The API key inherits **identical permissions to the service user assigned to the integration**. The effective security perimeter is defined by that service user's RBAC profile, not by the key itself.

| Scenario | Response |
|---|---|
| Missing header | `401 Unauthorized` |
| Invalid key or deactivated integration | `401 Unauthorized` |

Both scenarios return identical response bodies to prevent key enumeration attacks.

### Verification Probe

You can verify key validity without triggering state changes:

```bash
curl -sS https://panel.example/api/hoster/v1/health \
  -H "X-MSM-Hoster-Key: $MSM_HOSTER_KEY"
```

```json
{
  "ok": true,
  "integration": "my-store-integration"
}
```

---

## External API

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/hoster/v1/health` | Validate integration API key without side effects |
| `PUT` | `/api/hoster/v1/services/{external_service_id}` | Declare desired contract state (create or reconcile) |
| `GET` | `/api/hoster/v1/services/{external_service_id}` | Query current real-world status |
| `POST` | `/api/hoster/v1/handoffs` | Generate single-use authenticated login handoff |
| `GET` | `/api/hoster/handoff/{token}` | Public redirection consumed by customer's browser (no key required) |

### `PUT /api/hoster/v1/services/{external_service_id}`

Submits the desired contract state for a service instance. Creates the service contract on the initial call and reconciles or updates existing instances subsequently.

`external_service_id` is the unique subscription or item reference **assigned by your store platform** (up to 128 characters). Combined with the integration ID, it forms the unique idempotency key.

#### Request Body

| Parameter | Type | Required | Description |
|---|---|---|---|
| `desired_state` | `string` | Yes | Target state: `active`, `suspended`, or `terminated`. |
| `external_subject` | `string` (1–128) | Yes | Customer ID **from the billing system**. Identity mappings bind to this ID rather than email addresses to safeguard against account disconnection during email changes. |
| `product_key` | `string` (1–128) | Initial creation | Store product SKU/key. MSM maps this to a blueprint and hardware profile. For existing contracts, a modified key initiates an automatic tier upgrade/downgrade. |
| `email` | `string` (≤255) | Optional | Utilized strictly for provisioning the user account during initial creation. MSM **never** accepts or stores billing platform passwords. |

#### Example Call

```bash
curl -X PUT https://panel.example/api/hoster/v1/services/SVC-4711 \
  -H "X-MSM-Hoster-Key: $MSM_HOSTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{
        "desired_state": "active",
        "external_subject": "CUST-1234",
        "product_key": "mc-8gb",
        "email": "customer@example.com"
      }'
```

#### Response Body (Identical for `PUT` and `GET`)

| Field | Type | Description |
|---|---|---|
| `external_service_id` | `string` | The external reference submitted by the store |
| `desired_state` | `string` | The latest registered desired target state |
| `status` | `string` | Real-world state — see [State Machine](#state-machine) |
| `status_code` | `string \| null` | Stable diagnostic code or failure reason, otherwise `null` |
| `server_id` | `integer \| null` | Internal instance ID once allocated |
| `task_id` | `string \| null` | Active asynchronous provisioning or lifecycle task identifier |
| `correlation_id` | `string` (UUID) | Unique trace ID connecting all audit logs and webhooks |
| `terminate_after` | `string \| null` | ISO-8601 timestamp after which the instance is scheduled for deletion |
| `updated_at` | `string` | ISO-8601 timestamp of last state modification |

```json
{
  "external_service_id": "SVC-4711",
  "desired_state": "active",
  "status": "ready",
  "status_code": null,
  "server_id": 42,
  "task_id": "0a3f1b7c-2d4e-4f60-9a11-8c5e2f7b6d33",
  "correlation_id": "6f6d9d1e-6b1e-4a51-9f0c-2b7a5d3e8c14",
  "terminate_after": null,
  "updated_at": "2026-08-08T09:22:10+00:00"
}
```

> [!TIP]
> **Idempotent Execution Guarantee:** The identical request may be transmitted repeatedly without duplicate provisioning. Network retries will never generate duplicate game servers. Even concurrent race requests are serialized safely under the unique `(integration_id, external_service_id)` constraint.

### `GET /api/hoster/v1/services/{external_service_id}`

Queries the current status of an existing contract. Does not take a request body. Returns `404 Not Found` if the contract does not exist.

Provisioning occurs asynchronously in the background. Following a `PUT`, `status` will temporarily indicate `provisioning`. Store systems should listen for the `service.ready` webhook or poll this endpoint at reasonable intervals (avoid aggressive tight loops).

---

## State Machine

`desired_state` describes what the billing platform **requests**. `status` reflects the **actual operating state** of the underlying instance. Both fields operate in concert to enable seamless reconciliation.

### Target Desired States (`desired_state`)

| State | Behavior |
|---|---|
| `active` | Contract is in good standing. The server is created and started; user management grants permissions. |
| `suspended` | Billing suspension (e.g. overdue invoice). The server is stopped; customer permissions are revoked. **The customer's panel account and all world data remain intact.** Instances can be un-suspended instantly upon payment. |
| `terminated` | Contract canceled. The server is stopped and scheduled for deletion after a configurable retention grace period. **Data is not erased immediately.** |

### Real-World Operating States (`status`)

Each status change automatically triggers a corresponding `service.<status>` webhook event.

| Status | Meaning |
|---|---|
| `pending` | Contract registered in database; provisioning task has not yet commenced. |
| `provisioning` | Container initialization, volume allocation, and download pipeline actively running. |
| `ready` | Server is fully provisioned, ports bound, and delegated to the customer. |
| `suspended` | Container stopped, customer permissions suspended, volumes preserved. |
| `terminating` | Cancellation requested; retention grace period active (data still recoverable). |
| `terminated` | Retention period expired; container, volumes, and ports permanently erased (`server_id` reset to `null`). |
| `failed` | A lifecycle or provisioning step failed. Inspect `status_code` for the concrete diagnosis. |

The transition from `terminating` to `terminated` does not occur synchronously inside the API call, but via a periodic system task that cleans up expired services.

A product upgrade or downgrade (when `product_key` is altered) sets `status_code` to `product_changed_manual_resize_required`. Product metadata updates immediately, but resizing container memory or CPU limits on running instances requires an intentional restart.

When product mappings include a `role_id`, reaching `active` grants that global role **in addition** to the customer's existing roles. `suspended` and `terminated` revoke it automatically, provided no other active contract held by that customer requires the same role.

---

## Error Handling & Status Codes

| HTTP Status | Context |
|---|---|
| `200 OK` | Success (utilized for `PUT` and `GET`; MSM does not emit `201`). |
| `401 Unauthorized` | Missing, malformed, or deactivated API key. |
| `404 Not Found` | Contract reference unknown. |
| `422 Unprocessable` | Configuration mismatch (e.g., inactive product, unknown product key, invalid handoff target). |
| `503 Unavailable` | Internal processing error during task dispatch. |

### Common Diagnostic `status_code` Values

| Diagnostic Code | Underlying Cause |
|---|---|
| `port_conflict` | Target node lacks contiguous allocatable port blocks for this blueprint. |
| `node_not_found` | Mapped product references a nonexistent or decommissioned node. |
| `install_directory_exists` | Residual files remain from an uncleaned previous installation. |
| `install_update_already_running` | Another deployment or update task is actively executing for this instance. |
| `hoster_configuration_error` | Assigned product, service user, or identity mapping is misconfigured. |
| `hoster_role_escalation` | Product role grants permissions exceeding the service user's own authorization. Provisioning halts safely. |
| `hoster_internal_error` | Unexpected internal exception (detailed in panel backend logs). |
| `product_changed_manual_resize_required` | Informational: Tier updated; hardware reallocations apply upon next instance restart. |

---

## Webhooks

MSM dispatches webhook notifications to the configured HTTPS URL whenever a contract status transition occurs, provided a webhook secret has been configured in the panel integration settings.

### Event Names

Events follow the standardized `service.<status>` nomenclature:

```
service.pending
service.provisioning
service.ready
service.suspended
service.terminating
service.terminated
service.failed
```

### HTTP Headers

```http
Content-Type: application/json
X-MSM-Timestamp: 1786120930
X-MSM-Signature: sha256=c22272c50fb68bae6f99965c33f831b7e3197d9766c00b0fc216b6c5289a51b0
X-MSM-Event: service.ready
User-Agent: MSM-Hoster-Webhook/1.0
```

### Event Payload

The body matches the standard Service Schema without internal task identifiers, augmented with the `event` identifier:

```json
{
  "event": "service.ready",
  "external_service_id": "SVC-4711",
  "desired_state": "active",
  "status": "ready",
  "status_code": null,
  "server_id": 42,
  "correlation_id": "6f6d9d1e-6b1e-4a51-9f0c-2b7a5d3e8c14",
  "terminate_after": null,
  "updated_at": "2026-08-08T09:22:10+00:00"
}
```

> [!NOTE]
> Internal node names, private IP addresses, system paths, and host ports belong to the infrastructure operator and are purposefully omitted from consumer webhook payloads.

### Delivery Policies & Retries

| Parameter | Specification |
|---|---|
| Request Timeout | 10 seconds |
| Max Retry Attempts | 5 attempts |
| Backoff Schedule | 30 s, 120 s, 600 s, 3600 s |
| `4xx` Client Errors | Terminal (no automatic retries) |
| `5xx` / Network Errors | Retried according to backoff schedule |
| HTTP Redirects | Not followed (strict direct delivery) |
| Delivery Log Retention | 30 days stored in database |

**Maximum Payload Size:** 16 KiB. Payloads exceeding this ceiling are rejected. Normal payloads measure approximately 250 bytes.

---

## Signature Verification

Signatures are computed as `HMAC-SHA256` over the UTF-8 string `{timestamp}.{raw_body}` and formatted as `sha256=<hex>`. Incorporating the timestamp prevents replay attacks.

> [!WARNING]
> **Always compute HMAC against the raw request body bytes.**  
> MSM serializes JSON with `separators=(",", ":")` and UTF-8 encoding. Parsing the request into an internal dictionary/object and re-serializing it will alter whitespace and byte ordering, causing signature validation to fail.

### Test Vector

```text
Secret:     whsec_msm_beispiel_nicht_verwenden
Timestamp:  1786120930
Body:       {"event":"service.ready","external_service_id":"SVC-4711","desired_state":"active","status":"ready","status_code":null,"server_id":42,"correlation_id":"6f6d9d1e-6b1e-4a51-9f0c-2b7a5d3e8c14","terminate_after":null,"updated_at":"2026-08-08T09:22:10+00:00"}

Expected:   sha256=c22272c50fb68bae6f99965c33f831b7e3197d9766c00b0fc216b6c5289a51b0
```

Verify via command line:

```bash
printf '%s' "1786120930.{\"event\":\"service.ready\",\"external_service_id\":\"SVC-4711\",\"desired_state\":\"active\",\"status\":\"ready\",\"status_code\":null,\"server_id\":42,\"correlation_id\":\"6f6d9d1e-6b1e-4a51-9f0c-2b7a5d3e8c14\",\"terminate_after\":null,\"updated_at\":\"2026-08-08T09:22:10+00:00\"}" \
  | openssl dgst -sha256 -hmac "whsec_msm_beispiel_nicht_verwenden" -r \
  | cut -d' ' -f1
```

### Python Verification Example

```python
import hashlib
import hmac
import os
import time

SECRET = os.environ["MSM_WEBHOOK_SECRET"].encode("utf-8")
TOLERANCE_SECONDS = 300


def verify_msm_webhook(raw_body: bytes, timestamp_header: str, signature_header: str) -> bool:
    if not timestamp_header.isdigit() or abs(time.time() - int(timestamp_header)) > TOLERANCE_SECONDS:
        return False
    
    expected_digest = "sha256=" + hmac.new(
        SECRET,
        f"{timestamp_header}.".encode("utf-8") + raw_body,
        hashlib.sha256
    ).hexdigest()
    
    return hmac.compare_digest(expected_digest, signature_header)
```

---

## One-Click Handoff

Enables direct seamless navigation from your store dashboard into the customer's MSM server management console without requiring secondary credentials or manual login prompts.

### `POST /api/hoster/v1/handoffs`

#### Request Body

| Parameter | Type | Required | Description |
|---|---|---|---|
| `external_service_id` | `string` (1–128) | Yes | Contract instance to open |
| `target_path` | `string` (≤128) | No | Destination route inside panel. Restricted to: `/servers`, `/servers/{id}`, or `/dashboard`. Default: `/servers`. |

```bash
curl -X POST https://panel.example/api/hoster/v1/handoffs \
  -H "X-MSM-Hoster-Key: $MSM_HOSTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{"external_service_id":"SVC-4711","target_path":"/servers/42"}'
```

#### Response

```json
{
  "url": "https://panel.example/api/hoster/handoff/qJ8s...",
  "expires_at": "2026-08-08T09:27:10+00:00"
}
```

### Handoff Security Specifications

- **Time-To-Live:** Strictly valid for 5 minutes and single-use only.
- **Bound Scope:** Permanently tied to the authenticated user and target contract.
- **Strict Redirection:** Restrained strictly to the three whitelisted paths — arbitrary open redirects are rejected (`422`).
- **Zero-Storage Plaintext:** MSM stores only cryptographic hashes; raw tokens are never recorded in logs or audit traces.
- **Concurrent Limits:** Maximum 5 unconsumed tokens per user simultaneously.
- **Uniform Error Routing:** Expired, consumed, or invalid tokens uniformly redirect to standard login without disclosing token states.

Generate handoff links on-demand upon user click rather than pre-generating them when rendering store pages.

---

## Panel Administration (Admin Endpoints)

Administrative management routes used by the web frontend. These endpoints use standard session cookies with CSRF validation (`panel.hoster.*` permissions) rather than the external hoster API key.

Base path: `/api/hoster`

| Method | Route | Permission | Description |
|---|---|---|---|
| `GET` | `/integrations` | `panel.hoster.read` | List configured integrations |
| `POST` | `/integrations` | `panel.hoster.write` | Create integration (returns API key **once**) |
| `PATCH` | `/integrations/{integration_id}` | `panel.hoster.write` | Update name, status, service user, webhook URL, or grace periods |
| `POST` | `/integrations/{integration_id}/api-key` | `panel.hoster.write` | Rotate API key (invalidates old key immediately) |
| `POST` | `/integrations/{integration_id}/webhook-secret` | `panel.hoster.write` | Rotate HMAC webhook secret |
| `DELETE` | `/integrations/{integration_id}` | `panel.hoster.write` | Delete integration (blocked if active contracts exist) |
| `GET` | `/integrations/{integration_id}/products` | `panel.hoster.read` | List mapped product SKUs |
| `PUT` | `/integrations/{integration_id}/products` | `panel.hoster.write` | Create or update product SKU mapping |
| `DELETE` | `/integrations/{integration_id}/products/{product_id}` | `panel.hoster.write` | Delete product mapping |
| `GET` | `/integrations/{integration_id}/services` | `panel.hoster.read` | List active customer service contracts |
| `GET` | `/integrations/{integration_id}/deliveries` | `panel.hoster.read` | Inspect webhook delivery logs |
| `POST` | `/integrations/{integration_id}/deliveries/{delivery_id}/retry` | `panel.hoster.write` | Manually queue retry for failed webhook delivery |
| `POST` | `/integrations/{integration_id}/simulate` | `panel.hoster.write` | Simulate store event (purchase, suspend, resume, terminate, webhook) in sandbox |
| `DELETE` | `/integrations/{integration_id}/sandbox-data` | `panel.hoster.write` | Purge sandbox test data (services, servers, handoff tokens) |

---

## Operational Best Practices

1. **Service User Perimeter:** The integration is strictly bounded by its assigned service user. It requires `servers.create` and `servers.delete` (for termination cleanup). The administrator root owner account is intentionally forbidden as a service user.
2. **Customer Isolation:** Customers receive access restricted strictly to their own assigned container instances. Infrastructure settings, raw container execution (`exec`), and database root credentials remain inaccessible.
3. **Audit Visibility:** Every action triggered through the Hoster API is recorded in the immutable audit trail under `hoster.*` with `origin: external` and the associated `correlation_id`.
4. **Zero Password Sharing:** MSM never receives or stores store account passwords or customer payment credentials.
