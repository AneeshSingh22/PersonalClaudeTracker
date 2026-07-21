// ============================================================
// POST /api/health-import
// Receives Apple Health data pushed by the "Health Auto Export"
// iOS app's REST API automation (or a manual backfill script)
// and upserts it into Supabase.
//
// Auth: header  x-api-key: <HEALTH_IMPORT_KEY>
// Body: { data: { metrics: [ { name, units, data: [{ date, qty, source }] } ] } }
//       Sleep entries carry richer fields instead of qty:
//       { date, totalSleep, rem, deep, core, awake, inBed, sleepStart, sleepEnd, source }
//
// Env vars required on Vercel:
//   HEALTH_IMPORT_KEY   — shared secret the automation must send
//   SUPABASE_URL
//   SUPABASE_ANON_KEY
// ============================================================

// Health Auto Export uses different naming conventions depending on
// whether data comes via the MCP tool (snake_case, e.g. "resting_heart_rate")
// or the REST automation (Title Case, e.g. "Resting Heart Rate"). Normalize
// both into the same canonical keys so history stays in one continuous series.
const ALIASES = {
  active_energy_burned: 'active_energy',
  walking___running_distance: 'walking_running_distance',
  sleep_analysis_asleep_in_bed: 'sleep_analysis',
  vo2max: 'vo2_max',
  body_mass: 'weight',
  weight_body_mass: 'weight',
};

function normalizeMetricName(raw) {
  const slug = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return ALIASES[slug] || slug;
}

async function supaUpsert(supabaseUrl, anonKey, table, rows, onConflict) {
  if (!rows.length) return { ok: true };
  const r = await fetch(`${supabaseUrl}/rest/v1/${table}?on_conflict=${onConflict}`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify(rows),
  });
  if (!r.ok) return { ok: false, error: await r.text() };
  return { ok: true };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  const importKey = process.env.HEALTH_IMPORT_KEY;
  if (!importKey) return res.status(500).json({ error: 'server not configured (HEALTH_IMPORT_KEY)' });
  if (req.headers['x-api-key'] !== importKey) return res.status(401).json({ error: 'invalid api key' });

  const supabaseUrl = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) return res.status(500).json({ error: 'server not configured (SUPABASE_URL/SUPABASE_ANON_KEY)' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const metrics = (body && body.data && body.data.metrics) || [];
  if (!Array.isArray(metrics)) return res.status(400).json({ error: 'expected data.metrics array' });

  const metricRows = [];
  const sleepRows = [];

  for (const m of metrics) {
    const name = normalizeMetricName(m && m.name);
    if (!name) continue;
    const units = m.units || null;
    const points = Array.isArray(m.data) ? m.data : [];

    if (name === 'sleep_analysis') {
      for (const p of points) {
        const date = String(p.date || '').slice(0, 10);
        if (!date) continue;
        sleepRows.push({
          date,
          total_sleep: p.totalSleep ?? null,
          rem: p.rem ?? null,
          deep: p.deep ?? null,
          core: p.core ?? null,
          awake: p.awake ?? null,
          in_bed: p.inBed ?? null,
          sleep_start: p.sleepStart || null,
          sleep_end: p.sleepEnd || null,
          source: p.source || null,
          updated_at: new Date().toISOString(),
        });
      }
      continue;
    }

    for (const p of points) {
      const date = String(p.date || '').slice(0, 10);
      if (!date || p.qty == null) continue;
      metricRows.push({
        metric: name,
        date,
        qty: p.qty,
        units,
        source: p.source || null,
        updated_at: new Date().toISOString(),
      });
    }
  }

  const [metricsResult, sleepResult] = await Promise.all([
    supaUpsert(supabaseUrl, anonKey, 'apple_health_metrics', metricRows, 'metric,date'),
    supaUpsert(supabaseUrl, anonKey, 'apple_health_sleep', sleepRows, 'date'),
  ]);

  if (!metricsResult.ok || !sleepResult.ok) {
    return res.status(500).json({ error: 'supabase write failed', metricsResult, sleepResult });
  }
  return res.status(200).json({ ok: true, metricsWritten: metricRows.length, sleepWritten: sleepRows.length });
}
