const { Router } = require('express');
const Anthropic = require('@anthropic-ai/sdk');

const router = Router();

const client = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY,
});

router.post('/', async (req, res) => {
  const { text, filename } = req.body;

  const message = `Give code completion only without extra text and don't include given code
  filename: ${filename}
  code: ${text}`;

  try {
    const result = await client.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [{
          type: 'text',
          text: message,
        }],
      }],
    });

    // eslint-disable-next-line max-len
    // console.log('input_tokens', result.usage.input_tokens, 'output_tokens', result.usage.output_tokens);

    res.send({ result: result.content?.[0]?.text, status: 'success' });
  } catch (error) {
    res.status(500).send({ status: 'error', message: error.message });
  }
});

module.exports = router;
