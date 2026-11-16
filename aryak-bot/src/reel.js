// A Reel from a design (the owner, 15/11: «a moving video inside the design, zooming on the parts that show the film's texture»).
// No AI video: the design picture itself, filmed by a slow camera move with ffmpeg: a push-in on the room towards the main film,
// a cut to the close-up of the film's texture, and an end card with each film's swatch and code, the logo and the WhatsApp number.
// Vertical 1080 x 1920 at 30 frames a second, H.264 with a silent sound track (Instagram wants one), about 11 seconds.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** The ffmpeg program: FFMPEG_PATH, the bundled ffmpeg-static, or the system's own. */
export async function ffmpegPath() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try { const p = (await import('ffmpeg-static')).default; if (p && fs.existsSync(p)) return p; } catch { /* not installed */ }
  return 'ffmpeg';
}

// The server is small (1 GB, live test 15/11: a 2x zoom froze it): ffmpeg runs at the lowest priority, on one thread, and is stopped
// after [limitMs]; a Reel is skipped when the machine has too little free memory to make it without starving the bot.
function run(bin, args, limitMs = 240000) {
  return new Promise((resolve, reject) => {
    const nice = process.platform === 'linux';
    const ch = spawn(nice ? 'nice' : bin, nice ? ['-n', '19', bin, ...args] : args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    const timer = setTimeout(() => { err += ' (stopped: too slow)'; ch.kill('SIGKILL'); }, limitMs);
    ch.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
    ch.on('error', (e) => { clearTimeout(timer); reject(e); });
    ch.on('close', (code) => { clearTimeout(timer); if (code === 0) resolve(); else reject(new Error(`ffmpeg failed (${code}): ${err.split('\n').slice(-3).join(' ')}`)); });
  });
}
export const REEL_MIN_FREE_MB = 300;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : (lo + hi) / 2));

/**
 * The end card: the dark ARYAK ground, the logo (white), each film's swatch and code, the WhatsApp number. A PNG 1080 x 1920.
 * [codes] [{ code, swatch }], [logo] the black logo PNG, [font] a font file, [line] the words under the codes.
 */
