import os
import json
import time
import math
import random
import hashlib
import requests as http_requests
from flask import Flask, render_template, request, jsonify
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
app.secret_key = os.getenv("SECRET_KEY", "dev-secret-key-change-in-production")

# ─── CoinMarketCap Config ─────────────────────────────────────────────────────

CMC_API_KEY = os.getenv("CMC_API_KEY", "")
CMC_BASE_URL = "https://pro-api.coinmarketcap.com"

# In-memory cache: { cache_key: { "data": ..., "ts": epoch } }
_cache = {}


def cmc_fetch(endpoint, params=None, cache_ttl=120):
    """
    Fetch from CoinMarketCap API with caching.
    Returns parsed JSON or None on failure.
    """
    cache_key = f"{endpoint}:{json.dumps(params or {}, sort_keys=True)}"
    now = time.time()
    if cache_key in _cache and (now - _cache[cache_key]["ts"]) < cache_ttl:
        return _cache[cache_key]["data"]

    if not CMC_API_KEY:
        return None

    headers = {
        "Accepts": "application/json",
        "X-CMC_PRO_API_KEY": CMC_API_KEY,
    }
    resp = http_requests.get(
        f"{CMC_BASE_URL}{endpoint}",
        headers=headers,
        params=params or {},
        timeout=10,
    )
    resp.raise_for_status()
    data = resp.json()
    _cache[cache_key] = {"data": data, "ts": now}
    return data


# ─── Demo Data (used when no CMC_API_KEY is set) ──────────────────────────────

