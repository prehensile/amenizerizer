/**
 * archive.org item browsing.
 *
 * Workable from a purely client-side app because `archive.org/metadata/<id>`
 * and the `/download/` endpoint both send `Access-Control-Allow-Origin: *`,
 * and that header survives the 302 to the storage node. Any sample host
 * without CORS is off the table — the browser blocks the read outright, and
 * no amount of app code changes that.
 */

export interface ArchiveTrack {
  /** Path within the item, as archive.org stores it. */
  name: string;
  /** Cleaned-up display name. */
  title: string;
  seconds: number;
  bytes: number;
  url: string;
}

export interface ArchiveItem {
  identifier: string;
  title: string;
  creator: string;
  detailsUrl: string;
  tracks: ArchiveTrack[];
}

interface RawFile {
  name?: string;
  format?: string;
  length?: string;
  size?: string;
}

/** MP3 is ~10x smaller than the WAVE/Flac copies and decodes just as well. */
const PREFERRED_FORMAT = 'VBR MP3';

export function downloadUrl(identifier: string, name: string): string {
  // Each path segment is encoded separately so the directory slash survives.
  const path = name.split('/').map(encodeURIComponent).join('/');
  return `https://archive.org/download/${encodeURIComponent(identifier)}/${path}`;
}

/** "00:05", "1:02:03" and bare "5.28" all appear in archive.org metadata. */
export function parseLength(length: string | undefined): number {
  if (!length) return 0;
  if (!length.includes(':')) return Number.parseFloat(length) || 0;
  return length
    .split(':')
    .reduce((acc, part) => acc * 60 + (Number.parseFloat(part) || 0), 0);
}

/** Drop the containing folder, the extension and any leading track number. */
export function trackTitle(name: string): string {
  const base = name.slice(name.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '');
  return base.replace(/^\d+[\s.\-_]+/, '').trim() || base;
}

export function parseArchiveMetadata(json: unknown, identifier: string): ArchiveItem {
  const data = (json ?? {}) as { metadata?: Record<string, unknown>; files?: RawFile[] };
  const meta = data.metadata ?? {};
  const asText = (v: unknown) => (Array.isArray(v) ? v.join(', ') : typeof v === 'string' ? v : '');

  const tracks: ArchiveTrack[] = (data.files ?? [])
    .filter((f): f is RawFile & { name: string } => Boolean(f?.name) && f.format === PREFERRED_FORMAT)
    .map((f) => ({
      name: f.name,
      title: trackTitle(f.name),
      seconds: parseLength(f.length),
      bytes: Number.parseInt(f.size ?? '0', 10) || 0,
      url: downloadUrl(identifier, f.name),
    }));

  return {
    identifier,
    title: asText(meta.title) || identifier,
    creator: asText(meta.creator),
    detailsUrl: `https://archive.org/details/${encodeURIComponent(identifier)}`,
    tracks,
  };
}

export async function fetchArchiveItem(
  identifier: string,
  signal?: AbortSignal,
): Promise<ArchiveItem> {
  const res = await fetch(`https://archive.org/metadata/${encodeURIComponent(identifier)}`, {
    signal,
  });
  if (!res.ok) throw new Error(`archive.org returned ${res.status}`);
  const json = await res.json();
  const item = parseArchiveMetadata(json, identifier);
  if (item.tracks.length === 0) {
    throw new Error(`No ${PREFERRED_FORMAT} files in "${identifier}".`);
  }
  return item;
}

export async function fetchTrackBytes(
  track: ArchiveTrack,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  const res = await fetch(track.url, { signal });
  if (!res.ok) throw new Error(`Could not download "${track.title}" (${res.status}).`);
  return res.arrayBuffer();
}

export type SortMode = 'title' | 'shortest' | 'longest';

export const SORT_LABELS: Record<SortMode, string> = {
  title: 'Name (A–Z)',
  shortest: 'Shortest first',
  longest: 'Longest first',
};

/** Numeric-aware so "Break 2" sorts before "Break 10". */
function byTitle(a: ArchiveTrack, b: ArchiveTrack): number {
  return a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' });
}

/** Returns a new array; title breaks ties so the order is never arbitrary. */
export function sortTracks(tracks: ArchiveTrack[], mode: SortMode): ArchiveTrack[] {
  const out = [...tracks];
  if (mode === 'title') return out.sort(byTitle);
  const dir = mode === 'shortest' ? 1 : -1;
  return out.sort((a, b) => (a.seconds - b.seconds) * dir || byTitle(a, b));
}

export function formatSeconds(s: number): string {
  if (!s) return '—';
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return m > 0 ? `${m}:${String(sec).padStart(2, '0')}` : `0:${String(sec).padStart(2, '0')}`;
}

export function formatBytes(b: number): string {
  if (!b) return '—';
  return b < 1024 * 1024 ? `${Math.round(b / 1024)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`;
}