export async function endCard({ codes = [], logo = null, font = '', line = '' }) {
  const sharp = (await import('sharp')).default;
  const W = 1080; const H = 1920;
  const comps = [];
  const text = async (t, size, colour = '#ffffff') => sharp({ text: { text: `<span foreground="${colour}">${String(t).replace(/[<&>]/g, '')}</span>`, font: `IBM Plex Sans SemiBold ${size}`, ...(font ? { fontfile: font } : {}), dpi: 72, rgba: true } }).png().toBuffer();
  if (logo) {
    const lg = await sharp(logo).resize({ width: 420 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let i = 0; i < lg.data.length; i += 4) { lg.data[i] = 255; lg.data[i + 1] = 255; lg.data[i + 2] = 255; }
    comps.push({ input: await sharp(lg.data, { raw: { width: lg.info.width, height: lg.info.height, channels: 4 } }).png().toBuffer(), top: 300, left: Math.round((W - lg.info.width) / 2) });
  }
  const sw = codes.length > 2 ? 240 : 300;
  const gap = 50;
  const total = codes.length * sw + (codes.length - 1) * gap;
  let x = Math.round((W - total) / 2);
  for (const c of codes) {
    if (c.swatch) comps.push({ input: await sharp(c.swatch).resize(sw, sw, { fit: 'cover' }).extend({ top: 3, bottom: 3, left: 3, right: 3, background: '#ffffff' }).png().toBuffer(), top: 860, left: x - 3 });
    const t = await text(c.code, 58);
    const tm = await sharp(t).metadata();
    comps.push({ input: t, top: 860 + sw + 40, left: x + Math.round((sw - tm.width) / 2) });
    x += sw + gap;
  }
  if (line) {
    const t = await text(line, 46, '#d6b25e');
    const tm = await sharp(t).metadata();
    comps.push({ input: t, top: 1560, left: Math.max(20, Math.round((W - tm.width) / 2)) });
  }
  return sharp({ create: { width: W, height: H, channels: 4, background: { r: 20, g: 17, b: 14, alpha: 1 } } }).composite(comps).png().toBuffer();
}

/**
 * The colour pairing cards (the owner, 16/11, from a reel he liked: «WOOD + WHITE» tiles, then the room): a warm off-white ground with each
 * film's swatch as a rounded tile and its code under it. Two frames: the first tile alone, then all of them with «+» between, so the pair
 * builds. PNGs 1080 x 1920.
 */
export async function pairCards({ codes = [], font = '' }) {
  const sharp = (await import('sharp')).default;
  const W = 1080; const H = 1920;
  const tiles = codes.filter((c) => c?.swatch).slice(0, 3);
  if (tiles.length < 2) return [];
  const size = tiles.length === 3 ? 290 : 400; const gap = tiles.length === 3 ? 70 : 110;
  const top = 760;
  const text = async (t, px, colour) => sharp({ text: { text: `<span foreground="${colour}">${String(t).replace(/[<&>]/g, '')}</span>`, font: `IBM Plex Sans SemiBold ${px}`, ...(font ? { fontfile: font } : {}), dpi: 72, rgba: true } }).png().toBuffer();
  const round = Buffer.from(`<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${Math.round(size * 0.12)}" ry="${Math.round(size * 0.12)}"/></svg>`);
  const shadow = await sharp({ create: { width: size + 80, height: size + 80, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: Buffer.from(`<svg width="${size + 80}" height="${size + 80}"><rect x="40" y="52" width="${size}" height="${size}" rx="${Math.round(size * 0.12)}" fill="rgba(60,40,20,0.28)"/></svg>`) }]).blur(18).png().toBuffer();
  const frame = async (count) => {
    const comps = [];
    const total = count * size + (count - 1) * gap; // the tiles shown are centred: the first alone, then all
    let x = Math.round((W - total) / 2);
    for (let k = 0; k < count; k++) {
      {
        const tile = await sharp(tiles[k].swatch).resize(size, size, { fit: 'cover' }).composite([{ input: round, blend: 'dest-in' }]).png().toBuffer();
        comps.push({ input: shadow, top: top - 40, left: x - 40 }, { input: tile, top, left: x });
        const t = await text(tiles[k].code, 54, '#2b2622'); const tm = await sharp(t).metadata();
        comps.push({ input: t, top: top + size + 44, left: x + Math.round((size - tm.width) / 2) });
      }
      if (k < count - 1) {
        const plus = await text('+', 96, '#8a7a66'); const pm = await sharp(plus).metadata();
        comps.push({ input: plus, top: top + Math.round((size - pm.height) / 2), left: x + size + Math.round((gap - pm.width) / 2) });
      }
      x += size + gap;
    }
    return sharp({ create: { width: W, height: H, channels: 3, background: '#F4EFE8' } }).composite(comps).jpeg({ quality: 92 }).toBuffer();
  };
  return [await frame(1), await frame(tiles.length)];
}

/**
 * The Reel: [room] and [detail] pictures (4:5), [focus] { x, y } (0..1) where the camera pushes in on the room, [overlay] a transparent
 * PNG 1080 x 1920 laid over the two moving parts (the logo and the band of codes), [card] the end card. Returns the MP4.
 */
export async function makeReel({ room, detail = null, details = null, views = [], motion = 'zoom', hook = null, before = null, intro = [], reveal = null, focus = { x: 0.5, y: 0.5 }, overlay = null, card, music = null, seconds = { room: 5, detail: 4, card: 3 } }) {
  if (os.freemem() / 1048576 < REEL_MIN_FREE_MB && os.totalmem() / 1048576 < 4096) throw new Error(`too little free memory for a Reel (${Math.round(os.freemem() / 1048576)} MB)`);
  // the close-ups, one per film (the owner, 15/11: up to three films, wood grain longer and closer): [{ image, seconds, zoom }]
  const shots = (details || (detail ? [{ image: detail, seconds: seconds.detail, zoom: 0.12 }] : [])).filter((d) => d?.image).slice(0, 3);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reel-'));
  try {
    const put = (name, buf) => { const f = path.join(dir, name); fs.writeFileSync(f, buf); return f; };
    const fps = 30;
    const fx = clamp(focus?.x, 0.15, 0.85); const fy = clamp(focus?.y, 0.15, 0.85);
    const args = ['-y', '-loglevel', 'error'];
    const n = (x) => Math.round(x * fps);
    // each still is enlarged a little above the frame first, so the slow zoom moves smoothly (1.25x: twice froze the 1 GB server)
    const move = (i, frames, zoom, cx, cy) => `[${i}:v]scale=1350:2400:force_original_aspect_ratio=increase,crop=1350:2400,setsar=1,`
      + `zoompan=z='1+${zoom}*on/${frames}':x='(iw-iw/zoom)*${cx}':y='(ih-ih/zoom)*${cy}':d=${frames}:s=1080x1920:fps=${fps},setsar=1,format=yuv420p`;
    // the sideways move: a fixed small enlargement, the window travelling from one side to the other (every other shot the other way)
    const pan = (i, frames, toRight) => `[${i}:v]scale=1350:2400:force_original_aspect_ratio=increase,crop=1350:2400,setsar=1,`
      + `zoompan=z='1.18':x='(iw-iw/zoom)*${toRight ? '' : '(1-'}on/${frames}${toRight ? '' : ')'}':y='(ih-ih/zoom)*0.5':d=${frames}:s=1080x1920:fps=${fps},setsar=1,format=yuv420p`;
    // «the camera turns in the room, not a zoom» (the owner, 15/11): with motion 'orbit' each still is crossed by a slow sideways move,
    // and [views] (the same room from other camera places) follow the room, so the camera seems to walk around it
    const orbit = motion === 'orbit';
    const angles = orbit ? views.filter(Boolean).slice(0, 3) : [];
    // the shots in order: [hook] (the film's texture very close, the first 1.5 s that stop the scroll), [before] (the room before ARYAK,
    // wiped away by the room after), the room, its other views, the close-ups
    const seq = [];
    // the pairing cards first (they are the hook), each held a moment on a gentle push
    intro.filter(Boolean).slice(0, 2).forEach((c, k) => seq.push({ file: put(`intro${k}.jpg`, c), sec: seconds.intro || 1.35, make: (i, f) => move(i, f, 0.04, 0.5, 0.45) }));
    if (hook) seq.push({ file: put('hook.jpg', hook), sec: seconds.hook || 1.6, make: (i, f) => move(i, f, 0.3, 0.5, 0.5) });
    if (before) seq.push({ file: put('before.jpg', before), sec: seconds.before || 2.6, make: (i, f) => move(i, f, 0.06, 0.5, 0.5) });
    seq.push({ file: put('room.jpg', room), sec: seconds.room, make: (i, f) => (orbit ? pan(i, f, true) : move(i, f, 0.22, fx, fy)), cut: before ? 'wipeleft' : 'fade' });
    // the function reveal (the owner, 16/11): the same room with its doors open, dissolved in slowly after the room
    if (reveal) seq.push({ file: put('reveal.jpg', reveal), sec: seconds.reveal || 3.6, make: (i, f) => (orbit ? pan(i, f, false) : move(i, f, 0.1, fx, fy)), cut: 'dissolve' });
    angles.forEach((v, k) => seq.push({ file: put(`view${k}.jpg`, v), sec: seconds.view || seconds.room, make: (i, f) => pan(i, f, k % 2 === 1) }));
    shots.forEach((d, k) => seq.push({ file: put(`detail${k}.jpg`, d.image), sec: d.seconds || seconds.detail, make: (i, f) => (orbit ? pan(i, f, k % 2 === 0) : move(i, f, d.zoom ?? 0.12, 0.5, 0.5)) }));
    for (const x of seq) args.push('-i', x.file);
    args.push('-i', put('card.png', card));
    const cardIn = seq.length;
    if (overlay) args.push('-i', put('overlay.png', overlay));
    // the sound: the design's own music (an MP3, faded in and out), or silence (Instagram wants a sound track)
    if (music) args.push('-i', put('music.mp3', music)); else args.push('-f', 'lavfi', '-t', '60', '-i', 'anullsrc=r=44100:cl=stereo');
    const fade = 0.6;
    const parts = [`${seq[0].make(0, n(seq[0].sec))}[m0]`];
    let last = 'm0'; let t = seq[0].sec;
    for (let i = 1; i < seq.length; i++) {
      parts.push(`${seq[i].make(i, n(seq[i].sec))}[s${i}]`);
      parts.push(`[${last}][s${i}]xfade=transition=${seq[i].cut || 'fade'}:duration=${fade}:offset=${(t - fade).toFixed(2)}[m${i}]`);
      last = `m${i}`; t += seq[i].sec - fade;
    }
    const moving = t; // the overlay stays on the moving parts only
    if (overlay) { parts.push(`[${last}][${cardIn + 1}:v]overlay=0:0:enable='lt(t,${(moving - fade).toFixed(2)})'[o]`); last = 'o'; }
    parts.push(`[${cardIn}:v]loop=loop=${n(seconds.card)}:size=1:start=0,setpts=N/${fps}/TB,fps=${fps},scale=1080:1920,setsar=1,format=yuv420p[c]`);
    parts.push(`[${last}][c]xfade=transition=fade:duration=${fade}:offset=${(t - fade).toFixed(2)}[v]`);
    const total = t + seconds.card - fade;
    const audio = overlay ? cardIn + 2 : cardIn + 1;
    parts.push(`[${audio}:a]atrim=0:${total.toFixed(2)},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.4,afade=t=out:st=${Math.max(0, total - 1.5).toFixed(2)}:d=1.5[s]`);
    args.push('-filter_threads', '1', '-filter_complex_threads', '1', '-filter_complex', parts.join(';'), '-map', '[v]', '-map', '[s]', '-t', total.toFixed(2),
      '-c:v', 'libx264', '-preset', 'veryfast', '-threads', '1', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(fps), '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', path.join(dir, 'reel.mp4'));
    await run(await ffmpegPath(), args, 360000);
    return fs.readFileSync(path.join(dir, 'reel.mp4'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
