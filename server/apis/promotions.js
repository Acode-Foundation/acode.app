const path = require('node:path');
const fs = require('node:fs/promises');
const { Router } = require('express');

const promotionsFile = path.resolve(__dirname, '../../data/promotions.json');
const router = Router();

router.get('/', async (_req, res) => {
  try {
    const raw = await fs.readFile(promotionsFile, 'utf8');
    const data = JSON.parse(raw);
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
