import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// The new app's half of scripts/ci/team-wide-read-check.js (#1183). PostgREST
// cuts a read off at 1000 rows and answers 200 with no error, so a team-wide
// read that does not page returns a short list that looks complete (#694). A
// team-wide read here goes through readAll() (data/query.ts). This lives in
// app/ rather than tests/ci because it reads TypeScript with the compiler the
// app already installs; the root's TypeScript 7 has no JavaScript API.
//
// The exemptions are the current site's, so a correct scoped read never trips:
//   - .single() / .maybeSingle(), one row by construction
//   - .eq('player_id' | 'id', ...), bounded by one player's own history
//   - .select(cols, { head: true }), a count with no rows to truncate
//   - .limit(n) with a literal n, an explicitly bounded read
//   - a `// team-read-guard: <reason>` comment on or just above the read
// The comment is also the escape for a read this cannot follow, such as a chain
// built across several statements.

const TEAM_COLUMN = 'team_id';
const PLAYER_COLUMNS = ['player_id', 'id'];
// Not team-scoped, but the catalog gains a raid, a dungeon pool and a crafted
// list every season (#1166), so reads of it page whether or not they filter.
const PAGED_TABLES = ['items'];
const HELPER = 'readAll';
const ANNOTATION = /team-read-guard:/;
const ANNOTATION_REACH = 3;

type Method = { name: string; call: ts.CallExpression };
type Finding = { line: number; table: string };

const literal = (node: ts.Node | undefined) =>
  node && (ts.isStringLiteralLike(node) || ts.isNumericLiteral(node) || node.kind === ts.SyntaxKind.TrueKeyword)
    ? ts.isNumericLiteral(node)
      ? Number(node.text)
      : node.kind === ts.SyntaxKind.TrueKeyword
        ? true
        : (node as ts.StringLiteralLike).text
    : undefined;

// x.from('t').select(c).eq('team_id', id) -> [from, select, eq]
function flatten(node: ts.CallExpression): Method[] {
  const methods: Method[] = [];
  let cur: ts.Expression = node;
  while (ts.isCallExpression(cur) && ts.isPropertyAccessExpression(cur.expression)) {
    methods.unshift({ name: cur.expression.name.text, call: cur });
    cur = cur.expression.expression;
  }
  return methods;
}

