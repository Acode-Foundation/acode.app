// @vitest-environment jsdom

import { selectVideoSource, setupHeroVideo } from '../../client/pages/home/heroVideo';

let container;
let video;
let play;
let error;
let lifecycle;
let controls;
let toggle;
let mute;
let paused;
let scroller;
let readyState;
let touch;

beforeEach(() => {
  vi.useFakeTimers();
  touch = Object.assign(new EventTarget(), { matches: false });
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => touch),
  );
  scroller = document.createElement('div');
  scroller.id = 'app';
  scroller.scrollTo = vi.fn();
  scroller.scrollTop = 200;
  Object.defineProperty(scroller, 'clientHeight', { value: 800 });
  scroller.getBoundingClientRect = () => ({ top: 50 });
  container = document.createElement('div');
  container.getBoundingClientRect = () => ({ top: 700, height: 200 });
  container.innerHTML =
    '<video preload="none" tabindex="-1"></video><img src="cover.png" class="home-demo__poster"><button data-play-demo><span data-demo-label>Watch demo</span></button><div data-demo-controls hidden><button data-demo-toggle><svg><path data-demo-toggle-icon></path></svg></button><button data-demo-mute><svg><path data-demo-mute-icon></path></svg></button></div><div data-demo-buffering hidden></div><p data-demo-error hidden></p>';
  scroller.append(container);
  document.body.append(scroller);
  video = container.querySelector('video');
  play = container.querySelector('button');
  error = container.querySelector('p');
  controls = container.querySelector('[data-demo-controls]');
  toggle = container.querySelector('[data-demo-toggle]');
  mute = container.querySelector('[data-demo-mute]');
  paused = true;
  readyState = 4;
  Object.defineProperty(video, 'paused', { get: () => paused });
  Object.defineProperty(video, 'readyState', { get: () => readyState });
  video.play = vi.fn(async () => {
    paused = false;
    video.dispatchEvent(new Event('play'));
  });
  video.pause = vi.fn(() => {
    paused = true;
    video.dispatchEvent(new Event('pause'));
  });
  video.load = vi.fn();
  video.cancelVideoFrameCallback = vi.fn();
  lifecycle = new AbortController();
  setupHeroVideo(container, lifecycle.signal, { low: '/demo-480.mp4', high: '/demo-720.mp4' });
});

