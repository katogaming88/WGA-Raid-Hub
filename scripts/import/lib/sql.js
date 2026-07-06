// SQL literal builders for the #320 import generators.
//
// Everything the generators emit goes through these so quoting is handled in
// exactly one place. Values come from CSV exports of the Google Sheets, i.e.
// arbitrary user text (notes, item names with apostrophes).

export function sqlString(value) {
  if (value === null || value === undefined || value === '') return 'null';
  return "'" + String(value).replace(/'/g, "''") + "'";
}

export function sqlBool(value) {
  return value ? 'true' : 'false';
}

// Numeric or null. Rejects NaN/Infinity loudly rather than emitting them.
export function sqlNumber(value) {
  if (value === null || value === undefined || value === '') return 'null';
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`Not a finite number: ${JSON.stringify(value)}`);
  }
  return String(n);
}

// Accepts 'yyyy-MM-dd' or 'yyyy/MM/dd', emits a quoted ISO date or null.
export function sqlDate(value) {
  const s = String(value || '').trim();
  if (!s) return 'null';
  const m = s.match(/^(\d{4})[/-](\d{2})[/-](\d{2})/);
  if (!m) throw new Error(`Unrecognized date: ${JSON.stringify(value)}`);
  return `'${m[1]}-${m[2]}-${m[3]}'`;
}

// jsonb literal from a plain object; keys with empty values are dropped.
export function sqlJsonb(obj) {
  const compact = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== null && v !== undefined && v !== '') compact[k] = v;
  }
  return sqlString(JSON.stringify(compact)) + '::jsonb';
}

// A multi-row INSERT with an optional conflict clause.
export function insertStatement(table, columns, valueRows, conflictClause) {
  if (!valueRows.length) return `-- ${table}: no rows\n`;
  const lines = [
    `insert into ${table} (${columns.join(', ')})`,
    'values',
    valueRows.map((r) => `  (${r.join(', ')})`).join(',\n')
  ];
  if (conflictClause) lines.push(conflictClause);
  return lines.join('\n') + ';\n';
}

// Idempotent multi-row INSERT for tables with no unique key (audit_log,
// request queues): a correlated NOT EXISTS on the aliased VALUES filters out
// rows already applied. `existsCondition` references v.<column> names.
export function insertWhereNotExists(table, columns, valueRows, existsCondition) {
  if (!valueRows.length) return `-- ${table}: no rows\n`;
  return (
    `insert into ${table} (${columns.join(', ')})\n` +
    `select ${columns.map((c) => `v.${c}`).join(', ')}\n` +
    `from (values\n` +
    valueRows.map((r) => `  (${r.join(', ')})`).join(',\n') +
    `\n) as v(${columns.join(', ')})\n` +
    `where not exists (\n  select 1 from ${table} t where ${existsCondition}\n);\n`
  );
}
