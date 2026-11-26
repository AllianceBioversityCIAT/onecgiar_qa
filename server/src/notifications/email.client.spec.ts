import { Logger } from '@nestjs/common';
import { EMAIL_TIMEOUT_MS, EmailClient } from './email.client.js';

const KEY = 'clarisa-key-SECRET';
const message = {
  to: 'ada@example.org',
  subject: 'Subject MARK',
  text: 'plain',
  html: '<p>html</p>',
};

let fetchMock: ReturnType<typeof vi.fn>;
let lines: string[];
const client = (enabled = true) =>
  new EmailClient(
    { apiUrl: 'https://mail.test.invalid/api/email', enabled },
    { apiKey: KEY },
  );

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  lines = [];
  for (const level of ['log', 'warn'] as const) {
    vi.spyOn(Logger.prototype, level).mockImplementation((m: unknown) => {
      lines.push(String(m));
    });
  }
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('EmailClient (Notification Microservice, POST /send)', () => {
  it('posts multipart with the CLARISA key, emailBody as JSON and the HTML as the file part', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 202 }));

    await expect(client().send(message)).resolves.toBe('queued');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://mail.test.invalid/api/email/send');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'x-api-key': KEY });
    const form = init.body as FormData;
    expect(JSON.parse(form.get('emailBody') as string)).toEqual({
      subject: 'Subject MARK',
      to: 'ada@example.org',
      message: { text: 'plain' },
    });
    expect(JSON.parse(form.get('from') as string)).toEqual({
      name: 'One CGIAR QA Platform',
    });
    const file = form.get('file') as File;
    expect(file.type).toBe('text/html');
    expect(await file.text()).toBe('<p>html</p>');
  });

  it.each([
    ['a refusal', () => Promise.resolve(new Response('{}', { status: 401 }))],
    ['a network failure', () => Promise.reject(new TypeError('fetch failed'))],
  ])('%s → failed, never thrown', async (_name, answer) => {
    fetchMock.mockImplementationOnce(answer);
    await expect(client().send(message)).resolves.toBe('failed');
  });

  it(`gives up after ${EMAIL_TIMEOUT_MS} ms`, async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementationOnce(
      (_url: string, init: RequestInit) =>
        new Promise((_, reject) =>
          init.signal!.addEventListener('abort', () =>
            reject(new Error('aborted')),
          ),
        ),
    );
    const sent = client().send(message);
    await vi.advanceTimersByTimeAsync(EMAIL_TIMEOUT_MS);
    await expect(sent).resolves.toBe('failed');
    expect(lines.at(-1)).toContain('reason=timeout');
  });

  it('disabled → nothing sent', async () => {
    await expect(client(false).send(message)).resolves.toBe('disabled');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never logs the recipient, the subject or the key', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 500 }));
    await client().send(message);
    const all = lines.join('\n');
    for (const secret of [KEY, 'ada@example.org', 'MARK']) {
      expect(all).not.toContain(secret);
    }
  });
});
