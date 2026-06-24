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
    host: process.env.EMAIL_HOST,
    port: process.env.EMAIL_PORT,
    auth: {
      user: process.env.EMAIL_USERNAME,
      pass: process.env.EMAIL_PASSWORD,
    },
  });

  const mailOptions = {
    from: '"Acode - Foxbiz" <noreply@acode.app>',
    to: email,
    subject,
    html: `<div style="background-color:#f1f5f9;padding:40px 20px">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden">
    <div style="padding:32px 40px 0 40px">
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
        <div style="font-size:20px;font-weight:600;color:#334155;line-height:1.3">Acode</div>
      </div>
      <div style="height:1px;background:#f1f5f9;margin:24px 0"></div>
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;color:#1e293b;line-height:1.7">
        Hi ${name},
      </div>
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;color:#475569;line-height:1.7;padding-top:12px">
        ${message}
      </div>
      <div style="height:1px;background:#f1f5f9;margin-top:28px"></div>
    </div>
    <div style="padding:20px 40px 32px 40px">
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;color:#94a3b8;line-height:1.5">
        Acode by <strong>Foxbiz Software Pvt. Ltd.</strong>
      </div>
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:11px;color:#cbd5e1;line-height:1.5;margin-top:4px">
        This is an auto-generated email. Please do not reply.
      </div>
    </div>
  </div>
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
