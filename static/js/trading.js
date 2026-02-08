/* ═══════════════════════════════════════════════════════════════════════════
   Aglo Trading - Trading Engine
   Handles Deriv WebSocket connection, market data, and trade execution.
   ═══════════════════════════════════════════════════════════════════════════ */

// ─── State ────────────────────────────────────────────────────────────────────
let derivWs = null;
let chart = null;
let isAuthorized = false;
let currentSymbol = 'R_10';
let currentSymbolName = 'Volatility 10 Index';
let currentGranularity = 0; // 0 = ticks
let currentTradeType = 'rise_fall';
let tickSubscriptionId = null;
let proposalSubscriptions = {};
let openContracts = {};
let recentTradesList = [];
let reqIdCounter = 0;
let pendingRequests = {};
let lastPrice = null;
let previousPrice = null;
let allSymbols = [];       // Full list of symbols from API
let activeCategory = 'all';
let searchQuery = '';
let symbolPrices = {};     // Track last prices for price flash

const APP_ID = '1089'; // Deriv demo app ID

// ─── Initialize ───────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    chart = new TradingChart('priceChart');

    // Check for saved API token
    const savedToken = localStorage.getItem('deriv_token');
    if (savedToken) {
        document.getElementById('apiTokenInput').value = savedToken;
    }

    // Fetch app config (app_id) from server
    fetch('/api/config')
        .then(r => r.json())
        .then(config => {
            if (config.app_id) {
                // Update the APP_ID if server provides one
                window._DERIV_APP_ID = config.app_id;
            }
        })
        .catch(() => {});

    connectDeriv();
});

// ─── Auto-login via OAuth token (after OAuth redirect) ────────────────────────
function checkOAuthLogin() {
    const oauthToken = sessionStorage.getItem('deriv_oauth_token');
    if (oauthToken && !isAuthorized) {
        // Auto-authorize with the OAuth token
        derivWs.send(JSON.stringify({ authorize: oauthToken }));
        // Clear so we don't re-auth on reconnect loops
        sessionStorage.removeItem('deriv_oauth_token');
    }
}

// ─── Deriv WebSocket Connection ───────────────────────────────────────────────
function connectDeriv() {
    const wsUrl = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;

    derivWs = new WebSocket(wsUrl);

    derivWs.onopen = () => {
        updateConnectionStatus(true);
        // Load available markets from Deriv API
        loadActiveSymbols();
        // Subscribe to default symbol ticks
        subscribeTicks(currentSymbol);
        // Load historical data
        loadHistory(currentSymbol, currentGranularity);
        // Check if user just logged in via OAuth
        checkOAuthLogin();
    };

    derivWs.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleDerivMessage(data);
    };

    derivWs.onerror = (error) => {
        console.error('WebSocket error:', error);
        updateConnectionStatus(false);
    };

    derivWs.onclose = () => {
        updateConnectionStatus(false);
        // Reconnect after 3 seconds
        setTimeout(connectDeriv, 3000);
    };
}

function sendRequest(payload) {
    reqIdCounter++;
    payload.req_id = reqIdCounter;

    return new Promise((resolve, reject) => {
        pendingRequests[reqIdCounter] = { resolve, reject };
        derivWs.send(JSON.stringify(payload));

        // Timeout after 15s
        setTimeout(() => {
            if (pendingRequests[payload.req_id]) {
                delete pendingRequests[payload.req_id];
                reject(new Error('Request timed out'));
            }
        }, 15000);
    });
}

