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

/** What a video holds: { width, height, seconds, sound } from ffmpeg's own report. */
export async function probeVideo(file) {
  const bin = await ffmpegPath();
  const err = await new Promise((resolve) => {
    const ch = spawn(bin, ['-hide_banner', '-i', file], { stdio: ['ignore', 'ignore', 'pipe'] });
    let e = ''; ch.stderr.on('data', (d) => { e += d; }); ch.on('close', () => resolve(e)); ch.on('error', () => resolve(e));
  });
  const d = err.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
  const v = err.match(/Video:.*?(\d{2,5})x(\d{2,5})/);
  if (!d || !v) throw new Error('not a video');
  return { seconds: +d[1] * 3600 + +d[2] * 60 + +d[3], width: +v[1], height: +v[2], sound: /Audio:/.test(err) };
}

/**
 * A vertical Reel from a video the owner made in Gemini (the owner, 21/11: the app makes 10-second landscape videos, «make the Reel 15
 * seconds»): the whole video in the middle of a 1080 x 1920 frame over a blurred, darkened copy of itself (no label of it is cut), the
 * logo above it, the codes and the WhatsApp line below it, then the end card ([card](lastFrame) -> PNG) up to [seconds]. The video's own
 * sound goes on; kept [music] comes in under the end card. A video that is already vertical and long enough (plain Gemini's 15 s portrait,
 * 22/11) fills the frame and gets Atossa's words on it (dressTall): the logo, each film's code and name, the WhatsApp line and the end logo.
 */
