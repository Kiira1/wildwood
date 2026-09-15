import { expect, it } from 'vitest';
import ts from 'typescript';
import { localLegacyColumns, preserveLocalColumns } from './local-dev-workspace.mjs';

function schema(type = 'U64', extra = false) {
  return { sections: [
    { Typespace: { types: [{ Product: { elements: [
      { name: { some: 'chat_hearts_received' }, algebraic_type: { [type]: [] } },
      ...(extra ? [{ name: { some: 'other' }, algebraic_type: { String: [] } }] : []),
    ] } }] } },
    { Tables: [{ source_name: 'playerLifetime', product_type_ref: 0 }] },
  ] };
}

it('retains only known legacy columns, rejecting incompatible types or ordering', () => {
  expect(Object.keys(localLegacyColumns(schema()))).toEqual(['playerLifetime']);
  expect(() => localLegacyColumns(schema('String'))).toThrow('Unexpected legacy column');
  expect(() => localLegacyColumns(schema('U64', true))).toThrow('Unexpected legacy column');
  expect(localLegacyColumns({ sections: [{ Typespace: { types: [] } }, { Tables: [] }] })).toEqual({});
  expect(() => localLegacyColumns({})).toThrow('Unrecognized local database schema');
});

it('keeps old values on updates and supplies defaults for new rows', () => {
  const source = `
    const playerLifetime = table({}, { identity: t.identity() });
    ctx.db.playerLifetime.insert({ identity: 'new' });
    ctx.db.playerLifetime.identity.update({ identity: 'old', playedMicros: 20n });
    ctx.db.playerLifetime.identity.update({ identity: 'old', chatHeartsReceived: 7n });
    return playerLifetime;
  `;
  const transformed = preserveLocalColumns(source, localLegacyColumns(schema()));
  const calls: any[] = [];
  const db = { playerLifetime: {
    insert: (row: any) => calls.push(row),
    identity: { find: () => ({ chatHeartsReceived: 9n }), update: (row: any) => calls.push(row) },
  } };
  const js = ts.transpileModule(transformed, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const row = new Function('ctx', 'table', 't', js)({ db }, (_options: any, row: any) => row,
    { identity: () => 'identity', u64: () => ({ default: () => 'u64' }) });
  expect(row.chatHeartsReceived).toBe('u64');
  expect(calls.map(row => row.chatHeartsReceived)).toEqual([0n, 9n, 7n]);
});

it('leaves normal schemas and unrelated table writes unchanged', () => {
  const source = 'ctx.db.playerProgress.insert({ damage: 3 });';
  expect(preserveLocalColumns(source, localLegacyColumns(schema()))).toBe(source);
  expect(preserveLocalColumns('const chatMessage = table({}, {});', {})).toBe('const chatMessage = table({}, {});');
});