// ─── Message Handler ──────────────────────────────────────────────────────────
function handleDerivMessage(data) {
    const msgType = data.msg_type;

    // Resolve pending request
    if (data.req_id && pendingRequests[data.req_id]) {
        pendingRequests[data.req_id].resolve(data);
        delete pendingRequests[data.req_id];
    }

    switch (msgType) {
        case 'authorize':
            handleAuthorize(data);
            break;
        case 'tick':
            handleTick(data);
            break;
        case 'history':
            handleHistory(data);
            break;
        case 'ohlc':
            handleOHLC(data);
            break;
        case 'candles':
            handleCandles(data);
            break;
        case 'proposal':
            handleProposal(data);
            break;
        case 'buy':
            handleBuy(data);
            break;
        case 'proposal_open_contract':
            handleContractUpdate(data);
            break;
        case 'balance':
            handleBalance(data);
            break;
        case 'portfolio':
            handlePortfolio(data);
            break;
        case 'statement':
            handleStatement(data);
            break;
        case 'active_symbols':
            handleActiveSymbols(data);
            break;
    }

    // Handle errors
    if (data.error) {
        console.error('Deriv API Error:', data.error.message);
        if (data.error.code === 'AuthorizationRequired') {
            showNotification('Please connect your account to trade', 'error');
        }
    }
}

// ─── Authorization ────────────────────────────────────────────────────────────
function showAuthModal() {
    document.getElementById('authModal').classList.add('active');
    document.getElementById('authError').style.display = 'none';
}

function hideAuthModal() {
    document.getElementById('authModal').classList.remove('active');
}

function connectAccount() {
    const token = document.getElementById('apiTokenInput').value.trim();
    if (!token) {
        showAuthError('Please enter your API token');
        return;
    }

    const connectBtn = document.getElementById('connectBtn');
    connectBtn.textContent = 'Connecting...';
    connectBtn.disabled = true;

    // Save token if checkbox checked
    if (document.getElementById('rememberToken').checked) {
        localStorage.setItem('deriv_token', token);
    }

    derivWs.send(JSON.stringify({ authorize: token }));
}

function handleAuthorize(data) {
    const connectBtn = document.getElementById('connectBtn');
    connectBtn.textContent = 'Connect';
    connectBtn.disabled = false;

    if (data.error) {
        isAuthorized = false;
        showAuthError(data.error.message);
        return;
    }

    isAuthorized = true;
    const auth = data.authorize;

    // Update UI
    document.getElementById('accountName').textContent = auth.fullname || auth.loginid;
    document.getElementById('accountBalance').textContent =
        `${parseFloat(auth.balance).toFixed(2)} ${auth.currency}`;

    const typeEl = document.getElementById('accountType');
    const isDemo = auth.loginid.includes('VRTC');
    typeEl.textContent = isDemo ? 'DEMO' : 'REAL';
    typeEl.className = 'account-type ' + (isDemo ? 'demo' : 'real');

    document.getElementById('accountInfo').style.display = 'flex';
    document.getElementById('authBtn').textContent = 'Connected';
    document.getElementById('authBtn').classList.add('connected');

    hideAuthModal();

    // Subscribe to balance updates
    derivWs.send(JSON.stringify({ balance: 1, subscribe: 1 }));

    // Get portfolio and statement
    derivWs.send(JSON.stringify({ portfolio: 1 }));
    derivWs.send(JSON.stringify({ statement: 1, description: 1, limit: 20 }));

    // Request price proposals
    requestProposal('CALL');
    requestProposal('PUT');

    showNotification('Account connected successfully!', 'success');
}

function showAuthError(msg) {
    const el = document.getElementById('authError');
    el.textContent = msg;
    el.style.display = 'block';
}

// ─── Market Data ──────────────────────────────────────────────────────────────
function subscribeTicks(symbol) {
    // Forget previous subscriptions
    if (tickSubscriptionId) {
        derivWs.send(JSON.stringify({ forget: tickSubscriptionId }));
    }
    derivWs.send(JSON.stringify({ forget_all: 'ticks' }));

    // Subscribe to new symbol ticks
    derivWs.send(JSON.stringify({
        ticks: symbol,
        subscribe: 1
    }));
}

function loadHistory(symbol, granularity) {
    chart.clearData();

    if (granularity === 0) {
        // Load tick history
        derivWs.send(JSON.stringify({
            ticks_history: symbol,
            count: 200,
            end: 'latest',
            style: 'ticks'
        }));
    } else {
        // Load candle history
        derivWs.send(JSON.stringify({
            ticks_history: symbol,
            count: 200,
            end: 'latest',
            style: 'candles',
            granularity: granularity,
            subscribe: 1
        }));
    }
}

