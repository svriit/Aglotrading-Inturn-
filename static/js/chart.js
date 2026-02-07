/* ═══════════════════════════════════════════════════════════════════════════
   Aglo Trading - Chart Engine
   Custom canvas-based chart for real-time tick and candle visualization.
   ═══════════════════════════════════════════════════════════════════════════ */

class TradingChart {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');

        this.data = [];
        this.candles = [];
        this.chartType = 'line'; // 'line' or 'candle'
        this.maxDataPoints = 200;

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
        };

        // Chart padding
        this.padding = { top: 20, right: 70, bottom: 30, left: 10 };

        // Mouse
        this.mouseX = -1;
        this.mouseY = -1;

        this._setupCanvas();
        this._attachEvents();
        this._animate();
    }

    _setupCanvas() {
        const resize = () => {
            const rect = this.canvas.parentElement.getBoundingClientRect();
            const dpr = window.devicePixelRatio || 1;
            this.canvas.width = rect.width * dpr;
            this.canvas.height = rect.height * dpr;
            this.canvas.style.width = rect.width + 'px';
            this.canvas.style.height = rect.height + 'px';
            this.ctx.scale(dpr, dpr);
            this.width = rect.width;
            this.height = rect.height;
        };
        resize();
        window.addEventListener('resize', resize);
    }

    _attachEvents() {
        this.canvas.addEventListener('mousemove', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            this.mouseX = e.clientX - rect.left;
            this.mouseY = e.clientY - rect.top;
        });
        this.canvas.addEventListener('mouseleave', () => {
            this.mouseX = -1;
            this.mouseY = -1;
        });
    }

    addTick(price, epoch) {
        this.data.push({ price, epoch, time: new Date(epoch * 1000) });
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

        // Update last candle if same epoch, otherwise add new
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
    }

    setType(type) {
        this.chartType = type;
    }

    _animate() {
        this._draw();
        requestAnimationFrame(() => this._animate());
    }

    _draw() {
        const ctx = this.ctx;
        const w = this.width;
        const h = this.height;

        // Clear
        ctx.fillStyle = this.colors.bg;
        ctx.fillRect(0, 0, w, h);

        if (this.chartType === 'line') {
            this._drawLineChart(ctx, w, h);
        } else {
            this._drawCandleChart(ctx, w, h);
        }
    }

    _drawLineChart(ctx, w, h) {
        if (this.data.length < 2) return;

        const p = this.padding;
        const chartW = w - p.left - p.right;
        const chartH = h - p.top - p.bottom;

        const prices = this.data.map(d => d.price);
        let minPrice = Math.min(...prices);
        let maxPrice = Math.max(...prices);
        const priceRange = maxPrice - minPrice || 1;
        const pricePadding = priceRange * 0.1;
        minPrice -= pricePadding;
        maxPrice += pricePadding;

        // Grid
        this._drawGrid(ctx, p, chartW, chartH, minPrice, maxPrice);

        // Line path
        ctx.beginPath();
        ctx.strokeStyle = this.colors.line;
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';

        const points = [];
        for (let i = 0; i < this.data.length; i++) {
            const x = p.left + (i / (this.data.length - 1)) * chartW;
            const y = p.top + chartH - ((this.data[i].price - minPrice) / (maxPrice - minPrice)) * chartH;
            points.push({ x, y });
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // Gradient fill
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

        // Current price label
        const lastPrice = prices[prices.length - 1];
        const lastY = p.top + chartH - ((lastPrice - minPrice) / (maxPrice - minPrice)) * chartH;
        this._drawPriceLabel(ctx, w - p.right, lastY, lastPrice, w);

        // Crosshair
        if (this.mouseX > p.left && this.mouseX < w - p.right &&
            this.mouseY > p.top && this.mouseY < h - p.bottom) {
            this._drawCrosshair(ctx, p, chartW, chartH, minPrice, maxPrice);
        }
    }

    _drawCandleChart(ctx, w, h) {
        if (this.candles.length < 2) return;

        const p = this.padding;
        const chartW = w - p.left - p.right;
        const chartH = h - p.top - p.bottom;

        const highs = this.candles.map(c => c.high);
        const lows = this.candles.map(c => c.low);
        let minPrice = Math.min(...lows);
        let maxPrice = Math.max(...highs);
        const priceRange = maxPrice - minPrice || 1;
        const pricePadding = priceRange * 0.1;
        minPrice -= pricePadding;
        maxPrice += pricePadding;

        // Grid
        this._drawGrid(ctx, p, chartW, chartH, minPrice, maxPrice);

        // Draw candles
        const candleWidth = Math.max(2, (chartW / this.candles.length) * 0.7);
        const gap = chartW / this.candles.length;

        for (let i = 0; i < this.candles.length; i++) {
            const c = this.candles[i];
            const x = p.left + (i + 0.5) * gap;
            const isGreen = c.close >= c.open;

            const openY = p.top + chartH - ((c.open - minPrice) / (maxPrice - minPrice)) * chartH;
            const closeY = p.top + chartH - ((c.close - minPrice) / (maxPrice - minPrice)) * chartH;
            const highY = p.top + chartH - ((c.high - minPrice) / (maxPrice - minPrice)) * chartH;
            const lowY = p.top + chartH - ((c.low - minPrice) / (maxPrice - minPrice)) * chartH;

            const color = isGreen ? this.colors.candleGreen : this.colors.candleRed;

            // Wick
            ctx.beginPath();
            ctx.strokeStyle = color;
            ctx.lineWidth = 1;
            ctx.moveTo(x, highY);
            ctx.lineTo(x, lowY);
            ctx.stroke();

            // Body
            const bodyTop = Math.min(openY, closeY);
            const bodyHeight = Math.max(1, Math.abs(closeY - openY));

            ctx.fillStyle = color;
            ctx.fillRect(x - candleWidth / 2, bodyTop, candleWidth, bodyHeight);
        }

        // Current price label
        const lastCandle = this.candles[this.candles.length - 1];
        const lastY = p.top + chartH - ((lastCandle.close - minPrice) / (maxPrice - minPrice)) * chartH;
        this._drawPriceLabel(ctx, w - p.right, lastY, lastCandle.close, w);

        // Crosshair
        if (this.mouseX > p.left && this.mouseX < w - p.right &&
            this.mouseY > p.top && this.mouseY < h - p.bottom) {
            this._drawCrosshair(ctx, p, chartW, chartH, minPrice, maxPrice);
        }
    }

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

            ctx.fillText(this._formatPrice(price), p.left + chartW + 60, y + 4);
        }
    }

    _drawPriceLabel(ctx, x, y, price, totalW) {
        const text = this._formatPrice(price);
        const textWidth = ctx.measureText(text).width + 12;

        // Line across
        ctx.beginPath();
        ctx.strokeStyle = this.colors.priceLabelBg;
        ctx.setLineDash([3, 3]);
        ctx.lineWidth = 1;
        ctx.moveTo(this.padding.left, y);
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.setLineDash([]);

        // Label box
        ctx.fillStyle = this.colors.priceLabelBg;
        const labelH = 22;
        ctx.fillRect(x, y - labelH / 2, textWidth + 4, labelH);

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

        // Vertical
        ctx.moveTo(this.mouseX, p.top);
        ctx.lineTo(this.mouseX, p.top + chartH);
        // Horizontal
        ctx.moveTo(p.left, this.mouseY);
        ctx.lineTo(p.left + chartW, this.mouseY);
        ctx.stroke();
        ctx.setLineDash([]);

        // Price at cursor
        const hoverPrice = maxPrice - ((this.mouseY - p.top) / chartH) * (maxPrice - minPrice);
        ctx.fillStyle = '#334155';
        ctx.fillRect(p.left + chartW, this.mouseY - 10, 70, 20);
        ctx.fillStyle = this.colors.priceLabel;
        ctx.font = '10px SF Mono, monospace';
        ctx.textAlign = 'left';
        ctx.fillText(this._formatPrice(hoverPrice), p.left + chartW + 6, this.mouseY + 3);
    }

    _formatPrice(price) {
        if (price >= 1000) return price.toFixed(2);
        if (price >= 1) return price.toFixed(4);
        return price.toFixed(6);
    }
}
