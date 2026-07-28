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

  // Normaliza lo que el usuario tipea en un input de cantidad/precio para
  // que siempre quede en formato apto para parseFloat, aceptando coma o
  // punto como separador decimal (la convención es-AR usa coma, pero
  // <input type="number"> del HTML solo acepta punto sin importar la
  // locale del navegador — por eso estos inputs son type="text" y pasan
  // por acá en cada onChange). Descarta cualquier carácter que no sea
  // dígito o separador, y colapsa separadores de más después del primero.
  const normalizeDecimalInput = raw => {
    if (!raw) return '';
    let v = raw.replace(',', '.').replace(/[^0-9.]/g, '');
    const firstDot = v.indexOf('.');
    if (firstDot !== -1) {
      v = v.slice(0, firstDot + 1) + v.slice(firstDot + 1).replace(/\./g, '');
    }
    return v;
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

  // Deriva la posición actual (cantidad y precio de compra promedio) de un
  // holding a partir de su historial de transacciones, usando costo
  // promedio ponderado: una venta reduce las unidades al costo promedio
  // vigente sin cambiar el costo promedio de lo que queda (no es FIFO/LIFO).
  const deriveHoldingPosition = transactions => {
    if (!transactions || transactions.length === 0) return { amount: 0, buyPrice: 0 };
    // Camino rápido: una sola compra reproduce sus valores exactos, sin
    // aritmética de por medio. Es la garantía de round-trip que necesita
    // la migración de holdings v2 (amount/buyPrice planos) a v3.
    if (transactions.length === 1 && transactions[0].type === 'buy') {
      return { amount: transactions[0].amount, buyPrice: transactions[0].price };
    }
    const sorted = [...transactions].sort((a, b) => {
      const dateDiff = new Date(a.date) - new Date(b.date);
      if (dateDiff !== 0) return dateDiff;
      return String(a.id).localeCompare(String(b.id));
    });
    let amount = 0;
    let totalCost = 0;
    sorted.forEach(tx => {
      if (tx.type === 'buy') {
        totalCost += tx.amount * tx.price;
        amount += tx.amount;
      } else {
        const avgCost = amount > 0 ? totalCost / amount : 0;
        totalCost -= avgCost * tx.amount;
        amount -= tx.amount;
      }
    });
    // No clampeamos amount/totalCost negativos acá: la prevención de
    // sobreventa vive en la UI (TransactionsModal), no en esta función pura.
    const buyPrice = amount > 0 ? totalCost / amount : 0;
    return { amount, buyPrice };
  };

  // Suma la ganancia/pérdida ya realizada (de las ventas) de un holding,
  // usando el mismo costo promedio ponderado que deriveHoldingPosition:
  // cada venta se valúa contra el costo promedio vigente en ese momento
  // de la secuencia cronológica, no contra el costo promedio final.
  const computeRealizedGain = transactions => {
    if (!transactions || transactions.length === 0) return 0;
    const sorted = [...transactions].sort((a, b) => {
      const dateDiff = new Date(a.date) - new Date(b.date);
      if (dateDiff !== 0) return dateDiff;
      return String(a.id).localeCompare(String(b.id));
    });
    let amount = 0;
    let totalCost = 0;
    let realizedGain = 0;
    sorted.forEach(tx => {
      if (tx.type === 'buy') {
        totalCost += tx.amount * tx.price;
        amount += tx.amount;
      } else {
        const avgCost = amount > 0 ? totalCost / amount : 0;
        realizedGain += (tx.price - avgCost) * tx.amount;
        totalCost -= avgCost * tx.amount;
        amount -= tx.amount;
      }
    });
    return realizedGain;
  };

  // Migra holdings v2 (amount/buyPrice planos) a v3 (transactions[]),
  // envolviendo cada holding válido en una única transacción "buy"
  // sintética. Transforma solo el array en memoria — no toca localStorage
  // (ver migrateHoldingsIfNeeded en index.html para eso).
  const migrateHoldingsV2ToV3 = v2Holdings => {
    if (!Array.isArray(v2Holdings)) return [];
    return v2Holdings.map(h => {
      const amount = Number(h?.amount);
      const buyPrice = Number(h?.buyPrice);
      const { amount: _amount, buyPrice: _buyPrice, ...rest } = h || {};
      const isValid = Number.isFinite(amount) && amount > 0 && Number.isFinite(buyPrice) && buyPrice >= 0;
      return {
        ...rest,
        transactions: isValid ? [{
          id: `${h.id || 'legacy'}-migrated-buy`,
          type: 'buy',
          amount,
          price: buyPrice,
          date: h.addedAt || new Date(0).toISOString()
        }] : []
      };
    });
  };

  // Evalúa alertas de precio contra los precios actuales. Semántica de
  // histéresis con rearme automático: una alerta armada (active:true) que
  // cruza el umbral se dispara (pasa a active:false, entra en firedAlerts).
  // Mientras siga cruzada no vuelve a dispararse. Recién cuando el precio
  // cruza de vuelta al lado no disparado, la alerta rearma (active:true,
  // sin tocar triggeredAt) y puede dispararse de nuevo en un futuro cruce.
  // No muta ni `alerts` ni sus objetos.
  const checkAlertTriggers = (alerts, prices, now = Date.now()) => {
    const firedAlerts = [];
    const nextAlerts = alerts.map(alert => {
      if (!alert.enabled) return alert;
      const priceEntry = prices[`${alert.source}:${alert.sourceId}`];
      const currentPrice = priceEntry?.usd;
      if (currentPrice === undefined || currentPrice === null) return alert;
      const isPastThreshold = alert.direction === 'above'
        ? currentPrice >= alert.threshold
        : currentPrice <= alert.threshold;
      if (alert.active && isPastThreshold) {
        const fired = { ...alert, active: false, triggeredAt: new Date(now).toISOString() };
        firedAlerts.push(fired);
        return fired;
      }
      if (!alert.active && !isPastThreshold) {
        return { ...alert, active: true };
      }
      return alert;
    });
    return { alerts: nextAlerts, firedAlerts };
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
    normalizeDecimalInput,
    computeHoldingMetrics,
    computePortfolioTotals,
    isStale,
    mergePriceCache,
    deriveHoldingPosition,
    computeRealizedGain,
    migrateHoldingsV2ToV3,
    checkAlertTriggers
  };
});
