import { withRetry } from '../utils/retry.ts';

export async function post(url: string, body: unknown, apiKey: string): Promise<void> {
  await withRetry(async () => {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`);
  });
}
