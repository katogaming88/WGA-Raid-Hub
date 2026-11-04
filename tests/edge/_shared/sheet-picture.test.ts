// The signup sheet as a drawn picture (#983): who it shows, what the drawing
// says, and how a sheet with a picture is posted, edited, left alone when
// nothing changed, and sent as text when the drawing fails.
import { assert, assertEquals } from 'jsr:@std/assert@1';
import {
  type Picture,
  countsLine,
  pictureAltText,
  pictureKey,
  pictureOf,
  pictureSvg,
  specIconKey
} from '../../../supabase/functions/_shared/sheet-picture.ts';
import { type RosterRow, type SheetContext, syncSheet } from '../../../supabase/functions/_shared/signup-sheet.ts';
import { CHANNEL, RAID, SHEET, TEAM, fakeDiscord, fakeSheets } from '../_support/sheets.ts';

const NOW = new Date('2026-11-03T14:00:00.000Z');
const player = (id: number, name: string, role: string, className: string, spec: string, over = {}): RosterRow => ({
  id,
  nameRealm: `${name}-Stormrage`,
  nickname: null,
  isBench: false,
  role,
  className,
  spec,
  ...over
});
const ROSTER = [
  player(1, 'Fluffy', 'Tank', 'Warrior', 'Protection'),
  player(2, 'Noc', 'Ranged', 'Shaman', 'Elemental'),
  player(3, 'Brooke', 'Heal', 'Priest', 'Holy'),
  player(4, 'Katorrí', 'Ranged', 'Warlock', 'Demonology', { nickname: 'Kat' }),
  player(5, 'Benchy', 'Melee', 'Rogue', 'Subtlety', { isBench: true }),
  player(6, 'Nospec', 'Melee', '', '')
];

Deno.test('the picture shows who is in, by role, Late marked, the bench and anyone out left to the text', () => {
  // Nospec has a role but no class or spec: drawn, with no icon.
  const picture = pictureOf(
    ROSTER,
    [
      { playerId: 2, status: 'Late' },
      { playerId: 3, status: 'Absent' }
    ],
    RAID
  );
  assertEquals(picture, {
    groups: [
      { label: 'Tanks', raiders: [{ name: 'Fluffy', className: 'Warrior', spec: 'Protection', late: false }] },
      { label: 'Melee', raiders: [{ name: 'Nospec', className: '', spec: '', late: false }] },
      {
        label: 'Ranged',
        raiders: [
          { name: 'Kat', className: 'Warlock', spec: 'Demonology', late: false },
          { name: 'Noc', className: 'Shaman', spec: 'Elemental', late: true }
        ]
      }
    ]
  });
  assertEquals(countsLine(picture), 'Tanks 1 · Melee 1 · Ranged 2');
  assertEquals(pictureAltText(picture), 'Tanks: Fluffy. Melee: Nospec. Ranged: Kat, Noc (Late).');
});

Deno.test('an optional night shows only who said Attending or Late', () => {
  const picture = pictureOf(ROSTER, [{ playerId: 1, status: 'Attending' }], { ...RAID, isOptional: true });
  assertEquals(
    picture.groups.flatMap((g) => g.raiders.map((r) => r.name)),
    ['Fluffy']
  );
});

Deno.test('the drawing names each raider in its class colour with the spec, escapes text, and cuts long names', () => {
  const picture: Picture = {
    groups: [
      {
        label: 'Melee',
        raiders: [
          { name: 'Tom & <Jerry>', className: 'Rogue', spec: 'Subtlety', late: true },
          { name: 'Spoonsakimböxyz', className: 'Death Knight', spec: 'Frost', late: false }
        ]
      }
    ]
  };
  const svg = pictureSvg(picture, new Map([[specIconKey('Rogue', 'Subtlety'), 'data:image/jpeg;base64,AAAA']]));
  assert(svg.includes('fill="#fff468">Tom &amp; &lt;Jerry&gt;</text>'));
  assert(svg.includes('· Late'));
  assert(svg.includes('Spoonsakimböx…'));
  assert(svg.includes('fill="#e55870"'));
  // One icon given, one image drawn.
  assertEquals(svg.split('<image ').length - 1, 1);
  assertEquals(specIconKey('Demon Hunter', 'Havoc'), 'demon-hunter-havoc');
});

