const express = require('express');
const router = express.Router();
const axios = require('axios');

router.get('/', async (req, res) => {
  try {
    // Bybit — works from all regions, no restrictions
    const [ticker, klines] = await Promise.all([
      axios.get('https://api.bybit.com/v5/market/tickers?category=linear&symbol=BTCUSDT'),
      axios.get('https://api.bybit.com/v5/market/kline?category=linear&symbol=BTCUSDT&interval=D&limit=200')
    ]);

    const t     = ticker.data.result.list[0];
    const price = parseFloat(t.lastPrice);
    const change = parseFloat(t.price24hPcnt) * 100;
    const high  = parseFloat(t.highPrice24h);
    const low   = parseFloat(t.lowPrice24h);
    const vol   = parseFloat(t.volume24h);

    // Bybit klines: [startTime, open, high, low, close, volume, turnover]
    // Returned newest first — reverse for chronological order
    const closes = klines.data.result.list
      .map(k => parseFloat(k[4]))
      .reverse();

    // Moving averages
    const ma50  = closes.length >= 50  ? closes.slice(-50).reduce((a,b)=>a+b,0)/50   : null;
    const ma200 = closes.length >= 200 ? closes.slice(-200).reduce((a,b)=>a+b,0)/200 : null;

    // RSI 14
    const recent = closes.slice(-15);
    let gains = 0, losses = 0;
    for (let i = 1; i < recent.length; i++) {
      const diff = recent[i] - recent[i-1];
      diff >= 0 ? gains += diff : losses += Math.abs(diff);
    }
    const avgGain = gains / 14;
    const avgLoss = losses / 14;
    const rsi = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));

    // Trend
    let trend = 'NEUTRAL';
    if (ma50 && ma200) {
      if (price > ma50 && ma50 > ma200) trend = 'BULLISH';
      if (price < ma50 && ma50 < ma200) trend = 'BEARISH';
    }

    // MACD bias
    const ema12 = closes.slice(-12).reduce((a,b)=>a+b,0)/12;
    const ema26 = closes.slice(-26).reduce((a,b)=>a+b,0)/26;
    const macdBias = ema12 > ema26 ? 'BULLISH' : 'BEARISH';

    res.json({
      endpoint: '/v1/price',
      cost_sats: 3,
      data: {
        symbol:     'BTC/USD',
        price:      price,
        change_24h: change.toFixed(2) + '%',
        high_24h:   high,
        low_24h:    low,
        volume_24h: '$' + (vol * price / 1e9).toFixed(2) + 'B',
        ma_50:      ma50  ? parseFloat(ma50.toFixed(2))  : null,
        ma_200:     ma200 ? parseFloat(ma200.toFixed(2)) : null,
        rsi_14:     parseFloat(rsi.toFixed(1)),
        trend:      trend,
        macd_bias:  macdBias,
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch price data', detail: error.message });
  }
});

module.exports = router;