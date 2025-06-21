import './main.scss';
import digitalOceanLogo from 'res/digitalocean-icon.svg';
import logo from 'res/logo.svg';

export default ({ routes }) => (
  <>
    <header id='main-header' data-name='header'>
      <label attr-for='menu-toggler' className='icon menu' />
      <nav>
        <a className='logo' href='/'>
          <img src={logo} alt='Acode' />
          <span className='text'>Acode</span>
        </a>
      </nav>
      <input hidden type='checkbox' id='menu-toggler' name='menu toggler' />
      <label attr-for='menu-toggler' className='mask' />
      <nav>
        {routes.map(({ href, text, icon }) => (
          <a href={href}>
            {icon && <span className={`icon ${icon}`} />} {text}
          </a>
        ))}
      </nav>
      <nav>
        <a
          className='play-button'
          href='https://play.google.com/store/apps/details?id=com.foxdebug.acodefree&pcampaignid=pcampaignidMKT-Other-global-all-co-prtnr-py-PartBadge-Mar2515-1'
        >
          <img
            style={{ width: '150px' }}
            alt='Get it on Google Play'
            src='https://play.google.com/intl/en_us/badges/static/images/badges/en_badge_web_generic.png'
          />
        </a>
      </nav>
    </header>
    <main />
    <footer>
      <div style={{ background: 'transparent', textAlign: 'center', padding: '10px' }}>&copy; Foxbiz Software Pvt. Ltd. (2025-26)</div>
      <nav className='footer-nav'>
        <a href='https://foxbiz.io'>Foxbiz Software Pvt. Ltd.</a>
        <a href='/policy'>Privacy policy</a>
        <a href='/terms'>Terms of service</a>
      </nav>
      <nav style={{ textAlign: 'center' }}>
        <a
          target='_blank'
          style={{ color: '#0080FF', margin: '10px 0', textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
          href='https://www.digitalocean.com/?refcode=ddb6c70b077b&utm_campaign=Referral_Invite&utm_medium=Referral_Program&utm_source=badge'
          rel='noreferrer'
        >
          <img height='30' src={digitalOceanLogo} alt='' />
          <div style={{ marginLeft: '10px', display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
            <span style={{ fontSize: '0.7rem' }}>Powered by</span>
            <span>DigitalOcean</span>
          </div>
        </a>
      </nav>
    </footer>
  </>
);