Deno.test('the key changes with what the picture shows, and only then', async () => {
  const a = pictureOf(ROSTER, [], RAID);
  const b = pictureOf(ROSTER, [{ playerId: 2, status: 'Late' }], RAID);
  assertEquals(await pictureKey(a, { x: 1 }), await pictureKey(a, { x: 1 }));
  assert((await pictureKey(a, { x: 1 })) !== (await pictureKey(b, { x: 1 })));
  assert((await pictureKey(a, { x: 1 })) !== (await pictureKey(a, { x: 2 })));
});

// -- A sheet with a picture ---------------------------------------------------

const PNG = new Uint8Array([137, 80, 78, 71]);
const MSG = `/channels/${CHANNEL}/messages`;

function context(rows = {}, routes = {}, draw: SheetContext['draw'] = () => Promise.resolve(PNG)) {
  const sheets = fakeSheets({ nights: { '2026-11-03': RAID }, roster: ROSTER, rows });
  const discord = fakeDiscord(routes);
  const ctx: SheetContext = { db: sheets.db, discord: discord.call, now: NOW, emojis: new Map(), draw };
  return { ctx, calls: discord.calls };
}

Deno.test('a new sheet is posted with its picture, which takes the role columns’ place', async () => {
  const { ctx, calls } = context();
  assertEquals(await syncSheet(ctx, TEAM, SHEET, '2026-11-03', { create: true }), 'posted');
  const post = calls.find((c) => c.key === `POST ${MSG}`)!;
  const file = post.files![0].name;
  assert(/^sheet-[0-9a-f]{12}\.png$/.test(file));
  assertEquals(post.files![0].data, PNG);
  assertEquals(post.body.attachments, [
    { id: 0, filename: file, description: 'Tanks: Fluffy. Healers: Brooke. Melee: Nospec. Ranged: Kat, Noc.' }
  ]);
  assertEquals(post.body.embeds[0].image.url, `attachment://${file}`);
  // The counts stay in the text; the role columns don't.
  assert(post.body.embeds[0].description.endsWith('Tanks 1 · Healers 1 · Melee 1 · Ranged 2'));
  assertEquals(
    post.body.embeds[0].fields.map((f: { name: string }) => f.name),
    ['Other answers']
  );
});

Deno.test('a posted sheet already showing this picture is left alone: nothing drawn, nothing sent', async () => {
  let drawn = 0;
  const first = context({}, {}, () => {
    drawn++;
    return Promise.resolve(PNG);
  });
  await syncSheet(first.ctx, TEAM, SHEET, '2026-11-03', { create: true });
  const file = first.calls.find((c) => c.key === `POST ${MSG}`)!.files![0].name;
  const again = context(
    { '2026-11-03': { channelId: CHANNEL, messageId: 'm1' } },
    { [`GET ${MSG}/m1`]: { status: 200, body: { embeds: [{ image: { url: `https://cdn.test/a/${file}?ex=1` } }] } } },
    () => {
      drawn++;
      return Promise.resolve(PNG);
    }
  );
  assertEquals(await syncSheet(again.ctx, TEAM, SHEET, '2026-11-03', { create: false }), 'unchanged');
  assertEquals(
    again.calls.map((c) => c.key),
    [`GET ${MSG}/m1`]
  );
  assertEquals(drawn, 1);
});

Deno.test('a changed sheet is drawn again and sent with its new picture', async () => {
  const { ctx, calls } = context(
    { '2026-11-03': { channelId: CHANNEL, messageId: 'm1' } },
    {
      [`GET ${MSG}/m1`]: {
        status: 200,
        body: { embeds: [{ image: { url: 'https://cdn.test/sheet-000000000000.png' } }] }
      }
    }
  );
  assertEquals(await syncSheet(ctx, TEAM, SHEET, '2026-11-03', { create: false }), 'edited');
  const edit = calls.find((c) => c.key === `PATCH ${MSG}/m1`)!;
  assertEquals(edit.body.attachments[0].filename, edit.files![0].name);
  assert(edit.body.attachments[0].description.startsWith('Tanks: Fluffy.'));
});

Deno.test('a drawing that fails sends the text sheet, and takes an old picture off', async () => {
  const { ctx, calls } = context({ '2026-11-03': { channelId: CHANNEL, messageId: 'm1' } }, {}, () =>
    Promise.reject(new Error('no fonts'))
  );
  assertEquals(await syncSheet(ctx, TEAM, SHEET, '2026-11-03', { create: false }), 'edited');
  const edit = calls.find((c) => c.key === `PATCH ${MSG}/m1`)!;
  assertEquals(edit.files, undefined);
  assertEquals(edit.body.attachments, []);
  assert(edit.body.embeds[0].fields.some((f: { name: string }) => f.name.startsWith('Tank')));
});
