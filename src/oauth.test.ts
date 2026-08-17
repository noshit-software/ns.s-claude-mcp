import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./db.js', () => ({
  pool: { query: vi.fn() },
  m2tPool: null,
}));

const RW_TOKEN = 'krk_test_rw';
const RO_TOKEN = 'krk_test_ro';

async function loadOauth(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return import('./oauth.js');
}

function mockRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.send = vi.fn().mockReturnValue(res);
  res.redirect = vi.fn().mockReturnValue(res);
  return res;
}

describe('oauth', () => {
  const originalEnv = { ...process.env };
  vi.spyOn(process, 'exit').mockImplementation((() => {
    throw new Error('process.exit');
  }) as never);

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('renderLoginPage', () => {
    it('escapes attacker-controlled fields to prevent stored/reflected XSS', async () => {
      const { renderLoginPage } = await loadOauth({ KRK_MCP_TOKENS_RW: RW_TOKEN });
      const html = renderLoginPage({
        clientId: '"><script>alert(1)</script>',
        redirectUri: 'https://example.com/callback',
        codeChallenge: 'abc',
        scope: 'write',
      });
      expect(html).not.toContain('<script>alert(1)</script>');
      expect(html).toContain('&lt;script&gt;');
    });

    it('renders the posted-back OAuth params as hidden fields', async () => {
      const { renderLoginPage } = await loadOauth({ KRK_MCP_TOKENS_RW: RW_TOKEN });
      const html = renderLoginPage({
        clientId: 'client-123',
        redirectUri: 'https://example.com/callback',
        codeChallenge: 'chal-abc',
        scope: 'write',
        state: 'xyz',
      });
      expect(html).toContain('value="client-123"');
      expect(html).toContain('value="https://example.com/callback"');
      expect(html).toContain('value="chal-abc"');
      expect(html).toContain('value="xyz"');
      expect(html).toContain('action="/oauth/authorize/approve"');
    });
  });

  describe('handleApprove', () => {
    it('rejects an invalid pasted token with 401 and re-renders the form', async () => {
      const { handleApprove } = await loadOauth({ KRK_MCP_TOKENS_RW: RW_TOKEN });
      const res = mockRes();

      handleApprove(
        {
          token: 'not-a-real-token',
          client_id: 'c1',
          redirect_uri: 'https://example.com/callback',
          code_challenge: 'abc',
          scope: '',
          state: '',
        },
        res
      );

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.redirect).not.toHaveBeenCalled();
    });

    it('rejects a read-only token requesting write scope with 403', async () => {
      const { handleApprove } = await loadOauth({
        KRK_MCP_TOKENS_RW: RW_TOKEN,
        KRK_MCP_TOKENS_RO: RO_TOKEN,
      });
      const res = mockRes();

      handleApprove(
        {
          token: RO_TOKEN,
          client_id: 'c1',
          redirect_uri: 'https://example.com/callback',
          code_challenge: 'abc',
          scope: 'write',
          state: '',
        },
        res
      );

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.redirect).not.toHaveBeenCalled();
    });

    it('issues a code and redirects for a valid token', async () => {
      const { handleApprove } = await loadOauth({ KRK_MCP_TOKENS_RW: RW_TOKEN });
      const res = mockRes();

      handleApprove(
        {
          token: RW_TOKEN,
          client_id: 'c1',
          redirect_uri: 'https://example.com/callback',
          code_challenge: 'abc',
          scope: '',
          state: 'xyz',
        },
        res
      );

      expect(res.redirect).toHaveBeenCalledTimes(1);
      const target = new URL(res.redirect.mock.calls[0][0]);
      expect(target.origin + target.pathname).toBe('https://example.com/callback');
      expect(target.searchParams.get('code')).toBeTruthy();
      expect(target.searchParams.get('state')).toBe('xyz');
    });

    it('a code issued for one client cannot be redeemed by another', async () => {
      const { handleApprove, KrkOAuthProvider } = await loadOauth({ KRK_MCP_TOKENS_RW: RW_TOKEN });
      const res = mockRes();

      handleApprove(
        {
          token: RW_TOKEN,
          client_id: 'legit-client',
          redirect_uri: 'https://example.com/callback',
          code_challenge: 'abc',
          scope: '',
          state: '',
        },
        res
      );
      const target = new URL(res.redirect.mock.calls[0][0]);
      const code = target.searchParams.get('code')!;

      const provider = new KrkOAuthProvider();
      await expect(
        provider.challengeForAuthorizationCode(
          { client_id: 'attacker-client' } as any,
          code
        )
      ).rejects.toThrow('Invalid authorization code');
    });
  });
});
