require('dotenv').config();
const express = require('express');
const rateLimit = require('express-rate-limit');
const app = express();
app.set('trust proxy', 1); 

const cors = require('cors');
app.use(cors());

const l402 = require('./middleware/l402');
app.use(l402);

app.use(express.json());
app.use(express.static('public'));

// ─────────────────────────────────────────
// RATE LIMITERS
// ─────────────────────────────────────────

// Demo endpoint — 5 calls per hour per IP
const demoLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Rate limit reached',
    detail: 'Max 5 free demo calls per hour. Pay with Lightning for full access.',
    docs: 'https://satsapi.dev/docs'
  }
});

app.use('/v1/demo', demoLimiter, require('./routes/demo'));

// Standard endpoints — 60 calls per minute per IP
const standardLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests',
    detail: 'Standard endpoints allow 60 requests per minute per IP.',
    retry_after: '60 seconds',
    docs: 'https://satsapi.io/docs'
  }
});

// AI endpoints — 10 calls per minute per IP (protects Claude API costs)
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests',
    detail: 'AI-powered endpoints allow 10 requests per minute per IP.',
    retry_after: '60 seconds',
    docs: 'https://satsapi.io/docs'
  }
});

// Summary endpoint — 5 calls per minute per IP (most expensive)
const summaryLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests',
    detail: 'Summary endpoint allows 5 requests per minute per IP.',
    retry_after: '60 seconds',
    docs: 'https://satsapi.io/docs'
  }
});

// ─────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────

// Standard — no AI involved
app.use('/v1/price',       standardLimiter, require('./routes/price'));
app.use('/v1/mempool',     standardLimiter, require('./routes/mempool'));
app.use('/v1/tx',          standardLimiter, require('./routes/tx'));

// AI-powered
app.use('/v1/news',        aiLimiter,       require('./routes/news'));
app.use('/v1/signal',      aiLimiter,       require('./routes/signal'));
app.use('/v1/onchain',     standardLimiter, require('./routes/onchain'));
app.use('/v1/derivatives', standardLimiter, require('./routes/derivatives'));

// Most expensive — everything combined
app.use('/v1/summary',     summaryLimiter,  require('./routes/summary'));

// ─────────────────────────────────────────
// ROOT — what bots and developers see first
// ─────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    name: 'SatsAPI',
    description: 'Bitcoin market intelligence API. Pay per call in satoshis via Lightning Network.',
    version: '1.0.0',
    endpoints: {
      price:       { path: '/v1/price',       cost: '3 sats',   rate_limit: '60/min',  description: 'BTC price + RSI + moving averages + trend' },
      mempool:     { path: '/v1/mempool',      cost: '2 sats',   rate_limit: '60/min',  description: 'Mempool status + optimal fees + last block' },
      tx:          { path: '/v1/tx/:txid',     cost: '2 sats',   rate_limit: '60/min',  description: 'Transaction status, confirmations and details' },
      onchain:     { path: '/v1/onchain',      cost: '15 sats',  rate_limit: '60/min',  description: 'Fear & Greed + BTC dominance + supply + hashrate + market phase' },
      derivatives: { path: '/v1/derivatives',  cost: '15 sats',  rate_limit: '60/min',  description: 'Funding rates + open interest + long/short ratio + leverage risk' },
      news:        { path: '/v1/news',         cost: '50 sats',  rate_limit: '10/min',  description: 'AI-powered daily crypto news summary + sentiment' },
      signal:      { path: '/v1/signal',       cost: '150 sats', rate_limit: '10/min',  description: '9-factor signal: BUY/SELL/HOLD + trade setup + Pi Cycle + multi-timeframe RSI' },
      summary:     { path: '/v1/summary',      cost: '200 sats', rate_limit: '5/min',   description: 'Full market intelligence: all endpoints + executive summary + risk matrix + bot-ready fields' },
    },
    payment:  'Lightning Network (L402)',
    docs: 'https://satsapi.dev/docs',
    github: 'https://github.com/Aperezvigoa/satsapi',
  });
});

// ─────────────────────────────────────────
// 404 HANDLER
// ─────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    available_endpoints: ['/v1/price', '/v1/mempool', '/v1/tx/:txid', '/v1/onchain', '/v1/derivatives', '/v1/news', '/v1/signal', '/v1/summary'],
    docs: 'https://satsapi.dev/docs'
  });
});

// ─────────────────────────────────────────
// START
// ─────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`SatsAPI running on http://localhost:${PORT}`);
  console.log(`Endpoints: price, mempool, tx, onchain, derivatives, news, signal, summary`);
  console.log(`Rate limiting: standard 60/min · AI 10/min · summary 5/min`);
});