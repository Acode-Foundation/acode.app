/** Show the full brand name only when the mobile header has room for it. */
export function setupHeaderTitle(header) {
  const brand = header.querySelector('nav:first-of-type');
  const logo = brand.querySelector('a.logo');
  const title = logo.querySelector('.text');
  const mobile = window.matchMedia('(max-width: 760px)');

  function update() {
    // Measure the full link, including its image, spacing, and padding, before deciding.
    title.hidden = false;
    if (mobile.matches) {
      title.hidden = logo.getBoundingClientRect().width > brand.getBoundingClientRect().width;
    }
  }

  const observer = new ResizeObserver(update);
  // The available slot stays the same size when the title hides, avoiding observer loops.
  observer.observe(brand);
  observer.observe(logo.querySelector('img'));
  mobile.addEventListener('change', update);
  document.fonts?.ready.then(update);
  update();
}
