const HIVE_INTERNAL_KEY = process.env.HIVE_INTERNAL_KEY || '';

const SERVICES = {
  hivetrust: process.env.HIVETRUST_URL || 'https://hivetrust.onrender.com',
  hivebank:  process.env.HIVEBANK_URL  || 'https://hivebank.onrender.com',
  hivelaw:   process.env.HIVELAW_URL   || 'https://hivelaw.onrender.com',
  hiveclear: process.env.HIVECLEAR_URL || 'https://hiveclear.onrender.com',
  hiveforge: process.env.HIVEFORGE_URL || 'https://hiveforge-lhu4.onrender.com',
  hivemind:  process.env.HIVEMIND_URL  || 'https://hivemind-1-52cw.onrender.com',
};

export function getServiceUrl(name) {
  return SERVICES[name] || null;
}

export async function hiveGet(serviceUrl, path) {
  try {
    const res = await fetch(`${serviceUrl}${path}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-hive-internal-key': HIVE_INTERNAL_KEY,
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, status: res.status, error: text };
    }
    const data = await res.json();
    return { ok: true, data };
  } catch (err) {
    return { ok: false, status: 0, error: err.message };
  }
}

export async function hivePost(serviceUrl, path, body) {
  try {
    const res = await fetch(`${serviceUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-hive-internal-key': HIVE_INTERNAL_KEY,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, status: res.status, error: text };
    }
    const data = await res.json();
    return { ok: true, data };
  } catch (err) {
    return { ok: false, status: 0, error: err.message };
  }
}

export { SERVICES, HIVE_INTERNAL_KEY };
