const express = require('express');
const router = express.Router();
const axios = require('axios');

// Simple cache - avoids calling the AI on every request
let cache = { summary: null, timestamp: null };
const CACHE_HOURS = 6;

function parseRSSTitles(xml) {
  const titles = [];
  const regex = /<item>[\s\S]*?<title><!\[CDATA\[(.*?)\]\]><\/title>|<item>[\s\S]*?<title>(.*?)<\/title>/g;
  let match;
  while ((match = regex.exec(xml)) !== null && titles.length < 10) {
    const title = (match[1] || match[2] || '').trim();
    if (title) titles.push(title);
  }
  return titles;
}

router.get('/', async (req, res) => {
  try {
    const now = new Date();

    // Return cached version if less than 6 hours old
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

    // Fetch RSS from CoinDesk (accessible from cloud servers)
    const rssRes = await axios.get(
      'https://feeds.feedburner.com/CoinDesk',
      { timeout: 10000, headers: { 'User-Agent': 'Mozilla/5.0' } }
    );

    const titles = parseRSSTitles(rssRes.data);

    if (titles.length === 0) {
      throw new Error('No articles found in RSS feed');
    }

    const headlines = titles.map((t, i) => `${i + 1}. ${t}`).join('\n');

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
  "sources_analyzed": ${titles.length}
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

    const rawText = aiRes.data.content[0].text;
    const clean   = rawText.replace(/```json|```/g, '').trim();
    const parsed  = JSON.parse(clean);

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