export function findUnguardedTeamWideReads(source: string, filename = 'x.ts'): Finding[] {
  // TSX reads `<T>` in `const pick = <T>(x: T) => x;` as a tag rather than a
  // type parameter, and can drop everything after it from the tree with no
  // error raised for it. Read .tsx as TSX (it needs JSX) and everything else
  // as plain TypeScript, and fail loudly rather than silently under-scan a
  // file that didn't parse the way it was read.
  const scriptKind = filename.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, scriptKind);
  const diagnostics = (sf as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? [];
  if (diagnostics.length) {
    const message = ts.flattenDiagnosticMessageText(diagnostics[0]!.messageText, '\n');
    throw new Error(`Could not parse ${filename}: ${message}`);
  }
  const annotated = new Set<number>();
  source.split('\n').forEach((text, i) => {
    if (ANNOTATION.test(text)) annotated.add(i + 1);
  });
  const lineOf = (pos: number) => sf.getLineAndCharacterOfPosition(pos).line + 1;

  const findings: Finding[] = [];
  const consumed = new Set<ts.Node>();

  function check(node: ts.CallExpression, methods: Method[], insideHelper: boolean) {
    const names = methods.map((m) => m.name);
    if (!names.includes('select')) return;
    if (names.includes('single') || names.includes('maybeSingle')) return;

    const headOnly = methods.some((m) => {
      if (m.name !== 'select') return false;
      const opts = m.call.arguments[1];
      return (
        !!opts &&
        ts.isObjectLiteralExpression(opts) &&
        opts.properties.some(
          (p) => ts.isPropertyAssignment(p) && p.name.getText(sf) === 'head' && literal(p.initializer) === true
        )
      );
    });
    if (headOnly) return;

    // .in('team_id', teamIds) reads every team named, same as .eq('team_id', t)
    // reads the one team named.
    const filteredOn = (col: string[]) =>
      methods.some((m) => (m.name === 'eq' || m.name === 'in') && col.includes(String(literal(m.call.arguments[0]))));
    const table = literal(methods[0]!.call.arguments[0]);
    const pagedTable = typeof table === 'string' && PAGED_TABLES.includes(table);
    if (!filteredOn([TEAM_COLUMN]) && !pagedTable) return;
    if (filteredOn(PLAYER_COLUMNS)) return;
    if (methods.some((m) => m.name === 'limit' && typeof literal(m.call.arguments[0]) === 'number')) return;
    if (insideHelper) return;

    const start = lineOf(node.getStart(sf));
    const end = lineOf(node.getEnd());
    for (let line = start - ANNOTATION_REACH; line <= end; line++) if (annotated.has(line)) return;

    findings.push({ line: start, table: typeof table === 'string' ? table : '<computed>' });
  }

  // readAll(cb) only pages if cb actually asks for the next batch: passes both
  // of its own parameters to .range(), and sorts on a column that never
  // repeats so a batch can't miss or repeat a row. A callback missing either
  // reads the same 1000 rows forever, the failure readAll's own page cap is a
  // backstop for, not a substitute for catching here. Only an inline callback
  // can be checked this way; a named function passed by reference still needs
  // the `// team-read-guard:` comment, same as today.
  function checkHelperCallback(node: ts.CallExpression) {
    const cb = node.arguments[0];
    if (!cb || !(ts.isArrowFunction(cb) || ts.isFunctionExpression(cb))) return;
    const params = cb.parameters.map((p) => p.name.getText(sf));
    let hasRange = false;
    let hasOrder = false;
    function scan(n: ts.Node) {
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
        const name = n.expression.name.text;
        if (name === 'range' && n.arguments.length === 2) {
          const args = n.arguments.map((a) => a.getText(sf));
          if (args[0] === params[0] && args[1] === params[1]) hasRange = true;
        }
        if (name === 'order') hasOrder = true;
      }
      ts.forEachChild(n, scan);
    }
    scan(cb.body);

    const start = lineOf(node.getStart(sf));
    if (hasRange && hasOrder) return;
    for (let line = start - ANNOTATION_REACH; line <= start; line++) if (annotated.has(line)) return;
    const missing = !hasRange && !hasOrder ? '.range(...) and .order(...)' : !hasRange ? '.range(...)' : '.order(...)';
    findings.push({ line: start, table: `readAll callback missing ${missing}` });
  }

  function visit(node: ts.Node, insideHelper: boolean) {
    let here = insideHelper;
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === HELPER) {
      here = true;
      checkHelperCallback(node);
    }
    if (ts.isCallExpression(node) && !consumed.has(node)) {
      const methods = flatten(node);
      if (methods.length && methods[0]!.name === 'from') {
        methods.forEach((m) => consumed.add(m.call));
        check(node, methods, here);
      }
    }
    ts.forEachChild(node, (child) => visit(child, here));
  }

  visit(sf, false);
  return findings.sort((a, b) => a.line - b.line);
}

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function list(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) list(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

describe('team-wide read guard (#1183)', () => {
  it('walks the app source', () => {
    expect(list(SRC).length).toBeGreaterThan(20);
  });

  it('pages every team-wide read through readAll, or says why not', () => {
    const findings = list(SRC).flatMap((file) =>
      findUnguardedTeamWideReads(readFileSync(file, 'utf8'), file).map(
        (f) => `${path.relative(SRC, file).split(path.sep).join('/')}:${f.line} ${f.table}`
      )
    );
    expect(
      findings,
      'team-wide read does not page; wrap it in readAll() (data/query.ts), bound it with a literal .limit(), or add `// team-read-guard: <why it stays under 1000 rows>`'
    ).toEqual([]);
  });

  describe('finds what it exists to catch', () => {
    it('flags a team-wide select that does not page', () => {
      const src = `const r = await client.from('attendance').select('id').eq('team_id', teamId);`;
      expect(findUnguardedTeamWideReads(src)).toEqual([{ line: 1, table: 'attendance' }]);
    });

    it('flags an unfiltered read of a paged table', () => {
      expect(findUnguardedTeamWideReads(`client.from('items').select('id, name')`)).toHaveLength(1);
    });

    it('passes a read inside readAll', () => {
      const src = `readAll((from, to) => client.from('attendance').select('id').eq('team_id', t).order('id').range(from, to));`;
      expect(findUnguardedTeamWideReads(src)).toEqual([]);
    });

    it('passes a readAll callback built across a few lines', () => {
      const src = `readAll((from, to) => {
        let q = client.from('attendance').select('id').eq('team_id', t);
        return q.order('id').range(from, to);
      });`;
      expect(findUnguardedTeamWideReads(src)).toEqual([]);
    });

    it('flags a readAll callback with no .range()', () => {
      const src = `readAll((from, to) => client.from('attendance').select('id').eq('team_id', t).order('id'));`;
      const findings = findUnguardedTeamWideReads(src);
      expect(findings).toHaveLength(1);
      expect(findings[0]!.table).toContain('.range');
    });

    it('flags a readAll callback with no .order()', () => {
      const src = `readAll((from, to) => client.from('attendance').select('id').eq('team_id', t).range(from, to));`;
      const findings = findUnguardedTeamWideReads(src);
      expect(findings).toHaveLength(1);
      expect(findings[0]!.table).toContain('.order');
    });

    it('lets a readAll callback declared as a named function use the annotation escape', () => {
      const src = `// team-read-guard: paging handled in namedPage\nreadAll(namedPage);`;
      expect(findUnguardedTeamWideReads(src)).toEqual([]);
    });

    it('flags a team-wide read spread across every team with .in()', () => {
      const src = `client.from('team_settings').select('id').in('team_id', teamIds)`;
      expect(findUnguardedTeamWideReads(src)).toHaveLength(1);
    });

    it('reads a .ts file as TypeScript, not TSX', () => {
      const src = `const pick = <T>(x: T) => x;\nclient.from('a').select('id').eq('team_id', t);`;
      expect(findUnguardedTeamWideReads(src, 'x.ts')).toHaveLength(1);
    });

    it('fails loudly on a file that does not parse', () => {
      expect(() => findUnguardedTeamWideReads('const x = {', 'broken.ts')).toThrow(/Could not parse/);
    });

    it('passes each named exemption', () => {
      const reads = [
        `client.from('a').select('id').eq('team_id', t).single()`,
        `client.from('a').select('id').eq('team_id', t).maybeSingle()`,
        `client.from('a').select('id').eq('team_id', t).eq('player_id', p)`,
        `client.from('a').select('id', { count: 'exact', head: true }).eq('team_id', t)`,
        `client.from('a').select('id').eq('team_id', t).limit(50)`,
        `// team-read-guard: a few dozen rows\nclient.from('a').select('id').eq('team_id', t)`
      ];
      for (const src of reads) expect(findUnguardedTeamWideReads(src), src).toEqual([]);
    });

    it('does not treat a variable limit as a bound', () => {
      expect(findUnguardedTeamWideReads(`client.from('a').select('id').eq('team_id', t).limit(n)`)).toHaveLength(1);
    });

    it('ignores a read with no team filter and writes', () => {
      expect(findUnguardedTeamWideReads(`client.from('teams').select('id').eq('guild_id', g)`)).toEqual([]);
      expect(findUnguardedTeamWideReads(`client.from('a').update({ x: 1 }).eq('team_id', t)`)).toEqual([]);
    });
  });
});
