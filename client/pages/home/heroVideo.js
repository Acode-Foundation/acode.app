const BUFFER_GRACE_MS = 4000;

export function selectVideoSource(sources, width, connection) {
  const slow =
    connection?.saveData ||
    ['slow-2g', '2g', '3g'].includes(connection?.effectiveType) ||
    (Number.isFinite(connection?.downlink) && connection.downlink >= 0 && connection.downlink < 1.5);
  return width <= 700 || slow ? sources.low : sources.high;
}

export function setupHeroVideo(container, signal, sources) {
  if (signal.aborted) return;
  const video = container.querySelector('video');
  const play = container.querySelector('[data-play-demo]');
  const error = container.querySelector('[data-demo-error]');
  const label = container.querySelector('[data-demo-label]');
  const controls = container.querySelector('[data-demo-controls]');
  const toggle = container.querySelector('[data-demo-toggle]');
  const mute = container.querySelector('[data-demo-mute]');
  const toggleIcon = container.querySelector('[data-demo-toggle-icon]');
  const muteIcon = container.querySelector('[data-demo-mute-icon]');
  const buffering = container.querySelector('[data-demo-buffering]');
  const touch = window.matchMedia('(hover: none) and (pointer: coarse)');
  let frame;
  let awaitingBuffer = false;
  let controlsTimer;
  let selectedSource;
  let loading = false;
  let loadTimer;
  let readinessTimer;
  let graceTimer;
  let graceExpired = false;
  let attempt = 0;
  let focusOrigin;
  video.controls = false;
  video.muted = false;

  function showControls() {
    clearTimeout(controlsTimer);
    if (signal.aborted || !container.classList.contains('is-playing')) return;
    container.classList.add('is-controls-visible');
    if (!video.paused) {
      controlsTimer = setTimeout(() => container.classList.remove('is-controls-visible'), 2500);
    }
  }

  function setLoading(loading) {
    play.disabled = loading;
    toggle.disabled = loading;
    play.setAttribute('aria-busy', String(loading));
    play.setAttribute('aria-label', loading ? 'Loading Acode demo' : 'Watch demo: Acode, 30 seconds');
    label.textContent = loading ? 'Loading…' : 'Watch demo';
  }

  function stopLoading() {
    loading = false;
    awaitingBuffer = false;
    clearTimeout(loadTimer);
    clearInterval(readinessTimer);
    clearTimeout(graceTimer);
    setLoading(false);
  }

  function restoreFocus(target) {
    // Disabling a focused button blurs it in browsers. Do not steal focus if
    // the visitor deliberately moved to another control while waiting.
    if (focusOrigin && [document.body, focusOrigin].includes(document.activeElement)) target.focus({ preventScroll: true });
    focusOrigin = undefined;
  }

  function showBuffering(show) {
    if (buffering) buffering.hidden = !show;
  }

  function releaseVideo() {
    video.pause();
    if (video.hasAttribute('src')) {
      video.removeAttribute('src');
      video.load();
    }
  }

  function updateControls() {
    const touchPlayback = touch.matches && container.classList.contains('is-playing');
    const playbackLabel = video.paused ? 'Play video' : 'Pause video';
    toggle.hidden = touch.matches;
    video.tabIndex = touchPlayback ? 0 : -1;
    video.setAttribute('aria-label', touchPlayback ? playbackLabel : 'Acode demo video');
    if (touchPlayback) video.setAttribute('role', 'button');
    else video.removeAttribute('role');
    toggle.setAttribute('aria-label', playbackLabel);
    toggleIcon.setAttribute('d', video.paused ? 'm9 5 10 7-10 7Z' : 'M8 5v14M16 5v14');
    mute.setAttribute('aria-label', video.muted ? 'Unmute video' : 'Mute video');
    mute.setAttribute('aria-pressed', String(video.muted));
    muteIcon.setAttribute('d', `M11 5 6 9H3v6h3l5 4V5Z${video.muted ? 'M16 9l6 6m0-6-6 6' : 'M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14'}`);
    showControls();
  }

  function revealVideo() {
    frame = undefined;
    if (signal.aborted || !loading) return;
    awaitingBuffer = true;
    // A decoded frame alone can arrive while the rest is still buffering.
    if (!container.classList.contains('is-playing') && !graceExpired && video.readyState < video.HAVE_ENOUGH_DATA) {
      // Preserve the user's playback permission, but do not consume the demo
      // behind the cover while a slow connection is still filling the buffer.
      video.pause();
      video.currentTime = 0;
      video.preload = 'auto';
      return;
    }
    container.classList.add('is-playing');
    play.hidden = true;
    controls.hidden = false;
    stopLoading();
    showBuffering(video.readyState < video.HAVE_FUTURE_DATA);
    updateControls();
    restoreFocus(touch.matches ? video : toggle);
  }

  function showPlaybackError() {
    if (signal.aborted) return;
    attempt++;
    if (frame !== undefined) video.cancelVideoFrameCallback(frame);
    frame = undefined;
    stopLoading();
    releaseVideo();
    container.classList.remove('is-playing', 'is-controls-visible');
    controls.hidden = true;
    play.hidden = false;
    showBuffering(false);
    error.hidden = false;
    restoreFocus(play);
  }

  async function playAndReveal() {
    const currentAttempt = attempt;
    await video.play();
    if (signal.aborted) return video.pause();
    if (currentAttempt !== attempt) {
      if (!loading && !container.classList.contains('is-playing')) video.pause();
      return;
    }
    if (!container.classList.contains('is-playing') && typeof video.requestVideoFrameCallback === 'function') {
      frame = video.requestVideoFrameCallback(() => {
        if (currentAttempt === attempt) revealVideo();
      });
    } else {
      revealVideo();
    }
  }

  async function start() {
    if (loading || signal.aborted) return;
    focusOrigin = [play, toggle, video].includes(document.activeElement) ? document.activeElement : undefined;
    const currentAttempt = ++attempt;
    loading = true;
    setLoading(true);
    // Readiness events can be missed or omitted by a browser, so poll too.
    // After a short grace, play while buffering: some browsers stop loading a
    // paused video, so HAVE_ENOUGH_DATA may never arrive behind the cover.
    graceExpired = false;
    readinessTimer = setInterval(resumeWhenReady, 500);
    graceTimer = setTimeout(() => {
      if (currentAttempt !== attempt) return;
      graceExpired = true;
      resumeWhenReady();
    }, BUFFER_GRACE_MS);
    loadTimer = setTimeout(showPlaybackError, 30_000);
    error.hidden = true;
    // Scroll the page itself, not the home's overflow-clipped ancestors.
    const scroller = container.closest('#app') || document.scrollingElement;
    const bounds = container.getBoundingClientRect();
    const top = scroller === document.scrollingElement ? 0 : scroller.getBoundingClientRect().top;
    scroller.scrollTo({
      top: scroller.scrollTop + bounds.top + bounds.height / 2 - top - scroller.clientHeight / 2,
      behavior: 'smooth',
    });
    try {
      if (!selectedSource && sources) selectedSource = selectVideoSource(sources, window.innerWidth, navigator.connection);
      if (selectedSource && !video.hasAttribute('src')) video.src = selectedSource;
      if (video.error) video.load();
      await playAndReveal();
    } catch {
      if (currentAttempt === attempt) showPlaybackError();
    }
  }

  play.addEventListener('click', start, { signal });
  touch.addEventListener('change', updateControls, { signal });
  function resumeWhenReady() {
    if (!loading || !awaitingBuffer || signal.aborted || (!graceExpired && video.readyState < video.HAVE_ENOUGH_DATA)) return;
    awaitingBuffer = false;
    const currentAttempt = attempt;
    playAndReveal().catch(() => {
      if (currentAttempt === attempt) showPlaybackError();
    });
  }
  for (const event of ['canplaythrough', 'canplay', 'progress']) video.addEventListener(event, resumeWhenReady, { signal });
  for (const event of ['waiting', 'stalled']) {
    video.addEventListener(
      event,
      () => showBuffering(container.classList.contains('is-playing') && !video.paused && video.readyState < video.HAVE_FUTURE_DATA),
      { signal },
    );
  }
  for (const event of ['playing', 'canplay', 'pause']) video.addEventListener(event, () => showBuffering(false), { signal });
  video.addEventListener('error', showPlaybackError, { signal });
  for (const event of ['pointerenter', 'pointermove', 'pointerdown', 'focusin']) {
    container.addEventListener(event, showControls, { signal });
  }
  function togglePlayback() {
    if (toggle.disabled) return;
    if (video.paused) start();
    else video.pause();
  }

  toggle.addEventListener('click', togglePlayback, { signal });
  video.addEventListener(
    'click',
    () => {
      if (touch.matches && container.classList.contains('is-playing')) togglePlayback();
    },
    { signal },
  );
  video.addEventListener(
    'keydown',
    (event) => {
      if (!touch.matches || !container.classList.contains('is-playing') || !['Enter', ' '].includes(event.key)) return;
      event.preventDefault();
      togglePlayback();
    },
    { signal },
  );
  mute.addEventListener(
    'click',
    () => {
      video.muted = !video.muted;
      updateControls();
    },
    { signal },
  );
  for (const event of ['play', 'pause', 'volumechange']) video.addEventListener(event, updateControls, { signal });

  video.addEventListener(
    'ended',
    () => {
      stopLoading();
      showBuffering(false);
      const focused = controls.contains(document.activeElement) || document.activeElement === video;
      clearTimeout(controlsTimer);
      container.classList.remove('is-playing', 'is-controls-visible');
      controls.hidden = true;
      play.hidden = false;
      // Keep the buffered media for replay. play() restarts an ended video.
      updateControls();
      if (focused) play.focus();
    },
    { signal },
  );
  signal.addEventListener(
    'abort',
    () => {
      attempt++;
      if (frame !== undefined) video.cancelVideoFrameCallback(frame);
      clearTimeout(controlsTimer);
      stopLoading();
      showBuffering(false);
      releaseVideo();
    },
    { once: true },
  );
  updateControls();
}
