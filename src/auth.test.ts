import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';

// auth.ts validates KRK_MCP_TOKENS_RW at module load time and calls
// process.exit(1) if it's missing — so each test that needs a specific
// token configuration sets env vars and re-imports the module fresh.
async function loadAuth(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return import('./auth.js');
}

const RW_TOKEN = 'krk_test_rw_token';
const RO_TOKEN = 'krk_test_ro_token';

describe('auth', () => {
  const originalEnv = { ...process.env };
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`process.exit(${code})`);
  }) as never);

  afterEach(() => {
    process.env = { ...originalEnv };
    exitSpy.mockClear();
  });

  it('refuses to start when KRK_MCP_TOKENS_RW is unset', async () => {
    await expect(
      loadAuth({ KRK_MCP_TOKENS_RW: undefined, KRK_MCP_TOKENS_RO: undefined })
    ).rejects.toThrow('process.exit(1)');
  });

  it('refuses to start when KRK_MCP_TOKENS_RW is empty', async () => {
    await expect(loadAuth({ KRK_MCP_TOKENS_RW: '  ,  ' })).rejects.toThrow('process.exit(1)');
  });

  it('grants write scope for an RW token and read scope for an RO token', async () => {
    const { requireAuth } = await loadAuth({
      KRK_MCP_TOKENS_RW: RW_TOKEN,
      KRK_MCP_TOKENS_RO: RO_TOKEN,
    });

    const rwReq = mockReq(`Bearer ${RW_TOKEN}`);
    const rwRes = mockRes();
    requireAuth(rwReq as any, rwRes as any, vi.fn());
    expect(rwReq.scope).toBe('write');

    const roReq = mockReq(`Bearer ${RO_TOKEN}`);
    const roRes = mockRes();
    requireAuth(roReq as any, roRes as any, vi.fn());
    expect(roReq.scope).toBe('read');
  });

  it('rejects a missing Authorization header with 401', async () => {
    const { requireAuth } = await loadAuth({ KRK_MCP_TOKENS_RW: RW_TOKEN });
    const req = mockReq(undefined);
    const res = mockRes();
    const next = vi.fn();

    requireAuth(req as any, res as any, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.setHeader).toHaveBeenCalledWith('WWW-Authenticate', expect.stringContaining('Bearer'));
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects an unrecognized token with 401', async () => {
    const { requireAuth } = await loadAuth({ KRK_MCP_TOKENS_RW: RW_TOKEN });
    const req = mockReq('Bearer not-a-real-token');
    const res = mockRes();
    const next = vi.fn();

    requireAuth(req as any, res as any, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('accepts overlapping tokens during rotation (comma-separated list)', async () => {
    const oldToken = 'krk_old';
    const newToken = 'krk_new';
    const { requireAuth } = await loadAuth({ KRK_MCP_TOKENS_RW: `${oldToken},${newToken}` });

    for (const token of [oldToken, newToken]) {
      const req = mockReq(`Bearer ${token}`);
      const res = mockRes();
      const next = vi.fn();
      requireAuth(req as any, res as any, next);
      expect(next).toHaveBeenCalled();
      expect(req.scope).toBe('write');
    }
  });

  it('scopeForTool / hasScope / toolsVisibleForScope enforce read vs write correctly', async () => {
    const { scopeForTool, hasScope, toolsVisibleForScope } = await loadAuth({
      KRK_MCP_TOKENS_RW: RW_TOKEN,
    });

    expect(scopeForTool('search_topics')).toBe('read');
    expect(scopeForTool('delete_topic')).toBe('write');

    expect(hasScope('write', 'read')).toBe(true);
    expect(hasScope('write', 'write')).toBe(true);
    expect(hasScope('read', 'write')).toBe(false);
    expect(hasScope(null, 'read')).toBe(false);

    expect(toolsVisibleForScope('read')).toEqual(new Set(['search_topics', 'get_topic']));
    expect(toolsVisibleForScope('write')).toEqual(
      new Set(['search_topics', 'get_topic', 'save_topic', 'delete_topic'])
    );
    expect(toolsVisibleForScope(null).size).toBe(0);
  });

  it('never logs the full token on an auth failure', async () => {
    const { requireAuth } = await loadAuth({ KRK_MCP_TOKENS_RW: RW_TOKEN });
    const secretToken = 'krk_' + crypto.randomBytes(32).toString('base64url');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const req = mockReq(`Bearer ${secretToken}`);
    requireAuth(req as any, mockRes() as any, vi.fn());

    const logged = warnSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logged).not.toContain(secretToken);
    warnSpy.mockRestore();
  });
});

function mockReq(authHeader: string | undefined) {
  return {
    header: (name: string) => (name.toLowerCase() === 'authorization' ? authHeader : undefined),
    method: 'POST',
    ip: '127.0.0.1',
  } as any;
}

function mockRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.setHeader = vi.fn().mockReturnValue(res);
  return res;
}
