import { CWV_THRESHOLDS } from './constants.js';

function getRumDatePath(date = new Date()) {
  return date.toISOString().split('T')[0].split('-').join('/');
}

export async function fetchRumData(domain, domainkey) {
  const datePath = getRumDatePath();
  const url = `https://bundles.aem.page/bundles/${domain}/${datePath}?domainkey=${encodeURIComponent(domainkey)}`;
  const resp = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!resp.ok) {
    console.error(`RUM fetch failed for ${domain}: ${resp.status}`);
    return null;
  }
  const data = await resp.json();
  return data?.rumBundles || [];
}

function computeP75(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * 0.75);
  return sorted[Math.min(idx, sorted.length - 1)];
}

export function extractCwvFromBundles(bundlesData) {
  const metrics = { lcp: [], cls: [], inp: [] };

  const bundles = Array.isArray(bundlesData) ? bundlesData : [];
  for (const bundle of bundles) {
    const events = bundle.events || [];
    for (const event of events) {
      if (event.checkpoint === 'cwv-lcp' && event.value != null) {
        metrics.lcp.push(event.value);
      } else if (event.checkpoint === 'cwv-cls' && event.value != null) {
        metrics.cls.push(event.value);
      } else if (event.checkpoint === 'cwv-inp' && event.value != null) {
        metrics.inp.push(event.value);
      }
    }
  }

  return {
    lcp: computeP75(metrics.lcp),
    cls: computeP75(metrics.cls),
    inp: computeP75(metrics.inp),
    sampleSize: {
      lcp: metrics.lcp.length,
      cls: metrics.cls.length,
      inp: metrics.inp.length,
    },
  };
}

export function evaluateRumThresholds(cwv) {
  const breaches = [];
  for (const [metric, value] of Object.entries(cwv)) {
    if (metric === 'sampleSize' || value == null) continue;
    const threshold = CWV_THRESHOLDS[metric]?.good;
    if (threshold != null && value > threshold) {
      breaches.push({
        metric,
        value,
        threshold,
        rating: value > CWV_THRESHOLDS[metric].poor ? 'poor' : 'needs-improvement',
      });
    }
  }
  return breaches;
}

export function normalizeOverrideCwv(overrideCwv) {
  const raw = overrideCwv == null ? {} : overrideCwv;
  const toNumberOrNull = (value) => {
    if (value == null || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const cwv = {
    lcp: toNumberOrNull(raw.lcp),
    cls: toNumberOrNull(raw.cls),
    inp: toNumberOrNull(raw.inp),
  };

  if (cwv.lcp == null && cwv.cls == null && cwv.inp == null) return null;

  const sampleSize = raw.sampleSize || {};
  cwv.sampleSize = {
    lcp: toNumberOrNull(sampleSize.lcp) ?? (cwv.lcp == null ? 0 : 1),
    cls: toNumberOrNull(sampleSize.cls) ?? (cwv.cls == null ? 0 : 1),
    inp: toNumberOrNull(sampleSize.inp) ?? (cwv.inp == null ? 0 : 1),
  };

  return cwv;
}
