# Voiceover brief — Dreamcatcher demo

For a TTS or voice-cloning model. Paste everything from **Prompt** down.

The cut is `demo/dreamcatcher-demo.mp4`, **92.75 s**, 1920×1080, 30 fps, with a
silent stereo AAC track already in place. Every line below is timed against
that file. The film carries on-screen cards, so the read is deliberately
sparse — roughly 170 words in a minute and a half. Do not fill the gaps.

---

## Prompt

You are recording a voiceover for a 93-second product film about a
risk-control tool for on-chain perpetual futures. Produce a single continuous
audio track with the timings given below.

### Voice

A calm, unhurried, technically literate narrator. Think documentary or an
engineering conference talk, not an advertisement. Mid-range, warm, dry.
Neutral English; British or American both work, but stay consistent.

### Delivery rules

- Pace about **150 words per minute**. Never rush to fill a window.
- **Statements end down.** No upspeak, no rising inflection on declaratives.
- No emphatic selling. Do not punch words like "never", "only" or "exactly" —
  the sentences already carry them.
- Leave a real breath (350–500 ms) at every em dash and full stop.
- Lower the energy slightly for the final two sections. The film ends on what
  the product does *not* do, and that should sound like candour, not apology.
- No smiling tone, no warmth-on-command, no "excited to share".

### Pronunciation

- **Dreamcatcher** — one word, even stress, DREAM-catcher.
- **dreamDEX** — "dream decks".
- **Somnia** — SOM-nee-uh.
- **Hideki** — hee-DEH-kee.
- **placeOrderFor** — say it as three plain words: "place order for".
- **immediate-or-cancel** — say it in full, never "I-O-C".
- **fifty-eight thousand** — words, not digits.
- Read no hexadecimal, no block numbers and no transaction hashes. They are
  on screen; speaking them wastes the window.

### Timing

Times are from the first frame. Start each line at its in-point, ±0.2 s. The
out-point is a hard ceiling: a line that runs past it collides with the next
card. Where a window is longer than the line needs, let the extra be silence.

**0.00 – 4.45 — silence.** The title card opens cold. Do not speak over it.

**6.20 – 14.60**
> Several hundred perp positions a day are closed by the liquidation engine.
> You get whatever the book offers, plus a penalty.

**17.00 – 25.00**
> Dreamcatcher cuts a slice earlier, at a price you choose. The ring is your
> position; the web tightens as margin degrades.

**26.80 – 29.00**
> Any perp market on the venue.

**30.60 – 38.90**
> One function on one market — place order for — through dreamDEX's own
> operator registry. It can reduce only. It can never withdraw.

**41.30 – 46.60**
> Most of what a protective tool does is decline to act. So the screen asks
> the contract what a check would do, and prints its answer.

**48.60 – 50.40**
> Above trigger.

**53.80 – 58.00**
> The account crossed into margin call, and the watch cut it.

**58.60 – 63.00**
> Requested fifty-eight thousand base units. Filled fifty-eight thousand.
> Settled on Somnia.

**65.10 – 70.50**
> It isn't one lucky transaction. Two reductions, both read from the dreamDEX
> indexer.

**71.60 – 76.80**
> Below them, recent checks — a live tail, not an archive. The screen says so.

**79.00 – 87.20**
> It isn't protection. It reduces at a price you chose. No keeper runs it, and
> nothing fires on its own — not yet.

**89.30 – 92.30**
> Dreamcatcher. Live on Somnia Hideki.

### Hard constraints

Never say, in any phrasing, improvised or otherwise:

- "protected", "safe", "liquidation-proof", "guaranteed"
- "24/7", "always on", "automatically", "reactive" (in the present tense)
- any figure for money or losses saved
- anything about dreamDEX's volume, users, or endorsement

Read the lines as written. Do not paraphrase, do not add a sign-off, do not
add a call to action.

### Output

- 48 kHz, mono, 24-bit WAV.
- Normalise to about **−16 LUFS** integrated, true peak no higher than −1.5 dBTP.
- Total length exactly 92.75 s, silence preserved at the head and in every gap.
- No music, no room tone, no processing beyond light de-essing.

---

## Muxing it in

```bash
ffmpeg -i demo/dreamcatcher-demo.mp4 -i voiceover.wav \
  -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k -shortest \
  demo/dreamcatcher-demo-vo.mp4
```

If the read drifts, nudge the whole track rather than re-cutting the picture:
`-itsoffset 0.3` before `-i voiceover.wav`.
