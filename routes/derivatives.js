const express = require('express');
const router = express.Router();
const axios = require('axios');

// Cache - refresh every 15 minutes
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
          cost_sats: 20,
          cached: true,
          data: cache.data,
          timestamp: cache.timestamp.toISOString()
        });
      }
    }

    // Bybit public API - no restrictions, no key needed
    const [
      tickerRes,
      fundingRes,
      longShortRes,
      openInterestRes
    ] = await Promise.all([
      axios.get('https://api.bybit.com/v5/market/tickers?category=linear&symbol=BTCUSDT'),
      axios.get('https://api.bybit.com/v5/market/funding/history?category=linear&symbol=BTCUSDT&limit=2'),
      axios.get('https://api.bybit.com/v5/market/account-ratio?category=linear&symbol=BTCUSDT&period=1h&limit=2'),
      axios.get('https://api.bybit.com/v5/market/open-interest?category=linear&symbol=BTCUSDT&intervalTime=1h&limit=2')
    ]);

    // --- Funding Rate ---
    const ticker         = tickerRes.data.result.list[0];
    const funding        = parseFloat(ticker.fundingRate);
    const fundingPct     = (funding * 100).toFixed(4);
    const fundingAnnual  = (funding * 100 * 3 * 365).toFixed(1);
    const markPrice      = parseFloat(ticker.markPrice);

    const fundingBias = funding > 0.001  ? 'LONGS_PAYING'
                      : funding < -0.001 ? 'SHORTS_PAYING'
                      : 'NEUTRAL';

    const fundingNote = funding > 0.001  ? 'Longs paying shorts — market overleveraged long, squeeze risk elevated'
                      : funding < -0.001 ? 'Shorts paying longs — short squeeze risk elevated'
                      : 'Balanced funding — no extreme leverage in either direction';

    // --- Open Interest ---
    const oiList    = openInterestRes.data.result.list;
    const oiCurrent = parseFloat(oiList[0].openInterest);
    const oiPrev    = parseFloat(oiList[1].openInterest);
    const oiChange  = (((oiCurrent - oiPrev) / oiPrev) * 100).toFixed(2);
    const oiUSD     = (oiCurrent * markPrice / 1e9).toFixed(2);
    const oiTrend   = oiCurrent > oiPrev ? 'INCREASING' : 'DECREASING';

    // --- Long/Short Ratio ---
    const lsData    = longShortRes.data.result.list;
    const lsCurrent = parseFloat(lsData[0].buyRatio);
    const lsPrev    = parseFloat(lsData[1].buyRatio);
    const longPct   = (lsCurrent * 100).toFixed(1);
    const shortPct  = ((1 - lsCurrent) * 100).toFixed(1);
    const lsTrend   = lsCurrent > lsPrev ? 'MORE_LONGS' : 'MORE_SHORTS';

    // --- 24h Liquidations from ticker ---
    const liqAmount = parseFloat(ticker.nextFundingTime);
    const bid1Price = parseFloat(ticker.bid1Price);
    const ask1Price = parseFloat(ticker.ask1Price);
    const spread    = ((ask1Price - bid1Price) / bid1Price * 100).toFixed(4);

    // --- Leverage Risk ---
    let leverageRisk = 'LOW';
    if (Math.abs(funding) > 0.002) leverageRisk = 'MEDIUM';
    if (Math.abs(funding) > 0.005) leverageRisk = 'HIGH';
    if (Math.abs(funding) > 0.01)  leverageRisk = 'EXTREME';

    // --- Smart Money Signal ---
    const smartSentiment = lsCurrent > 0.6  ? 'MAJORITY_LONG'
                         : lsCurrent < 0.4  ? 'MAJORITY_SHORT'
                         : 'BALANCED';

    const smartNote = lsCurrent > 0.6  ? 'Over 60% accounts long — contrarian bearish signal'
                    : lsCurrent < 0.4  ? 'Over 60% accounts short — contrarian bullish signal'
                    : 'Balanced positioning — no contrarian signal';

    const result = {
      funding_rate: {
        current_pct:    parseFloat(fundingPct),
        annualized_pct: parseFloat(fundingAnnual),
        bias:           fundingBias,
        note:           fundingNote,
        next_funding:   new Date(parseInt(ticker.nextFundingTime)).toISOString(),
      },
      open_interest: {
        btc:             parseFloat(oiCurrent.toFixed(0)),
        usd_billion:     parseFloat(oiUSD),
        change_1h_pct:   parseFloat(oiChange),
        trend:           oiTrend,
      },
      long_short: {
        long_pct:   parseFloat(longPct),
        short_pct:  parseFloat(shortPct),
        trend:      lsTrend,
        sentiment:  smartSentiment,
        note:       smartNote,
      },
      market_spread: {
        bid:        bid1Price,
        ask:        ask1Price,
        spread_pct: parseFloat(spread),
      },
      leverage_risk: leverageRisk,
    };

    cache = { data: result, timestamp: now };

    res.json({
      endpoint: '/v1/derivatives',
      cost_sats: 20,
      cached: false,
      data: result,
      timestamp: now.toISOString()
    });

  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch derivatives data', detail: error.message });
  }
});

module.exports = router;