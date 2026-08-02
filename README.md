# Amenizerizer

**[Open the app →](https://prehensile.github.io/amenizerizer/)**

Injects a sample into [nitro2k01's Amenizer](https://blog.gg8.se/wordpress/2013/02/11/gameboy-project-week-6-can-i-have-an-a-men).

*Amenizer* is a 2013 homebrew Game Boy ROM: a sample masher with 
no menus and no screen, just a looped sample of the Amen breakbeat and some
controls for mashing and rearranging the loop in real time. It's really fun :)

It's possible to replace the Amen loop in the ROM with any sample you like,
via a little sample conversion and ROM hacking. The browser app in this repo 
wraps that process in a nice UI and can provide a new `.gb` file for download
with a replaced sample inside. The result runs in any emulator, or on a flash
cart in a real Game Boy.

Everything happens in your browser. Nothing is uploaded, and there is no server —
the app ships with the original ROM and rewrites it locally.

## Using it

**1. Source audio.** Drop in an audio file, or browse a collection of classic
breaks hosted on archive.org. One bar works best — a bar is what the cartridge
holds, and it gets divided into the sixteen slices the d-pad rearranges.

Then trim. The waveform's dividers quarter your current selection: click one to
narrow to it, click again to go finer, shift-click to span several. Drag for a
freehand selection, or drag an edge to nudge it. **Select all** starts over.

**2. Encode.** The Game Boy plays 4-bit audio at about 25 kHz. Getting a sample
to survive conversion is tricky, but Amenizerizer's default conversion settings
should work for most loops. If your loop sounds noisy, see 
[Sounds noisy?](#sounds-noisy) below.

The one choice worth understanding is **Length**:

- **Fit selection to one bar** stretches your selection to exactly one bar, so
  the slices land on sixteenths. This changes the pitch. It is what you want for
  a loop.
- **Keep pitch** resamples at the true ratio and pads or truncates to fit.

You can also retune the whole cartridge. The playback rate and the bar's tempo
are the same dial: drop the rate and everything gets slower and lower together.
Tick **Patch the ROM's boot rate** and set a BPM, and the downloaded ROM boots
at that speed.

**3. Slice tables.** Sixteen patterns of sixteen steps, one per d-pad
combination, each step choosing which slice plays. The stock patterns are loaded
by default; edit them or write your own. Most people can skip this panel.

**4. Play.** Audition through a re-implementation of the cartridge's engine.
Use the on-screen pad or your keyboard — arrow keys, <kbd>Z</kbd> for B,
<kbd>X</kbd> for A, <kbd>⏎</kbd> for Start. Held buttons respond live, the same
way they would on hardware:

| Hold | Does |
|---|---|
| **D-pad** | selects a slice-rearrangement pattern — each of the 15 combinations is a different one |
| **Start** | plays the loop straight, in order |
| **B** + Up/Down | the repeater: stutter and granular chatter, three depths |
| **A** + Left/Right | shortens or lengthens the decay on each slice |
| **Select** + Up/Down | retunes on the fly |

**5. Export.** **Download .gb** gives you the cartridge. You can also save the
encoded sample as a WAV to hear exactly what got written, or save a render of the
engine's output.

Load the `.gb` in an emulator, or write it to a flash cart. Only the sample, the
slice tables and — if you asked for it — the playback rate are changed; the rest
of the cartridge is untouched, so everything else it does still works.

## Sounds noisy?

The Game Boy has sixteen volume steps. Every noise problem comes from that.
Think of it as drawing with sixteen shades of grey: use only the middle four and
it looks blocky — use all sixteen and it looks fine.

There is a fixed amount of noise sitting under your sample and you cannot remove
it. You get two moves: make the noise quieter, or make the sample louder so the
noise matters less. **The second works better.**

The defaults already do most of this for you. They high-pass at 80 Hz, because
deep bass eats those sixteen steps and you cannot hear it on a Game Boy speaker
anyway; they drive the level 2× into a soft clip, which is the single biggest
win; and they leave dither off. So the main thing left to you is to **trim tight**
to the part you want looping.

If it still sounds wrong, work out which noise you have:

| What you hear | What it is | What to do |
|---|---|---|
| A steady hiss, there even in the gaps | The sample is too quiet, or dither is on | Drive **up**, dither **off** |
| A crunchy, gritty texture on cymbal tails and fades | The sixteen steps becoming audible as the sound decays | Dither **on** at 0.3–0.5, or try Noise-shaped |

Chase one too hard and you summon the other. Dense, busy loops mask the grit and
want no dither; sparse material with long tails is the case that needs it.

Three things look useful and mostly aren't:

- **Normalise** only looks at the single loudest peak, so one stray snare stops
  it doing anything. Drive is what raises the overall level.
- **Noise-shaped** dither is not a "less noise" setting despite the name. It
  moves noise up into the treble — measurably about 5 dB quieter below 1 kHz for
  8 dB louder around 10 kHz. Good against grittiness, worse for hiss.
- **Loop-seam fade** only fixes the click where the loop wraps around.

Short version: loud and slightly distorted beats quiet and clean. Sixteen steps
is so few that you want to use every one of them.

## Running it locally

Svelte 5 + TypeScript + Vite. No backend, no API keys, no accounts.

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # unit tests, no browser needed
npm run build    # static bundle into dist/
```

Pushing to `main` runs the tests and deploys to GitHub Pages.

Under the hood: the sample encoder (resampling, level, quantisation) and the
Game Boy playback engine are both plain TypeScript with no browser
dependencies, so they can be tested directly against the real cartridge. The
engine exists twice over — once for offline rendering and once as an
AudioWorklet for live play — and a test asserts the two agree sample for sample.

Notes on how the cartridge works and how this was built are in
[notes/](notes/); [CLAUDE.md](CLAUDE.md) is the working brief for AI coding
agents.

## Credits

[*Amenizer* by nitro2k01](https://blog.gg8.se/wordpress/2013/02/11/gameboy-project-week-6-can-i-have-an-a-men/). The ROM is included here as the original released build, unmodified until
you patch it. All the interesting decisions in the cartridge are theirs; this
tool just fills in the sample.

[gb-amenizer-flask](https://github.com/Chiptune-Anamnesis/gb-amenizer-flask) by [eggstoastbacon](https://github.com/eggstoastbacon) was the inspiration for Amenizerizer. It's a Flask app that
takes a headerless 8-bit raw loop, converts it to 4-bit and injects it into the
ROM server-side.

The breaks collection in the source panel is
[Bag of Items: All The Breaks 1, 2, 3](https://archive.org/details/bag-of-items-all-the-breaks-1-2-3)
on archive.org.

## AI disclosure
Amenizerizer was made using [Claude Code](https://code.claude.com/docs/en/overview).