function handleTick(data) {
    const tick = data.tick;
    if (!tick) return;

    tickSubscriptionId = data.subscription?.id;

    const price = parseFloat(tick.quote);
    const symbol = tick.symbol;

    // Update chart
    if (symbol === currentSymbol && currentGranularity === 0) {
        chart.addTick(price, tick.epoch);
    }

    // Update price display
    previousPrice = lastPrice;
    lastPrice = price;

    if (symbol === currentSymbol) {
        updatePriceDisplay(price);
    }

    // Update sidebar price with color flash
    const priceEl = document.getElementById(`price_${symbol}`);
    if (priceEl) {
        const prevPrice = symbolPrices[symbol];
        priceEl.textContent = formatPrice(price);
        if (prevPrice !== undefined) {
            priceEl.className = 'market-price ' + (price > prevPrice ? 'price-up' : price < prevPrice ? 'price-down' : '');
        }
        symbolPrices[symbol] = price;
    }

    // Hide chart overlay
    const overlay = document.getElementById('chartOverlay');
    if (overlay) overlay.classList.add('hidden');
}

function handleHistory(data) {
    const history = data.history;
    if (!history) return;

    const prices = history.prices;
    const times = history.times;

    chart.clearData();
    for (let i = 0; i < prices.length; i++) {
        chart.addTick(parseFloat(prices[i]), times[i]);
    }

    document.getElementById('chartOverlay').classList.add('hidden');
}

function handleOHLC(data) {
    const ohlc = data.ohlc;
    if (!ohlc) return;

    chart.addCandle({
        open: ohlc.open,
        high: ohlc.high,
        low: ohlc.low,
        close: ohlc.close,
        epoch: ohlc.open_time
    });

    // Update price display with close
    updatePriceDisplay(parseFloat(ohlc.close));

    document.getElementById('chartOverlay').classList.add('hidden');
}

function handleCandles(data) {
    const candles = data.candles;
    if (!candles) return;

    chart.setCandles(candles);
    chart.setType('candle');

    if (candles.length > 0) {
        const lastCandle = candles[candles.length - 1];
        updatePriceDisplay(parseFloat(lastCandle.close));
    }

    document.getElementById('chartOverlay').classList.add('hidden');
}

function handleActiveSymbols(data) {
    if (data.error || !data.active_symbols) {
        console.error('Failed to load symbols:', data.error?.message);
        return;
    }

    const symbols = data.active_symbols;
    allSymbols = [];

    symbols.forEach(s => {
        // Categorize: currency (forex), commodity, or composite (synthetic indices)
        const market = (s.market || '').toLowerCase();
        const submarket = (s.submarket || '').toLowerCase();
        let category = 'composite'; // default

        if (market === 'forex' || market === 'cryptocurrency') {
            category = 'currency';
        } else if (market === 'commodities' || market === 'commodity') {
            category = 'commodity';
        } else if (market === 'synthetic_index' || market === 'indices' ||
                   market === 'stock_indices' || market === 'basket_index') {
            category = 'composite';
        } else if (submarket.includes('forex') || submarket.includes('currency') || submarket.includes('crypto')) {
            category = 'currency';
        } else if (submarket.includes('metal') || submarket.includes('energy') || submarket.includes('commodity')) {
            category = 'commodity';
        }

        allSymbols.push({
            symbol: s.symbol,
            displayName: s.display_name,
            market: s.market_display_name || s.market,
            submarket: s.submarket_display_name || s.submarket,
            category: category,
            isTradingSuspended: s.is_trading_suspended,
        });
    });

    // Sort alphabetically within each category
    allSymbols.sort((a, b) => a.displayName.localeCompare(b.displayName));

    // Populate the sidebar
    populateMarketSidebar();
}

