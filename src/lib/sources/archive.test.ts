import { describe, expect, it } from 'vitest';

import fixture from './__fixtures__/archive-metadata.json';
import {
  downloadUrl,
  formatBytes,
  formatSeconds,
  parseArchiveMetadata,
  parseLength,
  sortTracks,
  trackTitle,
  type ArchiveTrack,
} from './archive';

const ID = 'bag-of-items-all-the-breaks-1-2-3';

describe('archive.org metadata parsing', () => {
  const item = parseArchiveMetadata(fixture, ID);

  it('reads the item header', () => {
    expect(item.identifier).toBe(ID);
    expect(item.title).toContain('All The Breaks');
    expect(item.creator).toBeTruthy();
    expect(item.detailsUrl).toBe(`https://archive.org/details/${ID}`);
  });

  it('keeps only the MP3 renditions', () => {
    // The item carries Flac, WAVE, PNG spectrograms and metadata alongside.
    expect(item.tracks.length).toBe(4);
    expect(item.tracks.every((t) => t.name.endsWith('.mp3'))).toBe(true);
  });

  it('builds URLs that survive spaces and commas in the path', () => {
    const url = item.tracks[0].url;
    expect(url.startsWith(`https://archive.org/download/${ID}/`)).toBe(true);
    expect(url).not.toMatch(/[ ,]/);
    // The directory separator must stay a real slash, not %2F.
    expect(url.split('/').length).toBeGreaterThan(5);
  });

  it('reads durations and sizes', () => {
    expect(item.tracks.every((t) => t.seconds > 0)).toBe(true);
    expect(item.tracks.every((t) => t.bytes > 0)).toBe(true);
  });

  it('survives junk input rather than throwing', () => {
    expect(parseArchiveMetadata({}, ID).tracks).toEqual([]);
    expect(parseArchiveMetadata(null, ID).tracks).toEqual([]);
    expect(parseArchiveMetadata({ files: [{ format: 'VBR MP3' }] }, ID).tracks).toEqual([]);
  });
});

describe('sortTracks', () => {
  const track = (title: string, seconds: number): ArchiveTrack => ({
    name: `${title}.mp3`,
    title,
    seconds,
    bytes: seconds * 1000,
    url: `https://example.com/${title}.mp3`,
  });

  const tracks = [track('Delta', 12), track('alpha', 30), track('Charlie', 4), track('Bravo', 12)];

  it('sorts by name, case-insensitively', () => {
    expect(sortTracks(tracks, 'title').map((t) => t.title)).toEqual([
      'alpha',
      'Bravo',
      'Charlie',
      'Delta',
    ]);
  });

  it('sorts shortest and longest first', () => {
    expect(sortTracks(tracks, 'shortest').map((t) => t.seconds)).toEqual([4, 12, 12, 30]);
    expect(sortTracks(tracks, 'longest').map((t) => t.seconds)).toEqual([30, 12, 12, 4]);
  });

  it('breaks ties on title so equal lengths are not arbitrary', () => {
    // Bravo and Delta are both 12s; they must stay in name order either way.
    expect(sortTracks(tracks, 'shortest').map((t) => t.title)).toEqual([
      'Charlie',
      'Bravo',
      'Delta',
      'alpha',
    ]);
    expect(sortTracks(tracks, 'longest').map((t) => t.title)).toEqual([
      'alpha',
      'Bravo',
      'Delta',
      'Charlie',
    ]);
  });

  it('orders numbered titles naturally', () => {
    const numbered = [track('Break 10', 1), track('Break 2', 1), track('Break 1', 1)];
    expect(sortTracks(numbered, 'title').map((t) => t.title)).toEqual([
      'Break 1',
      'Break 2',
      'Break 10',
    ]);
  });

  it('does not mutate its input', () => {
    const before = tracks.map((t) => t.title);
    sortTracks(tracks, 'longest');
    expect(tracks.map((t) => t.title)).toEqual(before);
  });
});

describe('helpers', () => {
  it('parses the length formats archive.org uses', () => {
    expect(parseLength('00:05')).toBe(5);
    expect(parseLength('2:30')).toBe(150);
    expect(parseLength('1:02:03')).toBe(3723);
    expect(parseLength('5.28')).toBeCloseTo(5.28, 2);
    expect(parseLength(undefined)).toBe(0);
  });

  it('strips folder, extension and track number from titles', () => {
    expect(trackTitle('Some Album/01 Artist - Track.mp3')).toBe('Artist - Track');
    expect(trackTitle('07. Another One.mp3')).toBe('Another One');
    expect(trackTitle('plain.mp3')).toBe('plain');
    // A name that is only a number must not become empty.
    expect(trackTitle('12.mp3')).toBe('12');
  });

  it('encodes each path segment independently', () => {
    const url = downloadUrl('an id', 'a dir/a file.mp3');
    expect(url).toBe('https://archive.org/download/an%20id/a%20dir/a%20file.mp3');
  });

  it('formats durations and sizes for display', () => {
    expect(formatSeconds(5)).toBe('0:05');
    expect(formatSeconds(95)).toBe('1:35');
    expect(formatSeconds(0)).toBe('—');
    expect(formatBytes(101462)).toBe('99 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatBytes(0)).toBe('—');
  });
});
