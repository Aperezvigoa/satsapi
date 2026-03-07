const express = require('express');
const router = express.Router();
const axios = require('axios');

router.get('/', async (req, res) => {
  try {
    // CryptoCompare — no geo restrictions, no API key needed for basic data
    const [priceRes, historyRes] = await Promise.all([
      axios.get('https://min-api.cryptocompare.com/data/pricemultifull?fsyms=BTC&tsyms=USD'),
      axios.get('https://min-api.cryptocompare.com/data/v2/histoday?fsym=BTC&tsym=USD&limit=200')
    ]);

    const raw    = priceRes.data.RAW.BTC.USD;
    const price  = raw.PRICE;
    const change = raw.CHANGEPCT24HOUR;
    const high   = raw.HIGH24HOUR;
    const low    = raw.LOW24HOUR;
    const vol    = raw.TOTALVOLUME24HTO;

    // Historical closes for indicators
    const closes = historyRes.data.Data.Data.map(d => d.close);

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
        volume_24h: '$' + (vol / 1e9).toFixed(2) + 'B',
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