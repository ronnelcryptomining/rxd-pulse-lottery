const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
}

const API = '';

async function api(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'x-telegram-init-data': tg?.initData || ''
  };
  const res = await fetch(API + path, { ...options, headers: { ...headers, ...options.headers } });
  return res.json();
}

let state = { pot: 0, myTickets: [], balance: 0, winners: [], nextDraw: null };
let currentTab = 'home';
let walletConnected = false;
let walletAddress = null;

function updateBalance() {
  const balEl = document.getElementById('balance');
  if (!balEl) return;
  if (walletConnected) {
    balEl.textContent = `${(state.balance || 0).toLocaleString()} RXD`;
    balEl.style.display = 'block';
  } else {
    balEl.textContent = 'Not connected';
    balEl.style.display = 'block';
  }
}

function render() {
  if (!walletConnected) {
    renderConnectGate();
    return;
  }
  if (currentTab === 'home') renderHome();
  else if (currentTab === 'tickets') renderTickets();
  else renderWinners();
}

function renderConnectGate() {
  document.getElementById('main').innerHTML = `
    <div class="connect-gate">
      <div style="font-size:48px">⚡</div>
      <h2>Connect Photonic Wallet</h2>
      <p>Connect your Photonic wallet to play RXD Pulse Lottery and see your RXD balance.</p>
      <button class="connect-btn" id="connectBtn">Connect Wallet</button>
    </div>
  `;
  document.getElementById('connectBtn').onclick = connectWallet;
}

function connectWallet() {
  // Placeholder for real Photonic connection.
  // In production this would open Photonic or request address.
  const address = prompt('Paste your Photonic / Radiant wallet address to connect:');
  if (!address || address.length < 10) {
    alert('Please enter a valid address.');
    return;
  }
  walletAddress = address.trim();
  walletConnected = true;
  // Simulate fetching balance (replace with real API call later)
  state.balance = 1284;
  updateBalance();
  loadState();
}

async function loadState() {
  try {
    const data = await api('/api/state');
    state = { ...state, ...data };
    if (walletConnected) updateBalance();
    render();
  } catch (e) {
    console.error(e);
    render();
  }
}

function renderHome() {
  const winnerShare = Math.floor((state.pot || 0) * 0.8);
  const devShare = Math.floor((state.pot || 0) * 0.1);
  const radiantShare = Math.floor((state.pot || 0) * 0.1);

  document.getElementById('main').innerHTML = `
    <div class="orb-container">
      <div class="orb">
        <div class="label">Total Pot</div>
        <div class="amount">${(state.pot || 0).toLocaleString()}</div>
        <div class="unit">RXD</div>
      </div>
    </div>
    <div class="pot-split">
      <div class="split-item">
        <div class="pct">80%</div>
        <div class="role">Winner</div>
        <div class="val">${winnerShare.toLocaleString()} RXD</div>
      </div>
      <div class="split-item">
        <div class="pct">10%</div>
        <div class="role">Dev</div>
        <div class="val">${devShare.toLocaleString()} RXD</div>
      </div>
      <div class="split-item">
        <div class="pct">10%</div>
        <div class="role">Radiant</div>
        <div class="val">${radiantShare.toLocaleString()} RXD</div>
      </div>
    </div>
    <div class="next-draw">
      <div class="label">Next Draw</div>
      <div class="time">Friday</div>
      <div class="countdown">⏱ ${formatCountdown(state.nextDraw)}</div>
    </div>
    <div class="buy-section">
      <div class="label">Buy Tickets</div>
      <div class="buy-row">
        <div class="qty-control">
          <button id="minus">−</button>
          <span id="qty">1</span>
          <button id="plus">+</button>
        </div>
        <button class="buy-btn" id="buyBtn">Buy Tickets • 5 RXD</button>
      </div>
    </div>
  `;

  let qty = 1;
  const qtyEl = document.getElementById('qty');
  const buyBtn = document.getElementById('buyBtn');

  document.getElementById('minus').onclick = () => { if (qty > 1) { qty--; qtyEl.textContent = qty; updateBtn(); } };
  document.getElementById('plus').onclick = () => { if (qty < 50) { qty++; qtyEl.textContent = qty; updateBtn(); } };

  function updateBtn() {
    const cost = qty * 5;
    buyBtn.textContent = qty === 1 ? 'Buy Tickets • 5 RXD' : `Buy ${qty} Tickets • ${cost} RXD`;
  }

  buyBtn.onclick = async () => {
    if (!walletConnected) return;
    buyBtn.disabled = true;
    buyBtn.textContent = 'Buying...';
    const result = await api('/api/buy', { method: 'POST', body: JSON.stringify({ qty }) });
    if (result.success) {
      tg?.HapticFeedback?.notificationOccurred('success');
      await loadState();
    } else {
      alert(result.error || 'Failed to buy');
      buyBtn.disabled = false;
      updateBtn();
    }
  };
}

function renderTickets() {
  if (!state.myTickets || state.myTickets.length === 0) {
    document.getElementById('main').innerHTML = `<div class="empty"><div style="font-size:48px">🎟</div><div>No tickets yet</div></div>`;
    return;
  }
  const html = state.myTickets.map(n => `<div class="card"><div class="ticket-num">${n}</div></div>`).join('');
  document.getElementById('main').innerHTML = `<h2 style="margin:8px 0">My Tickets (${state.myTickets.length})</h2><div class="list">${html}</div>`;
}

function renderWinners() {
  if (!state.winners || state.winners.length === 0) {
    document.getElementById('main').innerHTML = `<div class="empty"><div style="font-size:48px">🏆</div><div>No winners yet</div></div>`;
    return;
  }
  const html = state.winners.map(w => `
    <div class="card">
      <div>
        <div class="username">@${w.username}</div>
        <div style="font-size:12px;color:#8a9bb0">Ticket ${w.ticket}</div>
      </div>
      <div class="amount">${w.amount.toLocaleString()} RXD</div>
    </div>
  `).join('');
  document.getElementById('main').innerHTML = `<h2 style="margin:8px 0">Winners</h2><div class="list">${html}</div>`;
}

function formatCountdown(iso) {
  if (!iso) return '--';
  const diff = new Date(iso) - new Date();
  if (diff <= 0) return 'Drawing soon';
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  return `${d}d ${h}h ${m}m`;
}

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.onclick = () => {
    if (!walletConnected) return;
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentTab = btn.dataset.tab;
    render();
  };
});

updateBalance();
loadState();
setInterval(loadState, 15000);
