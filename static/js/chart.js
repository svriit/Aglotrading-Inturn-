/* ═══════════════════════════════════════════════════════════════════════════
   Aglo Trading - Chart Engine v2
   Canvas chart with zoom/pan, indicators, oscillators, and drawing tools.
   ═══════════════════════════════════════════════════════════════════════════ */

class TradingChart {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');

        // Data
        this.data = [];
        this.candles = [];
        this.chartType = 'line';
        this.maxDataPoints = 1000;

        // Zoom & Pan
        this.zoom = 1.0;
        this.minZoom = 0.2;
        this.maxZoom = 10.0;
        this.panOffset = 0;     // horizontal scroll offset in data points
        this.isPanning = false;
        this.panStartX = 0;
        this.panStartOffset = 0;

        // Colors
        this.colors = {
            bg: '#0a0e17',
            grid: '#1a2332',
            gridText: '#475569',
            line: '#3b82f6',
            lineGradientTop: 'rgba(59, 130, 246, 0.15)',
            lineGradientBottom: 'rgba(59, 130, 246, 0.0)',
            candleGreen: '#22c55e',
            candleRed: '#ef4444',
            crosshair: '#64748b',
            priceLabel: '#e2e8f0',
            priceLabelBg: '#3b82f6',
            sma: '#eab308',
            ema: '#a855f7',
            bb_upper: '#6366f1',
            bb_lower: '#6366f1',
            bb_fill: 'rgba(99, 102, 241, 0.06)',
            rsi_line: '#f59e0b',
            rsi_overbought: 'rgba(239, 68, 68, 0.3)',
            rsi_oversold: 'rgba(34, 197, 94, 0.3)',
            macd_line: '#3b82f6',
            macd_signal: '#ef4444',
            macd_hist_pos: 'rgba(34, 197, 94, 0.6)',
            macd_hist_neg: 'rgba(239, 68, 68, 0.6)',
            stoch_k: '#3b82f6',
            stoch_d: '#ef4444',
            drawing: '#f59e0b',
        };

        this.padding = { top: 20, right: 80, bottom: 30, left: 10 };

        // Mouse
        this.mouseX = -1;
        this.mouseY = -1;

        // Indicators config
        this.indicators = {
            sma: { enabled: false, period: 20 },
            ema: { enabled: false, period: 20 },
            bb:  { enabled: false, period: 20, stdDev: 2 },
        };

        // Oscillators config
        this.oscillators = {
            rsi:  { enabled: false, period: 14 },
            macd: { enabled: false, fast: 12, slow: 26, signal: 9 },
            stochastic: { enabled: false, kPeriod: 14, dPeriod: 3 },
        };

        // Oscillator panel height
        this.oscHeight = 0;

        // Drawing tools
        this.drawings = [];
        this.drawingMode = null; // 'trendline', 'hline', 'fibonacci', null
        this.drawingStart = null;
        this.drawingTemp = null;