// ─── Trading ──────────────────────────────────────────────────────────────────
function requestProposal(contractType) {
    const duration = parseInt(document.getElementById('durationValue').value);
    const durationUnit = document.getElementById('durationUnit').value;
    const amount = parseFloat(document.getElementById('stakeAmount').value);

    // Forget existing proposal subscription
    if (proposalSubscriptions[contractType]) {
        derivWs.send(JSON.stringify({ forget: proposalSubscriptions[contractType] }));
    }

    derivWs.send(JSON.stringify({
        proposal: 1,
        amount: amount.toString(),
        basis: 'stake',
        contract_type: contractType,
        currency: 'USD',
        duration: duration,
        duration_unit: durationUnit,
        symbol: currentSymbol,
        subscribe: 1
    }));
}

function handleProposal(data) {
    if (data.error) {
        console.warn('Proposal error:', data.error.message);
        return;
    }

    const proposal = data.proposal;
    if (!proposal) return;

    proposalSubscriptions[proposal.contract_type] = data.subscription?.id;

    const payout = parseFloat(proposal.payout);
    const askPrice = parseFloat(proposal.ask_price);
    const profit = payout - askPrice;

    if (proposal.contract_type === 'CALL') {
        document.getElementById('risePayout').textContent = `$${payout.toFixed(2)}`;
    } else if (proposal.contract_type === 'PUT') {
        document.getElementById('fallPayout').textContent = `$${payout.toFixed(2)}`;
    }

    document.getElementById('potentialPayout').textContent = `$${payout.toFixed(2)}`;
    document.getElementById('potentialProfit').textContent = `+$${profit.toFixed(2)}`;
}

function placeTrade(contractType) {
    if (!isAuthorized) {
        showAuthModal();
        showNotification('Please connect your account first', 'info');
        return;
    }

    const duration = parseInt(document.getElementById('durationValue').value);
    const durationUnit = document.getElementById('durationUnit').value;
    const amount = parseFloat(document.getElementById('stakeAmount').value);

    // Disable buttons during trade
    document.getElementById('btnRise').disabled = true;
    document.getElementById('btnFall').disabled = true;

    showNotification(`Placing ${contractType === 'CALL' ? 'Rise' : 'Fall'} trade...`, 'info');

    // Get proposal first, then buy
    sendRequest({
        proposal: 1,
        amount: amount.toString(),
        basis: 'stake',
        contract_type: contractType,
        currency: 'USD',
        duration: duration,
        duration_unit: durationUnit,
        symbol: currentSymbol,
    }).then(proposalData => {
        if (proposalData.error) {
            throw new Error(proposalData.error.message);
        }

        const proposalId = proposalData.proposal.id;

        return sendRequest({
            buy: proposalId,
            price: amount,
        });
    }).then(buyData => {
        if (buyData.error) {
            throw new Error(buyData.error.message);
        }
        handleBuy(buyData);
    }).catch(err => {
        showNotification(`Trade failed: ${err.message}`, 'error');
    }).finally(() => {
        document.getElementById('btnRise').disabled = false;
        document.getElementById('btnFall').disabled = false;
    });
}

function handleBuy(data) {
    if (data.error) {
        showNotification(`Trade failed: ${data.error.message}`, 'error');
        return;
    }

    const buy = data.buy;
    if (!buy) return;

    const contractId = buy.contract_id;

    showNotification(`Trade placed! Contract #${contractId}`, 'success');

    // Show trade result
    showTradeResult({
        contractId: contractId,
        buyPrice: buy.buy_price,
        payout: buy.payout,
        longcode: buy.longcode,
    });

    // Add to recent trades
    addRecentTrade({
        contractId: contractId,
        type: buy.longcode?.includes('higher') || buy.longcode?.includes('rise') ? 'CALL' : 'PUT',
        amount: buy.buy_price,
        payout: buy.payout,
    });

    // Subscribe to contract updates
    derivWs.send(JSON.stringify({
        proposal_open_contract: 1,
        contract_id: contractId,
        subscribe: 1,
    }));

    // Refresh portfolio
    derivWs.send(JSON.stringify({ portfolio: 1 }));
    // Refresh balance
    derivWs.send(JSON.stringify({ balance: 1 }));
}

