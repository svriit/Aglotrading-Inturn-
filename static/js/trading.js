/* ═══════════════════════════════════════════════════════════════════════════
   Aglo Trading - Crypto Dashboard Engine (CoinMarketCap)
   Handles CMC data loading, chart rendering, coin details, and watchlist.
   ═══════════════════════════════════════════════════════════════════════════ */

// ─── State ────────────────────────────────────────────────────────────────────
let chart = null;
let allCoins = [];
let selectedCoin = null;        // Currently selected coin object
let activeFilter = 'all';
let searchQuery = '';
let watchlist = [];             // Array of coin IDs
let pollTimer = null;
let isDemo = true;

// ─── Initialize ───────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    chart = new TradingChart('priceChart');

    // Load watchlist from localStorage
    try {
        watchlist = JSON.parse(localStorage.getItem('aglo_watchlist')) || [];
    } catch (e) { watchlist = []; }

    // Load all data
    loadCryptoListings();
    loadGlobalMetrics();
    loadCryptoTicker();
    setupSearch();

    // Auto-refresh every 60 seconds
    setInterval(() => {
        loadCryptoListings();
        loadCryptoTicker();
    }, 60000);

    // Refresh global metrics every 2 minutes
    setInterval(loadGlobalMetrics, 120000);
});

// ─── Data Loading ─────────────────────────────────────────────────────────────

function loadCryptoListings() {
    fetch('/api/crypto/listings?limit=50')
        .then(r => r.json())
        .then(data => {
            if (!data.success) throw new Error(data.error || 'Failed');
            allCoins = data.data;
            isDemo = data.demo;

            updateConnectionStatus(true);
            document.getElementById('dataBadge').textContent = isDemo ? 'DEMO' : 'LIVE';
            document.getElementById('dataBadge').className = 'data-badge ' + (isDemo ? '' : 'live');

            renderCoinList();
            renderMarketTable();

            // Auto-select first coin if none selected
            if (!selectedCoin && allCoins.length > 0) {
                selectCoin(allCoins[0]);
            } else if (selectedCoin) {
                // Update selected coin data
                const updated = allCoins.find(c => c.id === selectedCoin.id);
                if (updated) {
                    selectedCoin = updated;
                    updateDetailPanel(updated);
                    updatePriceDisplay(updated);
                }
            }

            document.getElementById('marketLoading').style.display = 'none';
        })
        .catch(err => {
            console.error('Failed to load listings:', err);
            updateConnectionStatus(false);
        });
}

function loadGlobalMetrics() {
    fetch('/api/crypto/global')
        .then(r => r.json())
        .then(data => {
            if (!data.success) return;
            const g = data.data;
            document.getElementById('globalMcap').textContent = formatCompact(g.total_market_cap);
            document.getElementById('globalVol').textContent = formatCompact(g.total_volume_24h);
            document.getElementById('globalBtcDom').textContent = g.btc_dominance + '%';
        })
        .catch(() => {});
}

function loadChartData(coinId) {
    fetch(`/api/crypto/chart/${coinId}`)
        .then(r => r.json())
        .then(data => {
            if (!data.success) return;
            chart.clearData();
            chart.setType('line');
            data.data.forEach(pt => {
                chart.addTick(pt.price, pt.epoch);
            });
            document.getElementById('chartOverlay').classList.add('hidden');
        })
        .catch(err => {
            console.error('Chart load error:', err);
        });
}

function loadCryptoTicker() {
    fetch('/api/crypto/listings?limit=15')
        .then(r => r.json())
        .then(data => {
            if (!data.success || !data.data) return;
            renderCryptoTicker(data.data);
        })
        .catch(() => {
            const scroll = document.getElementById('tickerScroll');
            if (scroll) scroll.innerHTML = '<span class="ticker-loading">Crypto data unavailable</span>';
        });
}

// ─── Coin Selection ───────────────────────────────────────────────────────────

function selectCoin(coin) {
    selectedCoin = coin;

    // Update sidebar active state
    document.querySelectorAll('.market-item').forEach(el => el.classList.remove('active'));
    const activeEl = document.querySelector(`.market-item[data-id="${coin.id}"]`);
    if (activeEl) activeEl.classList.add('active');

    // Update chart header
    document.getElementById('chartSymbolName').textContent = `${coin.name} (${coin.symbol})`;
    updatePriceDisplay(coin);

    // Load chart
    loadChartData(coin.id);

    // Update detail panel
    updateDetailPanel(coin);

    // Update watchlist button
    updateWatchlistButton();
}

