const path = require('path');
const fs = require('fs');
const { Router } = require('express');

const faqsFile = path.resolve(__dirname, '../../data/faqs.json');
const router = Router();

router.get('/', async (req, res) => {
  try {
    const faqs = JSON.parse(fs.readFileSync(faqsFile, 'utf8'));
    res.json(faqs.reverse());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { q, a } = req.body;
    if (!q) res.status(400).json({ error: 'q is required.' });
    if (!a) res.status(400).json({ error: 'a is required.' });
    const faqs = JSON.parse(fs.readFileSync(faqsFile, 'utf8'));
    const newFaq = { q, a };
    faqs.push(newFaq);
    fs.writeFileSync(faqsFile, JSON.stringify(faqs, null, 2));
    res.json({ message: 'success' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/', async (req, res) => {
  try {
    const { q, a, old_q: oldQ } = req.body;
    if (!oldQ) return res.status(400).json({ error: 'old_q is required.' });
    if (!q) return res.status(400).json({ error: 'q is required.' });
    if (!a) return res.status(400).json({ error: 'a is required.' });

    const faqs = JSON.parse(fs.readFileSync(faqsFile, 'utf8'));
    const newFaq = { q, a };
    const index = faqs.findIndex((faq) => faq.q === oldQ);
    faqs[index] = newFaq;
    fs.writeFileSync(faqsFile, JSON.stringify(faqs, null, 2));
    return res.json({ message: 'success' });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.delete('/:q', async (req, res) => {
  try {
    const { q } = req.params;
    const faqs = JSON.parse(fs.readFileSync(faqsFile, 'utf8'));
    const index = faqs.findIndex((faq) => faq.q === q);
    faqs.splice(index, 1);
    fs.writeFileSync(faqsFile, JSON.stringify(faqs, null, 2));
    res.json({ message: 'success' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
