const path = require('node:path');
const fs = require('node:fs');
const { Router } = require('express');

const promotionsFile = path.resolve(__dirname, '../../data/promotions.json');
const router = Router();

router.get('/', async (_req, res) => {
  try {
    const data = JSON.parse(fs.readFileSync(promotionsFile, 'utf8'));
    res.json(Array.isArray(data) ? data : []);
  } catch (err) {
    if (err.code === 'ENOENT') {
      res.json([]);
      return;
    }
    res.status(500).json({ error: 'Failed to read promotions' });
  }
});

module.exports = router;