DEMO_COINS = [
    {"id": 1, "rank": 1, "symbol": "BTC", "name": "Bitcoin", "price": 97245.32,
     "change_1h": 0.12, "change_24h": 2.14, "change_7d": 5.31,
     "market_cap": 1920000000000, "volume_24h": 42100000000,
     "circulating_supply": 19800000, "max_supply": 21000000},
    {"id": 1027, "rank": 2, "symbol": "ETH", "name": "Ethereum", "price": 3421.87,
     "change_1h": -0.08, "change_24h": -0.82, "change_7d": 3.14,
     "market_cap": 411000000000, "volume_24h": 18200000000,
     "circulating_supply": 120200000, "max_supply": None},
    {"id": 1839, "rank": 3, "symbol": "BNB", "name": "BNB", "price": 612.45,
     "change_1h": 0.31, "change_24h": 1.37, "change_7d": 2.88,
     "market_cap": 91800000000, "volume_24h": 2100000000,
     "circulating_supply": 149500000, "max_supply": 200000000},
    {"id": 5426, "rank": 4, "symbol": "SOL", "name": "Solana", "price": 198.63,
     "change_1h": 0.54, "change_24h": 4.21, "change_7d": 8.72,
     "market_cap": 96400000000, "volume_24h": 5800000000,
     "circulating_supply": 485300000, "max_supply": None},
    {"id": 52, "rank": 5, "symbol": "XRP", "name": "XRP", "price": 2.34,
     "change_1h": -0.15, "change_24h": -1.05, "change_7d": 0.67,
     "market_cap": 134000000000, "volume_24h": 8300000000,
     "circulating_supply": 57200000000, "max_supply": 100000000000},
    {"id": 2010, "rank": 6, "symbol": "ADA", "name": "Cardano", "price": 0.98,
     "change_1h": 0.22, "change_24h": 3.42, "change_7d": 7.15,
     "market_cap": 34800000000, "volume_24h": 1200000000,
     "circulating_supply": 35500000000, "max_supply": 45000000000},
    {"id": 74, "rank": 7, "symbol": "DOGE", "name": "Dogecoin", "price": 0.321,
     "change_1h": -0.41, "change_24h": -2.18, "change_7d": -0.53,
     "market_cap": 47400000000, "volume_24h": 3400000000,
     "circulating_supply": 147600000000, "max_supply": None},
    {"id": 6636, "rank": 8, "symbol": "DOT", "name": "Polkadot", "price": 7.85,
     "change_1h": 0.18, "change_24h": 1.93, "change_7d": 4.22,
     "market_cap": 10800000000, "volume_24h": 520000000,
     "circulating_supply": 1380000000, "max_supply": None},
    {"id": 5805, "rank": 9, "symbol": "AVAX", "name": "Avalanche", "price": 38.72,
     "change_1h": 0.67, "change_24h": 5.11, "change_7d": 12.34,
     "market_cap": 15800000000, "volume_24h": 980000000,
     "circulating_supply": 408000000, "max_supply": 720000000},
    {"id": 1975, "rank": 10, "symbol": "LINK", "name": "Chainlink", "price": 18.45,
     "change_1h": 0.09, "change_24h": 0.67, "change_7d": 3.81,
     "market_cap": 11500000000, "volume_24h": 750000000,
     "circulating_supply": 626800000, "max_supply": 1000000000},
    {"id": 3890, "rank": 11, "symbol": "MATIC", "name": "Polygon", "price": 0.58,
     "change_1h": -0.12, "change_24h": 1.85, "change_7d": 6.42,
     "market_cap": 5400000000, "volume_24h": 320000000,
     "circulating_supply": 9320000000, "max_supply": 10000000000},
    {"id": 4943, "rank": 12, "symbol": "DAI", "name": "Dai", "price": 1.00,
     "change_1h": 0.00, "change_24h": 0.01, "change_7d": 0.02,
     "market_cap": 5300000000, "volume_24h": 210000000,
     "circulating_supply": 5300000000, "max_supply": None},
    {"id": 1, "rank": 13, "symbol": "TRX", "name": "TRON", "price": 0.245,
     "change_1h": 0.05, "change_24h": 0.92, "change_7d": 2.10,
     "market_cap": 21300000000, "volume_24h": 890000000,
     "circulating_supply": 86800000000, "max_supply": None},
    {"id": 11419, "rank": 14, "symbol": "TON", "name": "Toncoin", "price": 5.72,
     "change_1h": 0.34, "change_24h": 2.67, "change_7d": 4.11,
     "market_cap": 14400000000, "volume_24h": 620000000,
     "circulating_supply": 2520000000, "max_supply": 5000000000},
    {"id": 2, "rank": 15, "symbol": "LTC", "name": "Litecoin", "price": 108.25,
     "change_1h": -0.21, "change_24h": 1.14, "change_7d": 3.55,
     "market_cap": 8100000000, "volume_24h": 650000000,
     "circulating_supply": 74900000, "max_supply": 84000000},
    {"id": 8916, "rank": 16, "symbol": "SHIB", "name": "Shiba Inu", "price": 0.0000224,
     "change_1h": -0.33, "change_24h": -1.47, "change_7d": 2.08,
     "market_cap": 13200000000, "volume_24h": 780000000,
     "circulating_supply": 589000000000000, "max_supply": None},
    {"id": 5994, "rank": 17, "symbol": "UNI", "name": "Uniswap", "price": 13.42,
     "change_1h": 0.15, "change_24h": 2.88, "change_7d": 5.67,
     "market_cap": 8100000000, "volume_24h": 410000000,
     "circulating_supply": 600500000, "max_supply": 1000000000},
    {"id": 1831, "rank": 18, "symbol": "BCH", "name": "Bitcoin Cash", "price": 465.80,
     "change_1h": 0.42, "change_24h": 3.15, "change_7d": 6.92,
     "market_cap": 9200000000, "volume_24h": 560000000,
     "circulating_supply": 19800000, "max_supply": 21000000},
    {"id": 7083, "rank": 19, "symbol": "NEAR", "name": "NEAR Protocol", "price": 5.34,
     "change_1h": 0.28, "change_24h": 4.52, "change_7d": 9.13,
     "market_cap": 6200000000, "volume_24h": 480000000,
     "circulating_supply": 1160000000, "max_supply": 1000000000},
    {"id": 3077, "rank": 20, "symbol": "VET", "name": "VeChain", "price": 0.042,
     "change_1h": -0.09, "change_24h": 1.73, "change_7d": 4.28,
     "market_cap": 3400000000, "volume_24h": 120000000,
     "circulating_supply": 80900000000, "max_supply": 86700000000},
]


def _parse_cmc_listing(item):
    """Extract coin data from a CMC listing item."""
    q = item.get("quote", {}).get("USD", {})
    return {
        "id": item.get("id"),
        "rank": item.get("cmc_rank"),
        "symbol": item.get("symbol"),
        "name": item.get("name"),
        "price": q.get("price", 0),
        "change_1h": round(q.get("percent_change_1h", 0), 2),
        "change_24h": round(q.get("percent_change_24h", 0), 2),
        "change_7d": round(q.get("percent_change_7d", 0), 2),
        "market_cap": q.get("market_cap", 0),
        "volume_24h": q.get("volume_24h", 0),
        "circulating_supply": item.get("circulating_supply"),
        "max_supply": item.get("max_supply"),
    }


