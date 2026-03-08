const express = require('express');
const router = express.Router();
const axios = require('axios');

router.get('/', async (req, res) => {
  try {
    const base = process.env.BASE_URL || 'http://localhost:3000';
    const result = await axios.get(`${base}/v1/price`);
    const { price, change_24h, rsi_14, trend, ma_50, ma_200 } = result.data.data;

    res.json({
      endpoint: '/v1/demo',
      free: true,
      rate_limit: '5 calls/hour per IP',
      note: 'Free demo — real BTC data. Pay with Lightning for full access to all endpoints.',
      data: { price, change_24h, rsi_14, trend, ma_50, ma_200 },
      upgrade: 'https://satsapi.dev/docs',
      timestamp: new Date().toISOString()
    });
  } catch (e) {
    res.status(500).json({ error: 'Demo unavailable', detail: e.message });
  }
});

module.exports = router;