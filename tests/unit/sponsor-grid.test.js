// @vitest-environment jsdom

import { HOME_MIN_SPONSORS, selectSponsorCards, setupSponsorGrid } from '../../client/pages/home/sponsorGrid';

describe('home sponsor row filling', () => {
  it('fills the screenshot layout from six to ten cards across five columns', () => {
    expect([...selectSponsorCards(Array(18).fill(1), 5)]).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('does not add a row when the first six cards already fit evenly', () => {
    for (const columns of [1, 2, 3, 6]) {
      expect([...selectSponsorCards(Array(18).fill(1), columns)]).toEqual([0, 1, 2, 3, 4, 5]);
    }
  });

  it('accounts for wide premium cards and skips fillers that cannot fit', () => {
    expect([...selectSponsorCards([2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1], 5)]).toEqual([0, 1, 2, 3, 4, 5, 7, 8, 9]);
    expect([...selectSponsorCards([2, 1, 1, 1, 1, 1, 2, 1, 1], 5)]).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('keeps available cards when there are too few sponsors to complete a row', () => {
    expect([...selectSponsorCards([1, 1, 1], 5)]).toEqual([0, 1, 2]);
    expect([...selectSponsorCards([], 5)]).toEqual([]);
  });
});

describe('home sponsor grid lifecycle', () => {
  let resize;
  let observer;
  let grid;
  let columns;
  let width;

  beforeEach(() => {
    columns = ' 180px  180px\t180px 180px 180px ';
    width = 940;
    observer = { observe: vi.fn(), disconnect: vi.fn() };
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback) {
          resize = callback;
          this.observe = observer.observe;
          this.disconnect = observer.disconnect;
        }
      },
    );
    vi.stubGlobal('getComputedStyle', (element) =>
      element === grid ? { gridTemplateColumns: columns, columnGap: '10px' } : { gridColumnStart: `span ${element.dataset.span}` },
    );
    grid = document.createElement('div');
    Object.defineProperty(grid, 'clientWidth', { get: () => width });
    for (let index = 0; index < 18; index += 1) {
      const card = document.createElement('div');
      card.dataset.span = '1';
      card.hidden = index >= HOME_MIN_SPONSORS;
      card.getBoundingClientRect = () => ({ width: card.hidden ? 0 : Number(card.dataset.span) * 190 - 10 });
      grid.append(card);
    }
    document.body.append(grid);
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  const visibleCount = () => [...grid.children].filter((card) => !card.hidden).length;

  it('fills immediately, recalculates on resize, and stops when aborted', () => {
    const lifecycle = new AbortController();
    setupSponsorGrid(grid, lifecycle.signal);
    expect(visibleCount()).toBe(10);
    expect(observer.observe).toHaveBeenCalledWith(grid);

    columns = '180px 180px 180px';
    width = 560;
    resize();
    expect(visibleCount()).toBe(6);

    lifecycle.abort();
    expect(observer.disconnect).toHaveBeenCalledOnce();
    columns = '180px 180px 180px 180px 180px';
    width = 940;
    resize();
    expect(visibleCount()).toBe(6);
  });

  it('measures tracks from wide cards when computed styles retain repeat/minmax', () => {
    columns = 'repeat(auto-fill, minmax(180px, 1fr))';
    for (const card of [...grid.children].slice(0, HOME_MIN_SPONSORS)) {
      card.dataset.span = '2';
    }
    setupSponsorGrid(grid, new AbortController().signal);
    expect(visibleCount()).toBe(9);
  });

  it('waits for a detached or hidden grid to have a measurable layout', () => {
    grid.remove();
    columns = 'none';
    width = 0;
    setupSponsorGrid(grid, new AbortController().signal);
    expect(visibleCount()).toBe(HOME_MIN_SPONSORS);
    document.body.append(grid);
    resize();
    expect(visibleCount()).toBe(HOME_MIN_SPONSORS);
    columns = 'repeat(auto-fill, minmax(180px, 1fr))';
    width = 940;
    resize();
    expect(visibleCount()).toBe(10);
  });

  it('keeps the initial fallback when ResizeObserver is unavailable or the page already left', () => {
    const lifecycle = new AbortController();
    lifecycle.abort();
    setupSponsorGrid(grid, lifecycle.signal);
    expect(observer.observe).not.toHaveBeenCalled();
    vi.stubGlobal('ResizeObserver', undefined);
    expect(() => setupSponsorGrid(grid, new AbortController().signal)).not.toThrow();
    expect(visibleCount()).toBe(HOME_MIN_SPONSORS);
  });
});