function handleContractUpdate(data) {
    const poc = data.proposal_open_contract;
    if (!poc) return;

    const contractId = poc.contract_id;
    openContracts[contractId] = poc;

    // Update positions table
    updatePositionsTable();

    // If contract is sold/expired, show result and refresh
    if (poc.is_sold || poc.is_expired) {
        const profit = parseFloat(poc.profit);
        const type = profit >= 0 ? 'success' : 'error';
        const prefix = profit >= 0 ? 'Won' : 'Lost';
        showNotification(`${prefix}: $${Math.abs(profit).toFixed(2)} on contract #${contractId}`, type);

        // Forget subscription
        if (data.subscription?.id) {
            derivWs.send(JSON.stringify({ forget: data.subscription.id }));
        }

        delete openContracts[contractId];
        updatePositionsTable();

        // Refresh
        derivWs.send(JSON.stringify({ balance: 1 }));
        derivWs.send(JSON.stringify({ statement: 1, description: 1, limit: 20 }));
    }
}

function handleBalance(data) {
    if (data.balance) {
        const balance = data.balance;
        const amount = typeof balance === 'object' ? balance.balance : balance;
        const currency = typeof balance === 'object' ? balance.currency : 'USD';
        document.getElementById('accountBalance').textContent =
            `${parseFloat(amount).toFixed(2)} ${currency}`;
    }
}

function handlePortfolio(data) {
    const contracts = data.portfolio?.contracts || [];
    openContracts = {};
    contracts.forEach(c => {
        openContracts[c.contract_id] = c;
    });
    updatePositionsTable();
}

function handleStatement(data) {
    const transactions = data.statement?.transactions || [];
    updateHistoryTable(transactions);
}

// ─── UI Updates ───────────────────────────────────────────────────────────────
function updateConnectionStatus(connected) {
    const dot = document.querySelector('.status-dot');
    const text = document.querySelector('.status-text');

    if (connected) {
        dot.className = 'status-dot connected';
        text.textContent = 'Connected';
    } else {
        dot.className = 'status-dot disconnected';
        text.textContent = 'Disconnected';
    }
}

function updatePriceDisplay(price) {
    const priceEl = document.getElementById('chartCurrentPrice');
    priceEl.textContent = formatPrice(price);

    const changeEl = document.getElementById('chartPriceChange');
    if (previousPrice !== null) {
        const diff = price - previousPrice;
        const pct = ((diff / previousPrice) * 100).toFixed(3);
        if (diff >= 0) {
            changeEl.textContent = `+${pct}%`;
            changeEl.className = 'chart-change up';
            priceEl.style.color = '#22c55e';
        } else {
            changeEl.textContent = `${pct}%`;
            changeEl.className = 'chart-change down';
            priceEl.style.color = '#ef4444';
        }
    }
}

function updatePositionsTable() {
    const tbody = document.getElementById('positionsBody');
    const contracts = Object.values(openContracts);

    if (contracts.length === 0) {
        tbody.innerHTML = '<tr class="empty-row"><td colspan="8">No open positions. Place a trade to get started.</td></tr>';
        return;
    }

    tbody.innerHTML = contracts.map(c => {
        const profit = parseFloat(c.profit || 0);
        const plClass = profit >= 0 ? 'pl-positive' : 'pl-negative';
        const plSign = profit >= 0 ? '+' : '';
        const type = c.contract_type || '--';
        const entry = c.entry_spot || c.buy_price || '--';
        const current = c.current_spot || '--';
        const stake = c.buy_price || '--';
        const payout = c.payout || '--';

        return `<tr>
            <td>#${c.contract_id || '--'}</td>
            <td>${type}</td>
            <td>${entry}</td>
            <td>${current}</td>
            <td>$${parseFloat(stake).toFixed(2)}</td>
            <td>$${parseFloat(payout).toFixed(2)}</td>
            <td class="${plClass}">${plSign}$${profit.toFixed(2)}</td>
            <td>${c.is_sold ? 'Closed' : 'Open'}</td>
        </tr>`;
    }).join('');
}