def _generate_chart_data(price, change_24h, points=200):
    """
    Generate synthetic chart history from current price and 24h change.
    Produces a realistic-looking price curve for display.
    """
    now = time.time()
    interval = (24 * 3600) / points  # spread over 24h
    change_frac = (change_24h or 0) / 100.0
    start_price = price / (1 + change_frac) if change_frac != -1 else price

    # Seed random from price for consistent charts per coin
    seed = int(hashlib.md5(str(price).encode()).hexdigest()[:8], 16)
    rng = random.Random(seed)

    data = []
    p = start_price
    target_step = (price - start_price) / points
    volatility = price * 0.002  # 0.2% per step

    for i in range(points):
        noise = rng.gauss(0, volatility)
        p += target_step + noise
        p = max(p, start_price * 0.9)  # floor
        epoch = int(now - (points - i) * interval)
        data.append({"price": round(p, 8), "epoch": epoch})

    # Ensure last point matches current price
    data[-1]["price"] = price
    return data


# ─── Routes ───────────────────────────────────────────────────────────────────


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/dashboard")
def dashboard():
    return render_template("dashboard.html")


@app.route("/api/crypto/listings")
def crypto_listings():
    """
    Top cryptocurrencies ranked by market cap.
    Query params: limit (default 50), start (default 1)
    """
    limit = request.args.get("limit", "50")
    start = request.args.get("start", "1")

    raw = cmc_fetch(
        "/v1/cryptocurrency/listings/latest",
        params={"start": start, "limit": limit, "convert": "USD"},
        cache_ttl=60,
    )

    if raw and raw.get("data"):
        coins = [_parse_cmc_listing(item) for item in raw["data"]]
        return jsonify({"success": True, "data": coins, "demo": False})

    # Fallback demo
    return jsonify({"success": True, "data": DEMO_COINS, "demo": True})


@app.route("/api/crypto/quote/<coin_id>")
def crypto_quote(coin_id):
    """
    Detailed quote for a single coin by CMC ID.
    """
    raw = cmc_fetch(
        "/v2/cryptocurrency/quotes/latest",
        params={"id": coin_id, "convert": "USD"},
        cache_ttl=60,
    )

    if raw and raw.get("data"):
        item = raw["data"].get(str(coin_id))
        if item:
            return jsonify({"success": True, "data": _parse_cmc_listing(item), "demo": False})

    # Fallback: find in demo
    for c in DEMO_COINS:
        if str(c["id"]) == str(coin_id):
            return jsonify({"success": True, "data": c, "demo": True})

    return jsonify({"success": False, "error": "Coin not found"}), 404


@app.route("/api/crypto/chart/<coin_id>")
def crypto_chart(coin_id):
    """
    Price chart data for a coin. Returns ~200 price points over 24 hours.
    On free CMC tier, generates synthetic data from current price + 24h change.
    """
    # Try to find coin data
    coin = None

    raw = cmc_fetch(
        "/v2/cryptocurrency/quotes/latest",
        params={"id": coin_id, "convert": "USD"},
        cache_ttl=60,
    )
    if raw and raw.get("data"):
        item = raw["data"].get(str(coin_id))
        if item:
            coin = _parse_cmc_listing(item)

    if not coin:
        for c in DEMO_COINS:
            if str(c["id"]) == str(coin_id):
                coin = c
                break

    if not coin:
        return jsonify({"success": False, "error": "Coin not found"}), 404

    chart_data = _generate_chart_data(coin["price"], coin["change_24h"])
    return jsonify({
        "success": True,
        "coin_id": coin_id,
        "symbol": coin["symbol"],
        "data": chart_data,
    })


@app.route("/api/crypto/global")
def crypto_global():
    """Global cryptocurrency market metrics."""
    raw = cmc_fetch(
        "/v1/global-metrics/quotes/latest",
        params={"convert": "USD"},
        cache_ttl=120,
    )

    if raw and raw.get("data"):
        d = raw["data"]
        q = d.get("quote", {}).get("USD", {})
        return jsonify({
            "success": True,
            "demo": False,
            "data": {
                "total_market_cap": q.get("total_market_cap", 0),
                "total_volume_24h": q.get("total_volume_24h", 0),
                "btc_dominance": round(d.get("btc_dominance", 0), 1),
                "eth_dominance": round(d.get("eth_dominance", 0), 1),
                "total_cryptocurrencies": d.get("total_cryptocurrencies", 0),
                "market_cap_change_24h": round(q.get("total_market_cap_yesterday_percentage_change", 0), 2),
            },
        })

    # Demo fallback
    return jsonify({
        "success": True,
        "demo": True,
        "data": {
            "total_market_cap": 3420000000000,
            "total_volume_24h": 142000000000,
            "btc_dominance": 56.2,
            "eth_dominance": 12.1,
            "total_cryptocurrencies": 2400000,
            "market_cap_change_24h": 1.84,
        },
    })


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)
