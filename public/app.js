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
let entered = false;
let walletConnected = false;
let walletAddress = null;

// Simple sound effects
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playSound(type) {
  try {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    if (type === 'tab') {
      osc.frequency.value = 800;
      gain.gain.value = 0.08;
      osc.start();
      osc.stop(audioCtx.currentTime + 0.08);
    } else if (type === 'buy') {
      osc.frequency.value = 600;
      gain.gain.value = 0.1;
      osc.start();
      osc.frequency.exponentialRampToValueAtTime(1200, audioCtx.currentTime + 0.15);
      osc.stop(audioCtx.currentTime + 0.2);
    } else if (type === 'success') {
      osc.frequency.value = 880;
      gain.gain.value = 0.12;
      osc.start();
      osc.stop(audioCtx.currentTime + 0.12);
    }
  } catch (e) {}
}

function updateBalance() {
  const balEl = document.getElementById('balance');
  if (!balEl) return;
  const username = tg?.initDataUnsafe?.user?.username || tg?.initDataUnsafe?.user?.first_name || 'Player';
  balEl.textContent = `@${username}`;
  balEl.style.display = 'block';
}

function render() {
  if (!entered) {
    renderWelcome();
    return;
  }
  if (!walletConnected) {
    renderConnectWallet();
    return;
  }
  if (currentTab === 'home') renderHome();
  else if (currentTab === 'tickets') renderTickets();
  else renderWinners();
}

function renderWelcome() {
  document.getElementById('main').innerHTML = `
    <div class="connect-gate">
      <div style="font-size:42px">⚡</div>
      <h2 style="font-size:22px;margin:8px 0">RXD Pulse Lottery</h2>
      <p style="font-size:16px;font-weight:600;color:#ffd700;margin-bottom:12px">Play. Win. Pulse the Future.</p>
      <p style="font-size:14px;line-height:1.5;max-width:300px">
        Buy tickets with $RXD. Every Friday a winner is drawn.<br><br>
        🏆 80% of the pot goes to the winner<br>
        💻 10% funds RXD Pulse Miner<br>
        🚀 10% supports Radiant Blockchain Developments — projects & CEX listings
      </p>
      <button class="connect-btn" id="enterBtn" style="background:#ffd700;color:#000;margin-top:20px">ENTER</button>
    </div>
  `;
  document.getElementById('enterBtn').onclick = () => {
    playSound('tab');
    entered = true;
    loadState();
  };
}

function renderConnectWallet() {
  document.getElementById('main').innerHTML = `
    <div class="connect-gate">
      <div style="font-size:48px">⚡</div>
      <h2>Connect your Radiant Wallet</h2>
      <p>Connect once so we know which address to pay if you win. This is saved to your Telegram account.</p>
      <button class="connect-btn" id="connectBtn">Connect Wallet</button>
    </div>
  `;
  document.getElementById('connectBtn').onclick = connectWallet;
}

async function connectWallet() {
  const address = prompt('Paste your Radiant wallet address (starts with 1):');
  if (!address || !address.startsWith('1') || address.length < 26 || address.length > 35) {
    alert('Please enter a valid Radiant wallet address (starts with 1).');
    return;
  }
  walletAddress = address.trim();

  const result = await api('/api/connect-wallet', {
    method: 'POST',
    body: JSON.stringify({ address: walletAddress })
  });

  if (result.success) {
    walletConnected = true;
    loadState();
  } else {
    alert(result.error || 'Failed to connect wallet');
  }
}

async function loadState() {
  try {
    const data = await api('/api/state');
    state = { ...state, ...data };
    if (data.walletAddress) {
      walletConnected = true;
      walletAddress = data.walletAddress;
    }
    updateBalance();
    render();
  } catch (e) {
    console.error(e);
    render();
  }
}

let qty = 1;

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
          <input type="number" id="qty" value="${qty}" min="1" max="250" style="width:56px;text-align:center;background:transparent;border:none;color:#fff;font-weight:600;font-size:16px;" />
          <button id="plus">+</button>
        </div>
        <button class="buy-btn" id="buyBtn">Buy Tickets • 5 RXD</button>
      </div>
    </div>
  `;

  const qtyEl = document.getElementById('qty');
  const buyBtn = document.getElementById('buyBtn');

  document.getElementById('minus').onclick = () => {
    playSound('tab');
    if (qty > 1) { qty--; qtyEl.value = qty; updateBtn(); }
  };
  document.getElementById('plus').onclick = () => {
    playSound('tab');
    if (qty < 250) { qty++; qtyEl.value = qty; updateBtn(); }
  };
  qtyEl.oninput = () => {
    const raw = qtyEl.value;
    if (raw === '') {
      updateBtn();
      return;
    }
    let val = parseInt(raw);
    if (isNaN(val)) return;
    if (val > 250) val = 250;
    if (val < 1) val = 1;
    qty = val;
    updateBtn();
  };
  qtyEl.onblur = () => {
    let val = parseInt(qtyEl.value);
    if (isNaN(val) || val < 1) val = 1;
    if (val > 250) val = 250;
    qty = val;
    qtyEl.value = val;
    updateBtn();
  };

  function updateBtn() {
    const current = parseInt(document.getElementById('qty')?.value) || qty;
    const cost = current * 5;
    buyBtn.textContent = current === 1 ? 'Buy Tickets • 5 RXD' : `Buy ${current} Tickets • ${cost} RXD`;
  }

  buyBtn.onclick = async () => {
    const currentQty = parseInt(document.getElementById('qty')?.value) || qty;
    if (currentQty < 1 || currentQty > 250) {
      alert('Please enter a quantity between 1 and 250.');
      return;
    }
    qty = currentQty;

    buyBtn.disabled = true;
    buyBtn.textContent = 'Creating payment...';

    try {
      const create = await api('/api/create-payment', { method: 'POST', body: JSON.stringify({ qty }) });
      if (!create.success) {
        alert(create.error || 'Failed to create payment');
        buyBtn.disabled = false;
        updateBtn();
        return;
      }

      const txid = prompt(
        `Send exactly ${create.amount} RXD to:\n${create.treasury}\n\nThen paste the transaction ID (txid) here to confirm:`
      );

      if (!txid) {
        buyBtn.disabled = false;
        updateBtn();
        return;
      }

      buyBtn.textContent = 'Verifying...';
      const verify = await api('/api/verify-payment', {
        method: 'POST',
        body: JSON.stringify({ paymentId: create.paymentId, txid: txid.trim() })
      });

      if (verify.success) {
        playSound('success');
        tg?.HapticFeedback?.notificationOccurred('success');
        await loadState();
      } else {
        alert(verify.error || 'Verification failed');
        buyBtn.disabled = false;
        updateBtn();
      }
    } catch (err) {
      alert('Something went wrong. Please try again.');
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
    if (!entered || !walletConnected) return;
    playSound('tab');
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentTab = btn.dataset.tab;
    render();
  };
});

updateBalance();
loadState();
setInterval(loadState, 15000);
