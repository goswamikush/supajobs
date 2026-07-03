export async function fetchWithRetry(url: string, options: RequestInit, retries = 3): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, options);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (err) {
      if (i === retries - 1) throw err;
      const base = 2 ** i * 500;
      const jitter = Math.random() * 200;
      await new Promise(r => setTimeout(r, base + jitter));
    }
  }
  throw new Error('Failed after retries');
}
