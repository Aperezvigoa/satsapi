const express = require('express');
const router = express.Router();
const axios = require('axios');

router.get('/', async (req, res) => {
  try {
    // Llamada directa a la fuente — no pasa por el middleware L402
    const [priceRes, historyRes] = await Promise.all([
      axios.get('https://min-api.cryptocompare.com/data/pricemultifull?fsyms=BTC&tsyms=USD'),
      axios.get('https://min-api.cryptocompare.com/data/v2/histoday?fsym=BTC&tsym=USD&limit=20')
    ]);

    const raw    = priceRes.data.RAW.BTC.USD;
    const price  = raw.PRICE;
    const change = raw.CHANGEPCT24HOUR;
    const high   = raw.HIGH24HOUR;
    const low    = raw.LOW24HOUR;

    // RSI 14 simplificado con los últimos 15 días
    const closes = historyRes.data.Data.Data.map(d => d.close);
    let gains = 0, losses = 0;
    for (let i = 1; i < closes.length; i++) {
      const diff = closes[i] - closes[i - 1];
      diff >= 0 ? gains += diff : losses += Math.abs(diff);
    }
    const periods = closes.length - 1;
    const avgGain = gains / periods;
    const avgLoss = losses / periods;
    const rsi = avgLoss === 0 ? 100 : parseFloat((100 - (100 / (1 + avgGain / avgLoss))).toFixed(1));

    const trend = change > 1 ? 'BULLISH' : change < -1 ? 'BEARISH' : 'NEUTRAL';

    res.json({
      endpoint: '/v1/demo',
      free: true,
      rate_limit: '5 calls/hour per IP',
      note: 'Free demo — real BTC data. Pay with Lightning for full indicators.',
      data: {
        symbol:     'BTC/USD',
        price:      price,
        change_24h: change.toFixed(2) + '%',
        high_24h:   high,
        low_24h:    low,
        rsi_14:     rsi,
        trend:      trend,
      },
      upgrade: 'https://satsapi.dev/docs',
      timestamp: new Date().toISOString()
    });

  } catch (e) {
    res.status(500).json({ error: 'Demo unavailable', detail: e.message });
  }
});

module.exports = router;