// ─── Render Sidebar Coin List ─────────────────────────────────────────────────

function renderCoinList() {
    const container = document.getElementById('coinList');
    const query = searchQuery.toLowerCase().trim();
    let coins = [...allCoins];

    // Apply filter
    if (activeFilter === 'top10') {
        coins = coins.filter(c => c.rank <= 10);
    } else if (activeFilter === 'gainers') {
        coins = coins.filter(c => c.change_24h > 0).sort((a, b) => b.change_24h - a.change_24h);
    } else if (activeFilter === 'losers') {
        coins = coins.filter(c => c.change_24h < 0).sort((a, b) => a.change_24h - b.change_24h);
    }

    // Apply search
    if (query) {
        coins = coins.filter(c =>
            c.name.toLowerCase().includes(query) ||
            c.symbol.toLowerCase().includes(query)
        );
    }

    // Update count
    const countEl = document.getElementById('searchResultsCount');
    if (countEl) {
        countEl.textContent = query ? `${coins.length} result${coins.length !== 1 ? 's' : ''}` : '';
    }

    // Show/hide no results
    document.getElementById('noResults').style.display = coins.length === 0 ? 'block' : 'none';

    // Build HTML
    container.innerHTML = coins.map(c => {
        const dir = c.change_24h >= 0 ? 'price-up' : 'price-down';
        const sign = c.change_24h >= 0 ? '+' : '';
        const isActive = selectedCoin && selectedCoin.id === c.id ? ' active' : '';
        const nameHtml = query ? highlightMatch(c.name, query) : escapeHtml(c.name);

        return `<div class="market-item${isActive}" data-id="${c.id}" onclick="selectCoinById(${c.id})">
            <div class="coin-item-left">
                <span class="coin-item-rank">${c.rank}</span>
                <div class="coin-item-info">
                    <span class="market-name">${nameHtml}</span>
                    <span class="coin-item-symbol">${c.symbol}</span>
                </div>
            </div>
            <div class="coin-item-right">
                <span class="market-price">$${formatPrice(c.price)}</span>
                <span class="market-change ${dir}">${sign}${c.change_24h.toFixed(2)}%</span>
            </div>
        </div>`;
    }).join('');
}

function selectCoinById(id) {
    const coin = allCoins.find(c => c.id === id);
    if (coin) selectCoin(coin);
}

// ─── Detail Panel ─────────────────────────────────────────────────────────────

function updateDetailPanel(coin) {
    document.getElementById('detailCoinName').textContent = coin.name;
    document.getElementById('detailCoinSymbol').textContent = coin.symbol;
    document.getElementById('detailCoinRank').textContent = '#' + coin.rank;
    document.getElementById('detailCoinPrice').textContent = '$' + formatPrice(coin.price);

    const change = coin.change_24h;
    const changeEl = document.getElementById('detailCoinChange');
    changeEl.textContent = (change >= 0 ? '+' : '') + change.toFixed(2) + '%';
    changeEl.className = 'coin-change-badge ' + (change >= 0 ? 'up' : 'down');

    // Change cards
    setChangeEl('detailChange1h', coin.change_1h);
    setChangeEl('detailChange24h', coin.change_24h);
    setChangeEl('detailChange7d', coin.change_7d);

    // Market stats
    document.getElementById('detailMarketCap').textContent = '$' + formatCompact(coin.market_cap);
    document.getElementById('detailVolume').textContent = '$' + formatCompact(coin.volume_24h);
    document.getElementById('detailCircSupply').textContent = coin.circulating_supply
        ? formatCompact(coin.circulating_supply) + ' ' + coin.symbol
        : '--';
    document.getElementById('detailMaxSupply').textContent = coin.max_supply
        ? formatCompact(coin.max_supply) + ' ' + coin.symbol
        : 'Unlimited';

    const volMcap = coin.market_cap ? ((coin.volume_24h / coin.market_cap) * 100).toFixed(2) + '%' : '--';
    document.getElementById('detailVolMcap').textContent = volMcap;
}

