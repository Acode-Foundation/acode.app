import './main.scss';
import logo from 'res/logo.svg';
import digitalOceanLogo from 'res/digitalocean-icon.svg';

export default ({ routes }) => <>
  <header id="main-header" data-name="header">
    <label attr-for="menu-toggler" className="icon menu"></label>
    <nav>
      <a className="logo" href="/">
        <img src={logo} alt="Acode" />
        <span className="text">Acode</span>
      </a>
    </nav>
    <input hidden type="checkbox" id="menu-toggler" name="menu toggler" />
    <label attr-for="menu-toggler" className="mask"></label>
    <nav>
      {routes.map(({ href, text, icon }) => (
        <a href={href}>{icon && <span className={`icon ${icon}`} />} {text}</a>
      ))}
      <a target='_blank' style={{ color: '#0080FF', margin: '10px 0' }} href="https://www.digitalocean.com/?refcode=ddb6c70b077b&utm_campaign=Referral_Invite&utm_medium=Referral_Program&utm_source=badge">
        <img height='30' src={digitalOceanLogo} alt='' />
        <span style={{ marginLeft: '10px' }}>
          <small>Powered by</small> <br />
          <big>DigitalOcean</big>
        </span>
      </a>
    </nav>
    <nav>
      <a className="play-button" href="https://play.google.com/store/apps/details?id=com.foxdebug.acodefree&pcampaignid=pcampaignidMKT-Other-global-all-co-prtnr-py-PartBadge-Mar2515-1">
        <img
          style={{ width: '150px' }}
          alt="Get it on Google Play"
          src="https://play.google.com/intl/en_us/badges/static/images/badges/en_badge_web_generic.png"
        />
      </a>
    </nav>
  </header>
  <main></main>
  <footer>
    <div style={{ background: 'transparent', textAlign: 'center', padding: '10px' }}>&copy; foxdebug 2023</div>
  </footer>
</>;
