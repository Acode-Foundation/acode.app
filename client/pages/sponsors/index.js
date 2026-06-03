import './style.scss';
import getSponsorTiers, { TIER_ORDER } from 'lib/sponsorTiers';

export default async function Sponsors() {
  const sponsors = await fetchSponsors();
  const { tiers } = await getSponsorTiers();

  return (
    <section id='sponsors-page'>
      <div className='sponsors-hero'>
        <h1>
          Our <span className='highlight'>Sponsors</span>
        </h1>
        <p className='subtitle'>
          These amazing people and companies support <span className='highlight'>Acode</span>.
        </p>
      </div>

      <div className='sponsors-grid-section'>
        {sponsors.length === 0 ? (
          <p className='empty-state'>Be the first to sponsor Acode!</p>
        ) : (
          TIER_ORDER.map((tier) => {
            const tierSponsors = sponsors.filter((s) => s.tier === tier);
            const tierInfo = tiers[tier];
            if (!tierInfo) return null;
            return (
              <div className='sponsor-tier-section' key={tier}>
                <div className='tier-heading'>
                  <span className={`tier-icon tier-icon-${tier}`} />
                  {tierInfo.label}
                </div>
                {tierSponsors.length === 0 ? (
                  <p className='empty-state'>Be the first {tierInfo.label} Sponsor!</p>
                ) : (
                  <div className='sponsors-grid'>{tierSponsors.map(renderSponsorCard)}</div>
                )}
              </div>
            );
          })
        )}
      </div>
      <br />
      <hr />
      <a href='/become-sponsor' className='btn-become-sponsor'>
        Become a Sponsor
      </a>
    </section>
  );
}

function renderSponsorCard(sponsor) {
  const { id, name, tier, tagline, website, image } = sponsor;
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const hasImage = ['gold', 'platinum', 'titanium'].includes(tier);
  const hasWebsite = ['silver', 'gold', 'platinum', 'titanium'].includes(tier);

  return (
    <div key={id} className={`sponsor-card sponsor-card-${tier}`}>
      {hasImage && (
        <div className='sponsor-avatar'>
          {image ? <img src={`/sponsor/image/${image}`} alt={name} loading='lazy' /> : <span className='avatar-fallback'>{initials}</span>}
        </div>
      )}
      <div className='sponsor-info'>
        {hasWebsite && website ? (
          <a href={website} target='_blank' rel='noopener' className='sponsor-name sponsor-name-link'>
            {name}
          </a>
        ) : (
          <span className='sponsor-name'>{name}</span>
        )}
        {tagline && ['platinum', 'titanium'].includes(tier) && <p className='sponsor-tagline'>{tagline}</p>}
        {hasWebsite && website && (
          <a href={ensureAbsoluteUrl(website)} target='_blank' rel='noopener' className='sponsor-website'>
            <span className='icon link' /> {website.replace(/^https?:\/\//, '')}
          </a>
        )}
      </div>
    </div>
  );
}

async function fetchSponsors() {
  try {
    const res = await fetch('/api/sponsors');
    return await res.json();
  } catch {
    return [];
  }
}

function ensureAbsoluteUrl(url) {
  if (!url) return '';
  if (/^https?:\/\//.test(url)) return url;
  return `http://${url}`;
}
