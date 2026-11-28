import fs from 'node:fs';
import vm from 'node:vm';
import Handlebars from 'handlebars';

it('escapes the greeting name while preserving intentional message HTML', async () => {
  const sendMail = vi.fn(async () => ({ messageId: 'test' }));
  const module = { exports: {} };
  const dependencies = {
    nodemailer: { createTransport: () => ({ sendMail }) },
    dotenv: { config() {} },
    handlebars: Handlebars,
  };
  vm.runInNewContext(fs.readFileSync(new URL('../../server/lib/sendEmail.js', import.meta.url), 'utf8'), {
    module,
    process: { env: {} },
    require: (name) => {
      if (!(name in dependencies)) throw Error(name);
      return dependencies[name];
    },
  });
  await module.exports('test@example.test', '<a href="https://evil.test">Sponsor</a>', 'Thanks', '<b>Thank you</b>');
  const { html } = sendMail.mock.calls[0][0];
  expect(html).toContain('&lt;a href&#x3D;');
  expect(html).not.toContain('<a href=');
  expect(html).toContain('<b>Thank you</b>');
});
