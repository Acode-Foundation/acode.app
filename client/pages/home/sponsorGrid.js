export const HOME_MIN_SPONSORS = 6;

// Match the grid's dense placement, preserving the ranked first six cards and
// filling only their remaining row space with additional sponsors.
export function selectSponsorCards(spans, columns, minimum = HOME_MIN_SPONSORS) {
  const rows = [];
  const visible = new Set();
  spans.forEach((span, index) => {
    const width = Math.min(columns, span);
    let row = rows.findIndex((remaining) => remaining >= width);
    if (row < 0) {
      if (index >= minimum) return;
      row = rows.length;
      rows.push(columns);
    }
    rows[row] -= width;
    visible.add(index);
  });
  return visible;
}

function columnCount(grid, cards, spans) {
  if (!grid.clientWidth) return 0;
  const style = getComputedStyle(grid);
  const tracks = style.gridTemplateColumns.trim().split(/\s+/);
  if (tracks.every((track) => /^\d+(?:\.\d+)?px$/.test(track))) return tracks.length;

  // Some engines retain repeat()/minmax() in computed styles. Derive a track
  // width from any visible card, including a double-width premium card.
  const index = cards.findIndex((card) => card.getBoundingClientRect().width > 0);
  if (index < 0) return 0;
  const gap = Number.parseFloat(style.columnGap) || 0;
  const trackWidth = (cards[index].getBoundingClientRect().width - (spans[index] - 1) * gap) / spans[index];
  return Math.max(1, Math.round((grid.clientWidth + gap) / (trackWidth + gap)));
}

export function setupSponsorGrid(grid, signal) {
  if (signal.aborted || typeof ResizeObserver !== 'function') return;
  const cards = [...grid.children];
  const update = () => {
    if (signal.aborted || !grid.isConnected) return;
    const spans = cards.map((card) => Number.parseInt(getComputedStyle(card).gridColumnStart.replace('span ', ''), 10) || 1);
    const columns = columnCount(grid, cards, spans);
    if (!columns) return;
    const visible = selectSponsorCards(spans, columns);
    cards.forEach((card, index) => {
      card.hidden = !visible.has(index);
    });
  };
  update();
  const observer = new ResizeObserver(update);
  observer.observe(grid);
  signal.addEventListener('abort', () => observer.disconnect(), { once: true });
}
