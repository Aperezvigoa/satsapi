const express = require('express');
const router = express.Router();
const axios = require('axios');

// Free demo endpoint — returns real BTC price data
// Rate limited to 5 calls/hour per IP (enforced in server.js)
router.get('/', async (req, res) => {
  try {
    const response = await axios.get('https://api.coingecko.com/api/v3/simple/price', {
      params: {
        ids: 'bitcoin',
        vs_currencies: 'usd',
        include_24hr_change: true,
        include_24hr_vol: true,
        include_market_cap: true
      },
      timeout: 5000
    });

    const btc = response.data.bitcoin;

    res.json({
      endpoint: '/v1/demo',
      cost_sats: 0,
      demo: true,
      note: 'Free demo — real data, limited to 5 calls/hour. Pay with Lightning for full access.',
      data: {
        price_usd:        btc.usd,
        change_24h_pct:   parseFloat(btc.usd_24h_change.toFixed(2)),
        volume_24h_usd:   btc.usd_24h_vol,
        market_cap_usd:   btc.usd_market_cap,
        timestamp:        new Date().toISOString()
      },
      upgrade: {
        message:  'Get RSI, MACD, signals, mempool, on-chain data and more — pay per call in sats.',
        price_endpoint:   'https://satsapi.dev/v1/price   — 3 sats',
        signal_endpoint:  'https://satsapi.dev/v1/signal  — 150 sats',
        summary_endpoint: 'https://satsapi.dev/v1/summary — 200 sats',
        docs:             'https://satsapi.dev/docs'
      }
    });

  } catch (err) {
    console.error('Demo endpoint error:', err.message);
    res.status(503).json({
      error:   'Data temporarily unavailable',
      message: 'Could not fetch price data. Please try again.',
      docs:    'https://satsapi.dev/docs'
    });
  }
});

module.exports = router;