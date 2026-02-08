import os
import json
import time
import threading
import requests as http_requests
from flask import Flask, render_template, request, jsonify, session, redirect, url_for
from flask_socketio import SocketIO, emit
from dotenv import load_dotenv
from deriv_api import DerivAPI

load_dotenv()

app = Flask(__name__)
app.secret_key = os.getenv("SECRET_KEY", "dev-secret-key-change-in-production")
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")

# Store active deriv connections per session
deriv_connections = {}

# OAuth / App config
DERIV_APP_ID = os.getenv("DERIV_APP_ID", "1089")
DERIV_OAUTH_URL = f"https://oauth.deriv.com/oauth2/authorize?app_id={DERIV_APP_ID}"

# CoinMarketCap config
CMC_API_KEY = os.getenv("CMC_API_KEY", "")
CMC_BASE_URL = "https://pro-api.coinmarketcap.com/v1"

# Simple cache for CMC data (avoid hitting rate limits)
_cmc_cache = {"data": None, "timestamp": 0}


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/dashboard")
def dashboard():
    return render_template("dashboard.html")


@app.route("/oauth/callback")
def oauth_callback():
    """
    OAuth redirect callback.
    Deriv redirects here with tokens in the URL fragment (#).
    Since fragments aren't sent to the server, this page uses JS to
    extract tokens and pass them to the dashboard.
    """
    return render_template("oauth_callback.html")


@app.route("/oauth/login")
def oauth_login():
    """Redirect user to Deriv OAuth login page."""
    return redirect(DERIV_OAUTH_URL)


@app.route("/api/config")
def get_config():
    """Return the app ID and OAuth URL for frontend."""
    return jsonify({
        "app_id": DERIV_APP_ID,
        "oauth_url": DERIV_OAUTH_URL,
    })


@app.route("/api/crypto")
def get_crypto_prices():
    """
    Proxy endpoint for CoinMarketCap cryptocurrency listings.
    Returns top cryptocurrencies with price, market cap, and 24h change.
    Uses a 2-minute cache to avoid hitting CMC rate limits.
    """
    global _cmc_cache

    # Return cached data if fresh (< 2 min)
    if _cmc_cache["data"] and (time.time() - _cmc_cache["timestamp"]) < 120:
        return jsonify(_cmc_cache["data"])

    if not CMC_API_KEY:
        # Return demo data if no API key configured
        demo = [
            {"symbol": "BTC", "name": "Bitcoin", "price": 97245.32, "change_24h": 2.14},
            {"symbol": "ETH", "name": "Ethereum", "price": 3421.87, "change_24h": -0.82},
            {"symbol": "BNB", "name": "BNB", "price": 612.45, "change_24h": 1.37},
            {"symbol": "SOL", "name": "Solana", "price": 198.63, "change_24h": 4.21},
            {"symbol": "XRP", "name": "XRP", "price": 2.34, "change_24h": -1.05},
            {"symbol": "ADA", "name": "Cardano", "price": 0.98, "change_24h": 3.42},
            {"symbol": "DOGE", "name": "Dogecoin", "price": 0.321, "change_24h": -2.18},
            {"symbol": "DOT", "name": "Polkadot", "price": 7.85, "change_24h": 1.93},
            {"symbol": "AVAX", "name": "Avalanche", "price": 38.72, "change_24h": 5.11},
            {"symbol": "LINK", "name": "Chainlink", "price": 18.45, "change_24h": 0.67},
        ]
        return jsonify({"success": True, "data": demo, "demo": True})

    try:
        headers = {
            "Accepts": "application/json",
            "X-CMC_PRO_API_KEY": CMC_API_KEY,
        }
        params = {
            "start": "1",
            "limit": "15",
            "convert": "USD",
        }
        resp = http_requests.get(
            f"{CMC_BASE_URL}/cryptocurrency/listings/latest",
            headers=headers,
            params=params,
            timeout=10,
        )
        resp.raise_for_status()
        raw = resp.json()

        coins = []
        for item in raw.get("data", []):
            quote = item.get("quote", {}).get("USD", {})
            coins.append({
                "symbol": item.get("symbol"),
                "name": item.get("name"),
                "price": round(quote.get("price", 0), 2),
                "change_24h": round(quote.get("percent_change_24h", 0), 2),
                "market_cap": round(quote.get("market_cap", 0), 0),
                "volume_24h": round(quote.get("volume_24h", 0), 0),
            })

        result = {"success": True, "data": coins, "demo": False}
        _cmc_cache = {"data": result, "timestamp": time.time()}
        return jsonify(result)

    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ─── SocketIO Events ──────────────────────────────────────────────────────────


@socketio.on("connect")
def handle_connect():
    print(f"Client connected: {request.sid}")
    emit("server_message", {"msg": "Connected to trading server"})


@socketio.on("disconnect")
def handle_disconnect():
    sid = request.sid
    print(f"Client disconnected: {sid}")
    # Cleanup deriv connection if exists
    if sid in deriv_connections:
        deriv_connections[sid].disconnect()
        del deriv_connections[sid]


@socketio.on("authorize")
def handle_authorize(data):
    """Authorize with Deriv API using token."""
    token = data.get("token", os.getenv("DERIV_API_TOKEN", ""))
    app_id = os.getenv("DERIV_APP_ID", "1089")
    sid = request.sid

    if not token:
        emit("auth_result", {"success": False, "error": "No API token provided"})
        return

    try:
        api = DerivAPI(app_id=app_id)
        deriv_connections[sid] = api
        result = api.authorize(token)
        if result.get("error"):
            emit("auth_result", {"success": False, "error": result["error"]["message"]})
        else:
            auth_data = result.get("authorize", {})
            emit("auth_result", {
                "success": True,
                "balance": auth_data.get("balance"),
                "currency": auth_data.get("currency"),
                "loginid": auth_data.get("loginid"),
                "fullname": auth_data.get("fullname"),
                "account_type": "demo" if "VRTC" in auth_data.get("loginid", "") else "real"
            })
    except Exception as e:
        emit("auth_result", {"success": False, "error": str(e)})


