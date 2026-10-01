// FFmpeg wrapper for the Aura clip editor (runs in the Electron main process).
// One render pipeline handles trim, cut, merge, text, compression, and MP4/GIF export.

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// In a packaged app the binaries live in app.asar.unpacked (see README: asarUnpack).
function unpacked(p) {
  return p.replace('app.asar', 'app.asar.unpacked');
}
const FFMPEG = unpacked(require('ffmpeg-static'));
const FFPROBE = unpacked(require('ffprobe-static').path);

let currentJob = null;

function probe(file) {
  return new Promise((resolve, reject) => {
    const args = ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file];
    const proc = spawn(FFPROBE, args, { windowsHide: true });
    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => (out += d));
    proc.stderr.on('data', (d) => (err += d));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(err.trim() || `ffprobe exited with code ${code}`));
      const info = JSON.parse(out);
      const video = info.streams.find((s) => s.codec_type === 'video');
      if (!video) return reject(new Error(`${path.basename(file)} has no video track.`));
      resolve({
        duration: parseFloat(info.format.duration) || parseFloat(video.duration) || 0,
        width: video.width,
        height: video.height,
        hasAudio: info.streams.some((s) => s.codec_type === 'audio'),
      });
    });
  });
}

// Escape a path for use inside a single-quoted filter option value.
function filterPath(p) {
  return p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "'\\''");
}

// Folder libass should search for fonts (null = system default via fontconfig).
function fontsDir() {
  if (process.platform === 'win32') return path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts');
  return null;
}

