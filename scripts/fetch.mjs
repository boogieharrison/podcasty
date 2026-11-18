// Zbiera najnowsze odcinki z kanałów wpisanych w channels.json
// i zapisuje je do data/episodes.json. Bez zależności, Node 20+.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHANNELS_FILE = path.join(ROOT, 'channels.json');
const DATA_DIR = path.join(ROOT, 'data');
const EPISODES_FILE = path.join(DATA_DIR, 'episodes.json');
const RESOLVED_FILE = path.join(DATA_DIR, 'resolved.json');

const MAX_PER_CHANNEL = 60; // ile odcinków na kanał trzymamy w historii
const MAX_DURATION_LOOKUPS = 40; // ile długości sprawdzamy w jednym przebiegu
const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

async function get(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': UA, 'accept-language': 'en-US,en;q=0.8' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} dla ${url}`);
  return res.text();
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function tag(xml, name) {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? decodeEntities(m[1].trim()) : '';
}

// Zwraca { title, entries: [{ id, title, published }] }
export function parseFeed(xml) {
  const [head, ...rest] = xml.split('<entry>');
  const entries = rest
    .map((chunk) => ({
      id: tag(chunk, 'yt:videoId'),
      title: tag(chunk, 'title'),
      published: tag(chunk, 'published'),
    }))
    .filter((e) => /^[\w-]{11}$/.test(e.id));
  return { title: tag(head, 'title'), entries };
}

// Z linku do kanału lub playlisty robi { kind, id }
export function parseChannelUrl(url) {
  const list = url.match(/[?&]list=([\w-]+)/);
  if (list) return { kind: 'playlist', id: list[1] };
  const ch = url.match(/\/channel\/(UC[\w-]{22})/);
  if (ch) return { kind: 'channel', id: ch[1] };
  return null;
}

export function findChannelId(html) {
  const patterns = [
    /<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/,
    /feeds\/videos\.xml\?channel_id=(UC[\w-]{22})/,
    /"externalId":"(UC[\w-]{22})"/,
    /"channelId":"(UC[\w-]{22})"/,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m) return m[1];
  }
  return null;
}

async function resolve(url, cache) {
  if (cache[url]) return cache[url];
  let target = parseChannelUrl(url);
  if (!target) {
    const id = findChannelId(await get(url));
    if (!id) throw new Error(`Nie udało się znaleźć ID kanału dla ${url}`);
    target = { kind: 'channel', id };
  }
  cache[url] = target;
  return target;
}

const feedUrl = (playlistId) =>
  `https://www.youtube.com/feeds/videos.xml?playlist_id=${playlistId}`;

async function fetchChannel(target) {
  if (target.kind === 'playlist') return parseFeed(await get(feedUrl(target.id)));
  const tail = target.id.slice(2);
  // UULF = zwykłe filmy bez shortsów, UULV = transmisje na żywo
  const results = await Promise.allSettled([
    get(feedUrl('UULF' + tail)),
    get(feedUrl('UULV' + tail)),
  ]);
  const feeds = results.filter((r) => r.status === 'fulfilled').map((r) => parseFeed(r.value));
  // Nazwę kanału bierzemy z głównego kanału RSS; służy też jako zapas,
  // gdyby listy bez shortsów nie odpowiedziały.
  let main = null;
  try {
    main = parseFeed(
      await get(`https://www.youtube.com/feeds/videos.xml?channel_id=${target.id}`),
    );
  } catch (err) {
    if (!feeds.length) throw err;
  }
  if (!feeds.length) return main;
  return { title: main?.title || feeds[0].title, entries: feeds.flatMap((f) => f.entries) };
}

async function fetchDuration(id) {
  try {
    const html = await get(`https://www.youtube.com/watch?v=${id}`);
    const m = html.match(/"lengthSeconds":"(\d+)"/);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

async function main() {
  const list = await readJson(CHANNELS_FILE, []);
  const previous = await readJson(EPISODES_FILE, { channels: [], episodes: [] });
  const resolved = await readJson(RESOLVED_FILE, {});
  const known = new Map(previous.episodes.map((e) => [e.id, e]));

  const channels = [];
  const episodes = [];
  let lookups = 0;
  let failures = 0;

  for (const item of list) {
    const url = typeof item === 'string' ? item : item.url;
    if (!url) continue;
    const oldChannel = previous.channels.find((c) => c.url === url);
    try {
      const target = await resolve(url, resolved);
      const feed = await fetchChannel(target);
      const key = target.id;
      const title = (typeof item === 'object' && item.name) || feed.title || url;
      channels.push({ key, title, url });

      const merged = new Map();
      for (const e of previous.episodes) if (e.channel === key) merged.set(e.id, e);
      for (const e of feed.entries) {
        const old = known.get(e.id);
        merged.set(e.id, {
          id: e.id,
          title: e.title,
          channel: key,
          published: e.published,
          duration: old?.duration ?? null,
        });
      }
      const sorted = [...merged.values()]
        .sort((a, b) => b.published.localeCompare(a.published))
        .slice(0, MAX_PER_CHANNEL);
      for (const e of sorted) {
        if (e.duration == null && lookups < MAX_DURATION_LOOKUPS) {
          lookups += 1;
          e.duration = await fetchDuration(e.id);
        }
        episodes.push(e);
      }
      console.log(`OK  ${title}: ${feed.entries.length} w kanale RSS`);
    } catch (err) {
      failures += 1;
      console.error(`BŁĄD  ${url}: ${err.message}`);
      // Kanał chwilowo niedostępny: zostawiamy to, co już mieliśmy.
      if (oldChannel) {
        channels.push(oldChannel);
        episodes.push(...previous.episodes.filter((e) => e.channel === oldChannel.key));
      }
    }
  }

  episodes.sort((a, b) => b.published.localeCompare(a.published));
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(RESOLVED_FILE, JSON.stringify(resolved, null, 2) + '\n');
  await writeFile(
    EPISODES_FILE,
    JSON.stringify({ updatedAt: new Date().toISOString(), channels, episodes }, null, 1) + '\n',
  );
  console.log(`Zapisano ${episodes.length} odcinków z ${channels.length} kanałów.`);
  if (list.length && failures === list.length) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
