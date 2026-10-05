import { describe, expect, it } from 'vitest';
import { fakeClient } from './fakeSupabase';

describe('fakeClient writes', () => {
  it('records an insert, an update and a delete with their filters, and answers each from the write handler', async () => {
    const client = fakeClient({
      write: (w) => (w.method === 'delete' ? { error: { message: 'Not allowed', code: '42501' } } : { data: null })
    });

    const inserted = await client.from('names').insert({ team_id: 1, label: 'Ashka' });
    const updated = await client.from('names').update({ label: 'Ashkara' }).eq('id', 3);
    const deleted = await client.from('names').delete().eq('id', 4);

    expect(client.writes).toEqual([
      { table: 'names', method: 'insert', values: { team_id: 1, label: 'Ashka' }, filters: [] },
      { table: 'names', method: 'update', values: { label: 'Ashkara' }, filters: [['eq', 'id', 3]] },
      { table: 'names', method: 'delete', values: undefined, filters: [['eq', 'id', 4]] }
    ]);
    expect([inserted.error, updated.error, deleted.error]).toEqual([
      null,
      null,
      { message: 'Not allowed', code: '42501' }
    ]);
    expect(client.reads).toEqual([]);
  });

  it('answers a write with no handler as a success with no data', async () => {
    const client = fakeClient({});
    const result = await client.from('names').delete().eq('id', 1);
    expect([result.data, result.error]).toEqual([null, null]);
  });
});
