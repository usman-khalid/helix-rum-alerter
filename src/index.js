import { sendRumAlerts } from './email.js';
import { fetchRumData, extractCwvFromBundles, evaluateRumThresholds, normalizeOverrideCwv } from './rum.js';
import { MAX_ENTRIES, DEFAULT_ALERT_INTERVAL_HOURS, VALID_ALERT_INTERVALS } from './constants.js';

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

function json(data, status = 200, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
  });
}

async function isAuthorized(authToken, org, site) {
  if (!authToken) return false;
  const resp = await fetch(`https://admin.hlx.page/config/${org}/sites/${site}.json`, {
    headers: { Authorization: authToken, Accept: 'application/json' },
  });
  return resp.ok;
}

const SLUG = '[a-z0-9][a-z0-9-]*[a-z0-9]';

const ROUTES = [
  { pattern: new RegExp(`^/rum/(${SLUG})/(${SLUG})$`), type: 'rum', prefix: 'rum' },
  { pattern: new RegExp(`^/alerts/(${SLUG})/(${SLUG})/test$`), type: 'alert-test', prefix: 'alerts' },
  { pattern: new RegExp(`^/alerts/(${SLUG})/(${SLUG})$`), type: 'alert-site', prefix: 'alerts' },
];

function parseRoute(pathname) {
  for (const { pattern, type, prefix } of ROUTES) {
    const match = pathname.match(pattern);
    if (match) return { type, org: match[1], site: match[2], key: `${prefix}/${match[1]}/${match[2]}` };
  }
  return null;
}

async function getHistory(env, key) {
  const data = await env.PERFORMANCE_ALERTER_STORE.get(key);
  return data ? JSON.parse(data) : [];
}

async function appendHistory(env, key, entry) {
  const existing = await getHistory(env, key);
  const updated = [entry, ...existing].slice(0, MAX_ENTRIES);
  await env.PERFORMANCE_ALERTER_STORE.put(key, JSON.stringify(updated));
  return updated;
}

function normalizeAlertConfig(body) {
  if (body.rum) {
    delete body.rum.level;
    const dk = body.rum.domainkey != null ? String(body.rum.domainkey).trim() : '';
    if (dk) body.rum.domainkey = dk;
    else delete body.rum.domainkey;

    const interval = parseInt(body.rum.alertIntervalHours, 10);
    if (!VALID_ALERT_INTERVALS.includes(interval)) {
      return { error: `alertIntervalHours must be one of: ${VALID_ALERT_INTERVALS.join(', ')}` };
    }
    body.rum.alertIntervalHours = interval;
  }
  return { config: body };
}

async function runRumCheck(env, org, site, config, options = {}) {
  const {
    overrideCwv = null,
    persistHistory = true,
    persistState = true,
  } = options;
  const { rum } = config;

  if (!rum?.domain && !overrideCwv) {
    return { ok: false, message: 'RUM domain is not configured.' };
  }

  let cwv = normalizeOverrideCwv(overrideCwv);
  let source = 'override';

  if (!cwv) {
    if (!rum?.domain) return { ok: false, message: 'RUM domain is not configured.' };
    const domainkey = typeof rum.domainkey === 'string' ? rum.domainkey.trim() : '';
    if (!domainkey) return { ok: false, message: 'RUM domain key is not configured.' };

    const bundlesData = await fetchRumData(rum.domain, domainkey);
    if (!bundlesData) return { ok: false, message: `Failed to fetch RUM data for ${rum.domain}.` };

    cwv = extractCwvFromBundles(bundlesData);
    source = 'live';
  }

  if (cwv.lcp == null && cwv.cls == null && cwv.inp == null) {
    return { ok: true, cwv, breaches: [], alertSent: false, providers: null, message: 'No CWV data available yet.', source };
  }

  if (persistHistory) {
    await appendHistory(env, `rum/${org}/${site}`, { timestamp: Date.now(), cwv });
  }

  const breaches = evaluateRumThresholds(cwv);
  let alertSent = false;
  let providers = null;

  if (breaches.length > 0) {
    const result = await sendRumAlerts(env, config, org, site, breaches);
    alertSent = result.sent;
    providers = result.providers;
    if (alertSent) config.lastRumAlert = Date.now();
  }

  if (persistState) {
    config.lastRumCheck = Date.now();
    await env.PERFORMANCE_ALERTER_STORE.put(`alerts/${org}/${site}`, JSON.stringify(config));
  }

  return {
    ok: true,
    cwv,
    breaches,
    alertSent,
    providers,
    source,
    message: breaches.length
      ? (alertSent ? 'Thresholds breached and alert email sent.' : 'Thresholds breached but email was not sent (no recipients or send failed).')
      : 'No thresholds breached.',
  };
}