export async function verticalReel({ video, seconds = 15, logo = null, font = '', codes = [], labels = [], tallLabels = true, tagline = '', line = '', card = null, music = null }) {
  if (os.freemem() / 1048576 < REEL_MIN_FREE_MB && os.totalmem() / 1048576 < 4096) throw new Error(`too little free memory for a Reel (${Math.round(os.freemem() / 1048576)} MB)`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vert-'));
  try {
    const put = (name, buf) => { const f = path.join(dir, name); fs.writeFileSync(f, buf); return f; };
    const src = put('in.mp4', video);
    const info = await probeVideo(src);
    const tall = info.height > info.width;
    const cardSec = Math.max(0, Math.min(6, seconds - info.seconds));
    const vidSec = Math.min(info.seconds, seconds); // a Gemini video extended to 20 s is cut to the Reel's 15 (the owner, 21/11)
    if (tall && cardSec < 1) {
      const rows = !tallLabels ? [] : labels.length ? labels : codes.map((c) => ({ code: c, name: '' })); // a video with Gemini's own labels (23/11) gets no second set
      if (!logo && !rows.length && !line && info.seconds <= seconds + 0.2) return video;
      return await dressTall({ src, dir, info, seconds: vidSec, logo, font, labels: rows, tagline, line, music });
    }
    const sharp = (await import('sharp')).default;
    const W = 1080; const H = 1920;
    const vh = tall ? H : Math.round(W * info.height / info.width / 2) * 2; // the video's height in the frame
    const top = Math.round((H - vh) / 2);
    // the words around the video, in the blurred bands above and below it
    const comps = [];
    const text = async (t, px, colour) => sharp({ text: { text: `<span foreground="${colour}">${String(t).replace(/[<&>]/g, '')}</span>`, font: `IBM Plex Sans SemiBold ${px}`, ...(font ? { fontfile: font } : {}), dpi: 72, rgba: true } }).png().toBuffer();
    if (!tall && logo) {
      const lg = await sharp(logo).resize({ width: 300 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      for (let i = 0; i < lg.data.length; i += 4) { lg.data[i] = 255; lg.data[i + 1] = 255; lg.data[i + 2] = 255; }
      comps.push({ input: await sharp(lg.data, { raw: { width: lg.info.width, height: lg.info.height, channels: 4 } }).png().toBuffer(), top: Math.max(120, top - 90 - lg.info.height), left: Math.round((W - lg.info.width) / 2) });
    }
    const under = top + vh + 70;
    if (!tall && codes.length) {
      const t = await text(codes.join('     '), 56, '#ffffff'); const m = await sharp(t).metadata();
      comps.push({ input: t, top: under, left: Math.max(20, Math.round((W - m.width) / 2)) });
    }
    if (!tall && line) {
      const t = await text(line, 44, '#d6b25e'); const m = await sharp(t).metadata();
      comps.push({ input: t, top: under + (codes.length ? 100 : 0), left: Math.max(20, Math.round((W - m.width) / 2)) });
    }
    const words = put('words.png', await sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(comps).png().toBuffer());
    const bin = await ffmpegPath();
    const args = ['-y', '-loglevel', 'error', '-i', src, '-loop', '1', '-i', words];
    const fc = [
      `[0:v]fps=30,split[a][b]`,
      `[a]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=24:2,eq=brightness=-0.18[bg]`,
      `[b]scale=${W}:${H}:force_original_aspect_ratio=decrease,setsar=1[fg]`,
      `[bg][fg]overlay=(W-w)/2:(H-h)/2[m]`,
      `[m][1:v]overlay=0:0:shortest=1,format=yuv420p,setsar=1[v0]`,
    ];
    let vout = '[v0]';
    let n = 2;
    if (cardSec >= 1 && card) {
      const lastFile = path.join(dir, 'last.jpg');
      // the room before its own end words appear, blurred well, so no word of the video shows behind the card's words
      await run(bin, ['-y', '-loglevel', 'error', '-ss', Math.max(0, info.seconds - 2.8).toFixed(2), '-i', src, '-frames:v', '1', lastFile], 60000);
      const ground = await sharp(fs.readFileSync(lastFile)).resize(W, H, { fit: 'cover' }).blur(28).jpeg({ quality: 90 }).toBuffer();
      const cardFile = put('card.png', await card(ground));
      args.push('-loop', '1', '-t', cardSec.toFixed(2), '-i', cardFile);
      fc.push(`[${n}:v]scale=${W}:${H},fps=30,format=yuv420p,setsar=1,fade=t=in:st=0:d=0.5[v1]`, `[v0][v1]concat=n=2:v=1:a=0[vv]`);
      vout = '[vv]'; n += 1;
    }
    const total = vidSec + (cardSec >= 1 && card ? cardSec : 0);
    // the sound: the video's own, then kept music faded in under the end card; a silent track when there is none (Instagram wants one)
    const own = info.sound ? `[0:a]aresample=48000,apad=whole_dur=${total.toFixed(2)}[own]` : `anullsrc=r=48000:cl=stereo,atrim=0:${total.toFixed(2)}[own]`;
    fc.push(own);
    let aout = '[own]';
    if (music && total > info.seconds + 0.5) {
      args.push('-i', put('music.mp3', music));
      const start = Math.max(0, info.seconds - 0.6);
      fc.push(`[${n}:a]aresample=48000,atrim=0:${(total - start).toFixed(2)},afade=t=in:st=0:d=0.8,volume=0.8,adelay=${Math.round(start * 1000)}:all=1[mus]`, `[own][mus]amix=inputs=2:duration=first:normalize=0[mix]`);
      aout = '[mix]'; n += 1;
    }
    fc.push(`${aout}afade=t=out:st=${Math.max(0, total - 1).toFixed(2)}:d=1[aa]`);
    const out = path.join(dir, 'out.mp4');
    args.push('-filter_complex', fc.join(';'), '-map', vout, '-map', '[aa]', '-t', total.toFixed(2), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-threads', '1', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', out);
    await run(bin, args, 420000);
    return fs.readFileSync(out);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

/**
 * Atossa's words on a vertical Gemini video (the owner, 22/11; Gemini's own advice: make the video clean and put the codes, the
 * callouts and the phone number on afterwards, so every letter is right and the brand's font stays the same): the video fills the
 * 1080 x 1920 frame; the white logo on top; at the foot, over a soft dark fade, each film's code and name and the WhatsApp line; for the
 * last 3 seconds the room darkens a little under a large logo and the [tagline]. Everything stays inside the Reel's safe area.
 */
async function dressTall({ src, dir, info, seconds, logo = null, font = '', labels = [], tagline = '', line = '', music = null }) {
  const sharp = (await import('sharp')).default;
  const W = 1080; const H = 1920;
  const text = async (t, px, colour) => sharp({ text: { text: `<span foreground="${colour}">${String(t).replace(/[<&>]/g, '')}</span>`, font: `IBM Plex Sans SemiBold ${px}`, ...(font ? { fontfile: font } : {}), dpi: 72, rgba: true } }).png().toBuffer();
  const white = async (buf, width, height) => {
    const lg = await sharp(buf).resize({ width, height, fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let i = 0; i < lg.data.length; i += 4) { lg.data[i] = 255; lg.data[i + 1] = 255; lg.data[i + 2] = 255; }
    return { input: await sharp(lg.data, { raw: { width: lg.info.width, height: lg.info.height, channels: 4 } }).png().toBuffer(), width: lg.info.width, height: lg.info.height };
  };
  const centre = async (buf, top) => { const m = await sharp(buf).metadata(); return { input: buf, top, left: Math.max(24, Math.round((W - m.width) / 2)) }; };
  // the words over the whole video
  const comps = [];
  const fade = Buffer.from(`<svg width="${W}" height="${H}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0.58" stop-color="#000" stop-opacity="0"/><stop offset="0.86" stop-color="#000" stop-opacity="0.55"/></linearGradient></defs><rect width="${W}" height="${H}" fill="url(#g)"/></svg>`);
  comps.push({ input: fade, top: 0, left: 0 });
  if (logo) { const l = await white(logo, 230, 120); comps.push({ input: l.input, top: 250, left: Math.round((W - l.width) / 2) }); }
  const rows = labels.slice(0, 3);
  const rowH = 62;
  let y = 1500 - (rows.length * rowH + (line ? 70 : 0)); // the block ends at the safe bottom
  for (const r of rows) {
    const t = await text(`${r.code}${r.name ? `   ${String(r.name).toUpperCase()}` : ''}`, 46, '#ffffff');
    comps.push(await centre(t, y)); y += rowH;
  }
  if (line) comps.push(await centre(await text(line, 42, '#d6b25e'), y + 14));
  const words = path.join(dir, 'tall-words.png');
  fs.writeFileSync(words, await sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(comps).png().toBuffer());
  // the end: a darker room, the large logo and the tagline
  const endComps = [{ input: Buffer.from(`<svg width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#000" fill-opacity="0.38"/></svg>`), top: 0, left: 0 }];
  let under = 900;
  if (logo) { const l = await white(logo, 520, 280); endComps.push({ input: l.input, top: 640, left: Math.round((W - l.width) / 2) }); under = 640 + l.height + 40; }
  if (tagline) endComps.push(await centre(await text(tagline, 44, '#ffffff'), under));
  const end = path.join(dir, 'tall-end.png');
  fs.writeFileSync(end, await sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(endComps).png().toBuffer());
  const endAt = Math.max(0, seconds - 3);
  const bin = await ffmpegPath();
  const args = ['-y', '-loglevel', 'error', '-i', src, '-loop', '1', '-i', words, '-loop', '1', '-t', (seconds - endAt).toFixed(2), '-i', end];
  const fc = [
    `[0:v]fps=30,scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1[m]`,
    `[m][1:v]overlay=0:0:shortest=1[w]`,
    `[2:v]format=rgba,fade=t=in:st=0:d=0.6:alpha=1,setpts=PTS-STARTPTS+${endAt.toFixed(2)}/TB[e]`,
    `[w][e]overlay=0:0:eof_action=pass,format=yuv420p[v]`,
  ];
  let n = 3;
  fc.push(info.sound ? `[0:a]aresample=48000,apad=whole_dur=${seconds.toFixed(2)}[own]` : `anullsrc=r=48000:cl=stereo,atrim=0:${seconds.toFixed(2)}[own]`);
  let aout = '[own]';
  if (music && !info.sound) { args.push('-i', path.join(dir, 'music.mp3')); fs.writeFileSync(path.join(dir, 'music.mp3'), music); fc.push(`[${n}:a]aresample=48000,atrim=0:${seconds.toFixed(2)},volume=0.8[mus]`, `[own][mus]amix=inputs=2:duration=first:normalize=0[mix]`); aout = '[mix]'; n += 1; }
  fc.push(`${aout}afade=t=out:st=${Math.max(0, seconds - 1).toFixed(2)}:d=1[aa]`);
  const out = path.join(dir, 'tall-out.mp4');
  args.push('-filter_complex', fc.join(';'), '-map', '[v]', '-map', '[aa]', '-t', seconds.toFixed(2), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-threads', '1', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', out);
  await run(bin, args, 420000);
  return fs.readFileSync(out);
}

/** The cover of a video the owner sends (21/11): its frame at one second, a 4:5 JPEG for the draft's picture. */
export async function coverFrame(video) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cover-'));
  try {
    fs.writeFileSync(path.join(dir, 'in.mp4'), video);
    await run(await ffmpegPath(), ['-y', '-loglevel', 'error', '-ss', '1', '-i', path.join(dir, 'in.mp4'), '-frames:v', '1', '-vf', 'scale=1080:-2', path.join(dir, 'c.jpg')], 60000);
    const sharp = (await import('sharp')).default;
    return await sharp(fs.readFileSync(path.join(dir, 'c.jpg'))).resize(1080, 1350, { fit: 'cover' }).jpeg({ quality: 90 }).toBuffer();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : (lo + hi) / 2));

/**
 * The end card: the dark ARYAK ground, the logo (white), each film's swatch and code, the WhatsApp number. A PNG 1080 x 1920.
 * [codes] [{ code, swatch }], [logo] the black logo PNG, [font] a font file, [line] the words under the codes.
 */
export async function endCard({ codes = [], logo = null, font = '', line = '', cta = '', background = null }) {
  const sharp = (await import('sharp')).default;
  const W = 1080; const H = 1920;
  const comps = [];
  // the room itself, darkened, under the logo and the codes (the owner, 21/11: the end of a reference Reel was the logo over the room)
  if (background) {
    try {
      const bg = await sharp(background).resize(W, H, { fit: 'cover' }).blur(2).modulate({ brightness: 0.42 }).jpeg({ quality: 90 }).toBuffer();
      comps.push({ input: bg, top: 0, left: 0 });
    } catch { /* the dark ground */ }
  }
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
    if (c.name) { // a code means nothing to a buyer: the film's short name under it (the owner's review, 17/11)
      let px = 36; let nt = await text(c.name, px, '#cfc4b4'); let nm = await sharp(nt).metadata();
      while (nm.width > sw + gap - 10 && px > 24) { px -= 3; nt = await text(c.name, px, '#cfc4b4'); nm = await sharp(nt).metadata(); }
      comps.push({ input: nt, top: 860 + sw + 116, left: Math.max(0, x + Math.round((sw - nm.width) / 2)) });
    }
    x += sw + gap;
  }
  if (cta) { // what to do next, in words (the owner's review, 17/11)
    const t = await text(cta, 50);
    const tm = await sharp(t).metadata();
    comps.push({ input: t, top: 1440, left: Math.max(20, Math.round((W - tm.width) / 2)) });
  }
  if (line) {
    const t = await text(line, 46, '#d6b25e');
    const tm = await sharp(t).metadata();
    comps.push({ input: t, top: 1560, left: Math.max(20, Math.round((W - tm.width) / 2)) });
  }
  return sharp({ create: { width: W, height: H, channels: 4, background: { r: 20, g: 17, b: 14, alpha: 1 } } }).composite(comps).png().toBuffer();
}

/**
 * The design board (the owner, 17/11, from a mood-board prompt he liked): the room above, below it the real sample of every film of the
 * design from the catalogue, with its code, its name and its part (main, second, accent). Drawn here, never by the image model, so the
 * codes, names and samples are exactly ARYAK's. One 4:5 page of the post's album (1080x1350).
 */
export async function moodBoard({ room, codes = [], logo = null, font = '' }) {
  const sharp = (await import('sharp')).default;
  const W = 1080; const H = 1350; const top = 860;
  const text = async (t, size, colour = '#ffffff') => sharp({ text: { text: `<span foreground="${colour}">${String(t).replace(/[<&>]/g, '')}</span>`, font: `IBM Plex Sans SemiBold ${size}`, ...(font ? { fontfile: font } : {}), dpi: 72, rgba: true } }).png().toBuffer();
  const fit = async (t, size, colour, width) => { let px = size; let b = await text(t, px, colour); let m = await sharp(b).metadata(); while (m.width > width && px > 18) { px -= 2; b = await text(t, px, colour); m = await sharp(b).metadata(); } return { b, m }; };
  const comps = [{ input: await sharp(room).resize(W, top, { fit: 'cover', position: 'centre' }).jpeg({ quality: 92 }).toBuffer(), top: 0, left: 0 }];
  comps.push({ input: await sharp({ create: { width: W, height: 3, channels: 3, background: '#d6b25e' } }).png().toBuffer(), top, left: 0 });
  if (logo) {
    const lg = await sharp(logo).resize({ width: 150 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const shade = Buffer.from(lg.data); for (let i = 0; i < shade.length; i += 4) { shade[i] = 0; shade[i + 1] = 0; shade[i + 2] = 0; shade[i + 3] = Math.round(shade[i + 3] * 0.7); }
    for (let i = 0; i < lg.data.length; i += 4) { lg.data[i] = 255; lg.data[i + 1] = 255; lg.data[i + 2] = 255; }
    // a soft shadow under the white logo: it stays readable on a bright window or wall
    comps.push({ input: await sharp(shade, { raw: { width: lg.info.width, height: lg.info.height, channels: 4 } }).extend({ top: 16, bottom: 16, left: 16, right: 16, background: { r: 0, g: 0, b: 0, alpha: 0 } }).blur(7).png().toBuffer(), top: 42 - 16, left: 46 - 16 });
    comps.push({ input: await sharp(lg.data, { raw: { width: lg.info.width, height: lg.info.height, channels: 4 } }).png().toBuffer(), top: 40, left: 44 });
  }
  const head = await text('The films of this design', 30, '#d6b25e'); const hm = await sharp(head).metadata();
  comps.push({ input: head, top: top + 30, left: Math.round((W - hm.width) / 2) });
  const tiles = codes.filter((c) => c?.swatch).slice(0, 3);
  const roles = tiles.length === 1 ? ['Main'] : tiles.length === 2 ? ['Main', 'Second'] : ['Main', 'Second', 'Accent'];
  const size = tiles.length === 3 ? 200 : tiles.length === 2 ? 230 : 260;
  const gap = tiles.length === 3 ? 90 : 140;
  const total = tiles.length * size + (tiles.length - 1) * gap;
  let x = Math.round((W - total) / 2);
  const y = top + 90;
  for (const [k, c] of tiles.entries()) {
    comps.push({ input: await sharp(c.swatch).resize(size, size, { fit: 'cover' }).extend({ top: 3, bottom: 3, left: 3, right: 3, background: '#cfc4b4' }).png().toBuffer(), top: y - 3, left: x - 3 });
    const room4 = size + gap - 16;
    const code = await fit(c.code, 40, '#ffffff', room4); comps.push({ input: code.b, top: y + size + 24, left: Math.max(0, x + Math.round((size - code.m.width) / 2)) });
    if (c.name) { const n = await fit(c.name, 28, '#cfc4b4', room4); comps.push({ input: n.b, top: y + size + 76, left: Math.max(0, x + Math.round((size - n.m.width) / 2)) }); }
    const r = await fit(roles[k], 22, '#8a7a66', room4); comps.push({ input: r.b, top: y + size + 116, left: Math.max(0, x + Math.round((size - r.m.width) / 2)) });
    x += size + gap;
  }
  return sharp({ create: { width: W, height: H, channels: 3, background: '#14110E' } }).composite(comps).jpeg({ quality: 92 }).toBuffer();
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
    .composite([{ input: Buffer.from(`<svg width="${size + 80}" height="${size + 80}"><rect x="40" y="52" width="${size}" height="${size}" rx="${Math.round(size * 0.12)}" fill="rgba(0,0,0,0.55)"/></svg>`) }]).blur(18).png().toBuffer();
  const frame = async (count) => {
    const comps = [];
    const total = count * size + (count - 1) * gap; // the tiles shown are centred: the first alone, then all
    let x = Math.round((W - total) / 2);
    for (let k = 0; k < count; k++) {
      {
        const tile = await sharp(tiles[k].swatch).resize(size, size, { fit: 'cover' }).composite([{ input: round, blend: 'dest-in' }]).png().toBuffer();
        comps.push({ input: shadow, top: top - 40, left: x - 40 }, { input: tile, top, left: x });
        const t = await text(tiles[k].code, 54, '#ffffff'); const tm = await sharp(t).metadata();
        comps.push({ input: t, top: top + size + 44, left: x + Math.round((size - tm.width) / 2) });
        if (tiles[k].name) { const nt = await text(tiles[k].name, tiles.length === 3 ? 30 : 38, '#cfc4b4'); const nm = await sharp(nt).metadata(); comps.push({ input: nt, top: top + size + 116, left: Math.max(0, x + Math.round((size - nm.width) / 2)) }); }
      }
      if (k < count - 1) {
        const plus = await text('+', 96, '#d6b25e'); const pm = await sharp(plus).metadata();
        comps.push({ input: plus, top: top + Math.round((size - pm.height) / 2), left: x + size + Math.round((gap - pm.width) / 2) });
      }
      x += size + gap;
    }
    return sharp({ create: { width: W, height: H, channels: 3, background: '#14110E' } }).composite(comps).jpeg({ quality: 92 }).toBuffer();
  };
  return [await frame(1), await frame(tiles.length)];
}

/**
 * Instagram covers the top of a Reel (about 220 px of 1920: the «Reels» title and the camera) and the bottom (about 420 px: the caption,
 * the name, the sound) and a column on the right (the buttons). Every mark of a Reel stays inside the rest (the owner's review, 17/11:
 * the band of codes at the very bottom was under Instagram's own words, and a card ran off the edge of the frame).
 */
export const SAFE = { top: 250, bottom: 1500, left: 64, right: 930 };

/** The Reel's own mark: the white logo with a soft shadow (it reads on light and dark), inside the safe area. A transparent PNG 1080 x 1920. */
export async function reelOverlay({ logo = null, tagline = '', font = '' } = {}) {
  const sharp = (await import('sharp')).default;
  const W = 1080; const H = 1920;
  const comps = [];
  if (logo) {
    const lg = await sharp(logo).resize({ width: tagline ? 190 : 170 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const white = Buffer.from(lg.data); const dark = Buffer.from(lg.data);
    for (let i = 0; i < white.length; i += 4) { white[i] = 255; white[i + 1] = 255; white[i + 2] = 255; dark[i] = 0; dark[i + 1] = 0; dark[i + 2] = 0; dark[i + 3] = Math.round(dark[i + 3] * 0.55); }
    const raw = (b) => sharp(b, { raw: { width: lg.info.width, height: lg.info.height, channels: 4 } });
    const shadow = await raw(dark).extend({ top: 20, bottom: 20, left: 20, right: 20, background: { r: 0, g: 0, b: 0, alpha: 0 } }).blur(8).png().toBuffer();
    // a header in the middle (the owner, 21/11, from a reference Reel): the logo centred at the top and a short line under it
    const left = tagline ? Math.round((W - lg.info.width) / 2) : SAFE.left;
    comps.push({ input: shadow, top: SAFE.top - 20 + 3, left: left - 20 + 3 }, { input: await raw(white).png().toBuffer(), top: SAFE.top, left });
    if (tagline) {
      const words = String(tagline).toUpperCase().replace(/[<&>]/g, '').split('').join('\u200A');
      const t = await sharp({ text: { text: `<span foreground="#ffffff">${words}</span>`, font: `IBM Plex Sans 26`, ...(font ? { fontfile: font } : {}), dpi: 72, rgba: true } }).png().toBuffer();
      const tm = await sharp(t).metadata();
      const ts = await sharp(t).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const tsh = Buffer.from(ts.data); for (let i = 0; i < tsh.length; i += 4) { tsh[i] = 0; tsh[i + 1] = 0; tsh[i + 2] = 0; tsh[i + 3] = Math.round(tsh[i + 3] * 0.6); }
      const top = SAFE.top + lg.info.height + 14;
      comps.push({ input: await sharp(tsh, { raw: { width: ts.info.width, height: ts.info.height, channels: 4 } }).extend({ top: 10, bottom: 10, left: 10, right: 10, background: { r: 0, g: 0, b: 0, alpha: 0 } }).blur(5).png().toBuffer(), top: top - 10 + 2, left: Math.round((W - tm.width) / 2) - 10 + 2 });
      comps.push({ input: t, top, left: Math.round((W - tm.width) / 2) });
    }
  }
  return sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(comps).png().toBuffer();
}

/**
 * The room with a pointer to each film (the owner, 21/11, from a reference Reel: «HZ825 DEEP SLATE BLUE MATTE» beside the doors): a dot on
 * the film, a short line and the code with its name, drawn here (never by the image model, so the words are spelled right). [spots]
 * [{ x, y, code, name }] in 0..1 of the picture; kept in the middle of the width, the part a vertical Reel shows. A JPEG of the same size.
 */
export async function calloutRoom({ image, spots = [], font = '' }) {
  const sharp = (await import('sharp')).default;
  const meta = await sharp(image).metadata();
  const W = meta.width; const H = meta.height;
  const k = W / 1080;
  const text = async (t, px, weight) => sharp({ text: { text: `<span foreground="#ffffff">${String(t).replace(/[<&>]/g, '')}</span>`, font: `IBM Plex Sans ${weight} ${Math.round(px * k)}`, ...(font ? { fontfile: font } : {}), dpi: 72, rgba: true } }).png().toBuffer();
  const shade = async (png) => { const r = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); const d = Buffer.from(r.data); for (let i = 0; i < d.length; i += 4) { d[i] = 0; d[i + 1] = 0; d[i + 2] = 0; d[i + 3] = Math.round(d[i + 3] * 0.75); } return sharp(d, { raw: { width: r.info.width, height: r.info.height, channels: 4 } }).extend({ top: 8, bottom: 8, left: 8, right: 8, background: { r: 0, g: 0, b: 0, alpha: 0 } }).blur(4).png().toBuffer(); };
  const comps = [];
  for (const s of spots.slice(0, 3)) {
    const x = Math.round(clamp(Number(s.x), 0.24, 0.76) * W); const y = Math.round(clamp(Number(s.y), 0.16, 0.84) * H);
    const right = x < W / 2; // the words go toward the middle
    const len = Math.round(70 * k); const r = Math.round(8 * k);
    const x2 = right ? x + len : x - len;
    const svg = `<svg width="${W}" height="${H}"><line x1="${x}" y1="${y}" x2="${x2}" y2="${y}" stroke="rgba(0,0,0,0.45)" stroke-width="${Math.round(4 * k)}"/><line x1="${x}" y1="${y}" x2="${x2}" y2="${y}" stroke="#ffffff" stroke-width="${Math.max(2, Math.round(2 * k))}"/><circle cx="${x}" cy="${y}" r="${r + 3}" fill="rgba(0,0,0,0.4)"/><circle cx="${x}" cy="${y}" r="${r}" fill="#ffffff"/></svg>`;
    comps.push({ input: Buffer.from(svg), top: 0, left: 0 });
    const code = await text(s.code, 34, 'SemiBold'); const cm = await sharp(code).metadata();
    const name = s.name ? await text(String(s.name).toUpperCase(), 19, 'Medium') : null; const nm = name ? await sharp(name).metadata() : { width: 0, height: 0 };
    const bw = Math.max(cm.width, nm.width);
    const left = right ? x2 + Math.round(10 * k) : x2 - Math.round(10 * k) - bw;
    const top = y - Math.round(cm.height * 0.85);
    const L = Math.max(0, Math.min(W - bw, left));
    comps.push({ input: await shade(code), top: Math.max(0, top - 8 + 2), left: Math.max(0, L - 8 + 2) }, { input: code, top: Math.max(0, top), left: L });
    if (name) { const nt = top + cm.height + Math.round(8 * k); comps.push({ input: await shade(name), top: Math.max(0, nt - 8 + 2), left: Math.max(0, L - 8 + 2) }, { input: name, top: Math.max(0, nt), left: L }); }
  }
  return sharp(image).composite(comps).jpeg({ quality: 92 }).toBuffer();
}

/** A shot's label (the film on screen, its code and short name), a dark rounded plate low in the safe area. A transparent PNG 1080 x 1920. */
export async function shotLabel({ code = '', name = '', font = '' } = {}) {
  const sharp = (await import('sharp')).default;
  const W = 1080; const H = 1920;
  const text = async (t, px, colour) => sharp({ text: { text: `<span foreground="${colour}">${String(t).replace(/[<&>]/g, '')}</span>`, font: `IBM Plex Sans SemiBold ${px}`, ...(font ? { fontfile: font } : {}), dpi: 72, rgba: true } }).png().toBuffer();
  const parts = [await text(code, 46, '#ffffff'), ...(name ? [await text(name, 40, '#e9dfcf')] : [])];
  const metas = await Promise.all(parts.map((b) => sharp(b).metadata()));
  const padX = 30; const gap = 22; const h = 92;
  const w = Math.min(SAFE.right - SAFE.left, padX * 2 + metas.reduce((a, m) => a + m.width, 0) + gap * (parts.length - 1));
  const top = 1330;
  const comps = [{ input: Buffer.from(`<svg width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="18" ry="18" fill="rgba(20,17,14,0.72)"/></svg>`), top, left: SAFE.left }];
  let x = SAFE.left + padX;
  for (const [k, b] of parts.entries()) { if (x + metas[k].width > SAFE.left + w) break; comps.push({ input: b, top: top + Math.round((h - metas[k].height) / 2), left: x }); x += metas[k].width + gap; }
  return sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(comps).png().toBuffer();
}

/**
 * The Reel: [room] and [detail] pictures (4:5), [focus] { x, y } (0..1) where the camera pushes in on the room, [overlay] a transparent
 * PNG 1080 x 1920 laid over the two moving parts (the logo and the band of codes), [card] the end card. Returns the MP4.
 */
export async function makeReel({ room, detail = null, details = null, views = [], motion = 'zoom', hook = null, before = null, intro = [], reveal = null, focus = { x: 0.5, y: 0.5 }, overlay = null, card, music = null, seconds = { room: 5, detail: 4, card: 3 }, sequence = null, fade: cross = 0.6, cardVoice = null, whoosh = false }) {
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
    // the camera moves in fractions of a pixel (the owner, 17/11: «the Reels do not run smoothly, small pauses»: zoompan crops at whole
    // pixels, so a slow move stepped 4, 2, 4, 2 px frame after frame). Each still is repeated for its frames and a moving window of it is
    // drawn by [perspective] with cubic interpolation, then fitted to 1080x1920; the still stays 1350x2400 (the 1 GB server froze on more).
    const still = (i, frames) => `[${i}:v]scale=1350:2400:force_original_aspect_ratio=increase,crop=1350:2400,setsar=1,loop=loop=${frames - 1}:size=1:start=0,settb=1/${fps},setpts=N,fps=${fps},`; // exact frame times (N/30/TB on a 1/25 time base dropped every sixth frame)
    const windowOf = (zx, x0, y0) => { const x1 = `(${x0})+W/(${zx})`; const y2 = `(${y0})+H/(${zx})`; return `perspective=x0='${x0}':y0='${y0}':x1='${x1}':y1='${y0}':x2='${x0}':y2='${y2}':x3='${x1}':y3='${y2}':interpolation=cubic:eval=frame,scale=1080:1920:flags=bicubic,setsar=1,format=yuv420p`; };
    const move = (i, frames, zoom, cx, cy) => { const z = `(1+${zoom}*on/${frames})`; return still(i, frames) + windowOf(z, `(W-W/${z})*${cx}`, `(H-H/${z})*${cy}`); };
    // the sideways move: a fixed small enlargement, the window travelling from one side to the other (every other shot the other way)
    const pan = (i, frames, toRight) => still(i, frames) + windowOf('1.18', `(W-W/1.18)*${toRight ? `on/${frames}` : `(1-on/${frames})`}`, '(H-H/1.18)*0.5');
    // «the camera turns in the room, not a zoom» (the owner, 15/11): with motion 'orbit' each still is crossed by a slow sideways move,
    // and [views] (the same room from other camera places) follow the room, so the camera seems to walk around it
    const orbit = motion === 'orbit';
    const angles = orbit ? views.filter(Boolean).slice(0, 3) : [];
    // the shots in order: [hook] (the film's texture very close, the first 1.5 s that stop the scroll), [before] (the room before ARYAK,
    // wiped away by the room after), the room, its other views, the close-ups
    const seq = [];
    // [sequence]: the shots already chosen and timed by the studio (the owner's review, 17/11: the strongest picture first, quick cuts,
    // every shot once): [{ image, sec, move: 'push' | 'pan', zoom, cx, cy, toRight, cut, label }]
    if (Array.isArray(sequence) && sequence.length) {
      sequence.filter((s) => s?.image).forEach((s, k) => seq.push({ file: put(`shot${k}.jpg`, s.image), sec: s.sec, cut: s.cut, label: s.label || null, voice: s.voice || null,
        make: (i, f) => (s.move === 'pan' ? pan(i, f, !!s.toRight) : move(i, f, s.zoom ?? 0.12, clamp(s.cx, 0.15, 0.85), clamp(s.cy, 0.15, 0.85))) }));
    }
    if (!seq.length) intro.filter(Boolean).slice(0, 2).forEach((c, k) => seq.push({ file: put(`intro${k}.jpg`, c), sec: seconds.intro || 1.35, make: (i, f) => move(i, f, 0.04, 0.5, 0.45) }));
    if (!sequence?.length && hook) seq.push({ file: put('hook.jpg', hook), sec: seconds.hook || 1.6, make: (i, f) => move(i, f, 0.3, 0.5, 0.5) });
    if (!sequence?.length && before) seq.push({ file: put('before.jpg', before), sec: seconds.before || 2.6, make: (i, f) => move(i, f, 0.06, 0.5, 0.5) });
    if (!sequence?.length) seq.push({ file: put('room.jpg', room), sec: seconds.room, make: (i, f) => (orbit ? pan(i, f, true) : move(i, f, 0.22, fx, fy)), cut: before ? 'wipeleft' : 'fade' });
    // the function reveal (the owner, 16/11): the same room with its doors open, dissolved in slowly after the room
    if (!sequence?.length && reveal) seq.push({ file: put('reveal.jpg', reveal), sec: seconds.reveal || 3.6, make: (i, f) => (orbit ? pan(i, f, false) : move(i, f, 0.1, fx, fy)), cut: 'dissolve' });
    if (!sequence?.length) angles.forEach((v, k) => seq.push({ file: put(`view${k}.jpg`, v), sec: seconds.view || seconds.room, make: (i, f) => pan(i, f, k % 2 === 1) }));
    if (!sequence?.length) shots.forEach((d, k) => seq.push({ file: put(`detail${k}.jpg`, d.image), sec: d.seconds || seconds.detail, make: (i, f) => (orbit ? pan(i, f, k % 2 === 0) : move(i, f, d.zoom ?? 0.12, 0.5, 0.5)) }));
    for (const x of seq) args.push('-i', x.file);
    args.push('-i', put('card.png', card));
    const cardIn = seq.length;
    let next = cardIn + 1;
    const overlayIn = overlay ? next++ : -1;
    if (overlay) args.push('-i', put('overlay.png', overlay));
    const labelIn = seq.map((x, k) => (x.label ? (args.push('-loop', '1', '-framerate', String(fps), '-i', put(`label${k}.png`, x.label)), next++) : -1));
    // the sound: the design's own music (an MP3, faded in and out), or silence (Instagram wants a sound track)
    const audio = next;
    if (music) args.push('-i', put('music.mp3', music)); else args.push('-f', 'lavfi', '-t', '60', '-i', 'anullsrc=r=44100:cl=stereo');
    next = audio + 1;
    // the voice (the owner, 21/11, from a reference Reel): one short line per shot, laid at its start; the card's line at the end
    const voiceIn = seq.map((x, k) => (x.voice ? (args.push('-i', put(`voice${k}.wav`, x.voice)), next++) : -1));
    const cardVoiceIn = cardVoice ? (args.push('-i', put('voicecard.wav', cardVoice)), next++) : -1;
    // a soft whoosh at every cut (filtered pink noise, made here)
    const whooshIn = whoosh ? seq.slice(1).concat([null]).map(() => (args.push('-f', 'lavfi', '-t', '0.7', '-i', 'anoisesrc=c=pink:r=44100:a=0.5'), next++)) : [];
    // every length in whole frames (live 17/11: a shot of 1.85 s is 55.5 frames and a fade of 0.35 s is 10.5, so one frame stood still at a cut)
    const fade = Math.round(cross * fps) / fps;
    for (const x of seq) x.sec = n(x.sec) / fps;
    seconds = { ...seconds, card: n(seconds.card) / fps };
    const parts = [`${seq[0].make(0, n(seq[0].sec) + 4)}[m0]`]; // four spare frames (measured 17/11: with 0, 1 or 2 one frame stood still at a cut; with 4 none)
    let last = 'm0'; let t = seq[0].sec;
    const starts = [0];
    for (let i = 1; i < seq.length; i++) {
      parts.push(`${seq[i].make(i, n(seq[i].sec) + 4)}[s${i}]`);
      parts.push(`[${last}][s${i}]xfade=transition=${seq[i].cut || 'fade'}:duration=${(fade - 0.002).toFixed(4)}:offset=${(t - fade).toFixed(4)}[m${i}]`);
      starts.push(t - fade);
      last = `m${i}`; t += seq[i].sec - fade;
    }
    const moving = t; // the overlay stays on the moving parts only
    if (overlay) { parts.push(`[${last}][${overlayIn}:v]overlay=0:0:enable='lt(t,${(moving - fade).toFixed(2)})'[o]`); last = 'o'; }
    // each shot's label (its film's code and name) while that shot is on screen
    seq.forEach((x, k) => {
      if (labelIn[k] < 0) return;
      const a = starts[k] + 0.15; const b = starts[k] + x.sec - fade - 0.05;
      parts.push(`[${labelIn[k]}:v]format=rgba,fade=t=in:st=${a.toFixed(3)}:d=0.3:alpha=1,fade=t=out:st=${(b - 0.3).toFixed(3)}:d=0.3:alpha=1[lb${k}]`);
      parts.push(`[${last}][lb${k}]overlay=0:0:eof_action=pass:enable='between(t,${a.toFixed(3)},${b.toFixed(3)})'[l${k}]`); last = `l${k}`;
    });
    parts.push(`[${cardIn}:v]loop=loop=${n(seconds.card)}:size=1:start=0,settb=1/${fps},setpts=N,fps=${fps},scale=1080:1920,setsar=1,format=yuv420p[c]`);
    parts.push(`[${last}][c]xfade=transition=fade:duration=${(fade - 0.002).toFixed(4)}:offset=${(t - fade).toFixed(4)}[v]`);
    const total = t + seconds.card - fade;
    // the peaks held under full scale (the owner's review, 17/11: every Reel touched 0 dB, which can crack on a phone's speaker)
    const st = (x) => 'aresample=44100,aformat=sample_rates=44100:channel_layouts=stereo';
    const voices = [];
    seq.forEach((x, k) => { if (voiceIn[k] >= 0) voices.push({ i: voiceIn[k], at: starts[k] + 0.25 }); });
    if (cardVoiceIn >= 0) voices.push({ i: cardVoiceIn, at: t - fade + 0.35 });
    const cuts = [...starts.slice(1), t - fade].map((s) => Math.max(0, s - 0.2));
    if (!voices.length && !whooshIn.length) parts.push(`[${audio}:a]atrim=0:${total.toFixed(2)},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.4,afade=t=out:st=${Math.max(0, total - 1.5).toFixed(2)}:d=1.5,alimiter=limit=0.89:level=0[s]`);
    else {
      parts.push(`[${audio}:a]atrim=0:${total.toFixed(2)},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.4,afade=t=out:st=${Math.max(0, total - 1.5).toFixed(2)}:d=1.5,${st()}[mus]`);
      let bed = 'mus'; const mixes = [];
      if (voices.length) {
        voices.forEach((v, k) => parts.push(`[${v.i}:a]${st()},volume=1.7,adelay=delays=${Math.round(v.at * 1000)}:all=1[vv${k}]`));
        parts.push(`${voices.map((_, k) => `[vv${k}]`).join('')}amix=inputs=${voices.length}:normalize=0:duration=longest,asplit=2[vo1][vo2]`);
        parts.push(`[mus][vo1]sidechaincompress=threshold=0.02:ratio=8:attack=20:release=400[duck]`); // the music steps back under the voice
        bed = 'duck'; mixes.push('[vo2]');
      }
      whooshIn.forEach((w, k) => { parts.push(`[${w}:a]highpass=f=350,lowpass=f=5200,afade=t=in:st=0:d=0.32,afade=t=out:st=0.32:d=0.36,volume=0.16,${st()},adelay=delays=${Math.round(cuts[k] * 1000)}:all=1[wh${k}]`); mixes.push(`[wh${k}]`); });
      parts.push(`[${bed}]${mixes.join('')}amix=inputs=${1 + mixes.length}:normalize=0:duration=first,atrim=0:${total.toFixed(2)},alimiter=limit=0.89:level=0[s]`);
    }
    args.push('-filter_threads', '1', '-filter_complex_threads', '1', '-filter_complex', parts.join(';'), '-map', '[v]', '-map', '[s]', '-t', total.toFixed(2),
      '-c:v', 'libx264', '-preset', 'veryfast', '-threads', '1', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(fps), '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', path.join(dir, 'reel.mp4'));
    await run(await ffmpegPath(), args, 360000);
    return fs.readFileSync(path.join(dir, 'reel.mp4'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
