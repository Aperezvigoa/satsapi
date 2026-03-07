const express = require('express');
const router = express.Router();
const axios = require('axios');

router.get('/', async (req, res) => {
  try {
    // Fetch price and 24h data from Binance (free, no key needed)
    const [ticker, klines] = await Promise.all([
      axios.get('https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT'),
      axios.get('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=200')
    ]);

    const price  = parseFloat(ticker.data.lastPrice);
    const change = parseFloat(ticker.data.priceChangePercent);
    const high   = parseFloat(ticker.data.highPrice);
    const low    = parseFloat(ticker.data.lowPrice);
    const volume = parseFloat(ticker.data.quoteVolume);

    // Calculate moving averages from daily candles
    const closes = klines.data.map(k => parseFloat(k[4]));
    const ma50  = closes.slice(-50).reduce((a, b) => a + b, 0) / 50;
    const ma200 = closes.slice(-200).reduce((a, b) => a + b, 0) / 200;

    // Calculate RSI (14 periods)
    const gains = [], losses = [];
    for (let i = closes.length - 14; i < closes.length; i++) {
      const diff = closes[i] - closes[i - 1];
      diff >= 0 ? gains.push(diff) : losses.push(Math.abs(diff));
    }
    const avgGain = gains.reduce((a, b) => a + b, 0) / 14;
    const avgLoss = losses.reduce((a, b) => a + b, 0) / 14;
    const rsi = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));

    // Determine trend
    let trend = 'NEUTRAL';
    if (price > ma50 && ma50 > ma200) trend = 'BULLISH';
    if (price < ma50 && ma50 < ma200) trend = 'BEARISH';

    res.json({
      endpoint: '/v1/price',
      cost_sats: 10,
      data: {
        symbol:     'BTC/USD',
        price:      price,
        change_24h: change.toFixed(2) + '%',
        high_24h:   high,
        low_24h:    low,
        volume_24h: '$' + (volume / 1e9).toFixed(2) + 'B',
        ma_50:      ma50.toFixed(2),
        ma_200:     ma200.toFixed(2),
        rsi_14:     rsi.toFixed(1),
        trend:      trend,
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch price data', detail: error.message });
  }
});

module.exports = router;