function updateHistoryTable(transactions) {
    const tbody = document.getElementById('historyBody');

    if (transactions.length === 0) {
        tbody.innerHTML = '<tr class="empty-row"><td colspan="6">No trade history yet.</td></tr>';
        return;
    }

    tbody.innerHTML = transactions.slice(0, 20).map(t => {
        const date = new Date(t.transaction_time * 1000).toLocaleString();
        const amount = parseFloat(t.amount || 0);
        const plClass = amount >= 0 ? 'pl-positive' : 'pl-negative';
        const plSign = amount >= 0 ? '+' : '';

        return `<tr>
            <td>${date}</td>
            <td>#${t.transaction_id || '--'}</td>
            <td>${t.action_type || '--'}</td>
            <td>$${Math.abs(amount).toFixed(2)}</td>
            <td>${t.payout ? '$' + parseFloat(t.payout).toFixed(2) : '--'}</td>
            <td class="${plClass}">${plSign}$${amount.toFixed(2)}</td>
        </tr>`;
    }).join('');
}

function addRecentTrade(trade) {
    recentTradesList.unshift(trade);
    if (recentTradesList.length > 10) recentTradesList.pop();

    const container = document.getElementById('recentTrades');
    container.innerHTML = recentTradesList.map(t => {
        const typeClass = t.type === 'CALL' ? 'call' : 'put';
        const typeLabel = t.type === 'CALL' ? 'RISE' : 'FALL';
        return `<div class="recent-trade-item">
            <span class="recent-trade-type ${typeClass}">${typeLabel}</span>
            <span>#${t.contractId}</span>
            <span class="recent-trade-amount">$${parseFloat(t.amount).toFixed(2)}</span>
        </div>`;
    }).join('');
}

function showTradeResult(trade) {
    document.getElementById('tradeResultTitle').textContent = 'Trade Placed Successfully';
    document.getElementById('tradeResultContent').innerHTML = `
        <div class="result-icon" style="color: var(--accent-green);">&#10003;</div>
        <div class="result-details">
            <p><strong>Contract ID:</strong> #${trade.contractId}</p>
            <p><strong>Buy Price:</strong> $${parseFloat(trade.buyPrice).toFixed(2)}</p>
            <p><strong>Potential Payout:</strong> $${parseFloat(trade.payout).toFixed(2)}</p>
            <p style="margin-top: 8px; font-size: 11px; color: var(--text-muted);">${trade.longcode || ''}</p>
        </div>
    `;
    document.getElementById('tradeResultModal').classList.add('active');
}

function hideTradeResult() {
    document.getElementById('tradeResultModal').classList.remove('active');
}

function showNotification(message, type) {
    const container = document.getElementById('tradeNotifications');
    const notif = document.createElement('div');
    notif.className = `trade-notification ${type}`;
    notif.textContent = message;
    container.prepend(notif);

    // Auto-remove after 5 seconds
    setTimeout(() => {
        notif.style.opacity = '0';
        notif.style.transform = 'translateY(-8px)';
        setTimeout(() => notif.remove(), 300);
    }, 5000);

    // Keep max 3 notifications
    while (container.children.length > 3) {
        container.removeChild(container.lastChild);
    }
}

// ─── Dynamic Market Sidebar ───────────────────────────────────────────────────

function loadActiveSymbols() {
    // Request active symbols from Deriv API
    derivWs.send(JSON.stringify({
        active_symbols: 'brief',
        product_type: 'basic'
    }));
}

