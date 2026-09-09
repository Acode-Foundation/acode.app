import { setupHeaderTitle } from '../../client/lib/headerTitle';

describe('responsive header title', () => {
  let title;
  let image;
  let logo;
  let brand;
  let header;
  let mobile;
  let observer;
  let resized;
  let fontsLoaded;
  let availableWidth;
  let requiredWidth;

  beforeEach(() => {
    availableWidth = 120;
    requiredWidth = 100;
    title = { hidden: false };
    image = {};
    logo = {
      querySelector: (selector) => (selector === '.text' ? title : image),
      getBoundingClientRect: () => ({ width: title.hidden ? 48 : requiredWidth }),
    };
    brand = { querySelector: () => logo, getBoundingClientRect: () => ({ width: availableWidth }) };
    header = { querySelector: () => brand };
    mobile = new EventTarget();
    mobile.matches = true;
    vi.stubGlobal('window', { matchMedia: () => mobile });
    vi.stubGlobal('document', {
      fonts: {
        ready: new Promise((resolve) => {
          fontsLoaded = resolve;
        }),
      },
    });
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback) {
          resized = callback;
          observer = this;
        }
        observe = vi.fn();
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows, hides, and restores the name as available space changes', () => {
    setupHeaderTitle(header);
    expect(title.hidden).toBe(false);
    availableWidth = requiredWidth;
    resized();
    expect(title.hidden).toBe(false);
    availableWidth = 70;
    resized();
    expect(title.hidden).toBe(true);
    // Repeated notifications must measure the full name, not toggle based on the smaller hidden link.
    resized();
    expect(title.hidden).toBe(true);
    availableWidth = 120;
    resized();
    expect(title.hidden).toBe(false);
    expect(observer.observe.mock.calls).toEqual([[brand], [image]]);
  });

  it('rechecks measurements after fonts and the logo image load', async () => {
    setupHeaderTitle(header);
    requiredWidth = 130;
    fontsLoaded();
    await document.fonts.ready;
    expect(title.hidden).toBe(true);
    requiredWidth = 115;
    resized();
    expect(title.hidden).toBe(false);
  });

  it('always restores the desktop name and rechecks when returning to mobile', () => {
    availableWidth = 70;
    setupHeaderTitle(header);
    expect(title.hidden).toBe(true);
    mobile.matches = false;
    mobile.dispatchEvent(new Event('change'));
    expect(title.hidden).toBe(false);
    mobile.matches = true;
    mobile.dispatchEvent(new Event('change'));
    expect(title.hidden).toBe(true);
  });
});