@socketio.on("get_active_symbols")
def handle_active_symbols(data):
    """Get available trading symbols."""
    sid = request.sid
    app_id = os.getenv("DERIV_APP_ID", "1089")

    try:
        api = deriv_connections.get(sid) or DerivAPI(app_id=app_id)
        result = api.get_active_symbols(product_type="basic")
        if result.get("error"):
            emit("active_symbols", {"success": False, "error": result["error"]["message"]})
        else:
            symbols = result.get("active_symbols", [])
            # Group by market
            markets = {}
            for s in symbols:
                market = s.get("market_display_name", "Other")
                if market not in markets:
                    markets[market] = []
                markets[market].append({
                    "symbol": s.get("symbol"),
                    "display_name": s.get("display_name"),
                    "market": market,
                    "submarket": s.get("submarket_display_name"),
                    "pip": s.get("pip"),
                    "is_trading_suspended": s.get("is_trading_suspended"),
                })
            emit("active_symbols", {"success": True, "markets": markets})
    except Exception as e:
        emit("active_symbols", {"success": False, "error": str(e)})


@socketio.on("subscribe_ticks")
def handle_subscribe_ticks(data):
    """Subscribe to real-time tick data for a symbol."""
    symbol = data.get("symbol", "R_100")
    sid = request.sid
    app_id = os.getenv("DERIV_APP_ID", "1089")

    try:
        api = deriv_connections.get(sid) or DerivAPI(app_id=app_id)
        if sid not in deriv_connections:
            deriv_connections[sid] = api

        def on_tick(tick_data):
            socketio.emit("tick_update", tick_data, room=sid)

        api.subscribe_ticks(symbol, callback=on_tick)
        emit("tick_subscribed", {"success": True, "symbol": symbol})
    except Exception as e:
        emit("tick_subscribed", {"success": False, "error": str(e)})


@socketio.on("buy_contract")
def handle_buy_contract(data):
    """Buy a binary options contract."""
    sid = request.sid

    contract_type = data.get("contract_type", "CALL")  # CALL or PUT
    symbol = data.get("symbol", "R_100")
    duration = data.get("duration", 5)
    duration_unit = data.get("duration_unit", "t")  # t=ticks, s=seconds, m=minutes
    amount = data.get("amount", 1)
    basis = data.get("basis", "stake")  # stake or payout

    try:
        api = deriv_connections.get(sid)
        if not api:
            emit("buy_result", {"success": False, "error": "Not connected. Please authorize first."})
            return

        # First get a price proposal
        proposal = api.get_proposal(
            contract_type=contract_type,
            symbol=symbol,
            duration=duration,
            duration_unit=duration_unit,
            amount=amount,
            basis=basis,
        )

        if proposal.get("error"):
            emit("buy_result", {"success": False, "error": proposal["error"]["message"]})
            return

        proposal_data = proposal.get("proposal", {})
        proposal_id = proposal_data.get("id")

        # Buy the contract
        buy_result = api.buy(proposal_id, amount)

        if buy_result.get("error"):
            emit("buy_result", {"success": False, "error": buy_result["error"]["message"]})
        else:
            buy_data = buy_result.get("buy", {})
            emit("buy_result", {
                "success": True,
                "contract_id": buy_data.get("contract_id"),
                "buy_price": buy_data.get("buy_price"),
                "payout": buy_data.get("payout"),
                "longcode": buy_data.get("longcode"),
                "start_time": buy_data.get("start_time"),
            })

            # Subscribe to contract updates
            contract_id = buy_data.get("contract_id")
            if contract_id:
                def on_contract_update(update):
                    socketio.emit("contract_update", update, room=sid)

                api.subscribe_proposal_open_contract(contract_id, callback=on_contract_update)

    except Exception as e:
        emit("buy_result", {"success": False, "error": str(e)})


@socketio.on("get_portfolio")
def handle_portfolio(data):
    """Get open positions."""
    sid = request.sid
    try:
        api = deriv_connections.get(sid)
        if not api:
            emit("portfolio_result", {"success": False, "error": "Not authorized"})
            return

        result = api.get_portfolio()
        if result.get("error"):
            emit("portfolio_result", {"success": False, "error": result["error"]["message"]})
        else:
            emit("portfolio_result", {
                "success": True,
                "contracts": result.get("portfolio", {}).get("contracts", [])
            })
    except Exception as e:
        emit("portfolio_result", {"success": False, "error": str(e)})


@socketio.on("get_statement")
def handle_statement(data):
    """Get account statement / trade history."""
    sid = request.sid
    limit = data.get("limit", 20)
    try:
        api = deriv_connections.get(sid)
        if not api:
            emit("statement_result", {"success": False, "error": "Not authorized"})
            return

        result = api.get_statement(limit=limit)
        if result.get("error"):
            emit("statement_result", {"success": False, "error": result["error"]["message"]})
        else:
            emit("statement_result", {
                "success": True,
                "transactions": result.get("statement", {}).get("transactions", [])
            })
    except Exception as e:
        emit("statement_result", {"success": False, "error": str(e)})


if __name__ == "__main__":
    socketio.run(app, debug=True, host="0.0.0.0", port=5000)
