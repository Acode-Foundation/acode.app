const { Router } = require('express');
const { faqMetadata } = require('../../shared/faqs');
const { builtin, findFaq, readFaqCatalog } = require('../lib/faqCatalog');
const { detailError } = require('../lib/publicMetadata');

function faqPages(render, read = readFaqCatalog) {
  const router = Router();
  router.get(['/', '/:id'], async (req, res) => {
    const { id } = req.params;
    let catalog;
    let item;
    try {
      if (id) item = await findFaq(id, read);
      else catalog = await read();
    } catch (error) {
      console.error('Could not load FAQ catalog:', error.message);
      res.set('Cache-Control', 'no-store');
      if (id)
        return res.status(503).send(render(`/faqs/${encodeURIComponent(id)}`, detailError('Question temporarily unavailable', '/faqs', 'All FAQs')));
      return res.send(
        render('/faqs', {
          detail: {
            heading: 'Frequently asked questions',
            text: 'Some answers are temporarily unavailable. You can still read these FAQs.',
            links: Array.from(builtin, ([key, { faq }]) => ({ href: `/faqs/${key}`, label: faq.q })),
          },
        }),
      );
    }
    if (!id) {
      const schema = {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: Array.from(catalog.byId.values(), ({ faq, text }) => ({
          '@type': 'Question',
          name: faq.q,
          acceptedAnswer: { '@type': 'Answer', text },
        })),
      };
      return res.send(render('/faqs', {}, schema));
    }
    if (!item && req.query.src === 'ios') return res.redirect('/faqs?src=ios');
    if (!item) return res.status(404).send(render(`/faqs/${encodeURIComponent(id)}`, detailError('Question not found', '/faqs', 'All FAQs')));
    const { faq, text } = item;
    const platform = { android: 'Android', ios: 'iOS' }[faq.platform] || 'Android and iOS';
    return res.send(
      render(`/faqs/${id}`, { ...faqMetadata(faq), detail: { heading: faq.q, text, platform, parentPath: '/faqs', parentLabel: 'All FAQs' } }),
    );
  });
  return router;
}

module.exports = faqPages;
