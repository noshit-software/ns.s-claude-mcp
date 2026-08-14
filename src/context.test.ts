import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();

vi.mock('./db.js', () => ({
  pool: { query: (...args: unknown[]) => queryMock(...args) },
  m2tPool: null,
}));

vi.mock('./config.js', () => ({
  config: { m2t: { enabled: false, clerkUserId: '' } },
}));

const { searchContext, deleteContext } = await import('./context.js');

describe('searchContext', () => {
  beforeEach(() => {
    queryMock.mockReset();
    queryMock.mockResolvedValue([[]]);
  });

  it('always filters out soft-deleted rows', async () => {
    await searchContext({});
    const [sql] = queryMock.mock.calls[0];
    expect(sql).toContain('deleted_at IS NULL');
  });

  it('clamps a valid limit into the query', async () => {
    await searchContext({ limit: 10 });
    const [sql] = queryMock.mock.calls[0];
    expect(sql).toContain('LIMIT 10');
  });

  it('caps an oversized limit at 500', async () => {
    await searchContext({ limit: 999999 });
    const [sql] = queryMock.mock.calls[0];
    expect(sql).toContain('LIMIT 500');
    expect(sql).not.toContain('999999');
  });

  it('drops a non-integer/malicious limit instead of interpolating it', async () => {
    // Simulates a raw JSON-RPC call bypassing the tool's advisory inputSchema.
    await searchContext({ limit: '1; DROP TABLE context;--' as unknown as number });
    const [sql] = queryMock.mock.calls[0];
    expect(sql).not.toContain('DROP TABLE');
    expect(sql).not.toContain('LIMIT');
  });

  it('drops a negative or zero limit', async () => {
    await searchContext({ limit: -5 });
    const [sql] = queryMock.mock.calls[0];
    expect(sql).not.toContain('LIMIT');
  });

  it('parameterizes query/tag/category/project filters rather than interpolating', async () => {
    await searchContext({ query: "'; DROP TABLE context;--", category: 'design', project: 'x' });
    const [sql, values] = queryMock.mock.calls[0];
    expect(sql).not.toContain('DROP TABLE');
    expect(values).toContain('%\'; DROP TABLE context;--%');
  });
});

describe('deleteContext', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('soft-deletes via UPDATE, never a hard DELETE', async () => {
    queryMock.mockResolvedValue([{ affectedRows: 1 }]);
    const result = await deleteContext('project:x:y');

    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/^\s*UPDATE context SET deleted_at/i);
    expect(sql).not.toMatch(/^\s*DELETE FROM/i);
    expect(params).toEqual(['project:x:y']);
    expect(result).toBe(true);
  });

  it('only soft-deletes rows that are not already deleted', async () => {
    queryMock.mockResolvedValue([{ affectedRows: 0 }]);
    const result = await deleteContext('project:already:deleted');

    const [sql] = queryMock.mock.calls[0];
    expect(sql).toContain('deleted_at IS NULL');
    expect(result).toBe(false);
  });
});
