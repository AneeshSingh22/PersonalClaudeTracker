// ============================================================
// GET /api/robinhood-data
// Server-side only — the browser never sees a Robinhood token.
// Refreshes the stored session (Robinhood rotates refresh tokens
// on every use, so the new one is saved back before anything else),
// then assembles a clean portfolio summary.
//
// Unofficial API — Robinhood can change these endpoints without
// notice. This is personal-account use only, against Robinhood's ToS.
//
// Env vars required on Vercel:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY   (secret — server only, never SUPABASE_ANON_KEY)
// ============================================================

const CLIENT_ID = 'c82SH0WZOsabOXGP2sxqcj34FxkvfnWRZBKlBjFS';
const BASE = 'https://api.robinhood.com';

async function loadSession(supabaseUrl, serviceKey) {
  const r = await fetch(`${supabaseUrl}/rest/v1/robinhood_session?id=eq.1&select=refresh_token,device_token`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  const rows = await r.json();
  if (!rows || !rows[0]) throw new Error('no robinhood session stored');
  return rows[0];
}

async function saveSession(supabaseUrl, serviceKey, patch) {
  await fetch(`${supabaseUrl}/rest/v1/robinhood_session?id=eq.1`, {
    method: 'PATCH',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
  });
}

async function refreshAccessToken(supabaseUrl, serviceKey) {
  const { refresh_token, device_token } = await loadSession(supabaseUrl, serviceKey);
  const r = await fetch(`${BASE}/oauth2/token/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token,
      client_id: CLIENT_ID,
      scope: 'internal',
      device_token,
    }),
  });
  const data = await r.json();
  if (!r.ok || !data.access_token) throw new Error('refresh failed: ' + JSON.stringify(data));

  // Save the new refresh_token immediately — Robinhood invalidates the old
  // one on every use, so losing this write strands the whole integration.
  await saveSession(supabaseUrl, serviceKey, {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: new Date(Date.now() + (data.expires_in || 86400) * 1000).toISOString(),
  });
  return data.access_token;
}

async function rhGet(path, accessToken) {
  const url = path.startsWith('http') ? path : BASE + path;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!r.ok) throw new Error(path + ' -> ' + r.status);
  return r.json();
}

async function fetchAllPages(path, accessToken, cap = 3) {
  let out = [];
  let next = BASE + path;
  for (let i = 0; i < cap && next; i++) {
    const page = await rhGet(next, accessToken);
    out = out.concat(page.results || []);
    next = page.next;
  }
  return out;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'server not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)' });
  }

  try {
    const accessToken = await refreshAccessToken(supabaseUrl, serviceKey);

    const [accounts, positions] = await Promise.all([
      rhGet('/accounts/', accessToken),
      fetchAllPages('/positions/?nonzero=true', accessToken),
    ]);

    const account = accounts.results && accounts.results[0];
    if (!account) throw new Error('no robinhood account found');

    const portfolio = await rhGet(account.url.replace(BASE, '').replace('/accounts/', '/portfolios/'), accessToken).catch(() => null);

    // Resolve each position's instrument -> symbol, and fetch a live quote.
    const resolved = await Promise.all(
      positions.map(async (p) => {
        try {
          const [instrument, quote] = await Promise.all([
            rhGet(p.instrument, accessToken),
            rhGet(p.instrument, accessToken).then((inst) => rhGet(`/quotes/${inst.symbol}/`, accessToken)).catch(() => null),
          ]);
          const qty = Number(p.quantity);
          const avgCost = Number(p.average_buy_price);
          const price = quote ? Number(quote.last_trade_price) : null;
          return {
            symbol: instrument.symbol,
            name: instrument.simple_name || instrument.name,
            quantity: qty,
            avgCost,
            price,
            value: price != null ? +(price * qty).toFixed(2) : null,
            costBasis: +(avgCost * qty).toFixed(2),
          };
        } catch (e) {
          return null;
        }
      })
    );

    const equity = portfolio ? Number(portfolio.equity) : null;
    // `equity_previous_close` is unreliable (often "0") — the adjusted field is the real one.
    const prevClose = portfolio ? Number(portfolio.adjusted_equity_previous_close) : null;
    const dayChangeValue = equity != null && prevClose != null ? +(equity - prevClose).toFixed(2) : null;
    const dayChangePercent = equity != null && prevClose ? +(((equity - prevClose) / prevClose) * 100).toFixed(2) : null;

    return res.status(200).json({
      equity,
      cash: account.portfolio_cash != null ? Number(account.portfolio_cash) : null,
      buyingPower: account.buying_power != null ? Number(account.buying_power) : null,
      dayChangeValue,
      dayChangePercent,
      positions: resolved.filter(Boolean).sort((a, b) => (b.value || 0) - (a.value || 0)),
      updatedAt: new Date().toISOString(),
    });
  } catch (e) {
    return res.status(500).json({ error: e && e.message ? e.message : String(e) });
  }
}