afterEach(() => {
  lifecycle.abort();
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('starts with sound, shows only custom controls, and restores the cover after playback', async () => {
  expect(video.getAttribute('src')).toBeNull();
  expect(video.play).not.toHaveBeenCalled();
  expect(video.load).not.toHaveBeenCalled();
  expect(video.controls).toBe(false);
  expect(video.muted).toBe(false);
  expect(container.classList.contains('is-playing')).toBe(false);
  play.focus();
  play.click();
  expect(play.getAttribute('aria-busy')).toBe('true');
  expect(play.disabled).toBe(true);
  expect(play.textContent).toBe('Loading…');
  await vi.advanceTimersByTimeAsync(0);
  expect(play.getAttribute('aria-busy')).toBe('false');
  expect(video.controls).toBe(false);
  expect(controls.hidden).toBe(false);
  expect(container.classList.contains('is-playing')).toBe(true);
  expect(play.hidden).toBe(true);
  expect(document.activeElement).toBe(toggle);

  video.dispatchEvent(new Event('ended'));
  expect(video.load).not.toHaveBeenCalled();
  expect(container.querySelector('img').getAttribute('src')).toBe('cover.png');
  expect(controls.hidden).toBe(true);
  expect(container.classList.contains('is-playing')).toBe(false);
  expect(video.controls).toBe(false);
  expect(play.hidden).toBe(false);
  expect(document.activeElement).toBe(play);
});

it('keeps the cover and loading indicator until the first video frame is ready', async () => {
  let ready;
  video.requestVideoFrameCallback = vi.fn((callback) => {
    ready = callback;
    return 1;
  });
  play.click();
  await vi.advanceTimersByTimeAsync(0);
  expect(container.classList.contains('is-playing')).toBe(false);
  expect(play.getAttribute('aria-busy')).toBe('true');
  expect(controls.hidden).toBe(true);
  ready();
  expect(container.classList.contains('is-playing')).toBe(true);
  expect(play.getAttribute('aria-busy')).toBe('false');
});

it('supports pause/resume and mute/unmute without enabling native controls or seeking', async () => {
  play.click();
  await vi.advanceTimersByTimeAsync(0);
  toggle.click();
  expect(video.pause).toHaveBeenCalledOnce();
  expect(toggle.getAttribute('aria-label')).toBe('Play video');
  toggle.click();
  await vi.advanceTimersByTimeAsync(0);
  expect(video.play).toHaveBeenCalledTimes(2);
  expect(toggle.getAttribute('aria-label')).toBe('Pause video');
  mute.click();
  expect(video.muted).toBe(true);
  expect(mute.getAttribute('aria-label')).toBe('Unmute video');
  mute.click();
  expect(video.muted).toBe(false);
  expect(mute.getAttribute('aria-pressed')).toBe('false');
  expect(video.controls).toBe(false);
  expect(video.currentTime).toBe(0);
});

it('uses video taps for touch playback and keeps mute independent', async () => {
  touch.matches = true;
  touch.dispatchEvent(new Event('change'));
  expect(toggle.hidden).toBe(true);
  video.click();
  expect(video.play).not.toHaveBeenCalled();
  play.focus();
  play.click();
  await vi.advanceTimersByTimeAsync(0);
  expect(document.activeElement).toBe(video);
  expect(video.getAttribute('role')).toBe('button');
  video.click();
  expect(video.paused).toBe(true);
  expect(video.getAttribute('aria-label')).toBe('Play video');
  mute.click();
  expect(video.muted).toBe(true);
  expect(video.paused).toBe(true);
  video.click();
  await vi.advanceTimersByTimeAsync(0);
  expect(video.paused).toBe(false);
  video.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
  expect(video.paused).toBe(true);
  touch.matches = false;
  touch.dispatchEvent(new Event('change'));
  expect(toggle.hidden).toBe(false);
  expect(video.tabIndex).toBe(-1);
  video.click();
  expect(video.paused).toBe(true);
});

it('keeps the poster and loading state until both a frame and enough buffered data are ready', async () => {
  let ready;
  readyState = 3;
  video.requestVideoFrameCallback = vi.fn((callback) => {
    ready = callback;
    return 1;
  });
  play.click();
  await vi.advanceTimersByTimeAsync(0);
  ready();
  expect(container.classList.contains('is-playing')).toBe(false);
  expect(play.getAttribute('aria-busy')).toBe('true');
  expect(controls.hidden).toBe(true);
  expect(video.paused).toBe(true);
  expect(video.currentTime).toBe(0);
  readyState = 4;
  video.dispatchEvent(new Event('canplaythrough'));
  await vi.advanceTimersByTimeAsync(0);
  ready();
  expect(video.paused).toBe(false);
  expect(container.classList.contains('is-playing')).toBe(true);
  expect(play.getAttribute('aria-busy')).toBe('false');
});

it('restores retry when buffering fails and does not reveal a late frame', async () => {
  readyState = 3;
  play.click();
  await vi.advanceTimersByTimeAsync(0);
  video.dispatchEvent(new Event('error'));
  expect(error.hidden).toBe(false);
  expect(play.disabled).toBe(false);
  readyState = 4;
  video.dispatchEvent(new Event('canplaythrough'));
  expect(container.classList.contains('is-playing')).toBe(false);
});

it('smoothly centers playback in the app scroll container on Play and resume', async () => {
  play.click();
  await vi.advanceTimersByTimeAsync(0);
  expect(scroller.scrollTo).toHaveBeenCalledWith({ behavior: 'smooth', top: 550 });
  toggle.click();
  toggle.click();
  await vi.advanceTimersByTimeAsync(0);
  expect(scroller.scrollTo).toHaveBeenCalledTimes(2);
  expect(scroller.scrollTo).toHaveBeenLastCalledWith({ behavior: 'smooth', top: 550 });
});

it('hides idle controls, reveals them on hover or tap, and keeps them visible while paused', async () => {
  play.click();
  await vi.advanceTimersByTimeAsync(0);
  expect(container.classList.contains('is-controls-visible')).toBe(true);
  vi.advanceTimersByTime(2500);
  expect(container.classList.contains('is-controls-visible')).toBe(false);
  for (const event of ['pointerenter', 'pointermove', 'pointerdown', 'focusin']) {
    container.dispatchEvent(new Event(event));
    expect(container.classList.contains('is-controls-visible')).toBe(true);
    vi.advanceTimersByTime(2500);
    expect(container.classList.contains('is-controls-visible')).toBe(false);
  }
  toggle.click();
  vi.advanceTimersByTime(5000);
  expect(container.classList.contains('is-controls-visible')).toBe(true);
  toggle.click();
  await vi.advanceTimersByTimeAsync(0);
  expect(vi.getTimerCount()).toBe(1);
  lifecycle.abort();
  expect(vi.getTimerCount()).toBe(0);
});

it('cancels a pending frame reveal when leaving the page', async () => {
  video.requestVideoFrameCallback = vi.fn(() => 7);
  video.cancelVideoFrameCallback = vi.fn();
  play.click();
  await vi.advanceTimersByTimeAsync(0);
  lifecycle.abort();
  expect(video.cancelVideoFrameCallback).toHaveBeenCalledWith(7);
  expect(controls.hidden).toBe(true);
  expect(play.getAttribute('aria-busy')).toBe('false');
});

it('keeps the play button usable and shows a fallback when playback fails', async () => {
  video.play.mockRejectedValue(new Error('Unavailable'));
  play.click();
  await vi.advanceTimersByTimeAsync(0);
  expect(play.hidden).toBe(false);
  expect(play.disabled).toBe(false);
  expect(play.getAttribute('aria-busy')).toBe('false');
  expect(play.textContent).toBe('Watch demo');
  expect(error.hidden).toBe(false);
  expect(container.classList.contains('is-playing')).toBe(false);
  expect(video.controls).toBe(false);
});

it('stops playback if navigation happens while the video is loading', async () => {
  let finish;
  video.play.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  play.click();
  lifecycle.abort();
  finish();
  await vi.advanceTimersByTimeAsync(0);
  expect(video.pause).toHaveBeenCalled();
  expect(play.hidden).toBe(false);
  expect(video.controls).toBe(false);
});

it.each([
  [390, undefined, 'low'],
  [700, undefined, 'low'],
  [701, undefined, 'high'],
  [1280, { saveData: true }, 'low'],
  [1280, { effectiveType: '3g' }, 'low'],
  [1280, { effectiveType: '2g' }, 'low'],
  [1280, { effectiveType: 'slow-2g' }, 'low'],
  [1280, { downlink: 0 }, 'low'],
  [1280, { downlink: Number.NaN }, 'high'],
  [1280, { downlink: 1.4 }, 'low'],
  [1280, { downlink: 1.5, effectiveType: '4g' }, 'high'],
])('chooses the right video at width %s with connection %j', (width, connection, expected) => {
  expect(selectVideoSource({ low: 'low', high: 'high' }, width, connection)).toBe(expected);
});

it('selects the source once on Play and retains it when the viewport changes', async () => {
  vi.stubGlobal('innerWidth', 390);
  play.click();
  await vi.advanceTimersByTimeAsync(0);
  expect(video.getAttribute('src')).toBe('/demo-480.mp4');
  toggle.click();
  vi.stubGlobal('innerWidth', 1280);
  toggle.click();
  await vi.advanceTimersByTimeAsync(0);
  expect(video.getAttribute('src')).toBe('/demo-480.mp4');
});

it('restores keyboard focus after browsers blur a disabled button, including resume', async () => {
  play.focus();
  play.click();
  play.blur();
  await vi.advanceTimersByTimeAsync(0);
  expect(document.activeElement).toBe(toggle);
  toggle.click();
  toggle.click();
  toggle.blur();
  await vi.advanceTimersByTimeAsync(0);
  expect(document.activeElement).toBe(toggle);
});

it('does not steal focus moved elsewhere while loading', async () => {
  const elsewhere = document.createElement('button');
  document.body.append(elsewhere);
  play.focus();
  play.click();
  elsewhere.focus();
  await vi.advanceTimersByTimeAsync(0);
  expect(document.activeElement).toBe(elsewhere);
});

it('recovers readiness without another canplaythrough event, without revealing early', async () => {
  readyState = 3;
  play.click();
  await vi.advanceTimersByTimeAsync(1500);
  expect(video.paused).toBe(true);
  expect(play.disabled).toBe(true);
  expect(container.classList.contains('is-playing')).toBe(false);
  readyState = 4;
  await vi.advanceTimersByTimeAsync(500);
  expect(video.paused).toBe(false);
  expect(container.classList.contains('is-playing')).toBe(true);
});

it('returns to an actionable retry when readiness never arrives and cancels late frames', async () => {
  let lateFrame;
  video.requestVideoFrameCallback = vi.fn((callback) => {
    lateFrame = callback;
    return 8;
  });
  play.click();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(play.disabled).toBe(false);
  expect(error.hidden).toBe(false);
  expect(video.cancelVideoFrameCallback).toHaveBeenCalledWith(8);
  lateFrame();
  expect(container.classList.contains('is-playing')).toBe(false);
  play.click();
  await vi.advanceTimersByTimeAsync(0);
  lateFrame();
  expect(container.classList.contains('is-playing')).toBe(true);
});

it('allows a fresh user gesture to retry when buffered playback is denied', async () => {
  readyState = 3;
  play.click();
  await vi.advanceTimersByTimeAsync(0);
  video.play.mockRejectedValueOnce(new DOMException('Gesture required', 'NotAllowedError'));
  readyState = 4;
  video.dispatchEvent(new Event('canplaythrough'));
  await vi.advanceTimersByTimeAsync(0);
  expect(play.disabled).toBe(false);
  expect(error.hidden).toBe(false);
  expect(container.classList.contains('is-playing')).toBe(false);
  play.click();
  await vi.advanceTimersByTimeAsync(0);
  expect(container.classList.contains('is-playing')).toBe(true);
});

it('shows buffering after reveal without moving the poster or disabling pause', async () => {
  const indicator = container.querySelector('[data-demo-buffering]');
  play.click();
  await vi.advanceTimersByTimeAsync(0);
  readyState = 2;
  video.dispatchEvent(new Event('waiting'));
  expect(indicator.hidden).toBe(false);
  expect(container.classList.contains('is-playing')).toBe(true);
  expect(toggle.disabled).toBe(false);
  video.dispatchEvent(new Event('playing'));
  expect(indicator.hidden).toBe(true);
  video.dispatchEvent(new Event('stalled'));
  expect(indicator.hidden).toBe(false);
  toggle.click();
  expect(indicator.hidden).toBe(true);
});

it('releases the selected video source when navigating away during buffering', async () => {
  readyState = 3;
  play.click();
  await vi.advanceTimersByTimeAsync(0);
  expect(video.preload).toBe('auto');
  lifecycle.abort();
  expect(video.getAttribute('src')).toBeNull();
  expect(video.load).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it('keeps the completed demo buffered for replay without reloading it', async () => {
  readyState = 3;
  play.click();
  await vi.advanceTimersByTimeAsync(0);
  readyState = 4;
  video.dispatchEvent(new Event('canplaythrough'));
  await vi.advanceTimersByTimeAsync(0);
  video.dispatchEvent(new Event('ended'));
  expect(video.load).not.toHaveBeenCalled();
  play.click();
  await vi.advanceTimersByTimeAsync(0);
  expect(container.classList.contains('is-playing')).toBe(true);
});

it('stops a timed-out download and retries the originally selected quality', async () => {
  vi.stubGlobal('innerWidth', 390);
  video.play.mockReturnValueOnce(new Promise(() => {}));
  play.click();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(error.hidden).toBe(false);
  expect(video.getAttribute('src')).toBeNull();
  vi.stubGlobal('innerWidth', 1280);
  readyState = 4;
  play.click();
  await vi.advanceTimersByTimeAsync(0);
  expect(video.getAttribute('src')).toBe('/demo-480.mp4');
  expect(container.classList.contains('is-playing')).toBe(true);
});

it('plays while buffering when paused media never reaches enough data', async () => {
  const indicator = container.querySelector('[data-demo-buffering]');
  readyState = 2;
  play.click();
  await vi.advanceTimersByTimeAsync(3999);
  expect(video.paused).toBe(true);
  expect(play.textContent).toBe('Loading…');
  expect(container.classList.contains('is-playing')).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(video.paused).toBe(false);
  expect(container.classList.contains('is-playing')).toBe(true);
  expect(play.hidden).toBe(true);
  expect(play.textContent).toBe('Watch demo');
  expect(indicator.hidden).toBe(false);
  expect(vi.getTimerCount()).toBe(1);
});

it('still reveals as soon as enough data arrives within the grace period', async () => {
  readyState = 3;
  play.click();
  await vi.advanceTimersByTimeAsync(1000);
  expect(container.classList.contains('is-playing')).toBe(false);
  readyState = 4;
  video.dispatchEvent(new Event('canplaythrough'));
  await vi.advanceTimersByTimeAsync(0);
  expect(container.classList.contains('is-playing')).toBe(true);
  expect(video.play).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(5000);
  expect(video.play).toHaveBeenCalledTimes(2);
});

it('cancels the grace fallback when leaving the page while buffering', async () => {
  readyState = 2;
  play.click();
  await vi.advanceTimersByTimeAsync(1000);
  lifecycle.abort();
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(5000);
  expect(video.play).toHaveBeenCalledOnce();
  expect(container.classList.contains('is-playing')).toBe(false);
});
