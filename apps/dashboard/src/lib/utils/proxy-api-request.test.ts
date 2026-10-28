import {
  buildProxiedApiResponse,
  isStreamingUpstreamPath,
  proxyRequestToApi,
  shouldForwardToApi
} from './proxy-api-request';

describe('shouldForwardToApi', () => {
  it('forwards /proxy and /api/auth paths', () => {
    expect(shouldForwardToApi('/proxy')).toBe(true);
    expect(shouldForwardToApi('/proxy/account')).toBe(true);
    expect(shouldForwardToApi('/api/auth')).toBe(true);
    expect(shouldForwardToApi('/api/auth/get-session')).toBe(true);
  });

  it('does not forward unrelated paths', () => {
    expect(shouldForwardToApi('/login')).toBe(false);
    expect(shouldForwardToApi('/api/csp-report')).toBe(false);
  });
});

describe('buildProxiedApiResponse', () => {
  it('strips content-encoding and content-length so the browser does not re-decode', async () => {
    const upstream = new Response('{"user":null}', {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'content-encoding': 'gzip',
        'content-length': '13',
        'transfer-encoding': 'chunked'
      }
    });

    const proxied = buildProxiedApiResponse(upstream);

    expect(proxied.status).toBe(200);
    expect(proxied.headers.get('content-type')).toBe('application/json');
    expect(proxied.headers.get('content-encoding')).toBeNull();
    expect(proxied.headers.get('content-length')).toBeNull();
    expect(proxied.headers.get('transfer-encoding')).toBeNull();
    expect(await proxied.text()).toBe('{"user":null}');
  });

  it('preserves multiple Set-Cookie headers without collapsing Expires commas', async () => {
    const upstreamHeaders = new Headers({
      'content-type': 'application/json',
      'content-encoding': 'gzip'
    });
    upstreamHeaders.append(
      'set-cookie',
      'better-auth.session_token=abc; Path=/; HttpOnly; Expires=Wed, 21 Oct 2026 07:28:00 GMT'
    );
    upstreamHeaders.append(
      'set-cookie',
      'better-auth.csrf_token=xyz; Path=/; HttpOnly; Expires=Thu, 22 Oct 2026 07:28:00 GMT'
    );

    const proxied = buildProxiedApiResponse(
      new Response('{"ok":true}', {
        status: 200,
        headers: upstreamHeaders
      })
    );

    expect(proxied.headers.getSetCookie()).toEqual([
      'better-auth.session_token=abc; Path=/; HttpOnly; Expires=Wed, 21 Oct 2026 07:28:00 GMT',
      'better-auth.csrf_token=xyz; Path=/; HttpOnly; Expires=Thu, 22 Oct 2026 07:28:00 GMT'
    ]);
    expect(proxied.headers.get('content-encoding')).toBeNull();
    expect(await proxied.text()).toBe('{"ok":true}');
  });
});

describe('proxyRequestToApi', () => {
  const originalPrivateServerUrl = process.env.PRIVATE_SERVER_URL;
  const originalFetch = global.fetch;

  afterEach(() => {
    if (originalPrivateServerUrl === undefined) {
      delete process.env.PRIVATE_SERVER_URL;
    } else {
      process.env.PRIVATE_SERVER_URL = originalPrivateServerUrl;
    }

    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('returns 502 when PRIVATE_SERVER_URL is missing', async () => {
    delete process.env.PRIVATE_SERVER_URL;

    const response = await proxyRequestToApi(new Request('https://app.example/api/auth/get-session'));

    expect(response.status).toBe(502);
    expect(await response.text()).toBe('API upstream not configured');
  });

  it('requests identity encoding and returns a stripped response', async () => {
    process.env.PRIVATE_SERVER_URL = 'http://api.internal:3081';

    const fetchMock = jest.fn().mockResolvedValue(
      new Response('{"session":null}', {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'content-encoding': 'gzip',
          'content-length': '16'
        }
      })
    );
    global.fetch = fetchMock as typeof fetch;

    const response = await proxyRequestToApi(
      new Request('https://dashboard.example/api/auth/get-session', {
        headers: {
          accept: 'application/json',
          'accept-encoding': 'gzip, deflate, br',
          cookie: 'better-auth.session_token=test'
        }
      })
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [upstreamUrl, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(String(upstreamUrl)).toBe('http://api.internal:3081/api/auth/get-session');
    expect(init.method).toBe('GET');

    const upstreamHeaders = new Headers(init.headers);
    expect(upstreamHeaders.get('accept-encoding')).toBe('identity');
    expect(upstreamHeaders.get('host')).toBe('api.internal:3081');
    expect(upstreamHeaders.get('x-forwarded-host')).toBe('dashboard.example');
    expect(upstreamHeaders.get('cookie')).toBe('better-auth.session_token=test');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-encoding')).toBeNull();
    expect(response.headers.get('content-length')).toBeNull();
    expect(await response.text()).toBe('{"session":null}');
  });
});

describe('proxyRequestToApi upstream timeout (Phase I)', () => {
  const originalPrivateServerUrl = process.env.PRIVATE_SERVER_URL;
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.PRIVATE_SERVER_URL = 'http://api.internal:3081';
  });

  afterEach(() => {
    if (originalPrivateServerUrl === undefined) delete process.env.PRIVATE_SERVER_URL;
    else process.env.PRIVATE_SERVER_URL = originalPrivateServerUrl;
    global.fetch = originalFetch;
  });

  it('classifies the long-lived streams as exempt from the timeout', () => {
    expect(isStreamingUpstreamPath('/agent/chat')).toBe(true);
    expect(isStreamingUpstreamPath('/hls/abc/master.m3u8')).toBe(true);
    expect(isStreamingUpstreamPath('/caseload/courses/c1/lessons/l1/submissions/download-all')).toBe(true);
    expect(isStreamingUpstreamPath('/agent/upload')).toBe(false);
    expect(isStreamingUpstreamPath('/media/image')).toBe(false);
    expect(isStreamingUpstreamPath('/course/123')).toBe(false);
  });

  it('attaches an abort signal to ordinary proxied calls', async () => {
    const fetchMock = jest.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    global.fetch = fetchMock as typeof fetch;

    await proxyRequestToApi(new Request('https://dashboard.example/proxy/course/123'));

    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(init.signal).toBeDefined();
  });

  it('does not attach a signal to agent chat, HLS or download-all streams', async () => {
    const fetchMock = jest.fn().mockImplementation(async () => new Response('x', { status: 200 }));
    global.fetch = fetchMock as typeof fetch;

    await proxyRequestToApi(new Request('https://dashboard.example/proxy/agent/chat', { method: 'GET' }));
    await proxyRequestToApi(new Request('https://dashboard.example/proxy/hls/a1/master.m3u8'));
    await proxyRequestToApi(
      new Request(
        'https://dashboard.example/proxy/caseload/courses/c/lessons/l/submissions/download-all?assessmentKey=k'
      )
    );

    for (const call of fetchMock.mock.calls) {
      expect((call[1] as RequestInit).signal).toBeUndefined();
    }
  });

  it('answers 504 when the upstream times out', async () => {
    const err = new Error('The operation was aborted due to timeout');
    err.name = 'TimeoutError';
    global.fetch = jest.fn().mockRejectedValue(err) as typeof fetch;
    jest.spyOn(console, 'error').mockImplementation(() => {});

    const response = await proxyRequestToApi(new Request('https://dashboard.example/proxy/course/123'));

    expect(response.status).toBe(504);
  });
});
