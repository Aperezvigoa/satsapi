const express = require('express');
const router = express.Router();
const axios = require('axios');

router.get('/', async (req, res) => {
  try {
    // CoinGecko free tier — no geo restrictions
    const [ticker, klines] = await Promise.all([
      axios.get('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_high_24h=true&include_low_24h=true'),
      axios.get('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=200', {
        headers: { 'X-Forwarded-For': '1.1.1.1' },
        timeout: 5000
      }).catch(() =>
        // Fallback to Bybit if Binance fails
        axios.get('https://api.bybit.com/v5/market/kline?category=linear&symbol=BTCUSDT&interval=D&limit=200')
      )
    ]);

    const btc    = ticker.data.bitcoin;
    const price  = btc.usd;
    const change = btc.usd_24h_change;

    // Parse klines from either Binance or Bybit
    let closes = [];
    if (klines.data.result) {
      // Bybit format
      closes = klines.data.result.list.map(k => parseFloat(k[4])).reverse();
    } else {
      // Binance format
      closes = klines.data.map(k => parseFloat(k[4]));
    }

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

    // MACD (simple)
    const ema12 = closes.slice(-12).reduce((a,b)=>a+b,0)/12;
    const ema26 = closes.slice(-26).reduce((a,b)=>a+b,0)/26;
    const macdBias = ema12 > ema26 ? 'BULLISH' : 'BEARISH';

    res.json({
      endpoint: '/v1/price',
      cost_sats: 3,
      data: {
        symbol:     'BTC/USD',
        price:      price,
        change_24h: change ? change.toFixed(2) + '%' : 'N/A',
        high_24h:   btc.usd_24h_high || null,
        low_24h:    btc.usd_24h_low  || null,
        volume_24h: btc.usd_24h_vol  ? '$' + (btc.usd_24h_vol / 1e9).toFixed(2) + 'B' : null,
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