function populateMarketSidebar() {
    const containers = {
        currency: document.getElementById('items_currency'),
        commodity: document.getElementById('items_commodity'),
        composite: document.getElementById('items_composite'),
    };

    // Clear containers
    Object.values(containers).forEach(c => { if (c) c.innerHTML = ''; });

    const counts = { currency: 0, commodity: 0, composite: 0 };

    allSymbols.forEach(s => {
        if (s.isTradingSuspended) return;

        const container = containers[s.category];
        if (!container) return;

        counts[s.category]++;

        const div = document.createElement('div');
        div.className = 'market-item';
        if (s.symbol === currentSymbol) div.classList.add('active');
        div.dataset.symbol = s.symbol;
        div.dataset.name = s.displayName;
        div.dataset.category = s.category;
        div.onclick = () => selectSymbol(s.symbol, s.displayName);

        div.innerHTML = `
            <span class="market-name" title="${s.displayName}">${s.displayName}</span>
            <span class="market-price" id="price_${s.symbol}">--</span>
        `;

        container.appendChild(div);
    });

    // Update counts
    Object.keys(counts).forEach(cat => {
        const countEl = document.getElementById('count_' + cat);
        if (countEl) countEl.textContent = counts[cat];
    });

    // Hide loading
    const loadingEl = document.getElementById('marketLoading');
    if (loadingEl) loadingEl.style.display = 'none';

    // Expand composite group by default (it has synthetics)
    const compositeItems = document.getElementById('items_composite');
    if (compositeItems) compositeItems.classList.remove('collapsed');

    // Apply current search/category filter
    applyFilters();
}

// ─── Interactive Search & Category Filtering ──────────────────────────────────

function filterByCategory(category, btn) {
    document.querySelectorAll('.cat-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeCategory = category;
    applyFilters();
}

function applyFilters() {
    const query = searchQuery.toLowerCase().trim();
    const groups = document.querySelectorAll('.market-group');
    let totalVisible = 0;

    groups.forEach(group => {
        const cat = group.dataset.category;
        // Hide entire group if category doesn't match
        if (activeCategory !== 'all' && cat !== activeCategory) {
            group.classList.add('hidden-category');
            return;
        }
        group.classList.remove('hidden-category');

        const items = group.querySelectorAll('.market-item');
        let groupVisible = 0;

        items.forEach(item => {
            const name = (item.dataset.name || '').toLowerCase();
            const symbol = (item.dataset.symbol || '').toLowerCase();
            const matches = !query || name.includes(query) || symbol.includes(query);

            if (matches) {
                item.classList.remove('hidden-item');
                groupVisible++;
                totalVisible++;

                // Highlight matching text
                const nameEl = item.querySelector('.market-name');
                const originalName = item.dataset.name;
                if (query && name.includes(query)) {
                    const idx = name.indexOf(query);
                    const before = originalName.substring(0, idx);
                    const match = originalName.substring(idx, idx + query.length);
                    const after = originalName.substring(idx + query.length);
                    nameEl.innerHTML = `${escapeHtml(before)}<span class="highlight">${escapeHtml(match)}</span>${escapeHtml(after)}`;
                } else {
                    nameEl.textContent = originalName;
                }
            } else {
                item.classList.add('hidden-item');
                // Reset highlight
                item.querySelector('.market-name').textContent = item.dataset.name;
            }
        });

        // If searching, auto-expand groups that have matches
        const itemsContainer = group.querySelector('.market-group-items');
        if (query && groupVisible > 0 && itemsContainer) {
            itemsContainer.classList.remove('collapsed');
        }
    });

    // Show/hide no results
    const noResults = document.getElementById('noResults');
    if (noResults) {
        noResults.style.display = (totalVisible === 0 && (query || activeCategory !== 'all')) ? 'block' : 'none';
    }

    // Update results count when searching
    const countEl = document.getElementById('searchResultsCount');
    if (countEl) {
        countEl.textContent = query ? `${totalVisible} result${totalVisible !== 1 ? 's' : ''} found` : '';
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Set up interactive search with debounce
document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('marketSearch');
    let searchTimeout = null;

    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value;
            // Debounce for smooth typing
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                searchQuery = query;
                applyFilters();
            }, 150);
        });

        // Clear search on Escape
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                searchInput.value = '';
                searchQuery = '';
                applyFilters();
                searchInput.blur();
            }
        });
    }
});

