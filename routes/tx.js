const express = require('express');
const router = express.Router();
const axios = require('axios');

router.get('/:txid', async (req, res) => {
  const { txid } = req.params;

  // Basic TXID validation — must be 64 hex characters
  if (!txid || !/^[a-fA-F0-9]{64}$/.test(txid)) {
    return res.status(400).json({
      error: 'Invalid TXID',
      detail: 'A valid Bitcoin TXID must be exactly 64 hexadecimal characters'
    });
  }

  try {
    const [tx, tipHeight] = await Promise.all([
      axios.get(`https://mempool.space/api/tx/${txid}`),
      axios.get('https://mempool.space/api/blocks/tip/height')
    ]);

    const txData      = tx.data;
    const blockHeight = tipHeight.data;
    const confirmed   = txData.status.confirmed;
    const confirms    = confirmed ? blockHeight - txData.status.block_height + 1 : 0;

    // Calculate total input and output values
    const totalInput  = txData.vin.reduce((sum, i) => sum + (i.prevout?.value || 0), 0);
    const totalOutput = txData.vout.reduce((sum, o) => sum + o.value, 0);
    const fee         = totalInput - totalOutput;

    res.json({
      endpoint: '/v1/tx/:txid',
      cost_sats: 5,
      data: {
        txid:          txid,
        status:        confirmed ? 'CONFIRMED' : 'PENDING',
        confirmations: confirms,
        block_height:  txData.status.block_height || null,
        block_time:    txData.status.block_time
                         ? new Date(txData.status.block_time * 1000).toISOString()
                         : null,
        fee_sats:      fee,
        fee_rate:      (fee / txData.size).toFixed(1) + ' sat/vB',
        size_bytes:    txData.size,
        weight:        txData.weight,
        inputs:        txData.vin.length,
        outputs:       txData.vout.length,
        value_sats:    totalOutput,
        value_btc:     (totalOutput / 1e8).toFixed(8),
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    if (error.response?.status === 404) {
      return res.status(404).json({ error: 'Transaction not found', txid });
    }
    res.status(500).json({ error: 'Failed to fetch transaction', detail: error.message });
  }
});

module.exports = router;