const express = require('express');
const router = express.Router();
const axios = require('axios');

// Cache 10 minutes — balances freshness vs cost
let cache = { data: null, timestamp: null };
const CACHE_MINUTES = 10;

router.get('/', async (req, res) => {
  try {
    const now = new Date();

    if (cache.data && cache.timestamp) {
      const minutesSince = (now - cache.timestamp) / 1000 / 60;
      if (minutesSince < CACHE_MINUTES) {
        return res.json({
          endpoint: '/v1/summary',
          cost_sats: 150,
          cached: true,
          cache_age_seconds: Math.round((now - cache.timestamp) / 1000),
          data: cache.data,
          timestamp: cache.timestamp.toISOString()
        });
      }
    }

    const base = process.env.BASE_URL || 'http://localhost:3000';

    // Fetch all endpoints in parallel
    const [signalRes, onchainRes, derivativesRes, mempoolRes, newsRes] = await Promise.all([
      axios.get(`${base}/v1/signal`),
      axios.get(`${base}/v1/onchain`),
      axios.get(`${base}/v1/derivatives`),
      axios.get(`${base}/v1/mempool`),
      axios.get(`${base}/v1/news`)
    ]);

    const signal      = signalRes.data.data;
    const onchain     = onchainRes.data.data;
    const derivatives = derivativesRes.data.data;
    const mempool     = mempoolRes.data.data;
    const news        = newsRes.data.data;

    const price    = signal.technicals.price_usd;
    const atr      = signal.technicals.atr_14d;
    const ma50     = signal.technicals.ma_50;
    const ma200    = signal.technicals.ma_200;
    const bbUpper  = signal.technicals.bb_upper;
    const bbLower  = signal.technicals.bb_lower;
    const fng      = onchain.fear_and_greed.value;

    // ─────────────────────────────────────────
    // MARKET SCORE 0–100
    // Weighted average of all available signals
    // ─────────────────────────────────────────
    const confluenceNorm  = signal.confluence / 100;
    const fngNorm         = fng <= 20 ? 0.85 : fng <= 35 ? 0.65 : fng <= 55 ? 0.50 : fng <= 75 ? 0.35 : 0.15;
    const fundingNorm     = derivatives.funding_rate.bias === 'SHORTS_PAYING' ? 0.70
                          : derivatives.funding_rate.bias === 'NEUTRAL'        ? 0.52
                          : derivatives.long_short.long_pct > 65               ? 0.28
                          : 0.45;
    const newsNorm        = news.sentiment === 'BULLISH' ? 0.75
                          : news.sentiment === 'NEUTRAL'  ? 0.50
                          : 0.25;
    const hashNorm        = onchain.network.hashrate_trend === 'INCREASING' ? 0.70 : 0.40;
    const leverageNorm    = derivatives.leverage_risk === 'LOW'    ? 0.80
                          : derivatives.leverage_risk === 'MEDIUM' ? 0.55
                          : derivatives.leverage_risk === 'HIGH'   ? 0.30
                          : 0.10;

    const marketScore = Math.round((
      confluenceNorm * 0.35 +
      fngNorm        * 0.20 +
      newsNorm       * 0.15 +
      fundingNorm    * 0.12 +
      hashNorm       * 0.10 +
      leverageNorm   * 0.08
    ) * 100);

    const marketScoreLabel = marketScore >= 75 ? 'VERY_BULLISH'
                           : marketScore >= 60 ? 'BULLISH'
                           : marketScore >= 45 ? 'NEUTRAL'
                           : marketScore >= 30 ? 'BEARISH'
                           : 'VERY_BEARISH';

    // ─────────────────────────────────────────
    // KEY PRICE LEVELS
    // Calculated from ATR, MAs and Bollinger Bands
    // ─────────────────────────────────────────
    const keyLevels = {
      current_price: price,
      critical_support: parseFloat(Math.min(
        bbLower || price * 0.94,
        ma200    || price * 0.90,
        price - (atr ? atr * 2 : price * 0.06)
      ).toFixed(2)),
      key_resistance: parseFloat(Math.max(
        bbUpper || price * 1.06,
        ma50     || price * 1.05
      ).toFixed(2)),
      invalidation_level: parseFloat((price - (atr ? atr * 3 : price * 0.09)).toFixed(2)),
      ma_50:  parseFloat(ma50?.toFixed(2)),
      ma_200: parseFloat(ma200?.toFixed(2)),
      bb_upper: bbUpper ? parseFloat(bbUpper.toFixed(2)) : null,
      bb_lower: bbLower ? parseFloat(bbLower.toFixed(2)) : null,
      distance_to_resistance_pct: bbUpper
        ? parseFloat(((bbUpper - price) / price * 100).toFixed(2))
        : null,
      distance_to_support_pct: bbLower
        ? parseFloat(((price - bbLower) / price * 100).toFixed(2))
        : null,
    };

    // ─────────────────────────────────────────
    // RISK MATRIX
    // Multiple risk dimensions in one place
    // ─────────────────────────────────────────
    const risks = [];
    if (signal.technicals.pi_cycle_ratio_pct > 85)
      risks.push({ level: 'CRITICAL', note: `Pi Cycle at ${signal.technicals.pi_cycle_ratio_pct}% — potential cycle top imminent` });
    if (derivatives.leverage_risk === 'HIGH' || derivatives.leverage_risk === 'EXTREME')
      risks.push({ level: 'HIGH', note: `Leverage risk ${derivatives.leverage_risk} — liquidation cascade possible` });
    if (derivatives.long_short.long_pct > 70)
      risks.push({ level: 'HIGH', note: `${derivatives.long_short.long_pct}% accounts long — extreme crowding, short squeeze imminent` });
    if (fng < 15)
      risks.push({ level: 'OPPORTUNITY', note: `F&G at ${fng} — historically strong long-term accumulation zone` });
    if (signal.technicals.rsi_4h < 15)
      risks.push({ level: 'OPPORTUNITY', note: `4H RSI at ${signal.technicals.rsi_4h} — extreme short-term oversold, bounce likely` });
    if (mempool.congestion === 'HIGH')
      risks.push({ level: 'MEDIUM', note: 'Network congested — high transaction fees, avoid on-chain moves' });
    if (risks.length === 0)
      risks.push({ level: 'LOW', note: 'No extreme risk conditions detected' });

    // ─────────────────────────────────────────
    // BOT-READY FIELDS
    // Flat, typed, zero-interpretation needed
    // ─────────────────────────────────────────
    const botReady = {
      signal:             signal.signal,
      confluence:         signal.confluence,
      market_score:       marketScore,
      market_score_label: marketScoreLabel,
      price_usd:          price,
      rsi_1d:             signal.technicals.rsi_1d,
      rsi_4h:             signal.technicals.rsi_4h,
      rsi_1h:             signal.technicals.rsi_1h,
      trend:              signal.market_context.market_phase,
      fear_greed:         fng,
      fear_greed_label:   onchain.fear_and_greed.label,
      funding_bias:       derivatives.funding_rate.bias,
      funding_rate_pct:   derivatives.funding_rate.current_pct,
      long_pct:           derivatives.long_short.long_pct,
      leverage_risk:      derivatives.leverage_risk,
      news_sentiment:     news.sentiment,
      btc_dominance:      onchain.dominance.btc_dominance,
      hashrate_trend:     onchain.network.hashrate_trend,
      mempool_congestion: mempool.congestion,
      pi_cycle_pct:       signal.technicals.pi_cycle_ratio_pct,
      atr_14d:            atr,
      support:            keyLevels.critical_support,
      resistance:         keyLevels.key_resistance,
      stop_loss:          signal.trade_setup?.stop_loss || null,
      target_1:           signal.trade_setup?.target_1  || null,
      risk_reward:        signal.trade_setup?.risk_reward || null,
      highest_risk:       risks[0]?.level || 'LOW',
      timestamp_unix:     Math.floor(now.getTime() / 1000),
    };

    // ─────────────────────────────────────────
    // AI EXECUTIVE SUMMARY
    // Analyst-grade, 4 sentences max
    // ─────────────────────────────────────────
    const aiRes = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 450,
        messages: [{
          role: 'user',
          content: `You are a senior Bitcoin market analyst writing a daily briefing for professional traders and AI agents.
Write exactly 4 sentences. No fluff. No disclaimers. Reference actual numbers.

Sentence 1: Overall market condition and the single most important driver right now.
Sentence 2: The biggest risk or opportunity in the next 24-48 hours with specific price levels.
Sentence 3: What derivatives and on-chain data are telling us that price alone doesn't show.
Sentence 4: One clear, actionable recommendation based on all data.

Current data snapshot:
- BTC Price: $${price}
- Signal: ${signal.signal} (confluence: ${signal.confluence}/100, market score: ${marketScore}/100)
- RSI: 1D ${signal.technicals.rsi_1d} / 4H ${signal.technicals.rsi_4h} / 1H ${signal.technicals.rsi_1h}
- Fear & Greed: ${fng} (${onchain.fear_and_greed.label}), trend: ${onchain.fear_and_greed.trend}
- Market Phase: ${onchain.market_phase.phase}
- Pi Cycle: ${signal.technicals.pi_cycle_ratio_pct}% convergence
- Funding Rate: ${derivatives.funding_rate.bias} (${derivatives.funding_rate.current_pct}%)
- Long/Short: ${derivatives.long_short.long_pct}% long — ${derivatives.long_short.note}
- Leverage Risk: ${derivatives.leverage_risk}
- Open Interest: $${derivatives.open_interest.usd_billion}B (${derivatives.open_interest.trend})
- News Sentiment: ${news.sentiment}
- BTC Dominance: ${onchain.dominance.btc_dominance}
- Hash Rate: ${onchain.network.hashrate_eh} EH/s (${onchain.network.hashrate_trend})
- Key levels: Support $${keyLevels.critical_support} / Resistance $${keyLevels.key_resistance}
- Trade setup: ${signal.trade_setup ? `Entry $${signal.trade_setup.entry_price}, Stop $${signal.trade_setup.stop_loss}, Target $${signal.trade_setup.target_1}` : 'No setup — HOLD'}
- Top risk: ${risks[0]?.note}`
        }]
      },
      {
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        }
      }
    );

    const executiveSummary = aiRes.data.content[0].text.trim();

    // ─────────────────────────────────────────
    // FINAL RESPONSE
    // ─────────────────────────────────────────
    const result = {
      // ── HEADLINE ──
      market_score:       marketScore,
      market_score_label: marketScoreLabel,
      executive_summary:  executiveSummary,

      // ── BOT-READY ──
      bot_ready: botReady,

      // ── SIGNAL ──
      signal: {
        action:             signal.signal,
        confluence:         signal.confluence,
        confidence:         signal.confidence,
        risk_level:         signal.risk_level,
        reasoning:          signal.reasoning,
        historical_context: signal.historical_context,
        trade_setup:        signal.trade_setup,
      },

      // ── KEY LEVELS ──
      key_levels: keyLevels,

      // ── RISK MATRIX ──
      risk_matrix: risks,

      // ── MARKET LAYERS ──
      technicals:     signal.technicals,
      onchain:        onchain,
      derivatives:    derivatives,
      mempool: {
        congestion:   mempool.congestion,
        pending_txs:  mempool.pending_txs,
        fees:         mempool.fees,
      },
      news: {
        sentiment:    news.sentiment,
        score:        news.score,
        summary:      news.summary,
        top_events:   news.top_events,
      },

      // ── FACTOR BREAKDOWN ──
      factors: signal.factors,
    };

    cache = { data: result, timestamp: now };

    res.json({
      endpoint: '/v1/summary',
      cost_sats: 150,
      cached: false,
      data: result,
      timestamp: now.toISOString()
    });

  } catch (error) {
    res.status(500).json({
      error: 'Failed to generate market summary',
      detail: error.message
    });
  }
});

module.exports = router;