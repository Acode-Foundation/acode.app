import './style.scss';

export default async function ContactUs() {
  return (
    <section id='contact-us'>
      <h1>Contact Us</h1>
      <p className='subtitle'>Have a question, issue, or refund request? We're here to help.</p>

      <div className='contact-card'>
        <span className='icon email' />
        <div className='contact-info'>
          <h2>Email</h2>
          <a href='mailto:contact@acode.app'>contact@acode.app</a>
          <p>We typically respond within 3–5 business days.</p>
        </div>
      </div>

      <div className='company-info'>
        <p>
          <strong>Foxbiz Software Pvt. Ltd.</strong>
        </p>
        <p>Operator of Acode — the powerful, extensible code editor for Android.</p>
      </div>
    </section>
  );
}
