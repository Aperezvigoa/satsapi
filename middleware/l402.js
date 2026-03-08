const axios = require('axios');
const crypto = require('crypto');

const PHOENIXD_URL = process.env.PHOENIXD_URL || 'http://localhost:9740';
const PHOENIXD_PASSWORD = process.env.PHOENIXD_PASSWORD || '';

// Costes en sats por endpoint
const ENDPOINT_COSTS = {
  '/v1/price': 3,
  '/v1/mempool': 2,
  '/v1/tx': 2,
  '/v1/onchain': 15,
  '/v1/derivatives': 15,
  '/v1/news': 50,
  '/v1/signal': 150,
  '/v1/summary': 200,
};

function getEndpointCost(path) {
  for (const [endpoint, cost] of Object.entries(ENDPOINT_COSTS)) {
    if (path.startsWith(endpoint)) return cost;
  }
  return null;
}

async function createInvoice(amountSat, description) {
  console.log('Calling phoenixd:', PHOENIXD_URL, 'password:', PHOENIXD_PASSWORD ? 'set' : 'NOT SET');
  const response = await axios.post(
    `${PHOENIXD_URL}/createinvoice`,
    new URLSearchParams({ amountSat, description, expirySeconds: 300 }),
    {
      auth: { username: '', password: PHOENIXD_PASSWORD },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    }
  );
  return response.data;
}

async function checkInvoice(paymentHash) {
  const response = await axios.get(
    `${PHOENIXD_URL}/payments/incoming/${paymentHash}`,
    { auth: { username: '', password: PHOENIXD_PASSWORD } }
  );
  return response.data;
}

async function l402Middleware(req, res, next) {
  // Rutas públicas — sin pago
  if (req.path === '/' || req.path === '/docs' || req.path === '/health' || req.path.startsWith('/v1/demo')) {
    return next();
  }

  // Bypass para llamadas internas entre endpoints (summary → signal, etc.)
  const internalSecret = process.env.INTERNAL_SECRET || 'satsapi-internal';
  if (req.headers['x-internal-secret'] === internalSecret) {
    return next();
  }

  const cost = getEndpointCost(req.path);
  if (!cost) return next();

  // Verificar si viene con token L402
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('L402 ')) {
    try {
      const token = authHeader.slice(5);
      const [macaroon, preimage] = token.split(':');
      // Verificar pago usando el payment hash del macaroon
      const paymentHash = Buffer.from(macaroon, 'base64').toString('utf8');
      const payment = await checkInvoice(paymentHash);
      if (payment && payment.isPaid) {
        return next();
      }
    } catch (e) {
      // Token inválido, continuar y pedir nuevo pago
    }
  }

  // Verificar si viene con payment_hash en query params (flujo simple)
  if (req.query.payment_hash) {
    try {
      const payment = await checkInvoice(req.query.payment_hash);
      if (payment && payment.isPaid) {
        return next();
      }
    } catch (e) {}
  }

  // Generar nuevo invoice
  try {
    const description = `SatsAPI ${req.path}`;
    const invoice = await createInvoice(cost, description);
    
    res.set('WWW-Authenticate', `L402 invoice="${invoice.serialized}", macaroon="${Buffer.from(invoice.paymentHash).toString('base64')}"`);
    return res.status(402).json({
      error: 'Payment Required',
      amount_sats: cost,
      invoice: invoice.serialized,
      payment_hash: invoice.paymentHash,
      message: `Pay ${cost} sats to access this endpoint. Then retry with ?payment_hash=${invoice.paymentHash}`
    });
  } catch (e) {
    console.error('L402 error:', e.message);
    return next(); // En caso de error con phoenixd, dejar pasar (modo degradado)
  }
}

module.exports = l402Middleware;