require('dotenv').config();
const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const cors = require('cors');

const app = express();

// ✅ Enable CORS so Flutter Web can talk to backend
app.use(cors());

// ✅ Parse JSON
app.use(bodyParser.json());

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

// Simple in-memory store (OK for now)
const payments = {};

/**
 * POST /pay
 * Body: { phone: "07XXXXXXXX", amount: 100 }
 */
app.post('/pay', async (req, res) => {
  try {
    const { phone, amount, email } = req.body;
    if (!phone || !amount) {
      console.log('❌ Missing phone or amount in request body:', req.body);
      return res.status(400).json({ error: 'phone and amount required' });
    }

    // Format phone to +2547XXXXXXX
    let formattedPhone = phone.trim();
    if (formattedPhone.startsWith('0')) {
      formattedPhone = '+254' + formattedPhone.slice(1);
    } else if (!formattedPhone.startsWith('+')) {
      formattedPhone = formattedPhone.startsWith('254')
        ? '+' + formattedPhone
        : '+254' + formattedPhone;
    }

    const amountInSmallest = Math.round(Number(amount) * 100);

    const payload = {
      amount: amountInSmallest,
      currency: 'KES',
      email: email || 'customer@fastcv.app',
      mobile_money: {
        phone: formattedPhone,
        provider: 'mpesa'
      }
    };

    // 🔹 Log payload being sent to Paystack
    console.log('💡 Sending to Paystack:', JSON.stringify(payload, null, 2));

    const response = await axios.post(
      'https://api.paystack.co/charge',
      payload,
      {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const data = response.data;
    const reference = data.data.reference;

    payments[reference] = {
      status: data.data.status || 'pending',
      createdAt: new Date().toISOString()
    };

    // 🔹 Log response from Paystack
    console.log('✅ Paystack response:', JSON.stringify(data, null, 2));

    return res.json({
      ok: true,
      message: data.message,
      data: data.data
    });

  } catch (err) {
    // 🔹 Log full error from Paystack
    console.error('❌ Pay error full detail:', err.response?.data || err.message);
    return res.status(500).json({
      error: 'pay_failed',
      details: err.response?.data || err.message
    });
  }
});

/**
 * GET /verify?reference=xxx
 */
app.get('/verify', async (req, res) => {
  const { reference } = req.query;
  if (!reference) {
    return res.status(400).json({ error: 'reference required' });
  }

  try {
    const r = await axios.get(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET}`
        }
      }
    );

    payments[reference] = payments[reference] || {};
    payments[reference].status = r.data.data.status;

    return res.json({ ok: true, data: r.data.data });
  } catch (err) {
    console.error('Verify error:', err.response?.data || err.message);
    return res.status(500).json({
      error: 'verify_failed',
      details: err.response?.data || err.message
    });
  }
});

/**
 * POST /webhook
 */
app.post('/webhook', (req, res) => {
  const signature = req.headers['x-paystack-signature'];
  const hash = crypto
    .createHmac('sha512', PAYSTACK_SECRET)
    .update(JSON.stringify(req.body))
    .digest('hex');

  if (signature !== hash) {
    return res.status(400).send('Invalid signature');
  }

  const event = req.body;
  if (event.data?.reference) {
    payments[event.data.reference] =
      payments[event.data.reference] || {};
    payments[event.data.reference].status =
      event.data.status || 'unknown';
  }

  res.json({ status: 'ok' });
});

/**
 * GET /check?reference=xxx
 */
app.get('/check', (req, res) => {
  const { reference } = req.query;
  if (!reference) {
    return res.status(400).json({ error: 'reference required' });
  }
  const record = payments[reference];
  if (!record) return res.json({ found: false });
  return res.json({ found: true, record });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`✅ Backend running on http://localhost:${PORT}`)
);
