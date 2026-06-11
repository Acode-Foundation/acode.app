import './style.scss';
import Ref from 'html-tag-js/ref';

const GAP = 14;
const COLUMNS_DESKTOP = 2;

let moduleResizeHandler = null;

export default async function AboutUs() {
  const teamGrid = Ref();

  fetchTeam();

  return (
    <section id='about-us'>
      <div className='hero'>
        <h1>About Us</h1>
        <p className='subtitle'>Building the future of mobile development — one line of code at a time.</p>
      </div>

      <div className='about-section'>
        <span className='section-label'>The Product</span>
        <h2>About Acode</h2>
        <p className='section-body'>
          Acode is a powerful, extensible, and open-source code editor for Android. It brings a full Alpine Linux terminal, AI coding assistants
          (Claude Code, Codex, OpenCode), and 250+ community plugins to your phone. Build React, Next.js, Node.js, and Python projects — complete with
          Git and SSH — right from your Android device.
        </p>
      </div>

      <div className='about-section'>
        <span className='section-label'>The Company</span>
        <h2>Foxbiz Software</h2>
        <p className='section-body'>
          <strong style='color: #ffffff'>Foxbiz Software Pvt. Ltd.</strong> is the company behind Acode. We are dedicated to building world-class
          developer tools that empower coders everywhere. Our mission is to make professional-grade development accessible on every device, starting
          with Android.
        </p>
      </div>

      <div className='about-section'>
        <span className='section-label'>The People</span>
        <h2>Our Team</h2>
        <p className='section-body'>Meet the developers behind Acode. We're a passionate team building the future of mobile development.</p>
        <div className='team-grid' ref={teamGrid}>
          {Array.from({ length: 4 }, (_, i) => (
            <div className='team-card skeleton' key={i}>
              <div className='avatar-placeholder' />
              <div className='team-info'>
                <div className='name-placeholder' />
                <div className='bio-placeholder' />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );

  async function fetchTeam() {
    try {
      const res = await fetch('/api/team');
      if (!res.ok) throw new Error('Failed to fetch team');
      const members = await res.json();
      teamGrid.el.content = members.map(renderMember);
      initMasonry();
    } catch {
      teamGrid.el.content = (
        <div className='error-state'>
          Unable to load team members.{' '}
          <a href='https://github.com/orgs/Acode-Foundation/teams/acode' target='_blank' rel='noreferrer'>
            View on GitHub
          </a>
        </div>
      );
    }
  }

  function initMasonry() {
    setTimeout(() => {
      layoutMasonry();
      teamGrid.el.style.visibility = 'visible';
    }, 0);

    if (moduleResizeHandler) {
      window.removeEventListener('resize', moduleResizeHandler);
    }
    moduleResizeHandler = debounce(() => {
      layoutMasonry();
    }, 150);
    window.addEventListener('resize', moduleResizeHandler);
  }

  function layoutMasonry() {
    const grid = teamGrid.el;
    if (!grid) return;

    const cards = grid.querySelectorAll('.team-card');
    if (!cards.length) return;

    const containerWidth = grid.clientWidth;
    const isMobile = window.innerWidth <= 600;
    const columns = isMobile ? 1 : COLUMNS_DESKTOP;
    const colWidth = (containerWidth - (columns - 1) * GAP) / columns;

    for (const card of cards) {
      card.style.position = '';
      card.style.left = '';
      card.style.top = '';
      card.style.width = `${colWidth}px`;
      card.style.float = 'left';
      card.style.marginRight = `${GAP}px`;
      card.style.marginBottom = `${GAP}px`;
    }

    // Pair each card with its measured height, sort tallest-first
    const items = [];
    for (const card of cards) {
      items.push({ card, height: card.getBoundingClientRect().height });
    }
    items.sort((a, b) => b.height - a.height);

    const colHeights = new Array(columns).fill(0);
    for (const { card, height } of items) {
      const colIndex = colHeights.indexOf(Math.min(...colHeights));

      card.style.position = 'absolute';
      card.style.float = '';
      card.style.marginRight = '';
      card.style.marginBottom = '';
      card.style.width = `${colWidth}px`;
      card.style.left = `${colIndex * (colWidth + GAP)}px`;
      card.style.top = `${colHeights[colIndex]}px`;

      colHeights[colIndex] += height + GAP;
    }

    grid.style.height = `${Math.max(...colHeights) - GAP}px`;
  }

  function renderMember(member) {
    const hasLinks = member.blog || member.twitter_username;
    const hasLocation = !!member.location;

    return (
      <a href={member.html_url} target='_blank' rel='noreferrer' className='team-card'>
        <img src={member.avatar_url} alt={member.name || member.login} className='team-avatar' loading='lazy' />
        <div className='team-info'>
          <h3 className='team-name'>{member.name || member.login}</h3>
          {member.name && <span className='team-login'>@{member.login}</span>}
          {member.bio && <p className='team-bio'>{member.bio}</p>}
          {hasLocation && (
            <div className='team-meta'>
              <span className='meta-tag'>{member.location}</span>
            </div>
          )}
          {hasLinks && (
            <div className='team-meta'>
              {member.blog && (
                <a href={member.blog} target='_blank' rel='noreferrer' className='meta-link' onclick={(e) => e.stopPropagation()}>
                  <span className='icon link' />
                </a>
              )}
              {member.twitter_username && (
                <a
                  href={`https://x.com/${member.twitter_username}`}
                  target='_blank'
                  rel='noreferrer'
                  className='meta-link'
                  onclick={(e) => e.stopPropagation()}
                >
                  <span className='icon x' />
                </a>
              )}
            </div>
          )}
        </div>
      </a>
    );
  }
}

function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}
