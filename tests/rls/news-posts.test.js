// #1523: news posts. Anyone reads published posts, Staff (site admins) read
// drafts and write; the news-pictures bucket takes uploads from Staff only.
//
// Each test runs in one rolled-back transaction (helpers.js withTxn).
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn, SITE_ADMIN, OFFICER_T1, RAIDER_T1, RLS_DENIED } from './helpers.js';

afterAll(() => pool.end());

const draft = (q) =>
  q("insert into public.news_posts (slug, title, category, summary) values ('a-draft', 'A draft', 'Fix', 'Soon.')");
const published = (q) =>
  q(
    "insert into public.news_posts (slug, title, category, summary, published_at) values ('out-now', 'Out now', 'Feature', 'Here.', now()) returning id"
  );
const slugs = async (run) => (await run("select slug from public.news_posts where slug in ('a-draft', 'out-now')")).rows.map((r) => r.slug).sort();

describe('news posts', () => {
  it('holds every news.json entry, published, with its pin and version', async () => {
    await withTxn(async ({ asAnon }) => {
      const res = await asAnon('select count(*)::int as n, count(*) filter (where pinned)::int as pinned from public.news_posts');
      expect(res.rows[0]).toEqual({ n: 27, pinned: 1 });
      const cal = await asAnon("select category, version, summary from public.news_posts where slug = 'raid-calendar-a-day-view-for-every-raid-night'");
      expect(cal.rows[0]).toMatchObject({ category: 'Feature', version: '3.93.0' });
      expect(cal.rows[0].summary).toMatch(/^There's a Calendar now/);
    });
  });

  it('shows a published post to everyone and a draft only to Staff', async () => {
    await withTxn(async ({ q, asAnon, asUser }) => {
      await draft(q);
      await published(q);
      expect(await slugs(asAnon)).toEqual(['out-now']);
      expect(await slugs((t) => asUser(RAIDER_T1, t))).toEqual(['out-now']);
      expect(await slugs((t) => asUser(OFFICER_T1, t))).toEqual(['out-now']);
      expect(await slugs((t) => asUser(SITE_ADMIN, t))).toEqual(['a-draft', 'out-now']);
    });
  });

  it('lets Staff write, edit, publish and delete a post, signed as themselves', async () => {
    await withTxn(async ({ q, asUser }) => {
      const me = (await q("select id from public.people where auth_user_id = $1", [SITE_ADMIN])).rows[0]?.id ?? null;
      const ins = await asUser(
        SITE_ADMIN,
        "insert into public.news_posts (slug, title, category, summary) values ('staff-post', 'Staff post', 'Announcement', 'Hi.') returning written_by"
      );
      expect(ins.rows[0].written_by).toBe(me);
      await asUser(SITE_ADMIN, "update public.news_posts set pinned = true, published_at = now() where slug = 'staff-post'");
      expect((await q("select pinned, published_at is not null as live from public.news_posts where slug = 'staff-post'")).rows[0]).toEqual({ pinned: true, live: true });
      await asUser(SITE_ADMIN, "delete from public.news_posts where slug = 'staff-post'");
      expect((await q("select 1 from public.news_posts where slug = 'staff-post'")).rowCount).toBe(0);
    });
  });

  it('refuses a post from anyone but Staff, and a post signed as someone else', async () => {
    await withTxn(async ({ q, asAnon, asUser }) => {
      const add = "insert into public.news_posts (slug, title, category, summary) values ('nope', 'Nope', 'Fix', 'No.')";
      await expect(asUser(OFFICER_T1, add)).rejects.toMatchObject({ code: RLS_DENIED });
      await expect(asAnon(add)).rejects.toMatchObject({ code: RLS_DENIED });
      const other = (await q("select id from public.people where auth_user_id is distinct from $1 limit 1", [SITE_ADMIN])).rows[0].id;
      await expect(
        asUser(SITE_ADMIN, `insert into public.news_posts (slug, title, category, summary, written_by) values ('forged', 'F', 'Fix', 'F.', ${other})`)
      ).rejects.toMatchObject({ code: RLS_DENIED });
    });
  });

  it("leaves a post alone when someone else edits or deletes it", async () => {
    await withTxn(async ({ q, asUser }) => {
      await published(q);
      await asUser(OFFICER_T1, "update public.news_posts set title = 'Hijacked' where slug = 'out-now'");
      await asUser(RAIDER_T1, "delete from public.news_posts where slug = 'out-now'");
      expect((await q("select title from public.news_posts where slug = 'out-now'")).rows[0].title).toBe('Out now');
    });
  });

  it('takes a picture upload from Staff only', async () => {
    await withTxn(async ({ asUser }) => {
      const put = (name) =>
        `insert into storage.objects (bucket_id, name, owner_id) values ('news-pictures', '${name}', auth.uid()::text)`;
      await asUser(SITE_ADMIN, put('cover.png'));
      await expect(asUser(OFFICER_T1, put('mine.png'))).rejects.toMatchObject({ code: RLS_DENIED });
    });
  });
});
