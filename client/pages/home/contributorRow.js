/** Show only complete avatars that fit the available row, including overlap. */
export function setupContributorRow(row, signal) {
  if (signal.aborted || typeof ResizeObserver !== 'function') return;
  const cards = [...row.children];
  if (!cards.length) return;

  const update = () => {
    if (signal.aborted || !row.isConnected || !row.clientWidth) return;
    const style = getComputedStyle(row);
    const avatar = getComputedStyle(cards[0]);
    const available = row.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const step = parseFloat(avatar.width) + parseFloat(avatar.marginLeft) + parseFloat(avatar.marginRight);
    if (!Number.isFinite(step) || step <= 0 || !Number.isFinite(available)) return;
    const count = Math.max(0, Math.floor(available / step));
    cards.forEach((card, index) => {
      card.hidden = index >= count;
    });
    row.scrollLeft = 0;
  };
  const observer = new ResizeObserver(update);
  observer.observe(row);
  signal.addEventListener('abort', () => observer.disconnect(), { once: true });
  update();
}