// ─── User Interactions ────────────────────────────────────────────────────────
function selectSymbol(symbol, name) {
    // Update active state
    document.querySelectorAll('.market-item').forEach(el => el.classList.remove('active'));
    const activeEl = document.querySelector(`.market-item[data-symbol="${symbol}"]`);
    if (activeEl) activeEl.classList.add('active');

    currentSymbol = symbol;
    currentSymbolName = name;

    document.getElementById('chartSymbolName').textContent = name;
    document.getElementById('chartCurrentPrice').textContent = '--';
    document.getElementById('chartPriceChange').textContent = '';

    lastPrice = null;
    previousPrice = null;

    // Resubscribe
    subscribeTicks(symbol);
    loadHistory(symbol, currentGranularity);

    // Refresh proposals if authorized
    if (isAuthorized) {
        forgetAllProposals();
        requestProposal('CALL');
        requestProposal('PUT');
    }
}

function toggleMarketGroup(header) {
    const items = header.nextElementSibling;
    items.classList.toggle('collapsed');
    const arrow = header.querySelector('.arrow');
    arrow.style.transform = items.classList.contains('collapsed') ? 'rotate(-90deg)' : '';
}

function changeTimeframe(btn, granularity) {
    document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    currentGranularity = granularity;

    if (granularity === 0) {
        chart.setType('line');
        document.querySelector('.ct-btn[data-type="line"]').classList.add('active');
        document.querySelector('.ct-btn[data-type="candle"]').classList.remove('active');
    } else {
        chart.setType('candle');
        document.querySelector('.ct-btn[data-type="candle"]').classList.add('active');
        document.querySelector('.ct-btn[data-type="line"]').classList.remove('active');
    }

    loadHistory(currentSymbol, granularity);
}

function changeChartType(type, btn) {
    document.querySelectorAll('.ct-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    chart.setType(type);

    if (type === 'candle' && currentGranularity === 0) {
        // Switch to 1m candles
        currentGranularity = 60;
        document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
        document.querySelector('.tf-btn[data-granularity="60"]').classList.add('active');
        loadHistory(currentSymbol, 60);
    }
}

function selectTradeType(type, btn) {
    document.querySelectorAll('.trade-type-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentTradeType = type;

    // Update button labels based on type
    if (type === 'rise_fall') {
        document.querySelector('.btn-rise .trade-label').textContent = 'Rise';
        document.querySelector('.btn-fall .trade-label').textContent = 'Fall';
    } else {
        document.querySelector('.btn-rise .trade-label').textContent = 'Higher';
        document.querySelector('.btn-fall .trade-label').textContent = 'Lower';
    }

    // Refresh proposals
    if (isAuthorized) {
        forgetAllProposals();
        requestProposal('CALL');
        requestProposal('PUT');
    }
}

function adjustStake(delta) {
    const input = document.getElementById('stakeAmount');
    let val = parseFloat(input.value) + delta;
    if (val < 0.35) val = 0.35;
    input.value = val.toFixed(2);
    onStakeChange();
}

function setStake(amount) {
    document.getElementById('stakeAmount').value = amount.toFixed(2);
    onStakeChange();
}

function onStakeChange() {
    if (isAuthorized) {
        forgetAllProposals();
        requestProposal('CALL');
        requestProposal('PUT');
    }
}

function forgetAllProposals() {
    derivWs.send(JSON.stringify({ forget_all: 'proposal' }));
    proposalSubscriptions = {};
}

// Listen for stake/duration changes
document.addEventListener('DOMContentLoaded', () => {
    const stakeInput = document.getElementById('stakeAmount');
    const durationInput = document.getElementById('durationValue');
    const durationSelect = document.getElementById('durationUnit');

    if (stakeInput) stakeInput.addEventListener('change', onStakeChange);
    if (durationInput) durationInput.addEventListener('change', onStakeChange);
    if (durationSelect) durationSelect.addEventListener('change', onStakeChange);
});

function switchBottomTab(tab, btn) {
    document.querySelectorAll('.bottom-tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));

    btn.classList.add('active');
    document.getElementById(tab + 'Panel').classList.add('active');
}

// ─── Utility ──────────────────────────────────────────────────────────────────
function formatPrice(price) {
    if (price >= 1000) return price.toFixed(2);
    if (price >= 1) return price.toFixed(4);
    return price.toFixed(6);
}