async function handleHistoryRoute(request, env, route, origin) {
  if (request.method === 'GET') {
    return json(await getHistory(env, route.key), 200, origin);
  }
  return json({ error: 'Method not allowed' }, 405, origin);
}

async function writeAlertConfig(env, key, body) {
  const result = normalizeAlertConfig(body);
  if (result.error) return { error: result.error };
  await env.PERFORMANCE_ALERTER_STORE.put(key, JSON.stringify(result.config));
  return { config: result.config };
}

async function handleAlertSite(request, env, route, origin) {
  const { org, site, key } = route;

  const authToken = request.headers.get('Authorization');
  if (!await isAuthorized(authToken, org, site)) {
    return json({ error: 'Unauthorized' }, 401, origin);
  }

  if (request.method === 'GET') {
    const data = await env.PERFORMANCE_ALERTER_STORE.get(key);
    if (!data) return json(null, 404, origin);
    return json(JSON.parse(data), 200, origin);
  }

  if (request.method === 'POST') {
    const existing = await env.PERFORMANCE_ALERTER_STORE.get(key);
    if (existing) return json({ error: 'Configuration already exists. Use PUT to update.' }, 409, origin);
    const result = await writeAlertConfig(env, key, await request.json());
    if (result.error) return json({ error: result.error }, 400, origin);
    return json({ ok: true, config: result.config }, 201, origin);
  }

  if (request.method === 'PUT') {
    const existing = await env.PERFORMANCE_ALERTER_STORE.get(key);
    if (!existing) return json({ error: 'No configuration found. Use POST to opt in first.' }, 404, origin);
    const result = await writeAlertConfig(env, key, await request.json());
    if (result.error) return json({ error: result.error }, 400, origin);
    return json({ ok: true, config: result.config }, 200, origin);
  }

  if (request.method === 'DELETE') {
    await env.PERFORMANCE_ALERTER_STORE.delete(key);
    return json({ ok: true }, 200, origin);
  }

  return json({ error: 'Method not allowed' }, 405, origin);
}

async function handleAlertTest(request, env, route, origin) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405, origin);
  }

  const authToken = request.headers.get('Authorization');
  if (!await isAuthorized(authToken, route.org, route.site)) {
    return json({ error: 'Unauthorized' }, 401, origin);
  }

  const raw = await env.PERFORMANCE_ALERTER_STORE.get(route.key);
  if (!raw) {
    return json({ error: `No alert config found for ${route.org}/${route.site}` }, 404, origin);
  }

  const config = JSON.parse(raw);
  const body = await request.json().catch(() => ({}));
  const result = await runRumCheck(env, route.org, route.site, config, {
    overrideCwv: body?.overrideCwv || null,
    persistHistory: false,
    persistState: false,
  });

  if (!result.ok) return json({ error: result.message }, 400, origin);

  return json({
    cwv: result.cwv,
    breaches: result.breaches,
    alertSent: result.alertSent,
    source: result.source,
    message: result.message,
    providers: result.providers,
  }, 200, origin);
}

async function handleScheduled(env) {
  const list = await env.PERFORMANCE_ALERTER_STORE.list({ prefix: 'alerts/' });

  for (const key of list.keys) {
    try {
      const raw = await env.PERFORMANCE_ALERTER_STORE.get(key.name);
      if (!raw) continue;
      const config = JSON.parse(raw);
      if (!config.enabled || !config.rum) continue;

      const parts = key.name.replace('alerts/', '').split('/');
      if (parts.length !== 2) continue;
      const [org, site] = parts;

      const intervalMs = (config.rum.alertIntervalHours || DEFAULT_ALERT_INTERVAL_HOURS) * 60 * 60 * 1000;
      if (Date.now() - (config.lastRumCheck || 0) < intervalMs) continue;

      const result = await runRumCheck(env, org, site, config);
      if (!result.ok) {
        console.error(`RUM check failed for ${org}/${site}: ${result.message}`);
      } else if (result.message === 'No CWV data available yet.') {
        console.log(`No CWV data for ${org}/${site} (${config.rum.domain})`);
      }
    } catch (err) {
      console.error(`Error processing ${key.name}:`, err);
    }
  }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    const route = parseRoute(new URL(request.url).pathname);
    if (!route) {
      return json({ error: 'Not found. Use /rum/:org/:site or /alerts/:org/:site' }, 404, origin);
    }

    if (route.type === 'rum') return handleHistoryRoute(request, env, route, origin);
    if (route.type === 'alert-site') return handleAlertSite(request, env, route, origin);
    if (route.type === 'alert-test') return handleAlertTest(request, env, route, origin);

    return json({ error: 'Not found' }, 404, origin);
  },

  async scheduled(event, env) {
    await handleScheduled(env);
  },
};
