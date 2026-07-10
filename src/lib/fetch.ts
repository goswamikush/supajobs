export class HttpError extends Error {
  status: number;

  constructor(status: number, body: string) {
    let message = `HTTP ${status}`;
    try {
      const parsed = JSON.parse(body);
      if (parsed?.error) {
        message = typeof parsed.error === 'string' ? parsed.error : JSON.stringify(parsed.error);
      }
    } catch {
      if (body) message = body;
    }
    super(message);
    this.status = status;
  }
}

export async function fetchWithRetry(url: string, options: RequestInit, retries = 3): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, options);
      if (!res.ok) throw new HttpError(res.status, await res.text());
      return res;
    } catch (err) {
      // Client errors (bad input, invalid invite code, etc.) won't succeed on retry.
      if (err instanceof HttpError && err.status < 500) throw err;
      if (i === retries - 1) throw err;
      const base = 2 ** i * 500;
      const jitter = Math.random() * 200;
      await new Promise(r => setTimeout(r, base + jitter));
    }
  }
  throw new Error('Failed after retries');
}
