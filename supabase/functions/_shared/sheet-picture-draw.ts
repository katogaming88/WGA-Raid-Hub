// Turns the signup sheet's picture (sheet-picture.ts) into a PNG (#983), with
// resvg's WebAssembly build. The fonts (Onest, the new app's typeface, as
// static TTFs under assets/fonts) and the spec icons (app/public/spec-icons)
// are read from the repo's main branch, the way the sheet's banner is, and
// kept for the life of the function instance.
//
// Anything here that fails throws; the caller posts the text sheet instead.
import { Resvg, initWasm } from 'npm:@resvg/resvg-wasm@2.6.2';
import { type Picture, pictureSvg, specIconKey } from './sheet-picture.ts';

const RESVG_WASM = 'https://cdn.jsdelivr.net/npm/@resvg/resvg-wasm@2.6.2/index_bg.wasm';
const REPO = 'https://raw.githubusercontent.com/katogaming88/WGA-Raid-Hub/main/';
// Each weight in two subsets: basic Latin, and the accented letters raiders'
// names use (Spoonsakimbö, Twañ).
const FONTS = ['latin-400', 'latin-700', 'latin-ext-400', 'latin-ext-700'].map(
  (f) => `${REPO}assets/fonts/onest-${f}.ttf`
);
const DEADLINE_MS = 8_000;

let ready: Promise<Uint8Array[]> | null = null;
const icons = new Map<string, string>();

async function bytes(fetcher: typeof fetch, url: string): Promise<Uint8Array> {
  const res = await fetcher(url, { signal: AbortSignal.timeout(DEADLINE_MS) });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

// The renderer and the fonts, once per instance. A failed start is forgotten,
// so the next run tries again.
function start(fetcher: typeof fetch): Promise<Uint8Array[]> {
  ready ??= (async () => {
    await initWasm(fetcher(RESVG_WASM, { signal: AbortSignal.timeout(DEADLINE_MS) }));
    return await Promise.all(FONTS.map((url) => bytes(fetcher, url)));
  })().catch((err) => {
    ready = null;
    throw err;
  });
  return ready;
}

function dataUrl(data: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < data.length; i += 0x8000) binary += String.fromCharCode(...data.subarray(i, i + 0x8000));
  return 'data:image/jpeg;base64,' + btoa(binary);
}

// The icons this picture needs; one that can't be read is left out, which
// only costs that raider's icon.
async function iconsFor(fetcher: typeof fetch, picture: Picture): Promise<Map<string, string>> {
  const keys = new Set(picture.groups.flatMap((g) => g.raiders.map((r) => specIconKey(r.className, r.spec))));
  await Promise.all(
    [...keys]
      .filter((k) => !icons.has(k))
      .map(async (k) => {
        try {
          icons.set(k, dataUrl(await bytes(fetcher, `${REPO}app/public/spec-icons/${k}.jpg`)));
        } catch {
          // no icon for this one
        }
      })
  );
  return icons;
}

// Any of the bot's pictures as a PNG: the sheet's roster and the weekly
// lineup's grid (#1709) both draw through here.
export async function drawSvg(svg: string, fetcher: typeof fetch = fetch): Promise<Uint8Array> {
  const fonts = await start(fetcher);
  const resvg = new Resvg(svg, {
    font: { fontBuffers: fonts, defaultFontFamily: 'Onest', loadSystemFonts: false }
  });
  return resvg.render().asPng();
}

export async function drawPicture(picture: Picture, fetcher: typeof fetch = fetch): Promise<Uint8Array> {
  return drawSvg(pictureSvg(picture, await iconsFor(fetcher, picture)), fetcher);
}