function setChangeEl(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    const v = value || 0;
    el.textContent = (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
    el.className = 'stat-card-value ' + (v >= 0 ? 'up' : 'down');
}

function updatePriceDisplay(coin) {
    const priceEl = document.getElementById('chartCurrentPrice');
    priceEl.textContent = '$' + formatPrice(coin.price);

    const changeEl = document.getElementById('chartPriceChange');
    const c = coin.change_24h;
    changeEl.textContent = (c >= 0 ? '+' : '') + c.toFixed(2) + '%';
    changeEl.className = 'chart-change ' + (c >= 0 ? 'up' : 'down');
    priceEl.style.color = c >= 0 ? '#3fb950' : '#f85149';
}

// ─── Market Table ─────────────────────────────────────────────────────────────

function renderMarketTable() {
    const tbody = document.getElementById('marketTableBody');
    if (!allCoins.length) {
        tbody.innerHTML = '<tr class="empty-row"><td colspan="8">Loading market data...</td></tr>';
        return;
    }

    tbody.innerHTML = allCoins.map(c => {
        const fmt = (v) => {
            const cls = v >= 0 ? 'pl-positive' : 'pl-negative';
            const sign = v >= 0 ? '+' : '';
            return `<td class="${cls}">${sign}${v.toFixed(2)}%</td>`;
        };
        return `<tr onclick="selectCoinById(${c.id})" style="cursor:pointer">
            <td>${c.rank}</td>
            <td><strong>${c.symbol}</strong> <span style="color:var(--text-muted)">${c.name}</span></td>
            <td>$${formatPrice(c.price)}</td>
            ${fmt(c.change_1h)}
            ${fmt(c.change_24h)}
            ${fmt(c.change_7d)}
            <td>$${formatCompact(c.market_cap)}</td>
            <td>$${formatCompact(c.volume_24h)}</td>
        </tr>`;
    }).join('');
}

// ─── Watchlist ────────────────────────────────────────────────────────────────

function toggleWatchlist() {
    if (!selectedCoin) return;
    const id = selectedCoin.id;
    const idx = watchlist.indexOf(id);
    if (idx >= 0) {
        watchlist.splice(idx, 1);
        showNotification(`${selectedCoin.name} removed from watchlist`, 'info');
    } else {
        watchlist.push(id);
        showNotification(`${selectedCoin.name} added to watchlist`, 'success');
    }
    localStorage.setItem('aglo_watchlist', JSON.stringify(watchlist));
    updateWatchlistButton();
    renderWatchlistTable();
}

function updateWatchlistButton() {
    if (!selectedCoin) return;
    const inList = watchlist.includes(selectedCoin.id);
    const btn = document.getElementById('watchlistBtn');
    const icon = document.getElementById('watchlistBtnIcon');
    if (inList) {
        icon.innerHTML = '&#9733;';
        btn.innerHTML = '<span id="watchlistBtnIcon">&#9733;</span> Remove from Watchlist';
        btn.classList.add('in-watchlist');
    } else {
        icon.innerHTML = '&#9734;';
        btn.innerHTML = '<span id="watchlistBtnIcon">&#9734;</span> Add to Watchlist';
        btn.classList.remove('in-watchlist');
    }
}

function renderWatchlistTable() {
    const tbody = document.getElementById('watchlistTableBody');
    const coins = allCoins.filter(c => watchlist.includes(c.id));

    if (coins.length === 0) {
        tbody.innerHTML = '<tr class="empty-row"><td colspan="6">Add coins to your watchlist by clicking the star icon.</td></tr>';
        return;
    }

    tbody.innerHTML = coins.map(c => {
        const cls = c.change_24h >= 0 ? 'pl-positive' : 'pl-negative';
        const sign = c.change_24h >= 0 ? '+' : '';
        return `<tr onclick="selectCoinById(${c.id})" style="cursor:pointer">
            <td>${c.rank}</td>
            <td><strong>${c.symbol}</strong> ${c.name}</td>
            <td>$${formatPrice(c.price)}</td>
            <td class="${cls}">${sign}${c.change_24h.toFixed(2)}%</td>
            <td>$${formatCompact(c.market_cap)}</td>
            <td><button class="toolbar-btn" onclick="event.stopPropagation(); removeFromWatchlist(${c.id})">&#10005;</button></td>
        </tr>`;
    }).join('');
}

function removeFromWatchlist(id) {
    const idx = watchlist.indexOf(id);
    if (idx >= 0) watchlist.splice(idx, 1);
    localStorage.setItem('aglo_watchlist', JSON.stringify(watchlist));
    updateWatchlistButton();
    renderWatchlistTable();
}

// ─── Crypto Ticker ────────────────────────────────────────────────────────────

function renderCryptoTicker(coins) {
    const scroll = document.getElementById('tickerScroll');
    if (!scroll || !coins || !coins.length) return;

    const buildItems = (items) => items.map(c => {
        const dir = c.change_24h >= 0 ? 'up' : 'down';
        const sign = c.change_24h >= 0 ? '+' : '';
        const priceStr = formatPrice(c.price);
        return `<div class="ticker-item" onclick="selectCoinById(${c.id})" style="cursor:pointer">
            <span class="ticker-symbol">${c.symbol}</span>
            <span class="ticker-price">$${priceStr}</span>
            <span class="ticker-change ${dir}">${sign}${c.change_24h.toFixed(2)}%</span>
        </div>`;
    }).join('');

    // Duplicate for seamless infinite scroll
    scroll.innerHTML = buildItems(coins) + buildItems(coins);
}

// ─── Search & Filter ──────────────────────────────────────────────────────────

function setupSearch() {
    const searchInput = document.getElementById('marketSearch');
    let searchTimeout = null;

    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                searchQuery = e.target.value;
                renderCoinList();
            }, 150);
        });

        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                searchInput.value = '';
                searchQuery = '';
                renderCoinList();
                searchInput.blur();
            }
        });
    }
}

