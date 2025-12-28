import './style.scss';

const BETTERKEEP_LOGO = 'https://betterkeep.app/icons/logo.png';
const BETTERKEEP_URL = 'https://betterkeep.app/welcome?utm_source=acode_announcement_banner';

export default () => (
  <a href={BETTERKEEP_URL} target='_blank' rel='noopener noreferrer' className='announcement-banner'>
    <div className='announcement-banner__content'>
      <div className='announcement-banner__logo-wrapper'>
        <img src={BETTERKEEP_LOGO} alt='Better Keep Notes' className='announcement-banner__logo' />
      </div>
      <div className='announcement-banner__text'>
        <span className='announcement-banner__new-badge'>NEW</span>
        <span className='announcement-banner__title'>Introducing Better Keep Notes</span>
        <span className='announcement-banner__subtitle'>A beautiful, private note-taking app. Try it free!</span>
      </div>
      <div className='announcement-banner__cta'>
        <span className='announcement-banner__cta-text'>Learn More</span>
        <span className='announcement-banner__arrow'>→</span>
      </div>
    </div>
  </a>
);
