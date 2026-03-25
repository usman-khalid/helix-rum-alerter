import { AEM_ALERT_EMAIL_ICON_URL, MAX_PROVIDER_ERROR_LEN } from './constants.js';

function sanitizeHeaderValue(value) {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').trim();
}

function truncateDetail(text) {
  const s = String(text ?? '');
  if (s.length <= MAX_PROVIDER_ERROR_LEN) return s;
  return `${s.slice(0, MAX_PROVIDER_ERROR_LEN)}…`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeHtmlAttr(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

function cwvRatingLabel(rating) {
  if (rating === 'poor') return 'Poor';
  if (rating === 'needs-improvement') return 'Needs Improvement';
  return String(rating || '');
}

export function buildRumExplorerUrl(domain, domainkey) {
  const d = String(domain || '').trim();
  const u = new URL('https://www.aem.live/tools/rum/explorer.html');
  if (d) u.searchParams.set('domain', d);
  u.searchParams.set('filter', '');
  u.searchParams.set('view', 'month');
  u.searchParams.append('checkpoint', 'enter');
  u.searchParams.append('checkpoint', 'click');
  const k = String(domainkey || '').trim();
  if (k) u.searchParams.set('domainkey', k);
  return u.toString();
}

function formatAlertEmailRows(breaches) {
  return breaches.map((b) => {
    const unit = b.metric === 'cls' ? '' : 'ms';
    const val = b.metric === 'cls' ? b.value.toFixed(3) : Math.round(b.value);
    const thresh = b.metric === 'cls' ? b.threshold.toFixed(2) : Math.round(b.threshold);
    const ratingColor = b.rating === 'poor' ? '#c9252d' : '#de7b00';
    const ratingBg = b.rating === 'poor' ? '#fdecea' : '#fff4e5';
    return `<tr>
      <td style="padding:12px 14px;border-bottom:1px solid #eaeaea;font-family:Adobe Clean,Source Sans Pro,Helvetica,Arial,sans-serif;font-size:14px;color:#2c2c2c;"><strong>${b.metric.toUpperCase()}</strong></td>
      <td style="padding:12px 14px;border-bottom:1px solid #eaeaea;font-family:Adobe Clean,Source Sans Pro,Helvetica,Arial,sans-serif;font-size:14px;color:#2c2c2c;">${val}${unit}</td>
      <td style="padding:12px 14px;border-bottom:1px solid #eaeaea;font-family:Adobe Clean,Source Sans Pro,Helvetica,Arial,sans-serif;font-size:14px;color:#505050;">≤ ${thresh}${unit} <span style="color:#888;font-size:12px;">(good)</span></td>
      <td style="padding:12px 14px;border-bottom:1px solid #eaeaea;">
        <span style="display:inline-block;padding:4px 10px;border-radius:4px;font-size:12px;font-weight:600;font-family:Adobe Clean,Source Sans Pro,Helvetica,Arial,sans-serif;color:${ratingColor};background:${ratingBg};">${escapeHtml(cwvRatingLabel(b.rating))}</span>
      </td>
    </tr>`;
  }).join('');
}

export function formatRumAlertEmail(orgName, siteName, domainName, breaches, explorerUrl) {
  const org = escapeHtml(orgName);
  const site = escapeHtml(siteName);
  const domain = escapeHtml(domainName);
  const href = escapeHtmlAttr(explorerUrl);
  const logoSrc = escapeHtmlAttr(AEM_ALERT_EMAIL_ICON_URL);
  const rows = formatAlertEmailRows(breaches);

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#f4f4f4;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f4f4;padding:24px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
          <tr>
            <td style="padding:20px 24px;border-bottom:1px solid #eaeaea;background:#fafafa;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="vertical-align:middle;width:48px;">
                    <img src="${logoSrc}" width="32" height="32" alt="AEM" style="display:block;border:0;" />
                  </td>
                  <td style="vertical-align:middle;padding-left:14px;">
                    <div style="font-family:Adobe Clean,Source Sans Pro,Helvetica,Arial,sans-serif;font-size:11px;font-weight:600;letter-spacing:0.06em;color:#707070;text-transform:uppercase;">AEM · RUM alert</div>
                    <div style="font-family:Adobe Clean,Source Sans Pro,Helvetica,Arial,sans-serif;font-size:20px;font-weight:700;color:#2c2c2c;line-height:1.25;margin-top:2px;">${org} / ${site}</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 24px 8px;font-family:Adobe Clean,Source Sans Pro,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#2c2c2c;">
              Core Web Vitals for <strong>${domain}</strong> are outside Google's <strong>good</strong> range. Figures are based on today's aggregated RUM data for your domain.
            </td>
          </tr>
          <tr>
            <td style="padding:8px 24px 24px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #eaeaea;border-radius:6px;overflow:hidden;">
                <tr style="background:#f8f8f8;">
                  <th align="left" style="padding:10px 14px;font-family:Adobe Clean,Source Sans Pro,Helvetica,Arial,sans-serif;font-size:11px;font-weight:600;letter-spacing:0.04em;color:#707070;text-transform:uppercase;">Metric</th>
                  <th align="left" style="padding:10px 14px;font-family:Adobe Clean,Source Sans Pro,Helvetica,Arial,sans-serif;font-size:11px;font-weight:600;letter-spacing:0.04em;color:#707070;text-transform:uppercase;">Current</th>
                  <th align="left" style="padding:10px 14px;font-family:Adobe Clean,Source Sans Pro,Helvetica,Arial,sans-serif;font-size:11px;font-weight:600;letter-spacing:0.04em;color:#707070;text-transform:uppercase;">Target Threshold</th>
                  <th align="left" style="padding:10px 14px;font-family:Adobe Clean,Source Sans Pro,Helvetica,Arial,sans-serif;font-size:11px;font-weight:600;letter-spacing:0.04em;color:#707070;text-transform:uppercase;">Status</th>
                </tr>
                ${rows}
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:0 24px 28px;" align="center">
              <a href="${href}" style="display:inline-block;padding:12px 22px;background:#1473e6;color:#ffffff;text-decoration:none;border-radius:20px;font-family:Adobe Clean,Source Sans Pro,Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;">Open in RUM Explorer</a>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 24px;border-top:1px solid #eaeaea;background:#fafafa;font-family:Adobe Clean,Source Sans Pro,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;color:#8e8e8e;">
              Automated message from your friends at AEM Engineering. <a href="${href}" style="color:#1473e6;text-decoration:none;">Direct link</a> if the button doesn't work.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body></html>`;
}

export async function sendEmail(env, recipients, subject, body) {
  if (!recipients.length) {
    return { ok: false, error: 'No email recipients configured.' };
  }
  if (!env.RESEND_API_KEY) {
    return { ok: false, error: 'RESEND_API_KEY is not set on the worker.' };
  }
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.RESEND_FROM || 'RUM <onboarding@resend.dev>',
        to: recipients,
        subject: sanitizeHeaderValue(subject),
        html: body,
      }),
    });
    const text = await resp.text();
    if (!resp.ok) {
      console.error('Resend API error:', resp.status, text);
      return { ok: false, status: resp.status, error: truncateDetail(text || resp.statusText) };
    }
    return { ok: true };
  } catch (err) {
    console.error('Email send failed:', err);
    return { ok: false, error: truncateDetail(err.message || String(err)) };
  }
}

export async function sendRumAlerts(env, config, org, site, breaches) {
  const { channels = {}, rum = {} } = config;
  const domain = rum.domain || `${org}/${site}`;
  const domainkey = typeof rum.domainkey === 'string' ? rum.domainkey.trim() : '';
  const explorerUrl = buildRumExplorerUrl(domain, domainkey);
  const subject = `RUM Alert: ${org}/${site} — CWV thresholds breached`;
  const providers = {};
  let sent = false;

  if (channels.email?.length) {
    providers.email = await sendEmail(
      env,
      channels.email,
      subject,
      formatRumAlertEmail(org, site, domain, breaches, explorerUrl),
    );
    if (providers.email.ok) sent = true;
  }

  return { sent, providers };
}
