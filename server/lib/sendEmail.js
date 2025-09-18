const nodeMailer = require('nodemailer');
const dotenv = require('dotenv');

dotenv.config();

/**
 * Send notification email
 * @param {string} email
 * @param {string} name
 * @param {string} subject
 * @param {string} message
 */
async function sendEmail(email, name, subject, message) {
  const transporter = nodeMailer.createTransport({
    host: process.env.ZEPTO_EMAIL_HOST,
    port: process.env.ZEPTO_EMAIL_PORT,
    auth: {
      user: process.env.ZEPTO_EMAIL_USERNAME,
      pass: process.env.ZEPTO_EMAIL_PASSWORD,
    },
  });

  const mailOptions = {
    from: '"Acode - Foxbiz" <noreply@acode.app>',
    to: email,
    subject,
    html: `<div style="font-family: Helvetica,Arial,sans-serif;overflow:auto;line-height:2">
    <h1 style="border-bottom:1px solid #eee">
      <a href="https://acode.app" style="font-size:1.4em;color: #00466a;text-decoration:none;font-weight:600">Acode by Foxbiz Software Pvt. Ltd.</a>
    </h1>
    <p style="font-size:1.1em">Hi ${name},</p>
    <p>${message}</p>
    <p>Regards,<br />Acode by Foxbiz</p>
    <small>This is an auto-generated email. Please do not reply.</small>
  </div>`,
  };

  if (process.env.NODE_ENV === 'development') {
    console.log('Email:', mailOptions);
    return { messageId: 'development' };
  }
  const info = await transporter.sendMail(mailOptions);
  return info;
}

module.exports = sendEmail;
