const path = require('node:path');
const fs = require('node:fs');
const { Router } = require('express');
const { getWebLoggedInUser } = require('../lib/helpers');

const faqsFile = path.resolve(__dirname, '../../data/faqs.json');
const { faqUrlInUse, findFaq, readFaqCatalog, storedCategories } = require('../lib/faqCatalog');
const router = Router();

// Anyone can read FAQs; only admins can change them.
router.use(async (req, res, next) => {
  // Express answers HEAD with the GET route, so it is a read too.
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  try {
    const user = await getWebLoggedInUser(req);
    if (!user?.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
    if (['POST', 'PUT'].includes(req.method)) {
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
        return res.status(400).json({ error: 'An FAQ request body is required.' });
      }
      if (req.body.platform !== undefined && !['', 'both', 'android', 'ios'].includes(req.body.platform)) {
        return res.status(400).json({ error: 'platform must be android, ios, or both.' });
      }
    }
    next();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const { platform } = req.query;
    if (platform !== undefined && !['android', 'ios', 'both'].includes(platform)) {
      return res.status(400).json({ error: 'platform must be android, ios, or both.' });
    }
    const filterByPlatform = platform && platform !== 'both';
    const visibleFaqs = (faqs) =>
      filterByPlatform ? faqs.filter((faq) => !faq.platform || faq.platform === 'both' || faq.platform === platform) : faqs;
    if (req.query.id !== undefined) {
      const match = await findFaq(req.query.id);
      if (!match || !visibleFaqs([match.faq]).length) return res.status(404).json({ error: 'Question not found' });
      const { id, name, builtin } = match.category;
      return res.json({ id, name, builtin, faqs: [match.faq] });
    }
    const { categories } = await readFaqCatalog();
    if (req.query.categories === '1') {
      return res.json(
        filterByPlatform
          ? categories.map((category) => ({ ...category, faqs: visibleFaqs(category.faqs || []) })).filter((c) => c.faqs.length)
          : categories,
      );
    }
    const faqs = categories.flatMap((c) => c.faqs || []);
    res.json(visibleFaqs(faqs).reverse());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

function saveFaqs(data) {
  fs.writeFileSync(faqsFile, JSON.stringify(data, null, 2));
  readFaqCatalog.invalidate();
}

function findInCategories(categories, q) {
  for (const cat of categories) {
    const idx = cat.faqs.findIndex((f) => f?.q === q);
    if (idx !== -1) return { category: cat, index: idx };
  }
  return null;
}

router.post('/', async (req, res) => {
  try {
    const { q, a, category, platform } = req.body;
    if (typeof q !== 'string' || !q.trim()) return res.status(400).json({ error: 'q is required.' });
    if (typeof a !== 'string' || !a.trim()) return res.status(400).json({ error: 'a is required.' });
    const data = JSON.parse(fs.readFileSync(faqsFile, 'utf8'));
    if (faqUrlInUse(data, q)) return res.status(409).json({ error: 'This question URL is already in use. Reword the question.' });
    const newFaq = { q, a, tags: [], platform: platform || 'both' };
    if (Array.isArray(data)) {
      data.push(newFaq);
    } else {
      const groups = storedCategories(data);
      const target = groups.find((group) => group.id === category) || groups[0];
      if (!target) return res.status(409).json({ error: 'No FAQ category is available.' });
      target.faqs.push(newFaq);
    }
    saveFaqs(data);
    res.json({ message: 'success' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/', async (req, res) => {
  try {
    const { q, a, old_q: oldQ, category, platform } = req.body;
    if (!oldQ) return res.status(400).json({ error: 'old_q is required.' });
    if (typeof q !== 'string' || !q.trim()) return res.status(400).json({ error: 'q is required.' });
    if (typeof a !== 'string' || !a.trim()) return res.status(400).json({ error: 'a is required.' });

    const data = JSON.parse(fs.readFileSync(faqsFile, 'utf8'));
    const changes = { q, a, ...(platform === undefined ? {} : { platform: platform || 'both' }) };

    const groups = storedCategories(data);
    const previous = findInCategories(groups, oldQ);
    if (!previous) return res.status(404).json({ error: 'FAQ not found.' });
    const oldFaq = previous.category.faqs[previous.index];
    if (q !== oldQ && faqUrlInUse(data, q, oldFaq))
      return res.status(409).json({ error: 'This question URL is already in use. Reword the question.' });
    const newFaq = { ...oldFaq, ...changes };
    if (category && !Array.isArray(data)) {
      const target = groups.find((group) => group.id === category) || groups[0];
      previous.category.faqs.splice(previous.index, 1);
      target.faqs.push(newFaq);
    } else {
      previous.category.faqs[previous.index] = newFaq;
    }
    saveFaqs(data);
    return res.json({ message: 'success' });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.delete('/', async (req, res) => {
  try {
    const q = req.query.q || req.body?.q;
    if (typeof q !== 'string' || !q.trim()) return res.status(400).json({ error: 'q is required as query param.' });
    const data = JSON.parse(fs.readFileSync(faqsFile, 'utf8'));
    if (Array.isArray(data)) {
      const index = data.findIndex((faq) => faq?.q === q);
      if (index === -1) return res.status(404).json({ error: 'FAQ not found.' });
      data.splice(index, 1);
    } else {
      const found = findInCategories(storedCategories(data), q);
      if (!found) return res.status(404).json({ error: 'FAQ not found.' });
      found.category.faqs.splice(found.index, 1);
    }
    saveFaqs(data);
    res.json({ message: 'success' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
