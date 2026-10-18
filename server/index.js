const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Treasury address that receives ticket payments (replace with your real one)
const TREASURY_ADDRESS = process.env.TREASURY_ADDRESS || 'rxd1treasuryplaceholderaddress';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

const DB_PATH = path.join(__dirname, 'data.json');

function loadDB() {
  if (!fs.existsSync(DB_PATH)) {
    return {
      pot: 0,
      currentDrawId: 1,
      tickets: [],
      users: {},
      winners: [],
      payments: [],   // { id, userId, address, amount, qty, status, txid, createdAt }
      lastDraw: null
    };
  }
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

function saveDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

let db = loadDB();

function getTelegramUser(initData) {
  if (!initData) return null;
  try {
    const params = new URLSearchParams(initData);
    const userStr = params.get('user');
    if (!userStr) return null;
    return JSON.parse(userStr);
  } catch (e) {
    return null;
  }
}

// Connect / link wallet
app.post('/api/connect-wallet', (req, res) => {
  const initData = req.headers['x-telegram-init-data'];
  const tgUser = getTelegramUser(initData);
  if (!tgUser) return res.status(401).json({ error: 'Not authenticated' });

  const { address } = req.body;
  if (!isValidRadiantAddress(address)) {
    return res.status(400).json({ error: 'Invalid Radiant wallet address. Must start with 1 and be a valid Base58 address.' });
  }

  const userId = tgUser.id;
  if (!db.users[userId]) {
    db.users[userId] = {
      username: tgUser.username || tgUser.first_name || `user${userId}`,
      firstName: tgUser.first_name,
      walletAddress: address,
      balance: 0
    };
  } else {
    db.users[userId].walletAddress = address;
  }

  saveDB(db);
  res.json({ success: true, address });
});

app.get('/api/state', (req, res) => {
  const initData = req.headers['x-telegram-init-data'];
  const tgUser = getTelegramUser(initData);
  const userId = tgUser?.id;

  const userTickets = userId
    ? db.tickets.filter(t => t.userId === userId && t.drawId === db.currentDrawId)
    : [];

  const user = userId ? (db.users[userId] || {}) : {};

  res.json({
    pot: db.pot,
    currentDrawId: db.currentDrawId,
    myTickets: userTickets.map(t => t.number),
    myTicketCount: userTickets.length,
    balance: user.balance || 0,
    walletAddress: user.walletAddress || null,
    winners: db.winners.slice(-20).reverse(),
    nextDraw: getNextFriday9PM(),
    treasury: TREASURY_ADDRESS
  });
});

// Create a payment request
app.post('/api/create-payment', (req, res) => {
  const initData = req.headers['x-telegram-init-data'];
  const tgUser = getTelegramUser(initData);
  if (!tgUser) return res.status(401).json({ error: 'Not authenticated' });

  const qty = Math.min(Math.max(parseInt(req.body.qty) || 1, 1), 250);
  const userId = tgUser.id;

  if (!db.users[userId]) {
    db.users[userId] = {
      username: tgUser.username || tgUser.first_name || `user${userId}`,
      firstName: tgUser.first_name,
      walletAddress: null,
      balance: 0
    };
  }
  const user = db.users[userId];

  const userTicketsThisDraw = db.tickets.filter(t => t.userId === userId && t.drawId === db.currentDrawId);
  if (userTicketsThisDraw.length + qty > 250) {
    return res.status(400).json({ error: 'Max 250 tickets per draw' });
  }

  const amount = qty * 5;
  const payment = {
    id: crypto.randomUUID(),
    userId,
    username: user.username,
    address: user.walletAddress || 'not-connected',
    amount,
    qty,
    status: 'pending',
    txid: null,
    createdAt: new Date().toISOString()
  };

  db.payments.push(payment);
  saveDB(db);

  res.json({
    success: true,
    paymentId: payment.id,
    amount,
    treasury: TREASURY_ADDRESS,
    message: `Send exactly ${amount} RXD to ${TREASURY_ADDRESS}`
  });
});

// Track used txids to prevent reuse
function isTxidUsed(txid) {
  return db.payments.some(p => p.txid === txid && p.status === 'confirmed');
}

async function verifyTxOnExplorer(txid, expectedAmount, fromAddress, treasury) {
  try {
    const url = `https://radiantexplorer.com/api/gettx/${txid}`;
    const response = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!response.ok) {
      return { success: false, reason: 'not_found' };
    }
    const data = await response.json();
    if (!data || !Array.isArray(data.vout)) {
      return { success: false, reason: 'invalid_response' };
    }

    // Sum RXD sent to the treasury address (value is in photons, 1 RXD = 100_000_000)
    let received = 0;
    for (const out of data.vout) {
      const addrs = out.scriptPubKey?.addresses || [];
      if (addrs.includes(treasury)) {
        received += Number(out.value || 0) / 100000000;
      }
    }

    // Quietly accept if equal or more. Reject if less.
    if (received >= expectedAmount) {
      return { success: true, received };
    }
    if (received > 0) {
      return { success: false, reason: 'insufficient', received };
    }
    return { success: false, reason: 'not_to_treasury' };
  } catch (e) {
    console.error('Explorer check failed:', e.message);
    return { success: false, reason: 'error' };
  }
}

