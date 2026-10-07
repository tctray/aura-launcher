// Aura clip editor (renderer). Talks to the main process through window.clipEditor (preload.js).
(() => {
  const api = window.clipEditor;
  const $ = (id) => document.getElementById(id);

  const video = $('video');
  const canvas = $('overlay');
  const ctx = canvas.getContext('2d');
  const stage = $('stage');
  const stageWrap = $('stage-wrap');
  const timeline = $('timeline');
  const ruler = $('ruler');
  const trackClips = $('track-clips');
  const trackText = $('track-text');
  const playheadEl = $('playhead');

  const MIN_CLIP = 0.1;
  const TIMELINE_PAD = 16;

  const state = {
    clips: [],     // { id, path, url, name, duration, width, height, hasAudio, in, out }
    texts: [],     // { id, text, start, end, x, y, size, color }
    selected: null, // { type: 'clip' | 'text', id }
    playhead: 0,
    playing: false,
    loadedIndex: -1,
    switching: false,
    pxPerSec: 40,
    textBoxes: [], // hit boxes in canvas pixels, rebuilt every frame
    drag: null,
  };
  let nextId = 1;
  let loadToken = 0;

  // ---------- Timeline maths ----------
  const clipLen = (c) => c.out - c.in;
  const totalDuration = () => state.clips.reduce((s, c) => s + clipLen(c), 0);
  const clipStart = (index) => {
    let t = 0;
    for (let i = 0; i < index; i++) t += clipLen(state.clips[i]);
    return t;
  };
  function locate(t) {
    let start = 0;
    for (let i = 0; i < state.clips.length; i++) {
      const len = clipLen(state.clips[i]);
      if (t < start + len || i === state.clips.length - 1) {
        return { index: i, offset: Math.min(Math.max(0, t - start), len) };
      }
      start += len;
    }
    return { index: -1, offset: 0 };
  }
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  function formatTime(t) {
    const m = Math.floor(t / 60);
    const s = t - m * 60;
    return `${m}:${s.toFixed(1).padStart(4, '0')}`;
  }

  // ---------- Preview playback ----------
  function loadClipAt(index, offset) {
    const clip = state.clips[index];
    const token = ++loadToken;
    return new Promise((resolve) => {
      const seek = () => {
        if (token !== loadToken) return resolve(false);
        video.currentTime = clip.in + offset;
        state.loadedIndex = index;
        resolve(true);
      };
      if (video.getAttribute('src') === clip.url && video.readyState >= 1) {
        seek();
      } else {
        video.setAttribute('src', clip.url);
        video.addEventListener('loadedmetadata', seek, { once: true });
      }
    });
  }

  async function seekTo(t) {
    if (!state.clips.length) return;
    state.playhead = clamp(t, 0, totalDuration());
    const { index, offset } = locate(state.playhead);
    const ok = await loadClipAt(index, offset);
    if (ok && state.playing) video.play().catch(() => {});
  }

  async function play() {
    if (!state.clips.length) return;
    if (state.playhead >= totalDuration() - 0.05) state.playhead = 0;
    state.playing = true;
    $('btn-play').parentElement.classList.add('is-playing');
    $('btn-play').setAttribute('aria-label', 'Pause');
    await seekTo(state.playhead);
  }

  function pause() {
    state.playing = false;
    video.pause();
    $('btn-play').parentElement.classList.remove('is-playing');
    $('btn-play').setAttribute('aria-label', 'Play');
  }

  function tick() {
    if (state.playing && !state.switching && state.loadedIndex >= 0) {
      const clip = state.clips[state.loadedIndex];
      if (clip) {
        state.playhead = clipStart(state.loadedIndex) + (video.currentTime - clip.in);
        if (video.currentTime >= clip.out - 0.02 || video.ended) {
          const next = state.loadedIndex + 1;
          if (next < state.clips.length) {
            state.switching = true;
            loadClipAt(next, 0).then(() => {
              state.switching = false;
              if (state.playing) video.play().catch(() => {});
            });
          } else {
            pause();
            state.playhead = totalDuration();
          }
        }
      }
    }
    drawOverlay();
    playheadEl.style.left = `${TIMELINE_PAD + state.playhead * state.pxPerSec}px`;
    $('time-current').textContent = formatTime(state.playhead);
    requestAnimationFrame(tick);
  }

  // ---------- Text overlay preview ----------
  function drawOverlay() {
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    state.textBoxes = [];
    const t = state.playhead;

    for (const item of state.texts) {
      if (t < item.start || t > item.end || !item.text.trim()) continue;
      const fontSize = Math.max(8, Math.round(H * item.size));
      const border = Math.max(1, Math.round(fontSize / 14));
      ctx.font = `bold ${fontSize}px Arial, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = border * 2;
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      const cx = item.x * W;
      const cy = item.y * H;
      ctx.strokeText(item.text, cx, cy);
      ctx.fillStyle = item.color;
      ctx.fillText(item.text, cx, cy);

      const w = ctx.measureText(item.text).width + border * 2;
      const box = { id: item.id, x: cx - w / 2, y: cy - fontSize * 0.6, w, h: fontSize * 1.2 };
      state.textBoxes.push(box);

      if (state.selected?.type === 'text' && state.selected.id === item.id) {
        ctx.save();
        ctx.setLineDash([6, 4]);
        ctx.lineWidth = Math.max(1, window.devicePixelRatio);
        ctx.strokeStyle = '#ffb547';
        ctx.strokeRect(box.x - 6, box.y - 4, box.w + 12, box.h + 8);
        ctx.restore();
      }
    }
  }

  function canvasPoint(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  }
  function hitText(p) {
    for (let i = state.textBoxes.length - 1; i >= 0; i--) {
      const b = state.textBoxes[i];
      if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) return b;
    }
    return null;
  }

  canvas.addEventListener('pointerdown', (e) => {
    const p = canvasPoint(e);
    const hit = hitText(p);
    if (!hit) return;
    const item = state.texts.find((x) => x.id === hit.id);
    select({ type: 'text', id: item.id });
    state.drag = { item, dx: p.x - item.x * canvas.width, dy: p.y - item.y * canvas.height };
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add('dragging');
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = canvasPoint(e);
    if (state.drag) {
      const { item, dx, dy } = state.drag;
      item.x = clamp((p.x - dx) / canvas.width, 0, 1);
      item.y = clamp((p.y - dy) / canvas.height, 0, 1);
    } else {
      canvas.classList.toggle('can-drag', !!hitText(p));
    }
  });
  const endDrag = () => {
    state.drag = null;
    canvas.classList.remove('dragging');
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  // ---------- Layout ----------
  function fitStage() {
    const w = stageWrap.clientWidth;
    const h = stageWrap.clientHeight;
    let sw = w;
    let sh = (w * 9) / 16;
    if (sh > h) {
      sh = h;
      sw = (h * 16) / 9;
    }
    stage.style.width = `${sw}px`;
    stage.style.height = `${sh}px`;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(sw * dpr);
    canvas.height = Math.round(sh * dpr);
  }
  new ResizeObserver(() => {
    fitStage();
    renderTimeline();
  }).observe(stageWrap);

  // ---------- Timeline ----------
  function renderTimeline() {
    const total = totalDuration();
    const available = timeline.clientWidth - TIMELINE_PAD * 2;
    state.pxPerSec = Math.max(20, available / Math.max(total, 1));
    const width = Math.max(available, total * state.pxPerSec);
    for (const el of [ruler, trackClips, trackText]) el.style.width = `${width}px`;

    // Ruler ticks, at least ~70px apart.
    ruler.innerHTML = '';
    const step = [1, 2, 5, 10, 15, 30, 60, 120, 300].find((s) => s * state.pxPerSec >= 70) || 600;
    for (let t = 0; t <= total + 0.001; t += step) {
      const tick = document.createElement('span');
      tick.style.left = `${t * state.pxPerSec}px`;
      tick.textContent = formatTime(t).replace(/\.0$/, '');
      ruler.appendChild(tick);
    }

    trackClips.innerHTML = '';
    let start = 0;
    state.clips.forEach((clip) => {
      const len = clipLen(clip);
      const block = document.createElement('div');
      block.className = 'clip-block';
      if (state.selected?.type === 'clip' && state.selected.id === clip.id) block.classList.add('selected');
      block.style.left = `${start * state.pxPerSec}px`;
      block.style.width = `${Math.max(4, len * state.pxPerSec - 3)}px`;
      block.innerHTML = '<span class="clip-title"></span><span class="clip-len"></span>';
      block.querySelector('.clip-title').textContent = clip.name;
      block.querySelector('.clip-len').textContent = formatTime(len);
      block.title = clip.name;
      const blockStart = start;
      block.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        select({ type: 'clip', id: clip.id });
        const rect = block.getBoundingClientRect();
        seekTo(blockStart + (e.clientX - rect.left) / state.pxPerSec);
      });
      trackClips.appendChild(block);
      start += len;
    });

    trackText.innerHTML = '';
    state.texts.forEach((item) => {
      const block = document.createElement('div');
      block.className = 'text-block';
      if (state.selected?.type === 'text' && state.selected.id === item.id) block.classList.add('selected');
      block.style.left = `${item.start * state.pxPerSec}px`;
      block.style.width = `${Math.max(12, (item.end - item.start) * state.pxPerSec)}px`;
      block.textContent = item.text || 'Empty text';
      block.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        select({ type: 'text', id: item.id });
        if (state.playhead < item.start || state.playhead > item.end) seekTo(item.start);
      });
      trackText.appendChild(block);
    });

    $('time-total').textContent = formatTime(total);
    playheadEl.style.display = state.clips.length ? 'block' : 'none';
  }

  // Click or drag on empty timeline space to scrub.
  timeline.addEventListener('pointerdown', (e) => {
    if (!state.clips.length) return;
    const scrub = (ev) => {
      const rect = timeline.getBoundingClientRect();
      const x = ev.clientX - rect.left + timeline.scrollLeft - TIMELINE_PAD;
      seekTo(x / state.pxPerSec);
    };
    pause();
    scrub(e);
    timeline.setPointerCapture(e.pointerId);
    const move = (ev) => scrub(ev);
    const up = () => {
      timeline.removeEventListener('pointermove', move);
      timeline.removeEventListener('pointerup', up);
    };
    timeline.addEventListener('pointermove', move);
    timeline.addEventListener('pointerup', up);
  });

  // ---------- Selection & inspector ----------
  function select(sel) {
    state.selected = sel;
    renderTimeline();
    renderInspector();
  }

  function selectedClip() {
    return state.selected?.type === 'clip' ? state.clips.find((c) => c.id === state.selected.id) : null;
  }
  function selectedText() {
    return state.selected?.type === 'text' ? state.texts.find((t) => t.id === state.selected.id) : null;
  }

  function renderInspector() {
    const clip = selectedClip();
    const text = selectedText();
    $('inspector-empty').hidden = !!(clip || text);
    $('clip-panel').hidden = !clip;
    $('text-panel').hidden = !text;

    if (clip) {
      $('clip-name').textContent = clip.name;
      for (const id of ['clip-in', 'clip-out']) {
        $(id).min = 0;
        $(id).max = clip.duration.toFixed(2);
      }
      $('clip-in').value = clip.in;
      $('clip-out').value = clip.out;
      $('clip-in-val').textContent = formatTime(clip.in);
      $('clip-out-val').textContent = formatTime(clip.out);
      $('clip-meta').textContent =
        `${clip.width}×${clip.height}, ${formatTime(clip.duration)} long` +
        (clip.hasAudio ? '' : ', no audio') +
        `. Using ${formatTime(clipLen(clip))}.`;
      const index = state.clips.indexOf(clip);
      $('clip-left').disabled = index === 0;
      $('clip-right').disabled = index === state.clips.length - 1;
    }
    if (text) {
      if (document.activeElement !== $('text-value')) $('text-value').value = text.text;
      $('text-start').value = text.start.toFixed(1);
      $('text-end').value = text.end.toFixed(1);
      $('text-size').value = text.size;
      $('text-color').value = text.color;
    }
  }

  function trimInput(which) {
    const clip = selectedClip();
    if (!clip) return;
    pause();
    const v = parseFloat($(`clip-${which}`).value);
    if (which === 'in') clip.in = Math.min(v, clip.out - MIN_CLIP);
    else clip.out = Math.max(v, clip.in + MIN_CLIP);
    renderTimeline();
    renderInspector();
    // Show the frame being trimmed.
    const index = state.clips.indexOf(clip);
    seekTo(clipStart(index) + (which === 'in' ? 0 : clipLen(clip) - 0.04));
    updateButtons();
  }
  $('clip-in').addEventListener('input', () => trimInput('in'));
  $('clip-out').addEventListener('input', () => trimInput('out'));

  function moveClip(delta) {
    const clip = selectedClip();
    if (!clip) return;
    const i = state.clips.indexOf(clip);
    const j = i + delta;
    if (j < 0 || j >= state.clips.length) return;
    [state.clips[i], state.clips[j]] = [state.clips[j], state.clips[i]];
    pause();
    renderTimeline();
    renderInspector();
    seekTo(clipStart(j));
  }
  $('clip-left').addEventListener('click', () => moveClip(-1));
  $('clip-right').addEventListener('click', () => moveClip(1));

  function removeSelected() {
    const clip = selectedClip();
    const text = selectedText();
    if (clip) {
      state.clips.splice(state.clips.indexOf(clip), 1);
      pause();
      if (!state.clips.length) {
        video.removeAttribute('src');
        video.load();
        state.loadedIndex = -1;
        state.playhead = 0;
      }
    } else if (text) {
      state.texts.splice(state.texts.indexOf(text), 1);
    } else {
      return;
    }
    select(null);
    updateButtons();
    seekTo(state.playhead);
  }
  $('clip-delete').addEventListener('click', removeSelected);
  $('text-delete').addEventListener('click', removeSelected);

  // Text panel
  $('text-value').addEventListener('input', (e) => {
    const t = selectedText();
    if (t) { t.text = e.target.value; renderTimeline(); }
  });
  $('text-start').addEventListener('change', (e) => {
    const t = selectedText();
    if (!t) return;
    t.start = clamp(parseFloat(e.target.value) || 0, 0, Math.max(0, t.end - MIN_CLIP));
    renderTimeline(); renderInspector();
  });
  $('text-end').addEventListener('change', (e) => {
    const t = selectedText();
    if (!t) return;
    t.end = Math.max(t.start + MIN_CLIP, parseFloat(e.target.value) || 0);
    renderTimeline(); renderInspector();
  });
  $('text-size').addEventListener('input', (e) => {
    const t = selectedText();
    if (t) t.size = parseFloat(e.target.value);
  });
  $('text-color').addEventListener('input', (e) => {
    const t = selectedText();
    if (t) t.color = e.target.value;
  });

  // ---------- Actions ----------
  async function addClips() {
    const { clips, errors } = await api.openClips();
    const wasEmpty = !state.clips.length;
    for (const c of clips) {
      state.clips.push({ ...c, id: nextId++, in: 0, out: c.duration });
    }
    if (errors.length) alert(`Some files couldn't be added:\n\n${errors.join('\n')}`);
    if (!clips.length) return;
    renderTimeline();
    updateButtons();
    if (wasEmpty) seekTo(0);
  }

  function splitAtPlayhead() {
    if (!state.clips.length) return;
    pause();
    const { index, offset } = locate(state.playhead);
    const clip = state.clips[index];
    if (offset < MIN_CLIP || offset > clipLen(clip) - MIN_CLIP) return;
    const cutPoint = clip.in + offset;
    const second = { ...clip, id: nextId++, in: cutPoint };
    clip.out = cutPoint;
    state.clips.splice(index + 1, 0, second);
    select({ type: 'clip', id: second.id });
    seekTo(state.playhead);
  }

  function addText() {
    const total = totalDuration();
    if (!total) return;
    let start = state.playhead;
    if (total - start < 1) start = Math.max(0, total - 3);
    const item = {
      id: nextId++,
      text: 'Your text',
      start,
      end: Math.min(total, start + 3),
      x: 0.5,
      y: 0.85,
      size: 0.07,
      color: '#ffffff',
    };
    state.texts.push(item);
    select({ type: 'text', id: item.id });
    if (state.playhead < item.start) seekTo(item.start);
    $('text-value').focus();
    $('text-value').select();
  }

  function updateButtons() {
    const has = state.clips.length > 0;
    $('empty').hidden = has;
    for (const id of ['btn-export', 'btn-play', 'btn-split', 'btn-add-text']) $(id).disabled = !has;
  }

  $('btn-add').addEventListener('click', addClips);
  $('btn-add-empty').addEventListener('click', addClips);
  $('btn-play').addEventListener('click', () => (state.playing ? pause() : play()));
  $('btn-split').addEventListener('click', splitAtPlayhead);
  $('btn-add-text').addEventListener('click', addText);

  document.addEventListener('keydown', (e) => {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || $('export-dialog').open) return;
    if (e.code === 'Space') { e.preventDefault(); state.playing ? pause() : play(); }
    else if (e.key === 's' || e.key === 'S') splitAtPlayhead();
    else if (e.key === 't' || e.key === 'T') { e.preventDefault(); addText(); }
    else if (e.key === 'Delete' || e.key === 'Backspace') removeSelected();
  });

  // ---------- Export ----------
  const dialog = $('export-dialog');
  const form = $('export-form');
  let exporting = false;

  function syncExportForm() {
    const isGif = form.format.value === 'gif';
    $('mp4-options').hidden = isGif;
    $('gif-options').hidden = !isGif;
    const total = totalDuration();
    $('gif-warning').textContent = isGif && total > 20
      ? `This GIF would be ${Math.round(total)} seconds long. Long GIFs get very large, so consider trimming it or exporting MP4.`
      : '';
  }
  form.addEventListener('change', syncExportForm);

  function setStatus(text, kind = '') {
    $('export-status').textContent = text;
    $('export-status').className = `status ${kind}`;
  }
  function setExporting(on) {
    exporting = on;
    $('export-progress').hidden = !on;
    $('export-start').hidden = on;
    $('export-cancel').hidden = !on;
    $('export-close').disabled = on;
    form.querySelectorAll('select, input').forEach((el) => (el.disabled = on));
  }

  $('btn-export').addEventListener('click', () => {
    pause();
    setStatus('');
    setExporting(false);
    syncExportForm();
    dialog.showModal();
  });
  $('export-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('cancel', (e) => { if (exporting) e.preventDefault(); });
  $('export-cancel').addEventListener('click', () => api.cancelExport());

  $('export-start').addEventListener('click', async () => {
    const total = totalDuration();
    const project = {
      clips: state.clips.map((c) => ({ path: c.path, in: c.in, out: c.out, hasAudio: c.hasAudio })),
      texts: state.texts
        .filter((t) => t.text.trim() && t.start < total)
        .map((t) => ({ ...t, end: Math.min(t.end, total) })),
    };
    const options = {
      format: form.format.value,
      resolution: Number(form.resolution.value),
      fps: Number(form.fps.value),
      quality: form.quality.value,
      gifWidth: Number(form.gifWidth.value),
      gifFps: Number(form.gifFps.value),
    };

    $('progress-fill').style.width = '0%';
    $('progress-label').textContent = '0%';
    setStatus('Choose where to save the file.');
    setExporting(true);
    const stop = api.onProgress((p) => {
      const pct = Math.round(p * 100);
      $('progress-fill').style.width = `${pct}%`;
      $('progress-label').textContent = `${pct}%`;
      setStatus('Exporting…');
    });

    const result = await api.exportProject(project, options);
    stop();
    setExporting(false);
    if (result.ok) setStatus(`Saved to ${result.path}`, 'done');
    else if (result.canceled) setStatus('');
    else setStatus(result.error, 'error');
  });

  // Stop Enter in an input from submitting (and reloading) the window.
  document.querySelectorAll('form').forEach((f) => f.addEventListener('submit', (e) => e.preventDefault()));

  // ---------- Start ----------
  fitStage();
  renderTimeline();
  updateButtons();
  requestAnimationFrame(tick);
})();