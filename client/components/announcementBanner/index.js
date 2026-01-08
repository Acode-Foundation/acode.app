import './style.scss';
import hpLogo from 'res/hp-logo.png';

const BANNERS = [
  {
    id: 'betterkeep',
    logo: 'https://betterkeep.app/icons/logo.png',
    url: 'https://betterkeep.app/welcome?utm_source=acode_announcement_banner',
    alt: 'Better Keep Notes',
    badge: 'NEW',
    title: 'Introducing Better Keep Notes',
    subtitle: 'A beautiful, private note-taking app. Try it free!',
    cta: 'Learn More',
    theme: 'betterkeep',
  },
  {
    id: 'hangingpiece',
    logo: hpLogo,
    url: 'https://www.hangingpiece.com?utm_source=acode_announcement_banner',
    alt: 'Hanging Piece',
    badge: 'NEW',
    title: 'Hanging Piece - AI Chess Coach',
    subtitle: 'Understand WHY you blundered. Stop repeating mistakes!',
    cta: 'Try Now',
    theme: 'hangingpiece',
  },
];

const TOGGLE_INTERVAL = 8000;

export default function AnnouncementBanner() {
  let currentIndex = 0;

  const $logo = <img alt='App Logo' className='announcement-banner__logo' />;
  const $badge = <span className='announcement-banner__new-badge' />;
  const $title = <span className='announcement-banner__title' />;
  const $subtitle = <span className='announcement-banner__subtitle' />;
  const $ctaText = <span className='announcement-banner__cta-text' />;

  const $closeBtn = (
    <button type='button' className='announcement-banner__close' aria-label='Close announcement'>
      <span className='icon clear' />
    </button>
  );

  const $link = (
    // biome-ignore lint/a11y/useValidAnchor: URL is dynamic
    <a target='_blank' rel='noopener noreferrer' data-visible='true' className='announcement-banner'>
      <div className='announcement-banner__content'>
        <div className='announcement-banner__logo-wrapper'>{$logo}</div>
        <div className='announcement-banner__text'>
          {$badge}
          {$title}
          {$subtitle}
        </div>
        <div className='announcement-banner__cta'>
          {$ctaText}
          <span className='announcement-banner__arrow'>→</span>
        </div>
      </div>
      <div className='announcement-banner__indicators'>
        {BANNERS.map((_, index) => (
          <span className={`announcement-banner__indicator ${index === 0 ? 'active' : ''}`} data-index={index} />
        ))}
      </div>
      {$closeBtn}
    </a>
  );

  let intervalId;

  const updateHeaderTop = (bannerVisible) => {
    const header = document.getElementById('main-header');
    if (header) {
      if (bannerVisible) {
        const bannerHeight = $link.offsetHeight;
        header.style.top = `${bannerHeight}px`;
      } else {
        header.style.top = '0';
      }
    }
  };

  $closeBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    $link.classList.add('hidden');
    clearInterval(intervalId);
    sessionStorage.setItem('announcement-banner-closed', 'true');
    updateHeaderTop(false);
    $link.removeAttribute('data-visible');
  });

  // Check if banner was closed in this session
  if (sessionStorage.getItem('announcement-banner-closed') === 'true') {
    $link.classList.add('hidden');
  } else {
    // Set header top after banner is rendered
    requestAnimationFrame(() => updateHeaderTop(true));
  }

  const $content = $link.querySelector('.announcement-banner__content');

  const updateBanner = (index, animate = false) => {
    const b = BANNERS[index];

    const applyContent = () => {
      $link.href = b.url;
      $link.className = `announcement-banner announcement-banner--${b.theme}`;
      $logo.src = b.logo;
      $logo.alt = b.alt;
      $badge.textContent = b.badge;
      $title.textContent = b.title;
      $subtitle.textContent = b.subtitle;
      $ctaText.textContent = b.cta;

      // Update indicators
      $link.querySelectorAll('.announcement-banner__indicator').forEach((indicator, i) => {
        indicator.classList.toggle('active', i === index);
      });
    };

    if (animate && $content) {
      // Slide out
      $content.classList.add('slide-out');
      $content.classList.remove('slide-in');

      setTimeout(() => {
        applyContent();
        // Slide in
        $content.classList.remove('slide-out');
        $content.classList.add('slide-in');

        setTimeout(() => {
          $content.classList.remove('slide-in');
        }, 300);
      }, 300);
    } else {
      applyContent();
    }
  };

  // Initialize with first banner
  updateBanner(0);

  // Toggle banners periodically
  intervalId = setInterval(() => {
    currentIndex = (currentIndex + 1) % BANNERS.length;
    updateBanner(currentIndex, true);
  }, TOGGLE_INTERVAL);

  return $link;
}