// Valid Radiant address: Base58, starts with 1, length 26-35
function isValidRadiantAddress(addr) {
  if (!addr || typeof addr !== 'string') return false;
  if (!addr.startsWith('1')) return false;
  if (addr.length < 26 || addr.length > 35) return false;
  return /^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/.test(addr);
}
app.post('/api/verify-payment', async (req, res) => {
  const initData = req.headers['x-telegram-init-data'];
  const tgUser = getTelegramUser(initData);
  if (!tgUser) return res.status(401).json({ error: 'Not authenticated' });

  const { paymentId, txid } = req.body;
  const payment = db.payments.find(p => p.id === paymentId && p.userId === tgUser.id);

  if (!payment) return res.status(404).json({ error: 'Payment not found' });
  if (payment.status === 'confirmed') return res.status(400).json({ error: 'Already confirmed' });

  if (!txid || txid.length < 10) {
    return res.status(400).json({ error: 'Invalid txid' });
  }

  if (isTxidUsed(txid)) {
    return res.status(400).json({ error: 'This transaction ID has already been used.' });
  }

  // Automatic check against Radiant explorer (waits up to ~30s)
  const result = await verifyTxOnExplorer(txid, payment.amount, payment.address, TREASURY_ADDRESS);
  if (!result.success) {
    payment.status = 'failed';
    saveDB(db);
    let msg = 'Transaction ID cannot be found. Please try again.';
    if (result.reason === 'insufficient') {
      msg = `Insufficient amount. You sent ${result.received || 0} RXD but need at least ${payment.amount} RXD.`;
    } else if (result.reason === 'not_to_treasury') {
      msg = 'Transaction does not send to the treasury address.';
    }
    return res.status(400).json({ error: msg });
  }

  payment.status = 'confirmed';
  payment.txid = txid;
  payment.confirmedAt = new Date().toISOString();

  // Issue tickets
  const newTickets = [];
  for (let i = 0; i < payment.qty; i++) {
    const number = String(Math.floor(10000 + Math.random() * 90000));
    db.tickets.push({
      id: crypto.randomUUID(),
      userId: payment.userId,
      username: payment.username,
      number,
      drawId: db.currentDrawId,
      createdAt: new Date().toISOString(),
      paymentId: payment.id
    });
    newTickets.push(number);
  }

  db.pot += payment.amount;
  saveDB(db);

  res.json({
    success: true,
    tickets: newTickets,
    pot: db.pot
  });
});

app.post('/api/draw', (req, res) => {
  const currentTickets = db.tickets.filter(t => t.drawId === db.currentDrawId);
  if (currentTickets.length === 0) {
    return res.json({ message: 'No tickets to draw' });
  }

  const winnerTicket = currentTickets[Math.floor(Math.random() * currentTickets.length)];
  const winnerShare = Math.floor(db.pot * 0.8);
  const devShare = Math.floor(db.pot * 0.1);
  const radiantShare = Math.floor(db.pot * 0.1);

  db.winners.push({
    username: winnerTicket.username,
    ticket: winnerTicket.number,
    amount: winnerShare,
    date: new Date().toISOString(),
    drawId: db.currentDrawId
  });

  db.pot = 0;
  db.currentDrawId += 1;
  db.lastDraw = new Date().toISOString();

  saveDB(db);

  res.json({
    winner: winnerTicket.username,
    ticket: winnerTicket.number,
    amount: winnerShare,
    devShare,
    radiantShare
  });
});

app.get('/api/winners', (req, res) => {
  res.json(db.winners.slice(-50).reverse());
});

function getNextFriday9PM() {
  const now = new Date();
  const vancouver = new Date(now.toLocaleString('en-US', { timeZone: 'America/Vancouver' }));
  let day = vancouver.getDay();
  let daysUntil = (5 - day + 7) % 7;
  if (daysUntil === 0 && vancouver.getHours() >= 21) daysUntil = 7;
  const next = new Date(vancouver);
  next.setDate(vancouver.getDate() + daysUntil);
  next.setHours(21, 0, 0, 0);
  return next.toISOString();
}

app.listen(PORT, () => {
  console.log(`RXD Pulse Lottery running on port ${PORT}`);
  console.log(`Treasury: ${TREASURY_ADDRESS}`);
});
