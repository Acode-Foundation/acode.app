// @vitest-environment jsdom

import { setupContributorRow } from '../../client/pages/home/contributorRow';

it('shows only complete avatars that fit, updates on resize, and disconnects on navigation', () => {
  const row = document.createElement('div');
  row.append(...Array.from({ length: 24 }, () => document.createElement('a')));
  document.body.append(row);
  let width = 784;
  let avatarWidth = 40;
  let overlap = -10;
  let resize;
  const disconnect = vi.fn();
  Object.defineProperty(row, 'clientWidth', { get: () => width });
  vi.stubGlobal('getComputedStyle', (element) =>
    element === row ? { paddingLeft: '20px', paddingRight: '10px' } : { width: `${avatarWidth}px`, marginLeft: `${overlap}px`, marginRight: '0px' },
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback) {
        resize = callback;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  const lifecycle = new AbortController();
  try {
    setupContributorRow(row, lifecycle.signal);
    const visible = () => [...row.children].filter((card) => !card.hidden).length;
    expect(visible()).toBe(24);
    width = 342;
    avatarWidth = 34;
    overlap = -8;
    resize();
    expect(visible()).toBe(12);
    expect(row.children[11].hidden).toBe(false);
    expect(row.children[12].hidden).toBe(true);
    width = 200;
    resize();
    expect(visible()).toBe(6);
    width = 784;
    avatarWidth = 40;
    overlap = -10;
    resize();
    expect(visible()).toBe(24);
    lifecycle.abort();
    expect(disconnect).toHaveBeenCalledOnce();
    width = 100;
    resize();
    expect(visible()).toBe(24);
  } finally {
    lifecycle.abort();
    row.remove();
    vi.unstubAllGlobals();
  }
});
