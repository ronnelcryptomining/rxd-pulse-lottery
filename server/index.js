const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Simple file-based database
const DB_PATH = path.join(__dirname, 'data.json');

function loadDB() {
  if (!fs.existsSync(DB_PATH)) {
    return {
      pot: 0,
      currentDrawId: 1,
      tickets: [],       // { id, userId, username, number, drawId, createdAt }
      users: {},         // userId -> { balance, username, firstName }
      winners: [],       // { username, ticket, amount, date, drawId }
      lastDraw: null
    };
  }
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

function saveDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

let db = loadDB();

// Telegram initData verification (simplified - in production verify hash properly)
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

// Routes
app.get('/api/state', (req, res) => {
  const initData = req.headers['x-telegram-init-data'];
  const tgUser = getTelegramUser(initData);
  const userId = tgUser?.id;

  const userTickets = userId 
    ? db.tickets.filter(t => t.userId === userId && t.drawId === db.currentDrawId)
    : [];

  const user = userId ? (db.users[userId] || { balance: 0 }) : { balance: 0 };

  res.json({
    pot: db.pot,
    currentDrawId: db.currentDrawId,
    myTickets: userTickets.map(t => t.number),
    myTicketCount: userTickets.length,
    balance: user.balance,
    winners: db.winners.slice(-20).reverse(),
    nextDraw: getNextFriday9PM()
  });
});

app.post('/api/buy', (req, res) => {
  const initData = req.headers['x-telegram-init-data'];
  const tgUser = getTelegramUser(initData);
  if (!tgUser) return res.status(401).json({ error: 'Not authenticated' });

  const qty = Math.min(Math.max(parseInt(req.body.qty) || 1, 1), 50);
  const userId = tgUser.id;
  const username = tgUser.username || tgUser.first_name || `user${userId}`;

  if (!db.users[userId]) {
    db.users[userId] = { balance: 1000, username, firstName: tgUser.first_name };
  }

  const cost = qty * 5;
  if (db.users[userId].balance < cost) {
    return res.status(400).json({ error: 'Insufficient balance' });
  }

  const userTicketsThisDraw = db.tickets.filter(t => t.userId === userId && t.drawId === db.currentDrawId);
  if (userTicketsThisDraw.length + qty > 200) {
    return res.status(400).json({ error: 'Max 200 tickets per draw' });
  }

  db.users[userId].balance -= cost;
  db.pot += cost;

  const newTickets = [];
  for (let i = 0; i < qty; i++) {
    const number = String(Math.floor(10000 + Math.random() * 90000));
    const ticket = {
      id: crypto.randomUUID(),
      userId,
      username,
      number,
      drawId: db.currentDrawId,
      createdAt: new Date().toISOString()
    };
    db.tickets.push(ticket);
    newTickets.push(number);
  }

  saveDB(db);
  res.json({ success: true, tickets: newTickets, newBalance: db.users[userId].balance, pot: db.pot });
});

app.post('/api/draw', (req, res) => {
  // In production this should be protected or run by a cron
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

  // Reset for next draw
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
});
