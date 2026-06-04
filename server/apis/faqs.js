const path = require('node:path');
const fs = require('node:fs');
const { Router } = require('express');

const faqsFile = path.resolve(__dirname, '../../data/faqs.json');
const router = Router();

router.get('/', async (req, res) => {
  try {
    const data = JSON.parse(fs.readFileSync(faqsFile, 'utf8'));
    const faqs = Array.isArray(data) ? data : (data.categories || []).flatMap((c) => c.faqs || []);
    if (req.query.categories === '1') {
      return res.json(data.categories || []);
    }
    res.json(faqs.reverse());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

function findInCategories(categories, q) {
  for (const cat of categories) {
    const idx = cat.faqs.findIndex((f) => f.q === q);
    if (idx !== -1) return { category: cat, index: idx };
  }
  return null;
}

router.post('/', async (req, res) => {
  try {
    const { q, a, category } = req.body;
    if (!q) return res.status(400).json({ error: 'q is required.' });
    if (!a) return res.status(400).json({ error: 'a is required.' });
    const data = JSON.parse(fs.readFileSync(faqsFile, 'utf8'));
    const newFaq = { q, a, tags: [] };
    if (Array.isArray(data)) {
      data.push(newFaq);
    } else if (category && data.categories) {
      const cat = data.categories.find((c) => c.id === category);
      if (cat) cat.faqs.push(newFaq);
      else data.categories[0].faqs.push(newFaq);
    } else if (data.categories) {
      data.categories[0].faqs.push(newFaq);
    }
    fs.writeFileSync(faqsFile, JSON.stringify(data, null, 2));
    res.json({ message: 'success' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/', async (req, res) => {
  try {
    const { q, a, old_q: oldQ, category } = req.body;
    if (!oldQ) return res.status(400).json({ error: 'old_q is required.' });
    if (!q) return res.status(400).json({ error: 'q is required.' });
    if (!a) return res.status(400).json({ error: 'a is required.' });

    const data = JSON.parse(fs.readFileSync(faqsFile, 'utf8'));
    const newFaq = { q, a, tags: [] };

    if (Array.isArray(data)) {
      const index = data.findIndex((faq) => faq.q === oldQ);
      if (index === -1) return res.status(404).json({ error: 'FAQ not found.' });
      data[index] = newFaq;
    } else {
      const found = findInCategories(data.categories || [], oldQ);
      if (!found) return res.status(404).json({ error: 'FAQ not found.' });
      if (category && data.categories) {
        found.category.faqs.splice(found.index, 1);
        const targetCat = data.categories.find((c) => c.id === category);
        (targetCat || data.categories[0]).faqs.push(newFaq);
      } else {
        found.category.faqs[found.index] = newFaq;
      }
    }
    fs.writeFileSync(faqsFile, JSON.stringify(data, null, 2));
    return res.json({ message: 'success' });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.delete('/', async (req, res) => {
  try {
    const q = req.query.q || req.body.q;
    if (!q) return res.status(400).json({ error: 'q is required as query param.' });
    const data = JSON.parse(fs.readFileSync(faqsFile, 'utf8'));
    if (Array.isArray(data)) {
      const index = data.findIndex((faq) => faq.q === q);
      if (index === -1) return res.status(404).json({ error: 'FAQ not found.' });
      data.splice(index, 1);
    } else {
      const found = findInCategories(data.categories || [], q);
      if (!found) return res.status(404).json({ error: 'FAQ not found.' });
      found.category.faqs.splice(found.index, 1);
    }
    fs.writeFileSync(faqsFile, JSON.stringify(data, null, 2));
    res.json({ message: 'success' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