function filterCoins(filter, btn) {
    document.querySelectorAll('.cat-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeFilter = filter;
    renderCoinList();
}

// ─── Chart Controls ───────────────────────────────────────────────────────────

function changeChartType(type, btn) {
    document.querySelectorAll('.ct-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    chart.setType(type);
}

function toggleInd(name, btn) {
    const active = btn.classList.toggle('active');
    chart.toggleIndicator(name, active);
}

function toggleOsc(name, btn) {
    const active = btn.classList.toggle('active');
    chart.toggleOscillator(name, active);
}

function startDrawing(mode) {
    chart.setDrawingMode(mode);
    showNotification(`Drawing mode: ${mode}. Click on the chart to place points.`, 'info');
}

// ─── UI Helpers ───────────────────────────────────────────────────────────────

function switchBottomTab(tab, btn) {
    document.querySelectorAll('.bottom-tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(tab + 'Panel').classList.add('active');

    if (tab === 'watchlist') renderWatchlistTable();
}

function updateConnectionStatus(connected) {
    const dot = document.getElementById('statusDot');
    const text = document.getElementById('statusText');
    if (connected) {
        dot.className = 'status-dot connected';
        text.textContent = 'Connected';
    } else {
        dot.className = 'status-dot disconnected';
        text.textContent = 'Disconnected';
    }
}

function showNotification(message, type) {
    const container = document.getElementById('tradeNotifications');
    const notif = document.createElement('div');
    notif.className = `trade-notification ${type}`;
    notif.textContent = message;
    container.prepend(notif);

    setTimeout(() => {
        notif.style.opacity = '0';
        notif.style.transform = 'translateY(-8px)';
        setTimeout(() => notif.remove(), 300);
    }, 4000);

    while (container.children.length > 3) {
        container.removeChild(container.lastChild);
    }
}

// ─── Formatting Utilities ─────────────────────────────────────────────────────

function formatPrice(price) {
    if (price == null) return '--';
    if (price >= 1000) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (price >= 1) return price.toFixed(4);
    if (price >= 0.001) return price.toFixed(6);
    return price.toPrecision(4);
}

function formatCompact(num) {
    if (num == null || num === 0) return '--';
    if (num >= 1e12) return (num / 1e12).toFixed(2) + 'T';
    if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
    if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
    if (num >= 1e3) return (num / 1e3).toFixed(1) + 'K';
    return num.toLocaleString('en-US');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function highlightMatch(text, query) {
    const lower = text.toLowerCase();
    const idx = lower.indexOf(query.toLowerCase());
    if (idx < 0) return escapeHtml(text);
    const before = text.substring(0, idx);
    const match = text.substring(idx, idx + query.length);
    const after = text.substring(idx + query.length);
    return `${escapeHtml(before)}<span class="highlight">${escapeHtml(match)}</span>${escapeHtml(after)}`;
}