function assTime(t) {
  const cs = Math.max(0, Math.round(t * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const sec = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
}

function assColor(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '') || [0, 'ff', 'ff', 'ff'];
  return `&H00${m[3]}${m[2]}${m[1]}&`.toUpperCase(); // ASS uses BGR order
}

function assText(text) {
  return text
    .replace(/\\/g, '\\\u2060') // stop "\n", "\N" etc. being read as codes
    .replace(/\{/g, '(')
    .replace(/\}/g, ')')
    .replace(/\r?\n/g, '\\N');
}

// Text overlays are rendered with libass (the "ass" filter), which the ffmpeg-static
// builds include. Coordinates use the output resolution, so preview and export line up.
function writeAssFile(texts, W, H, file) {
  const lines = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${W}`,
    `PlayResY: ${H}`,
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    'Style: Overlay,Arial,48,&H00FFFFFF,&H00FFFFFF,&H26000000,&H00000000,-1,0,0,0,100,100,0,0,1,3,0,5,0,0,0,1',
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  texts.forEach((t, k) => {
    if (!t.text || !t.text.trim()) return;
    const size = Math.max(8, Math.round(H * t.size));
    const border = Math.max(1, Math.round(size / 14));
    const x = Math.round(W * t.x);
    const y = Math.round(H * t.y);
    lines.push(
      `Dialogue: ${k},${assTime(t.start)},${assTime(t.end)},Overlay,,0,0,0,,` +
        `{\\pos(${x},${y})\\fs${size}\\bord${border}\\c${assColor(t.color)}}${assText(t.text)}`
    );
  });
  fs.writeFileSync(file, '\ufeff' + lines.join('\r\n') + '\r\n', 'utf8');
}

const num = (v, lo, hi, d) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : d);

// Colour effects for one clip. The editor previews the same effects with CSS filters.
function fxFilters(fx) {
  if (!fx) return [];
  const out = [];
  const b = num(fx.brightness, -0.5, 0.5, 0);
  const c = num(fx.contrast, 0.5, 2, 1);
  const s = num(fx.saturation, 0, 2, 1);
  if (b !== 0 || c !== 1 || s !== 1) {
    out.push(`eq=brightness=${b.toFixed(3)}:contrast=${c.toFixed(3)}:saturation=${s.toFixed(3)}`);
  }
  switch (fx.preset) {
    case 'bw': out.push('hue=s=0'); break;
    case 'sepia': out.push('colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131'); break;
    case 'vivid': out.push('eq=saturation=1.5:contrast=1.1'); break;
    case 'vignette': out.push('vignette=angle=PI/4'); break;
    default: break;
  }
  return out;
}

const PRESETS = {
  1080: [1920, 1080],
  720: [1280, 720],
  480: [854, 480],
};
const QUALITY_CRF = { high: 18, balanced: 23, small: 28 };

/**
 * project = {
 *   clips:  [{ path, in, out, hasAudio, fx: { preset, brightness, contrast, saturation } }],
 *   texts:  [{ text, start, end, x, y, size, color }]   // x/y/size are 0..1 of the frame
 *   images: [{ path, start, end, x, y, scale, opacity }]  // scale = width as a fraction of the frame
 *   fade:   { in: seconds, out: seconds }
 * }
 * options = { format: 'mp4'|'gif', resolution: 1080|720|480, quality: 'high'|'balanced'|'small',
 *             fps: number, gifWidth: number, gifFps: number }
 */
function buildArgs(project, options, outputPath, tmpDir) {
  const isGif = options.format === 'gif';
  let W;
  let H;
  let fps;
  if (isGif) {
    W = Math.round((options.gifWidth || 480) / 2) * 2;
    H = Math.round((W * 9) / 16 / 2) * 2;
    fps = options.gifFps || 15;
  } else {
    [W, H] = PRESETS[options.resolution] || PRESETS[1080];
    fps = options.fps || 60;
  }

  const args = ['-y', '-hide_banner', '-nostats', '-progress', 'pipe:1'];
  const filters = [];
  const concatInputs = [];

  project.clips.forEach((clip, i) => {
    const dur = Math.max(0.05, clip.out - clip.in);
    args.push('-ss', clip.in.toFixed(3), '-t', dur.toFixed(3), '-i', clip.path);

    filters.push(
      `[${i}:v:0]setpts=PTS-STARTPTS,` +
        `scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
        `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,` +
        fxFilters(clip.fx).map((f) => f + ',').join('') +
        `fps=${fps},format=yuv420p[v${i}]`
    );
    concatInputs.push(`[v${i}]`);

    if (!isGif) {
      if (clip.hasAudio) {
        filters.push(
          `[${i}:a:0]asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo[a${i}]`
        );
      } else {
        filters.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${dur.toFixed(3)}[a${i}]`);
      }
      concatInputs.push(`[a${i}]`);
    }
  });

  const n = project.clips.length;
  filters.push(
    `${concatInputs.join('')}concat=n=${n}:v=1:a=${isGif ? 0 : 1}[vc]${isGif ? '' : '[ac]'}`
  );

  const total = project.clips.reduce((sum, c) => sum + Math.max(0.05, c.out - c.in), 0);
  let last = 'vc';

  // Image overlays (logos, stickers, screenshots). Each image is looped for the
  // length of the video and shown only between its start and end times.
  (project.images || []).forEach((img, k) => {
    const idx = n + k;
    args.push('-loop', '1', '-t', total.toFixed(3), '-i', img.path);
    const w = Math.max(2, Math.round((W * num(img.scale, 0.02, 1, 0.25)) / 2) * 2);
    const alpha = num(img.opacity, 0, 1, 1).toFixed(3);
    const x = num(img.x, 0, 1, 0.5).toFixed(4);
    const y = num(img.y, 0, 1, 0.5).toFixed(4);
    filters.push(`[${idx}:v]scale=${w}:-2,format=rgba,colorchannelmixer=aa=${alpha}[img${k}]`);
    filters.push(
      `[${last}][img${k}]overlay=x=W*${x}-w/2:y=H*${y}-h/2:shortest=1:` +
        `enable='between(t,${num(img.start, 0, 1e6, 0).toFixed(3)},${num(img.end, 0, 1e6, total).toFixed(3)})'[ov${k}]`
    );
    last = `ov${k}`;
  });

  // Text overlays, burned in with libass (drawn on top of images).
  const texts = (project.texts || []).filter((t) => t.text && t.text.trim());
  if (texts.length) {
    const assFile = path.join(tmpDir, 'overlay.ass');
    writeAssFile(texts, W, H, assFile);
    const dir = fontsDir();
    const opts = [`filename='${filterPath(assFile)}'`];
    if (dir) opts.push(`fontsdir='${filterPath(dir)}'`);
    filters.push(`[${last}]ass=${opts.join(':')}[vt]`);
    last = 'vt';
  }

  // Fade in from / out to black (and the sound with it).
  const fadeIn = num(project.fade?.in, 0, total / 2, 0);
  const fadeOut = num(project.fade?.out, 0, total / 2, 0);
  let audioLabel = 'ac';
  if (fadeIn > 0 || fadeOut > 0) {
    const vf = [];
    const af = [];
    if (fadeIn > 0) {
      vf.push(`fade=t=in:st=0:d=${fadeIn.toFixed(3)}`);
      af.push(`afade=t=in:st=0:d=${fadeIn.toFixed(3)}`);
    }
    if (fadeOut > 0) {
      const st = Math.max(0, total - fadeOut).toFixed(3);
      vf.push(`fade=t=out:st=${st}:d=${fadeOut.toFixed(3)}`);
      af.push(`afade=t=out:st=${st}:d=${fadeOut.toFixed(3)}`);
    }
    filters.push(`[${last}]${vf.join(',')}[vf]`);
    last = 'vf';
    if (!isGif) {
      filters.push(`[ac]${af.join(',')}[af]`);
      audioLabel = 'af';
    }
  }

  if (isGif) {
    filters.push(
      `[${last}]split[g0][g1];[g0]palettegen=stats_mode=diff[pal];` +
        `[g1][pal]paletteuse=dither=bayer:bayer_scale=5[vout]`
    );
    args.push('-filter_complex', filters.join(';'), '-map', '[vout]', '-loop', '0', outputPath);
  } else {
    const crf = QUALITY_CRF[options.quality] ?? 23;
    args.push(
      '-filter_complex', filters.join(';'),
      '-map', `[${last}]`, '-map', `[${audioLabel}]`,
      '-c:v', 'libx264', '-preset', 'medium', '-crf', String(crf),
      '-c:a', 'aac', '-b:a', '160k',
      '-movflags', '+faststart',
      outputPath
    );
  }
  return args;
}

function render(project, options, outputPath, onProgress) {
  if (currentJob) return Promise.reject(new Error('An export is already running.'));
  if (!project.clips || project.clips.length === 0) {
    return Promise.reject(new Error('Add at least one clip before exporting.'));
  }

  const totalDuration = project.clips.reduce((sum, c) => sum + (c.out - c.in), 0);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-clip-'));
  const args = buildArgs(project, options, outputPath, tmpDir);

  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, args, { windowsHide: true });
    currentJob = { proc, cancelled: false };
    const job = currentJob;
    let stderrTail = '';
    let buffer = '';

    proc.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();
      for (const line of lines) {
        const [key, value] = line.split('=');
        if (key === 'out_time_us' || key === 'out_time_ms') {
          const seconds = Number(value) / 1e6; // both keys are in microseconds
          if (Number.isFinite(seconds) && totalDuration > 0) {
            onProgress(Math.min(0.99, Math.max(0, seconds / totalDuration)));
          }
        } else if (key === 'progress' && value === 'end') {
          onProgress(1);
        }
      }
    });
    proc.stderr.on('data', (d) => {
      stderrTail = (stderrTail + d.toString()).slice(-4000);
    });

    const cleanup = () => {
      currentJob = null;
      fs.rm(tmpDir, { recursive: true, force: true }, () => {});
    };

    proc.on('error', (err) => {
      cleanup();
      reject(err);
    });
    proc.on('close', (code) => {
      cleanup();
      if (job.cancelled) {
        fs.rm(outputPath, { force: true }, () => {});
        return reject(new Error('Export cancelled.'));
      }
      if (code === 0) return resolve(outputPath);
      const lastLines = stderrTail.trim().split(/\r?\n/).slice(-6).join('\n');
      reject(new Error(`FFmpeg failed (code ${code}):\n${lastLines}`));
    });
  });
}

function cancel() {
  if (!currentJob) return false;
  currentJob.cancelled = true;
  currentJob.proc.kill('SIGKILL');
  return true;
}

module.exports = { probe, render, cancel, buildArgs };
