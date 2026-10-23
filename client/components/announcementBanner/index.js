import './style.scss';
import { isAccountRoute } from '../../../shared/adPolicy';

export default function AnnouncementBanner() {
  const setHeight = (value) => document.documentElement.style.setProperty('--announcement-height', value);
  setHeight('0px');
  if (isAccountRoute(location.pathname) || sessionStorage.getItem('announcement-banner-closed') === 'true') return null;
  const root = document.createElement('div');
  root.className = 'announcement-banner hidden';
  const link = document.createElement('a');
  link.className = 'announcement-banner__content';
  link.target = '_blank';
  link.rel = 'noopener noreferrer sponsored';
  const icon = document.createElement('img');
  icon.className = 'announcement-banner__logo';
  icon.alt = '';
  icon.referrerPolicy = 'no-referrer';
  icon.onerror = () => {
    icon.hidden = true;
  };
  const text = document.createElement('span');
  text.className = 'announcement-banner__text';
  const title = document.createElement('span');
  title.className = 'announcement-banner__title';
  const description = document.createElement('span');
  description.className = 'announcement-banner__subtitle';
  const cta = document.createElement('span');
  cta.className = 'announcement-banner__cta';
  cta.setAttribute('aria-hidden', 'true');
  const ctaLabel = document.createElement('span');
  ctaLabel.className = 'announcement-banner__cta-label';
  ctaLabel.textContent = 'Learn more';
  cta.append(ctaLabel);
  text.append(title, description);
  link.append(icon, text, cta);
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'announcement-banner__close';
  close.setAttribute('aria-label', 'Close announcement');
  root.append(link, close);
  let timer;
  let transitionTimer;
  let closed = false;
  close.onclick = () => {
    closed = true;
    clearInterval(timer);
    clearTimeout(transitionTimer);
    root.classList.add('hidden');
    root.removeAttribute('data-visible');
    sessionStorage.setItem('announcement-banner-closed', 'true');
    setHeight('0px');
  };
  fetch('/api/promotions')
    .then((response) => {
      if (!response.ok) throw new Error('Promotions unavailable');
      return response.json();
    })
    .then((items) => {
      if (closed || !Array.isArray(items) || !items.length) return;
      const promotions = items.slice(0, 3);
      let index = 0;
      const show = () => {
        const promotion = promotions[index];
        link.href = promotion.url;
        icon.hidden = false;
        icon.src = promotion.icon;
        title.textContent = promotion.label;
        description.textContent = promotion.link_text;
      };
      show();
      root.classList.remove('hidden');
      root.dataset.visible = 'true';
      setHeight('40px');
      if (promotions.length > 1)
        timer = setInterval(() => {
          if (closed || !root.isConnected) {
            clearInterval(timer);
            return;
          }
          if (document.hidden) return;
          link.classList.add('slide-out');
          transitionTimer = setTimeout(() => {
            link.classList.remove('slide-out');
            if (closed || !root.isConnected) return;
            index = (index + 1) % promotions.length;
            show();
            link.classList.add('slide-in');
            transitionTimer = setTimeout(() => link.classList.remove('slide-in'), 300);
          }, 300);
        }, 8000);
    })
    .catch(() => {});
  return root;
}
