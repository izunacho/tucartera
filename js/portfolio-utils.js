// Lógica pura de formateo y cálculo del portafolio, extraída de index.html
// para poder testearla con Vitest sin depender de React ni del DOM.
// Se carga como <script> clásico en index.html (expone window.PortfolioUtils)
// y como módulo CommonJS en los tests (require('./portfolio-utils.js')).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PortfolioUtils = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  // Tiempo máximo que un precio se considera "fresco" antes de mostrarse
  // como desactualizado en la UI.
  const DEFAULT_STALE_MS = 5 * 60 * 1000; // 5 minutos

  const formatCurrency = n => {
    if (n === null || n === undefined || isNaN(n)) return '$0.00';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(n);
  };

  const formatNumber = (n, decimals = 4) => {
    if (n === 0 || !n) return '0';
    if (Math.abs(n) < 0.000001) return n.toExponential(2);
    if (Math.abs(n) < 0.01) return n.toFixed(8);
    if (Math.abs(n) < 1) return n.toFixed(6);
    return n.toLocaleString('en-US', {
      maximumFractionDigits: decimals
    });
  };

  // ¿Un precio cacheado en fetchedAt (timestamp ms) ya está viejo?
  const isStale = (fetchedAt, now = Date.now(), maxAgeMs = DEFAULT_STALE_MS) => {
    if (!fetchedAt) return true;
    return now - fetchedAt > maxAgeMs;
  };

  // Mezcla precios cacheados con precios recién obtenidos: lo nuevo pisa lo
  // viejo (y queda con fetchedAt = now), lo que no vino en `fresh` se
  // conserva tal cual (para no dejar la UI en blanco si una fuente falla).
  const mergePriceCache = (cached, fresh, now = Date.now()) => {
    const merged = { ...cached };
    Object.entries(fresh).forEach(([key, value]) => {
      merged[key] = { ...value, fetchedAt: now };
    });
    return merged;
  };

  // Calcula precio actual, cambio 24h, valor, ganancia/pérdida y si el
  // precio mostrado está desactualizado, para un holding.
  const computeHoldingMetrics = (holding, prices, now = Date.now()) => {
    const key = `${holding.source}:${holding.sourceId}`;
    const p = prices[key];
    const currentPrice = p?.usd || 0;
    const change24h = p?.usd_24h_change || 0;
    const currentValue = currentPrice * holding.amount;
    const investedValue = holding.buyPrice * holding.amount;
    const profit = currentValue - investedValue;
    const profitPct = investedValue > 0 ? profit / investedValue * 100 : 0;
    const fetchedAt = p?.fetchedAt || null;
    const stale = !p || isStale(fetchedAt, now);
    return { currentPrice, change24h, currentValue, investedValue, profit, profitPct, fetchedAt, stale };
  };

  // Agrega totales del portafolio a partir de holdings ya enriquecidos con computeHoldingMetrics.
  const computePortfolioTotals = enriched => {
    const totalValue = enriched.reduce((s, h) => s + h.currentValue, 0);
    const totalInvested = enriched.reduce((s, h) => s + h.investedValue, 0);
    const totalProfit = totalValue - totalInvested;
    const totalProfitPct = totalInvested > 0 ? totalProfit / totalInvested * 100 : 0;
    const weighted24h = totalValue > 0 ? enriched.reduce((s, h) => s + h.change24h * h.currentValue, 0) / totalValue : 0;
    return { totalValue, totalInvested, totalProfit, totalProfitPct, weighted24h };
  };

  return {
    formatCurrency,
    formatNumber,
    computeHoldingMetrics,
    computePortfolioTotals,
    isStale,
    mergePriceCache
  };
});
