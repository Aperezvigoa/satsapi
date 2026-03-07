const express = require('express');
const router = express.Router();
const axios = require('axios');

router.get('/', async (req, res) => {
  try {
    // Fetch data from mempool.space (free, no key needed)
    const [fees, mempool, blocks] = await Promise.all([
      axios.get('https://mempool.space/api/v1/fees/recommended'),
      axios.get('https://mempool.space/api/mempool'),
      axios.get('https://mempool.space/api/v1/blocks')
    ]);

    const pendingTxs  = mempool.data.count;
    const pendingSize = (mempool.data.vsize / 1e6).toFixed(2);
    const lastBlock   = blocks.data[0];

    // Determine congestion level
    let congestion = 'LOW';
    if (pendingTxs > 50000)  congestion = 'MEDIUM';
    if (pendingTxs > 100000) congestion = 'HIGH';

    res.json({
      endpoint: '/v1/mempool',
      cost_sats: 5,
      data: {
        pending_txs:   pendingTxs,
        pending_size:  pendingSize + ' MB',
        congestion:    congestion,
        fees: {
          fast_10min:  fees.data.fastestFee  + ' sat/vB',
          medium_30min:fees.data.halfHourFee + ' sat/vB',
          slow_1h:     fees.data.hourFee     + ' sat/vB',
          minimum:     fees.data.minimumFee  + ' sat/vB',
        },
        last_block: {
          height:    lastBlock.height,
          timestamp: new Date(lastBlock.timestamp * 1000).toISOString(),
          tx_count:  lastBlock.tx_count,
          size_kb:   (lastBlock.size / 1024).toFixed(1) + ' KB',
        }
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch mempool data', detail: error.message });
  }
});

module.exports = router;