        this._setupCanvas();
        this._attachEvents();
        this._animate();
    }

    // ─── Canvas Setup ─────────────────────────────────────────────────────────
    _setupCanvas() {
        this._resize = () => {
            const rect = this.canvas.parentElement.getBoundingClientRect();
            const dpr = window.devicePixelRatio || 1;
            this.canvas.width = rect.width * dpr;
            this.canvas.height = rect.height * dpr;
            this.canvas.style.width = rect.width + 'px';
            this.canvas.style.height = rect.height + 'px';
            this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            this.width = rect.width;
            this.height = rect.height;
        };
        this._resize();
        window.addEventListener('resize', this._resize);
    }

    _attachEvents() {
        // Mouse move
        this.canvas.addEventListener('mousemove', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            this.mouseX = e.clientX - rect.left;
            this.mouseY = e.clientY - rect.top;

            if (this.isPanning) {
                const dx = this.mouseX - this.panStartX;
                const dataLen = this._getDataLength();
                const visibleCount = this._visibleCount();
                const pxPerPoint = (this.width - this.padding.left - this.padding.right) / visibleCount;
                this.panOffset = this.panStartOffset + dx / pxPerPoint;
                this.panOffset = Math.min(this.panOffset, 0);
                this.panOffset = Math.max(this.panOffset, -(dataLen - visibleCount));
            }

            // Drawing in progress
            if (this.drawingMode && this.drawingStart) {
                this.drawingTemp = this._mouseToData();
            }
        });

        this.canvas.addEventListener('mouseleave', () => {
            this.mouseX = -1;
            this.mouseY = -1;
            this.isPanning = false;
        });

        // Mouse wheel zoom
        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
            const oldZoom = this.zoom;
            this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * zoomFactor));

            // Adjust pan to zoom toward cursor
            const dataLen = this._getDataLength();
            const oldVisible = Math.floor(dataLen / oldZoom);
            const newVisible = this._visibleCount();
            const cursorRatio = (this.mouseX - this.padding.left) / (this.width - this.padding.left - this.padding.right);
            this.panOffset -= (newVisible - oldVisible) * cursorRatio;
            this.panOffset = Math.min(this.panOffset, 0);
            this.panOffset = Math.max(this.panOffset, -(dataLen - newVisible));
        }, { passive: false });

        // Pan (middle click or shift+drag)
        this.canvas.addEventListener('mousedown', (e) => {
            if (this.drawingMode) {
                this._handleDrawingClick(e);
                return;
            }
            this.isPanning = true;
            this.panStartX = this.mouseX;
            this.panStartOffset = this.panOffset;
            this.canvas.style.cursor = 'grabbing';
        });

        this.canvas.addEventListener('mouseup', () => {
            if (this.isPanning) {
                this.isPanning = false;
                this.canvas.style.cursor = this.drawingMode ? 'crosshair' : 'default';
            }
        });
    }

    // ─── Data Methods ─────────────────────────────────────────────────────────
    addTick(price, epoch) {
        this.data.push({ price: parseFloat(price), epoch, time: new Date(epoch * 1000) });
        if (this.data.length > this.maxDataPoints) {
            this.data.shift();
        }
    }

    setCandles(candleData) {
        this.candles = candleData.map(c => ({
            open: parseFloat(c.open),
            high: parseFloat(c.high),
            low: parseFloat(c.low),
            close: parseFloat(c.close),
            epoch: c.epoch,
            time: new Date(c.epoch * 1000),
        }));
    }

    addCandle(candle) {
        const c = {
            open: parseFloat(candle.open),
            high: parseFloat(candle.high),
            low: parseFloat(candle.low),
            close: parseFloat(candle.close),
            epoch: candle.epoch,
            time: new Date(candle.epoch * 1000),
        };
        if (this.candles.length > 0 && this.candles[this.candles.length - 1].epoch === c.epoch) {
            this.candles[this.candles.length - 1] = c;
        } else {
            this.candles.push(c);
            if (this.candles.length > this.maxDataPoints) {
                this.candles.shift();
            }
        }
    }

    clearData() {
        this.data = [];
        this.candles = [];
        this.panOffset = 0;
        this.zoom = 1.0;
    }

    setType(type) { this.chartType = type; }

    _getDataLength() {
        return this.chartType === 'line' ? this.data.length : this.candles.length;
    }

    _visibleCount() {
        const dataLen = this._getDataLength();
        return Math.max(10, Math.floor(dataLen / this.zoom));
    }

    _getVisibleRange() {
        const dataLen = this._getDataLength();
        const visible = this._visibleCount();
        let end = dataLen + Math.round(this.panOffset);
        let start = end - visible;
        if (start < 0) { start = 0; end = Math.min(visible, dataLen); }
        if (end > dataLen) { end = dataLen; start = Math.max(0, end - visible); }
        return { start, end, count: end - start };
    }

    // ─── Zoom Controls ────────────────────────────────────────────────────────
    zoomIn() {
        this.zoom = Math.min(this.maxZoom, this.zoom * 1.3);
    }

    zoomOut() {
        this.zoom = Math.max(this.minZoom, this.zoom / 1.3);
        const dataLen = this._getDataLength();
        const visible = this._visibleCount();
        this.panOffset = Math.max(this.panOffset, -(dataLen - visible));
    }

    resetZoom() {
        this.zoom = 1.0;
        this.panOffset = 0;
    }

    // ─── Indicator Toggles ────────────────────────────────────────────────────
    toggleIndicator(name, enabled, params) {
        if (this.indicators[name]) {
            this.indicators[name].enabled = enabled;
            if (params) Object.assign(this.indicators[name], params);
        }
    }

    toggleOscillator(name, enabled, params) {
        if (this.oscillators[name]) {
            this.oscillators[name].enabled = enabled;
            if (params) Object.assign(this.oscillators[name], params);
        }
        this._updateOscHeight();
    }

    _updateOscHeight() {
        let count = 0;
        if (this.oscillators.rsi.enabled) count++;
        if (this.oscillators.macd.enabled) count++;
        if (this.oscillators.stochastic.enabled) count++;
        this.oscHeight = count * 100;
    }

    // ─── Drawing Tools ────────────────────────────────────────────────────────
    setDrawingMode(mode) {
        this.drawingMode = mode;
        this.drawingStart = null;
        this.drawingTemp = null;
        this.canvas.style.cursor = mode ? 'crosshair' : 'default';
    }

    clearDrawings() {
        this.drawings = [];
        this.drawingMode = null;
        this.drawingStart = null;
        this.drawingTemp = null;
        this.canvas.style.cursor = 'default';
    }

    _mouseToData() {
        const p = this.padding;
        const chartH = this.height - p.top - p.bottom - this.oscHeight;
        const chartW = this.width - p.left - p.right;
        const range = this._getVisibleRange();

        const xRatio = (this.mouseX - p.left) / chartW;
        const dataIndex = range.start + xRatio * range.count;

        // Get price range from visible data
        const { minPrice, maxPrice } = this._getPriceRange(range);
        const yRatio = (this.mouseY - p.top) / chartH;
        const price = maxPrice - yRatio * (maxPrice - minPrice);

        return { index: dataIndex, price, x: this.mouseX, y: this.mouseY };
    }

    _handleDrawingClick(e) {
        const point = this._mouseToData();
        if (!this.drawingStart) {
            if (this.drawingMode === 'hline') {
                this.drawings.push({ type: 'hline', price: point.price });
                this.drawingMode = null;
                this.canvas.style.cursor = 'default';
            } else {
                this.drawingStart = point;
            }
        } else {
            this.drawings.push({
                type: this.drawingMode,
                start: this.drawingStart,
                end: point,
            });
            this.drawingStart = null;
            this.drawingTemp = null;
            this.drawingMode = null;
            this.canvas.style.cursor = 'default';
        }
    }

    // ─── Price Range ──────────────────────────────────────────────────────────
    _getPriceRange(range) {
        let minPrice, maxPrice;
        if (this.chartType === 'line') {
            const slice = this.data.slice(range.start, range.end);
            if (slice.length === 0) return { minPrice: 0, maxPrice: 1 };
            const prices = slice.map(d => d.price);
            minPrice = Math.min(...prices);
            maxPrice = Math.max(...prices);
        } else {
            const slice = this.candles.slice(range.start, range.end);
            if (slice.length === 0) return { minPrice: 0, maxPrice: 1 };
            minPrice = Math.min(...slice.map(c => c.low));
            maxPrice = Math.max(...slice.map(c => c.high));
        }
        const pad = (maxPrice - minPrice || 0.0001) * 0.08;
        return { minPrice: minPrice - pad, maxPrice: maxPrice + pad };
    }

    // ─── Animation Loop ──────────────────────────────────────────────────────
    _animate() {
        this._draw();
        requestAnimationFrame(() => this._animate());
    }

    _draw() {
        const ctx = this.ctx;
        const w = this.width;
        const h = this.height;
        if (!w || !h) return;

        ctx.fillStyle = this.colors.bg;
        ctx.fillRect(0, 0, w, h);

        const mainH = h - this.oscHeight;

        if (this.chartType === 'line') {
            this._drawLineChart(ctx, w, mainH);
        } else {
            this._drawCandleChart(ctx, w, mainH);
        }

        // Draw indicators on main chart
        this._drawIndicators(ctx, w, mainH);

        // Draw oscillators below
        this._drawOscillators(ctx, w, h, mainH);

        // Draw user drawings
        this._drawDrawings(ctx, w, mainH);
    }

    // ─── Line Chart ───────────────────────────────────────────────────────────
    _drawLineChart(ctx, w, h) {
        if (this.data.length < 2) return;

        const p = this.padding;
        const chartW = w - p.left - p.right;
        const chartH = h - p.top - p.bottom;
        const range = this._getVisibleRange();
        const slice = this.data.slice(range.start, range.end);
        if (slice.length < 2) return;

        const { minPrice, maxPrice } = this._getPriceRange(range);

        this._drawGrid(ctx, p, chartW, chartH, minPrice, maxPrice);

        // Line
        ctx.beginPath();
        ctx.strokeStyle = this.colors.line;
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';

        const points = [];
        for (let i = 0; i < slice.length; i++) {
            const x = p.left + (i / (slice.length - 1)) * chartW;
            const y = p.top + chartH - ((slice[i].price - minPrice) / (maxPrice - minPrice)) * chartH;
            points.push({ x, y });
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // Gradient
        const gradient = ctx.createLinearGradient(0, p.top, 0, h - p.bottom);
        gradient.addColorStop(0, this.colors.lineGradientTop);
        gradient.addColorStop(1, this.colors.lineGradientBottom);
        ctx.beginPath();
        for (let i = 0; i < points.length; i++) {
            if (i === 0) ctx.moveTo(points[i].x, points[i].y);
            else ctx.lineTo(points[i].x, points[i].y);
        }
        ctx.lineTo(points[points.length - 1].x, h - p.bottom);
        ctx.lineTo(points[0].x, h - p.bottom);
        ctx.closePath();
        ctx.fillStyle = gradient;
        ctx.fill();

        // Price label
        const lastPrice = slice[slice.length - 1].price;
        const lastY = p.top + chartH - ((lastPrice - minPrice) / (maxPrice - minPrice)) * chartH;
        this._drawPriceLabel(ctx, w - p.right, lastY, lastPrice);

        // Crosshair
        if (this.mouseX > p.left && this.mouseX < w - p.right &&
            this.mouseY > p.top && this.mouseY < h - p.bottom) {
            this._drawCrosshair(ctx, p, chartW, chartH, minPrice, maxPrice);
        }
    }

    // ─── Candle Chart ─────────────────────────────────────────────────────────
    _drawCandleChart(ctx, w, h) {
        if (this.candles.length < 2) return;

        const p = this.padding;
        const chartW = w - p.left - p.right;
        const chartH = h - p.top - p.bottom;
        const range = this._getVisibleRange();
        const slice = this.candles.slice(range.start, range.end);
        if (slice.length < 1) return;

        const { minPrice, maxPrice } = this._getPriceRange(range);

        this._drawGrid(ctx, p, chartW, chartH, minPrice, maxPrice);

        const candleWidth = Math.max(1, Math.min(20, (chartW / slice.length) * 0.7));
        const gap = chartW / slice.length;

        for (let i = 0; i < slice.length; i++) {
            const c = slice[i];
            const x = p.left + (i + 0.5) * gap;
            const isGreen = c.close >= c.open;
            const color = isGreen ? this.colors.candleGreen : this.colors.candleRed;

            const openY  = p.top + chartH - ((c.open - minPrice)  / (maxPrice - minPrice)) * chartH;
            const closeY = p.top + chartH - ((c.close - minPrice) / (maxPrice - minPrice)) * chartH;
            const highY  = p.top + chartH - ((c.high - minPrice)  / (maxPrice - minPrice)) * chartH;
            const lowY   = p.top + chartH - ((c.low - minPrice)   / (maxPrice - minPrice)) * chartH;

            // Wick
            ctx.beginPath();
            ctx.strokeStyle = color;
            ctx.lineWidth = 1;
            ctx.moveTo(x, highY);
            ctx.lineTo(x, lowY);
            ctx.stroke();

            // Body
            const bodyTop = Math.min(openY, closeY);
            const bodyH = Math.max(1, Math.abs(closeY - openY));
            ctx.fillStyle = color;
            ctx.fillRect(x - candleWidth / 2, bodyTop, candleWidth, bodyH);
        }

        // Price label
        const last = slice[slice.length - 1];
        const lastY = p.top + chartH - ((last.close - minPrice) / (maxPrice - minPrice)) * chartH;
        this._drawPriceLabel(ctx, w - p.right, lastY, last.close);

        // Crosshair
        if (this.mouseX > p.left && this.mouseX < w - p.right &&
            this.mouseY > p.top && this.mouseY < h - p.bottom) {
            this._drawCrosshair(ctx, p, chartW, chartH, minPrice, maxPrice);
        }
    }

    // ─── Indicators (overlays on main chart) ──────────────────────────────────
    _drawIndicators(ctx, w, h) {
        const p = this.padding;
        const chartW = w - p.left - p.right;
        const chartH = h - p.top - p.bottom;
        const range = this._getVisibleRange();
        const prices = this._getClosePrices();
        if (prices.length < 5) return;

        const { minPrice, maxPrice } = this._getPriceRange(range);
        const toY = (val) => p.top + chartH - ((val - minPrice) / (maxPrice - minPrice)) * chartH;

        // SMA
        if (this.indicators.sma.enabled) {
            const sma = this._calcSMA(prices, this.indicators.sma.period);
            this._drawOverlayLine(ctx, sma, range, chartW, toY, this.colors.sma, 1.5);
        }

        // EMA
        if (this.indicators.ema.enabled) {
            const ema = this._calcEMA(prices, this.indicators.ema.period);
            this._drawOverlayLine(ctx, ema, range, chartW, toY, this.colors.ema, 1.5);
        }

        // Bollinger Bands
        if (this.indicators.bb.enabled) {
            const bb = this._calcBB(prices, this.indicators.bb.period, this.indicators.bb.stdDev);
            const slice = bb.slice(range.start, range.end);
            if (slice.length > 1) {
                const gap = chartW / slice.length;
                // Fill
                ctx.beginPath();
                for (let i = 0; i < slice.length; i++) {
                    const x = p.left + (i + 0.5) * gap;
                    if (i === 0) ctx.moveTo(x, toY(slice[i].upper));
                    else ctx.lineTo(x, toY(slice[i].upper));
                }
                for (let i = slice.length - 1; i >= 0; i--) {
                    const x = p.left + (i + 0.5) * gap;
                    ctx.lineTo(x, toY(slice[i].lower));
                }
                ctx.closePath();
                ctx.fillStyle = this.colors.bb_fill;
                ctx.fill();

                // Upper & Lower lines
                this._drawOverlayLine(ctx, bb.map(b => b.upper), range, chartW, toY, this.colors.bb_upper, 1);
                this._drawOverlayLine(ctx, bb.map(b => b.lower), range, chartW, toY, this.colors.bb_lower, 1);
                this._drawOverlayLine(ctx, bb.map(b => b.middle), range, chartW, toY, this.colors.sma, 1);
            }
        }
    }

    _drawOverlayLine(ctx, fullData, range, chartW, toY, color, lineWidth) {
        const slice = fullData.slice(range.start, range.end);
        if (slice.length < 2) return;
        const gap = chartW / slice.length;
        const p = this.padding;

        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.lineJoin = 'round';

        let started = false;
        for (let i = 0; i < slice.length; i++) {
            if (slice[i] === null || isNaN(slice[i])) continue;
            const x = p.left + (i + 0.5) * gap;
            const y = toY(slice[i]);
            if (!started) { ctx.moveTo(x, y); started = true; }
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
    }

    // ─── Oscillators (below main chart) ───────────────────────────────────────
    _drawOscillators(ctx, w, totalH, mainH) {
        if (this.oscHeight === 0) return;

        let yOffset = mainH;
        const range = this._getVisibleRange();
        const prices = this._getClosePrices();
        const p = this.padding;
        const chartW = w - p.left - p.right;
        const panelH = 100;

        // Separator line
        ctx.strokeStyle = this.colors.grid;
        ctx.lineWidth = 1;

        if (this.oscillators.rsi.enabled) {
            this._drawOscPanel(ctx, 'RSI', yOffset, panelH, w);
            const rsi = this._calcRSI(prices, this.oscillators.rsi.period);
            this._drawOscLine(ctx, rsi, range, yOffset, panelH, 0, 100, chartW, this.colors.rsi_line);
            // Overbought/oversold zones
            const zoneToY = (val) => yOffset + 10 + (panelH - 20) - ((val) / 100) * (panelH - 20);
            ctx.fillStyle = this.colors.rsi_overbought;
            ctx.fillRect(p.left, zoneToY(100), chartW, zoneToY(70) - zoneToY(100));
            ctx.fillStyle = this.colors.rsi_oversold;
            ctx.fillRect(p.left, zoneToY(30), chartW, zoneToY(0) - zoneToY(30));
            // 70/30 lines
            ctx.setLineDash([3, 3]);
            ctx.strokeStyle = '#475569';
            ctx.beginPath();
            ctx.moveTo(p.left, zoneToY(70)); ctx.lineTo(p.left + chartW, zoneToY(70));
            ctx.moveTo(p.left, zoneToY(30)); ctx.lineTo(p.left + chartW, zoneToY(30));
            ctx.stroke();
            ctx.setLineDash([]);
            yOffset += panelH;
        }

        if (this.oscillators.macd.enabled) {
            this._drawOscPanel(ctx, 'MACD', yOffset, panelH, w);
            const macd = this._calcMACD(prices, this.oscillators.macd.fast, this.oscillators.macd.slow, this.oscillators.macd.signal);
            const slice = macd.slice(range.start, range.end);
            if (slice.length > 1) {
                const vals = slice.filter(m => m !== null);
                if (vals.length > 0) {
                    const allVals = vals.flatMap(m => [m.macd, m.signal, m.histogram]);
                    const min = Math.min(...allVals);
                    const max = Math.max(...allVals);
                    // Histogram bars
                    const gap = chartW / slice.length;
                    const barW = Math.max(1, gap * 0.5);
                    for (let i = 0; i < slice.length; i++) {
                        if (!slice[i]) continue;
                        const x = p.left + (i + 0.5) * gap;
                        const h = slice[i].histogram;
                        const zeroY = yOffset + 10 + (panelH - 20) - ((0 - min) / (max - min || 1)) * (panelH - 20);
                        const barY = yOffset + 10 + (panelH - 20) - ((h - min) / (max - min || 1)) * (panelH - 20);
                        ctx.fillStyle = h >= 0 ? this.colors.macd_hist_pos : this.colors.macd_hist_neg;
                        ctx.fillRect(x - barW / 2, Math.min(zeroY, barY), barW, Math.abs(barY - zeroY));
                    }
                    this._drawOscLine(ctx, macd.map(m => m ? m.macd : null), range, yOffset, panelH, min, max, chartW, this.colors.macd_line);
                    this._drawOscLine(ctx, macd.map(m => m ? m.signal : null), range, yOffset, panelH, min, max, chartW, this.colors.macd_signal);
                }
            }
            yOffset += panelH;
        }

        if (this.oscillators.stochastic.enabled) {
            this._drawOscPanel(ctx, 'Stochastic', yOffset, panelH, w);
            const stoch = this._calcStochastic(this.oscillators.stochastic.kPeriod, this.oscillators.stochastic.dPeriod);
            this._drawOscLine(ctx, stoch.map(s => s ? s.k : null), range, yOffset, panelH, 0, 100, chartW, this.colors.stoch_k);
            this._drawOscLine(ctx, stoch.map(s => s ? s.d : null), range, yOffset, panelH, 0, 100, chartW, this.colors.stoch_d);
            // 80/20 zones
            const zoneToY = (val) => yOffset + 10 + (panelH - 20) - ((val) / 100) * (panelH - 20);
            ctx.setLineDash([3, 3]);
            ctx.strokeStyle = '#475569';
            ctx.beginPath();
            ctx.moveTo(p.left, zoneToY(80)); ctx.lineTo(p.left + chartW, zoneToY(80));
            ctx.moveTo(p.left, zoneToY(20)); ctx.lineTo(p.left + chartW, zoneToY(20));
            ctx.stroke();
            ctx.setLineDash([]);
            yOffset += panelH;
        }
    }

    _drawOscPanel(ctx, label, yOffset, panelH, w) {
        const p = this.padding;
        ctx.strokeStyle = this.colors.grid;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, yOffset);
        ctx.lineTo(w, yOffset);
        ctx.stroke();

        ctx.fillStyle = this.colors.gridText;
        ctx.font = 'bold 10px SF Mono, monospace';
        ctx.textAlign = 'left';
        ctx.fillText(label, p.left + 4, yOffset + 16);
    }

    _drawOscLine(ctx, fullData, range, yOffset, panelH, min, max, chartW, color) {
        const slice = fullData.slice(range.start, range.end);
        if (slice.length < 2) return;
        const p = this.padding;
        const gap = chartW / slice.length;

        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.lineJoin = 'round';

        let started = false;
        for (let i = 0; i < slice.length; i++) {
            if (slice[i] === null || isNaN(slice[i])) continue;
            const x = p.left + (i + 0.5) * gap;
            const y = yOffset + 10 + (panelH - 20) - ((slice[i] - min) / (max - min || 1)) * (panelH - 20);
            if (!started) { ctx.moveTo(x, y); started = true; }
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
    }

    // ─── Drawings ─────────────────────────────────────────────────────────────
    _drawDrawings(ctx, w, h) {
        const p = this.padding;
        const chartW = w - p.left - p.right;
        const chartH = h - p.top - p.bottom;
        const range = this._getVisibleRange();
        const { minPrice, maxPrice } = this._getPriceRange(range);
        const toY = (price) => p.top + chartH - ((price - minPrice) / (maxPrice - minPrice)) * chartH;
        const toX = (index) => p.left + ((index - range.start) / range.count) * chartW;

        ctx.strokeStyle = this.colors.drawing;
        ctx.lineWidth = 1.5;

        // Draw saved drawings
        for (const d of this.drawings) {
            if (d.type === 'hline') {
                const y = toY(d.price);
                ctx.beginPath();
                ctx.setLineDash([6, 4]);
                ctx.moveTo(p.left, y);
                ctx.lineTo(p.left + chartW, y);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.fillStyle = this.colors.drawing;
                ctx.font = '10px SF Mono, monospace';
                ctx.textAlign = 'left';
                ctx.fillText(this._formatPrice(d.price), p.left + chartW + 4, y + 3);
            } else if (d.type === 'trendline') {
                ctx.beginPath();
                ctx.moveTo(toX(d.start.index), toY(d.start.price));
                ctx.lineTo(toX(d.end.index), toY(d.end.price));
                ctx.stroke();
            } else if (d.type === 'fibonacci') {
                const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
                const priceDiff = d.end.price - d.start.price;
                const fibColors = ['#ef4444', '#f59e0b', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#ef4444'];
                levels.forEach((level, idx) => {
                    const price = d.start.price + priceDiff * level;
                    const y = toY(price);
                    ctx.beginPath();
                    ctx.setLineDash([4, 3]);
                    ctx.strokeStyle = fibColors[idx];
                    ctx.moveTo(p.left, y);
                    ctx.lineTo(p.left + chartW, y);
                    ctx.stroke();
                    ctx.setLineDash([]);
                    ctx.fillStyle = fibColors[idx];
                    ctx.font = '10px SF Mono, monospace';
                    ctx.textAlign = 'left';
                    ctx.fillText(`${(level * 100).toFixed(1)}% ${this._formatPrice(price)}`, p.left + chartW + 4, y + 3);
                });
                ctx.strokeStyle = this.colors.drawing;
            }
        }

        // Draw in-progress drawing
        if (this.drawingStart && this.drawingTemp) {
            ctx.beginPath();
            ctx.strokeStyle = this.colors.drawing;
            ctx.setLineDash([4, 4]);
            if (this.drawingMode === 'trendline' || this.drawingMode === 'fibonacci') {
                ctx.moveTo(toX(this.drawingStart.index), toY(this.drawingStart.price));
                ctx.lineTo(this.drawingTemp.x, this.drawingTemp.y);
            }
            ctx.stroke();
            ctx.setLineDash([]);
        }
    }

    // ─── Grid / Labels / Crosshair ────────────────────────────────────────────
    _drawGrid(ctx, p, chartW, chartH, minPrice, maxPrice) {
        const gridLines = 6;
        ctx.strokeStyle = this.colors.grid;
        ctx.lineWidth = 1;
        ctx.font = '11px SF Mono, monospace';
        ctx.fillStyle = this.colors.gridText;
        ctx.textAlign = 'right';

        for (let i = 0; i <= gridLines; i++) {
            const y = p.top + (i / gridLines) * chartH;
            const price = maxPrice - (i / gridLines) * (maxPrice - minPrice);
            ctx.beginPath();
            ctx.setLineDash([2, 4]);
            ctx.moveTo(p.left, y);
            ctx.lineTo(p.left + chartW, y);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillText(this._formatPrice(price), p.left + chartW + 68, y + 4);
        }
    }

    _drawPriceLabel(ctx, x, y, price) {
        const text = this._formatPrice(price);
        const textWidth = ctx.measureText(text).width + 12;

        ctx.beginPath();
        ctx.strokeStyle = this.colors.priceLabelBg;
        ctx.setLineDash([3, 3]);
        ctx.lineWidth = 1;
        ctx.moveTo(this.padding.left, y);
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = this.colors.priceLabelBg;
        ctx.fillRect(x, y - 11, textWidth + 4, 22);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 11px SF Mono, monospace';
        ctx.textAlign = 'left';
        ctx.fillText(text, x + 6, y + 4);
    }

    _drawCrosshair(ctx, p, chartW, chartH, minPrice, maxPrice) {
        ctx.beginPath();
        ctx.strokeStyle = this.colors.crosshair;
        ctx.setLineDash([3, 3]);
        ctx.lineWidth = 0.5;
        ctx.moveTo(this.mouseX, p.top);
        ctx.lineTo(this.mouseX, p.top + chartH);
        ctx.moveTo(p.left, this.mouseY);
        ctx.lineTo(p.left + chartW, this.mouseY);
        ctx.stroke();
        ctx.setLineDash([]);

        const hoverPrice = maxPrice - ((this.mouseY - p.top) / chartH) * (maxPrice - minPrice);
        ctx.fillStyle = '#334155';
        ctx.fillRect(p.left + chartW, this.mouseY - 10, 80, 20);
        ctx.fillStyle = this.colors.priceLabel;
        ctx.font = '10px SF Mono, monospace';
        ctx.textAlign = 'left';
        ctx.fillText(this._formatPrice(hoverPrice), p.left + chartW + 6, this.mouseY + 3);
    }

    // ─── Calculation Helpers ──────────────────────────────────────────────────
    _getClosePrices() {
        if (this.chartType === 'line') return this.data.map(d => d.price);
        return this.candles.map(c => c.close);
    }

    _calcSMA(prices, period) {
        const result = new Array(prices.length).fill(null);
        for (let i = period - 1; i < prices.length; i++) {
            let sum = 0;
            for (let j = 0; j < period; j++) sum += prices[i - j];
            result[i] = sum / period;
        }
        return result;
    }

    _calcEMA(prices, period) {
        const result = new Array(prices.length).fill(null);
        const k = 2 / (period + 1);
        let sum = 0;
        for (let i = 0; i < period && i < prices.length; i++) sum += prices[i];
        result[period - 1] = sum / period;
        for (let i = period; i < prices.length; i++) {
            result[i] = prices[i] * k + result[i - 1] * (1 - k);
        }
        return result;
    }

    _calcBB(prices, period, stdDev) {
        const sma = this._calcSMA(prices, period);
        return prices.map((_, i) => {
            if (sma[i] === null) return { upper: null, middle: null, lower: null };
            let variance = 0;
            for (let j = 0; j < period && (i - j) >= 0; j++) {
                variance += Math.pow(prices[i - j] - sma[i], 2);
            }
            const std = Math.sqrt(variance / period);
            return {
                upper: sma[i] + stdDev * std,
                middle: sma[i],
                lower: sma[i] - stdDev * std,
            };
        });
    }

    _calcRSI(prices, period) {
        const result = new Array(prices.length).fill(null);
        if (prices.length < period + 1) return result;

        let gainSum = 0, lossSum = 0;
        for (let i = 1; i <= period; i++) {
            const diff = prices[i] - prices[i - 1];
            if (diff > 0) gainSum += diff;
            else lossSum -= diff;
        }
        let avgGain = gainSum / period;
        let avgLoss = lossSum / period;
        result[period] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));

        for (let i = period + 1; i < prices.length; i++) {
            const diff = prices[i] - prices[i - 1];
            const gain = diff > 0 ? diff : 0;
            const loss = diff < 0 ? -diff : 0;
            avgGain = (avgGain * (period - 1) + gain) / period;
            avgLoss = (avgLoss * (period - 1) + loss) / period;
            result[i] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
        }
        return result;
    }

    _calcMACD(prices, fast, slow, signal) {
        const emaFast = this._calcEMA(prices, fast);
        const emaSlow = this._calcEMA(prices, slow);
        const macdLine = prices.map((_, i) =>
            (emaFast[i] !== null && emaSlow[i] !== null) ? emaFast[i] - emaSlow[i] : null
        );

        // Signal line (EMA of MACD)
        const validMacd = macdLine.filter(v => v !== null);
        const sigEMA = this._calcEMA(validMacd, signal);
        let sigIdx = 0;
        const signalLine = macdLine.map(v => {
            if (v === null) return null;
            return sigEMA[sigIdx++] || null;
        });

        return prices.map((_, i) => {
            if (macdLine[i] === null || signalLine[i] === null) return null;
            return {
                macd: macdLine[i],
                signal: signalLine[i],
                histogram: macdLine[i] - signalLine[i],
            };
        });
    }

    _calcStochastic(kPeriod, dPeriod) {
        if (this.chartType === 'line') {
            // Use tick prices as pseudo-OHLC
            const prices = this.data.map(d => d.price);
            const result = new Array(prices.length).fill(null);
            for (let i = kPeriod - 1; i < prices.length; i++) {
                const slice = prices.slice(i - kPeriod + 1, i + 1);
                const high = Math.max(...slice);
                const low = Math.min(...slice);
                const k = high === low ? 50 : ((prices[i] - low) / (high - low)) * 100;
                result[i] = { k, d: null };
            }
            // D line
            for (let i = kPeriod - 1 + dPeriod - 1; i < result.length; i++) {
                let sum = 0;
                for (let j = 0; j < dPeriod; j++) sum += (result[i - j]?.k || 0);
                if (result[i]) result[i].d = sum / dPeriod;
            }
            return result;
        }

        const result = new Array(this.candles.length).fill(null);
        for (let i = kPeriod - 1; i < this.candles.length; i++) {
            const slice = this.candles.slice(i - kPeriod + 1, i + 1);
            const high = Math.max(...slice.map(c => c.high));
            const low = Math.min(...slice.map(c => c.low));
            const k = high === low ? 50 : ((this.candles[i].close - low) / (high - low)) * 100;
            result[i] = { k, d: null };
        }
        for (let i = kPeriod - 1 + dPeriod - 1; i < result.length; i++) {
            let sum = 0;
            for (let j = 0; j < dPeriod; j++) sum += (result[i - j]?.k || 0);
            if (result[i]) result[i].d = sum / dPeriod;
        }
        return result;
    }

    _formatPrice(price) {
        if (price >= 1000) return price.toFixed(2);
        if (price >= 1) return price.toFixed(4);
        return price.toFixed(6);
    }
}
