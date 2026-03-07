const express = require('express');
const router = express.Router();
const axios = require('axios');

let cache = { data: null, timestamp: null };
const CACHE_MINUTES = 15;

router.get('/', async (req, res) => {
  try {
    const now = new Date();
    if (cache.data && cache.timestamp) {
      const minutesSince = (now - cache.timestamp) / 1000 / 60;
      if (minutesSince < CACHE_MINUTES) {
        return res.json({
          endpoint: '/v1/derivatives',
          cost_sats: 15,
          cached: true,
          data: cache.data,
          timestamp: cache.timestamp.toISOString()
        });
      }
    }

    // CryptoCompare for price and volume data — works from all servers
    const [priceRes, histRes] = await Promise.all([
      axios.get('https://min-api.cryptocompare.com/data/pricemultifull?fsyms=BTC&tsyms=USD'),
      axios.get('https://min-api.cryptocompare.com/data/v2/histohour?fsym=BTC&tsym=USD&limit=24')
    ]);

    const raw   = priceRes.data.RAW.BTC.USD;
    const price = raw.PRICE;
    const vol24 = raw.TOTALVOLUME24HTO;

    // Calculate price momentum to estimate funding rate bias
    const hours   = histRes.data.Data.Data;
    const closes  = hours.map(h => h.close);
    const recent3 = closes.slice(-3);
    const older3  = closes.slice(-6, -3);
    const recentAvg = recent3.reduce((a,b)=>a+b,0)/3;
    const olderAvg  = older3.reduce((a,b)=>a+b,0)/3;
    const momentum  = (recentAvg - olderAvg) / olderAvg;

    // Estimate funding rate from momentum
    const fundingRate = Math.max(-0.01, Math.min(0.01, momentum * 0.5));
    const fundingPct  = (fundingRate * 100).toFixed(4);
    const fundingAnnual = (fundingRate * 100 * 3 * 365).toFixed(1);

    const fundingBias = fundingRate > 0.001  ? 'LONGS_PAYING'
                      : fundingRate < -0.001 ? 'SHORTS_PAYING'
                      : 'NEUTRAL';

    const fundingNote = fundingRate > 0.001
      ? 'Positive momentum suggests longs paying — market leaning long'
      : fundingRate < -0.001
      ? 'Negative momentum suggests shorts paying — market leaning short'
      : 'Balanced momentum — no extreme leverage detected';

    // Estimate long/short from price action
    const change1h  = (closes[closes.length-1] - closes[closes.length-2]) / closes[closes.length-2];
    const change24h = (closes[closes.length-1] - closes[0]) / closes[0];

    const longPct  = Math.min(70, Math.max(30, 50 + (change24h * 500)));
    const shortPct = 100 - longPct;

    const smartSentiment = longPct > 60  ? 'MAJORITY_LONG'
                         : longPct < 40  ? 'MAJORITY_SHORT'
                         : 'BALANCED';

    const smartNote = longPct > 60
      ? `${longPct.toFixed(1)}% estimated long — contrarian bearish signal`
      : longPct < 40
      ? `${shortPct.toFixed(1)}% estimated short — contrarian bullish signal`
      : 'Balanced positioning — no strong contrarian signal';

    // Open interest estimated from volume
    const oiEstimate = (vol24 * 0.15 / 1e9).toFixed(2);

    const leverageRisk = Math.abs(fundingRate) > 0.005 ? 'HIGH'
                       : Math.abs(fundingRate) > 0.002 ? 'MEDIUM'
                       : 'LOW';

    const result = {
      funding_rate: {
        current_pct:    parseFloat(fundingPct),
        annualized_pct: parseFloat(fundingAnnual),
        bias:           fundingBias,
        note:           fundingNote,
        estimated:      true,
      },
      open_interest: {
        usd_billion:   parseFloat(oiEstimate),
        trend:         momentum > 0 ? 'INCREASING' : 'DECREASING',
        estimated:     true,
      },
      long_short: {
        long_pct:   parseFloat(longPct.toFixed(1)),
        short_pct:  parseFloat(shortPct.toFixed(1)),
        trend:      longPct > 50 ? 'MORE_LONGS' : 'MORE_SHORTS',
        sentiment:  smartSentiment,
        note:       smartNote,
        estimated:  true,
      },
      price_momentum: {
        change_1h_pct:  parseFloat((change1h * 100).toFixed(3)),
        change_24h_pct: parseFloat((change24h * 100).toFixed(2)),
      },
      leverage_risk: leverageRisk,
      data_note: 'Funding rate and L/S ratio estimated from price momentum. Exchange APIs restricted from cloud servers.'
    };

    cache = { data: result, timestamp: now };

    res.json({
      endpoint: '/v1/derivatives',
      cost_sats: 15,
      cached: false,
      data: result,
      timestamp: now.toISOString()
    });

  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch derivatives data', detail: error.message });
  }
});

module.exports = router;