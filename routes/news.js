const express = require('express');
const router = express.Router();
const axios = require('axios');

// Simple cache - avoids calling the AI on every request
let cache = { summary: null, timestamp: null };
const CACHE_HOURS = 6;

router.get('/', async (req, res) => {
  try {
    // Return cached version if less than 6 hours old
    const now = new Date();
    if (cache.summary && cache.timestamp) {
      const hoursSince = (now - cache.timestamp) / 1000 / 3600;
      if (hoursSince < CACHE_HOURS) {
        return res.json({
          endpoint: '/v1/news',
          cost_sats: 50,
          cached: true,
          data: cache.summary,
          timestamp: cache.timestamp.toISOString()
        });
      }
    }

    // Fetch latest crypto headlines from CryptoCompare (free, no key needed)
    const newsRes = await axios.get(
      'https://min-api.cryptocompare.com/data/v2/news/?lang=EN&categories=BTC&sortOrder=popular'
    );

    // CryptoCompare v2 returns data.Data (array) — handle both old and new structure
    const rawData = newsRes.data?.Data;
    let articles = [];
    if (Array.isArray(rawData)) {
      articles = rawData.slice(0, 10);
    } else if (rawData?.Data && Array.isArray(rawData.Data)) {
      articles = rawData.Data.slice(0, 10);
    } else {
      throw new Error('Unexpected news API response structure');
    }

    if (articles.length === 0) {
      throw new Error('No articles returned from news API');
    }

    const headlines = articles.map((a, i) => `${i + 1}. ${a.title}`).join('\n');

    // Ask Claude to summarize and analyze
    const aiRes = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: `You are a concise Bitcoin market analyst. Based on these headlines, provide a JSON response with this exact structure, no extra text:
{
  "sentiment": "BULLISH or BEARISH or NEUTRAL",
  "score": 0.0 to 1.0,
  "summary": "2 sentence max summary of the most important developments",
  "top_events": ["event 1", "event 2", "event 3"],
  "sources_analyzed": 10
}

Headlines:
${headlines}`
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

    // Parse AI response
    const rawText = aiRes.data.content[0].text;
    const clean   = rawText.replace(/```json|```/g, '').trim();
    const parsed  = JSON.parse(clean);

    // Save to cache
    cache = { summary: parsed, timestamp: now };

    res.json({
      endpoint: '/v1/news',
      cost_sats: 50,
      cached: false,
      data: parsed,
      timestamp: now.toISOString()
    });

  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch news', detail: error.message });
  }
});

module.exports = router;