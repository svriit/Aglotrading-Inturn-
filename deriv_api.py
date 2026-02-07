"""
Deriv API WebSocket Client
Handles all communication with the Deriv WebSocket API.
"""

import json
import threading
import time
import websocket


class DerivAPI:
    """WebSocket client for the Deriv trading API."""

    WS_URL = "wss://ws.derivws.com/websockets/v3"

    def __init__(self, app_id="1089"):
        self.app_id = app_id
        self.ws = None
        self.connected = False
        self.req_id = 0
        self._responses = {}
        self._subscriptions = {}
        self._lock = threading.Lock()
        self._connect()

    def _connect(self):
        """Establish WebSocket connection to Deriv."""
        url = f"{self.WS_URL}?app_id={self.app_id}"
        self.ws = websocket.WebSocketApp(
            url,
            on_open=self._on_open,
            on_message=self._on_message,
            on_error=self._on_error,
            on_close=self._on_close,
        )
        self._ws_thread = threading.Thread(target=self.ws.run_forever, daemon=True)
        self._ws_thread.start()

        # Wait for connection
        timeout = 10
        start = time.time()
        while not self.connected and (time.time() - start) < timeout:
            time.sleep(0.1)

        if not self.connected:
            raise ConnectionError("Failed to connect to Deriv WebSocket API")

    def _on_open(self, ws):
        self.connected = True

    def _on_message(self, ws, message):
        data = json.loads(message)
        req_id = data.get("req_id")

        # Check if this is a subscription update
        msg_type = data.get("msg_type")
        if msg_type == "tick" and "tick" in self._subscriptions:
            symbol = data.get("tick", {}).get("symbol")
            cb = self._subscriptions.get("tick", {}).get(symbol)
            if cb:
                cb({
                    "symbol": symbol,
                    "quote": data["tick"].get("quote"),
                    "epoch": data["tick"].get("epoch"),
                    "ask": data["tick"].get("ask"),
                    "bid": data["tick"].get("bid"),
                })
                return

        if msg_type == "proposal_open_contract":
            contract_id = data.get("proposal_open_contract", {}).get("contract_id")
            cb = self._subscriptions.get("poc", {}).get(str(contract_id))
            if cb:
                poc = data.get("proposal_open_contract", {})
                cb({
                    "contract_id": contract_id,
                    "current_spot": poc.get("current_spot"),
                    "current_spot_display_value": poc.get("current_spot_display_value"),
                    "entry_spot": poc.get("entry_spot"),
                    "profit": poc.get("profit"),
                    "profit_percentage": poc.get("profit_percentage"),
                    "buy_price": poc.get("buy_price"),
                    "payout": poc.get("payout"),
                    "is_sold": poc.get("is_sold"),
                    "is_expired": poc.get("is_expired"),
                    "status": poc.get("status"),
                    "contract_type": poc.get("contract_type"),
                    "exit_tick": poc.get("exit_tick"),
                    "exit_tick_display_value": poc.get("exit_tick_display_value"),
                    "sell_price": poc.get("sell_price"),
                })
                return

        # Store response by req_id
        if req_id is not None:
            self._responses[req_id] = data

    def _on_error(self, ws, error):
        print(f"Deriv WS Error: {error}")

    def _on_close(self, ws, close_status_code, close_msg):
        self.connected = False

    def _send(self, payload, timeout=15):
        """Send a request and wait for response."""
        with self._lock:
            self.req_id += 1
            req_id = self.req_id

        payload["req_id"] = req_id

        if not self.connected:
            self._connect()

        self.ws.send(json.dumps(payload))

        # Wait for response
        start = time.time()
        while (time.time() - start) < timeout:
            if req_id in self._responses:
                return self._responses.pop(req_id)
            time.sleep(0.05)

        return {"error": {"message": "Request timed out"}}

    def disconnect(self):
        """Close the WebSocket connection."""
        if self.ws:
            self.ws.close()
            self.connected = False

    # ─── API Methods ──────────────────────────────────────────────────────────

    def authorize(self, token):
        """Authorize with Deriv API token."""
        return self._send({"authorize": token})

    def get_active_symbols(self, product_type="basic"):
        """Get list of active trading symbols."""
        return self._send({
            "active_symbols": product_type,
            "product_type": "basic"
        })

    def get_proposal(self, contract_type, symbol, duration, duration_unit, amount, basis="stake"):
        """Get a price proposal for a binary options contract."""
        return self._send({
            "proposal": 1,
            "amount": str(amount),
            "basis": basis,
            "contract_type": contract_type,
            "currency": "USD",
            "duration": duration,
            "duration_unit": duration_unit,
            "symbol": symbol,
        })

    def buy(self, proposal_id, price):
        """Buy a contract by proposal ID."""
        return self._send({
            "buy": proposal_id,
            "price": price,
        })

    def sell(self, contract_id, price=0):
        """Sell a contract (close position)."""
        return self._send({
            "sell": contract_id,
            "price": price,
        })

    def get_portfolio(self):
        """Get current open positions."""
        return self._send({"portfolio": 1})

    def get_statement(self, limit=50, offset=0):
        """Get account statement."""
        return self._send({
            "statement": 1,
            "description": 1,
            "limit": limit,
            "offset": offset,
        })

    def get_balance(self):
        """Get account balance."""
        return self._send({"balance": 1})

    def get_ticks_history(self, symbol, count=100, style="ticks"):
        """Get historical tick data."""
        return self._send({
            "ticks_history": symbol,
            "count": count,
            "end": "latest",
            "style": style,
        })

    def get_candles(self, symbol, count=100, granularity=60):
        """Get OHLC candle data."""
        return self._send({
            "ticks_history": symbol,
            "count": count,
            "end": "latest",
            "style": "candles",
            "granularity": granularity,
        })

    def subscribe_ticks(self, symbol, callback):
        """Subscribe to real-time tick updates."""
        if "tick" not in self._subscriptions:
            self._subscriptions["tick"] = {}
        self._subscriptions["tick"][symbol] = callback

        payload = {
            "ticks": symbol,
            "subscribe": 1,
        }
        with self._lock:
            self.req_id += 1
            payload["req_id"] = self.req_id

        self.ws.send(json.dumps(payload))

    def subscribe_proposal_open_contract(self, contract_id, callback):
        """Subscribe to open contract updates."""
        if "poc" not in self._subscriptions:
            self._subscriptions["poc"] = {}
        self._subscriptions["poc"][str(contract_id)] = callback

        payload = {
            "proposal_open_contract": 1,
            "contract_id": contract_id,
            "subscribe": 1,
        }
        with self._lock:
            self.req_id += 1
            payload["req_id"] = self.req_id

        self.ws.send(json.dumps(payload))

    def forget_all(self, stream_type="ticks"):
        """Unsubscribe from all streams of a type."""
        return self._send({"forget_all": stream_type})
