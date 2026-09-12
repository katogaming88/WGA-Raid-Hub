// The table the `functions` job in .github/workflows/deploy.yml appends to
// the run summary after a deploy (#1083): `supabase functions list -o json`
// on stdin, markdown out. Epoch milliseconds in, minutes out.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function summaryTable(listed) {
  const rows = (Array.isArray(listed) ? listed : listed.functions || [])
    .slice()
    .sort((a, b) => a.slug.localeCompare(b.slug));
  if (rows.length === 0) return '\nNo functions listed.';
  const lines = ['', '| Function | Version | Updated |', '|---|---|---|'];
  for (const fn of rows) {
    const when = new Date(fn.updated_at).toISOString().slice(0, 16).replace('T', ' ');
    lines.push(`| ${fn.slug} | ${fn.version} | ${when} |`);
  }
  return lines.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(summaryTable(JSON.parse(readFileSync(0, 'utf8'))));
}
