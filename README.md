# helix-rum-alerter

Cloudflare Worker that stores per-site alert configuration in KV, pulls **Operational Telemetry (RUM)** bundle data for Core Web Vitals (CWV), and sends **email** (via [Resend](https://resend.com)) when any metric is worse than Google's **good** CWV thresholds. A cron trigger runs hourly and only performs checks when each site's `alertIntervalHours` has elapsed.

All write operations require an `Authorization: token <AEM_ADMIN_TOKEN>` header. The token is verified against `admin.hlx.page` for the target org/site.

### Alert configuration

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/alerts/:org/:site` | Required | Load saved alert config |
| `POST` | `/alerts/:org/:site` | Required | Opt in (fails if config already exists) |
| `PUT` | `/alerts/:org/:site` | Required | Update existing config (fails if not found) |
| `DELETE` | `/alerts/:org/:site` | Required | Delete alert config |
| `POST` | `/alerts/:org/:site/test` | Required | Send a test alert with optional CWV overrides |

**Example config** (stored at KV key `alerts/{org}/{site}`):

```json
{
  "enabled": true,
  "rum": {
    "domain": "www.example.com",
    "domainkey": "YOUR-RUM-DOMAIN-KEY",
    "alertIntervalHours": 24
  },
  "channels": {
    "email": ["you@example.com"]
  },
  "lastRumCheck": 0,
  "lastRumAlert": 0
}
```

Valid values for `alertIntervalHours`: `24`, `48`, `72`, `168`. Defaults to `24`.

### Test endpoint

`POST /alerts/:org/:site/test`

Runs a single check with no RUM history append and no state side effects. Optional body to simulate CWV values (skips live bundle fetch):

```json
{
  "overrideCwv": {
    "lcp": 5000,
    "cls": 0.2,
    "inp": 600
  }
}
```

Response includes `cwv`, `breaches`, `alertSent`, `providers`, `source` (`live` | `override`), and `message`.

### RUM history store

Read-only. History is appended automatically on each scheduled check (max 30 entries per site).

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/rum/:org/:site` | RUM snapshot history |

## How RUM checks work

1. For **today's UTC date**, the worker requests `bundles.aem.page` RUM bundles for `rum.domain` with `rum.domainkey`.
2. It derives **p75** aggregates from `cwv-lcp`, `cwv-cls`, and `cwv-inp` events.
3. A metric **breaches** when worse than Google's **good** threshold: LCP > 2.5s, CLS > 0.1, INP > 200ms.
4. If there are breaches, it sends email to `channels.email`. Alert emails include a direct link to RUM Explorer.

## Cron

`wrangler.toml` schedules `0 * * * *` (hourly). For each `alerts/*` config with `enabled: true` and `rum` set, the worker runs a check only if `alertIntervalHours` has elapsed since `lastRumCheck`.

## Development

| Script | Command |
|--------|---------|
| Develop | `npm run dev` |
| Deploy | `npm run deploy` |

The Worker needs a KV namespace bound as `PERFORMANCE_ALERTER_STORE` (see `wrangler.toml`) and Resend secrets:

| Secret | Required | Description |
|--------|----------|-------------|
| `RESEND_API_KEY` | Yes | Resend API key |
| `RESEND_FROM` | No | `From` header, e.g. `AEM Performance Alerts <name@yourdomain.com>` |

Use `wrangler dev --test-scheduled` to exercise the scheduled handler locally.
