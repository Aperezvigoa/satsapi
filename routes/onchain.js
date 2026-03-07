const express = require('express');
const router = express.Router();
const axios = require('axios');

// Cache - refresh every 30 minutes
let cache = { data: null, timestamp: null };
const CACHE_MINUTES = 30;

router.get('/', async (req, res) => {
  try {
    // Return cached version if fresh enough
    const now = new Date();
    if (cache.data && cache.timestamp) {
      const minutesSince = (now - cache.timestamp) / 1000 / 60;
      if (minutesSince < CACHE_MINUTES) {
        return res.json({
          endpoint: '/v1/onchain',
          cost_sats: 20,
          cached: true,
          data: cache.data,
          timestamp: cache.timestamp.toISOString()
        });
      }
    }

    // Fetch all sources in parallel - all free, no keys needed
    const [
      fearGreed,
      globalMarket,
      btcSupply,
      mempoolStats
    ] = await Promise.all([
      // Fear & Greed Index - Alternative.me
      axios.get('https://api.alternative.me/fng/?limit=7'),

      // Global crypto market data - CoinGecko free tier
      axios.get('https://api.coingecko.com/api/v3/global'),

      // BTC supply and holder data - Blockchain.info
      axios.get('https://blockchain.info/q/totalbc'),

      // Mempool mining stats
      axios.get('https://mempool.space/api/v1/mining/hashrate/3d')
    ]);

    // --- Fear & Greed ---
    const fngToday     = fearGreed.data.data[0];
    const fngYesterday = fearGreed.data.data[1];
    const fngWeekAgo   = fearGreed.data.data[6];
    const fngValue     = parseInt(fngToday.value);
    const fngTrend     = fngValue > parseInt(fngYesterday.value) ? 'IMPROVING' : 'DETERIORATING';

    // --- Market Dominance & Cap ---
    const global        = globalMarket.data.data;
    const btcDominance  = global.market_cap_percentage.btc.toFixed(1);
    const totalMarketCap = (global.total_market_cap.usd / 1e12).toFixed(2);
    const btcMarketCap  = (global.total_market_cap.usd * global.market_cap_percentage.btc / 100 / 1e9).toFixed(1);
    const altcoinSeason = parseFloat(btcDominance) < 45 ? true : false;

    // --- BTC Supply ---
    const circulatingBTC = (parseInt(btcSupply.data) / 1e8).toFixed(0);
    const remainingBTC   = (21000000 - parseInt(circulatingBTC)).toFixed(0);
    const supplyMined    = ((parseInt(circulatingBTC) / 21000000) * 100).toFixed(2);

    // --- Hash Rate ---
    const hashrates     = mempoolStats.data.hashrates;
    const latestHash    = hashrates[hashrates.length - 1];
    const earliestHash  = hashrates[0];
    const hashrateEH    = (latestHash.avgHashrate / 1e18).toFixed(1);
    const hashrateTrend = latestHash.avgHashrate > earliestHash.avgHashrate ? 'INCREASING' : 'DECREASING';

    // --- Market Phase Detection ---
    // Uses Fear&Greed + BTC dominance to determine cycle phase
    let marketPhase = 'UNKNOWN';
    if (fngValue >= 75 && parseFloat(btcDominance) > 55) marketPhase = 'BTC_EUPHORIA';
    else if (fngValue >= 75 && parseFloat(btcDominance) < 50) marketPhase = 'ALTSEASON';
    else if (fngValue >= 55) marketPhase = 'GREED';
    else if (fngValue >= 45) marketPhase = 'NEUTRAL';
    else if (fngValue >= 25) marketPhase = 'FEAR';
    else marketPhase = 'EXTREME_FEAR';

    const phaseNote = {
      BTC_EUPHORIA:  'BTC leading, institutions buying — historically precedes altseason',
      ALTSEASON:     'Capital rotating to alts — BTC dominance falling',
      GREED:         'Market optimistic — watch for overextension',
      NEUTRAL:       'No clear directional bias — accumulation zone possible',
      FEAR:          'Retail selling — historically good long-term entry',
      EXTREME_FEAR:  'Maximum pessimism — historically best buying opportunities'
    }[marketPhase];

    const result = {
      fear_and_greed: {
        value:      fngValue,
        label:      fngToday.value_classification,
        trend:      fngTrend,
        yesterday:  parseInt(fngYesterday.value),
        week_ago:   parseInt(fngWeekAgo.value),
      },
      dominance: {
        btc_dominance:  parseFloat(btcDominance) + '%',
        altcoin_season: altcoinSeason,
        total_market_cap_trillion: parseFloat(totalMarketCap),
        btc_market_cap_billion:    parseFloat(btcMarketCap),
      },
      supply: {
        circulating_btc: parseInt(circulatingBTC),
        remaining_btc:   parseInt(remainingBTC),
        percent_mined:   parseFloat(supplyMined) + '%',
        max_supply:      21000000,
      },
      network: {
        hashrate_eh:    parseFloat(hashrateEH),
        hashrate_trend: hashrateTrend,
        hashrate_unit:  'EH/s',
      },
      market_phase: {
        phase: marketPhase,
        note:  phaseNote,
      }
    };

    // Save to cache
    cache = { data: result, timestamp: now };

    res.json({
      endpoint: '/v1/onchain',
      cost_sats: 20,
      cached: false,
      data: result,
      timestamp: now.toISOString()
    });

  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch on-chain data', detail: error.message });
  }
});

module.exports = router;