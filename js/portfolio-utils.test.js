import { describe, it, expect } from 'vitest';
import PortfolioUtils from './portfolio-utils.js';

const { formatCurrency, formatNumber, computeHoldingMetrics, computePortfolioTotals, isStale, mergePriceCache, deriveHoldingPosition, migrateHoldingsV2ToV3, checkAlertTriggers } = PortfolioUtils;

describe('formatCurrency', () => {
  it('formatea valores positivos con 2 decimales', () => {
    expect(formatCurrency(1234.5)).toBe('$1,234.50');
  });

  it('formatea valores negativos', () => {
    expect(formatCurrency(-50)).toBe('-$50.00');
  });

  it('devuelve $0.00 para null, undefined y NaN', () => {
    expect(formatCurrency(null)).toBe('$0.00');
    expect(formatCurrency(undefined)).toBe('$0.00');
    expect(formatCurrency(NaN)).toBe('$0.00');
  });

  it('formatea cero', () => {
    expect(formatCurrency(0)).toBe('$0.00');
  });
});

describe('formatNumber', () => {
  it('devuelve "0" para cero o valores falsy', () => {
    expect(formatNumber(0)).toBe('0');
  });

  it('usa notación exponencial para valores muy chicos', () => {
    expect(formatNumber(0.0000001)).toBe('1.00e-7');
  });

  it('usa 8 decimales para valores menores a 0.01', () => {
    expect(formatNumber(0.005)).toBe('0.00500000');
  });

  it('usa 6 decimales para valores menores a 1', () => {
    expect(formatNumber(0.5)).toBe('0.500000');
  });

  it('usa el parámetro decimals para valores normales', () => {
    expect(formatNumber(1234.5678, 2)).toBe('1,234.57');
  });

  it('respeta el default de 4 decimales', () => {
    expect(formatNumber(1234.56789)).toBe('1,234.5679');
  });
});

describe('computeHoldingMetrics', () => {
  const holding = { source: 'coingecko', sourceId: 'bitcoin', amount: 2, buyPrice: 100 };
  const now = 1_700_000_000_000;

  it('calcula precio, valor y ganancia cuando hay precio disponible', () => {
    const prices = { 'coingecko:bitcoin': { usd: 150, usd_24h_change: 5, fetchedAt: now } };
    const m = computeHoldingMetrics(holding, prices, now);
    expect(m.currentPrice).toBe(150);
    expect(m.change24h).toBe(5);
    expect(m.currentValue).toBe(300);
    expect(m.investedValue).toBe(200);
    expect(m.profit).toBe(100);
    expect(m.profitPct).toBe(50);
    expect(m.stale).toBe(false);
  });

  it('usa 0 como precio actual y marca stale cuando falta en el mapa de precios', () => {
    const m = computeHoldingMetrics(holding, {}, now);
    expect(m.currentPrice).toBe(0);
    expect(m.change24h).toBe(0);
    expect(m.currentValue).toBe(0);
    expect(m.stale).toBe(true);
    expect(m.fetchedAt).toBe(null);
  });

  it('marca stale cuando el precio cacheado es viejo', () => {
    const oldFetchedAt = now - 10 * 60 * 1000; // 10 minutos atrás
    const prices = { 'coingecko:bitcoin': { usd: 150, fetchedAt: oldFetchedAt } };
    const m = computeHoldingMetrics(holding, prices, now);
    expect(m.stale).toBe(true);
  });

  it('evita división por cero cuando investedValue es 0', () => {
    const freeHolding = { source: 'coingecko', sourceId: 'bitcoin', amount: 2, buyPrice: 0 };
    const prices = { 'coingecko:bitcoin': { usd: 150, fetchedAt: now } };
    const m = computeHoldingMetrics(freeHolding, prices, now);
    expect(m.investedValue).toBe(0);
    expect(m.profitPct).toBe(0);
  });
});

describe('isStale', () => {
  const now = 1_700_000_000_000;

  it('es true cuando no hay fetchedAt', () => {
    expect(isStale(null, now)).toBe(true);
    expect(isStale(undefined, now)).toBe(true);
  });

  it('es false justo dentro del umbral por defecto (5 min)', () => {
    expect(isStale(now - 4 * 60 * 1000, now)).toBe(false);
  });

  it('es true pasado el umbral por defecto', () => {
    expect(isStale(now - 6 * 60 * 1000, now)).toBe(true);
  });

  it('respeta un maxAgeMs custom', () => {
    expect(isStale(now - 1000, now, 500)).toBe(true);
    expect(isStale(now - 1000, now, 2000)).toBe(false);
  });
});

describe('mergePriceCache', () => {
  const now = 1_700_000_000_000;

  it('agrega fetchedAt = now a las entradas nuevas', () => {
    const merged = mergePriceCache({}, { 'coingecko:bitcoin': { usd: 100 } }, now);
    expect(merged['coingecko:bitcoin']).toEqual({ usd: 100, fetchedAt: now });
  });

  it('conserva entradas cacheadas que no vinieron en fresh', () => {
    const cached = { 'yahoo:AAPL': { usd: 200, fetchedAt: now - 1000 } };
    const merged = mergePriceCache(cached, { 'coingecko:bitcoin': { usd: 100 } }, now);
    expect(merged['yahoo:AAPL']).toEqual({ usd: 200, fetchedAt: now - 1000 });
    expect(merged['coingecko:bitcoin']).toEqual({ usd: 100, fetchedAt: now });
  });

  it('las entradas frescas pisan a las cacheadas con el mismo key', () => {
    const cached = { 'coingecko:bitcoin': { usd: 90, fetchedAt: now - 5000 } };
    const merged = mergePriceCache(cached, { 'coingecko:bitcoin': { usd: 100 } }, now);
    expect(merged['coingecko:bitcoin']).toEqual({ usd: 100, fetchedAt: now });
  });
});

describe('computePortfolioTotals', () => {
  it('devuelve todo en 0 para un portafolio vacío', () => {
    const t = computePortfolioTotals([]);
    expect(t).toEqual({
      totalValue: 0,
      totalInvested: 0,
      totalProfit: 0,
      totalProfitPct: 0,
      weighted24h: 0
    });
  });

  it('suma valores y calcula el cambio 24h ponderado por valor actual', () => {
    const enriched = [
      { currentValue: 300, investedValue: 200, change24h: 10 },
      { currentValue: 100, investedValue: 100, change24h: -20 }
    ];
    const t = computePortfolioTotals(enriched);
    expect(t.totalValue).toBe(400);
    expect(t.totalInvested).toBe(300);
    expect(t.totalProfit).toBe(100);
    expect(t.totalProfitPct).toBeCloseTo(33.333, 2);
    // (300*10 + 100*-20) / 400 = (3000 - 2000) / 400 = 2.5
    expect(t.weighted24h).toBe(2.5);
  });

  it('evita división por cero cuando totalValue es 0', () => {
    const enriched = [{ currentValue: 0, investedValue: 0, change24h: 5 }];
    const t = computePortfolioTotals(enriched);
    expect(t.weighted24h).toBe(0);
    expect(t.totalProfitPct).toBe(0);
  });
});

describe('deriveHoldingPosition', () => {
  it('devuelve amount y buyPrice en 0 para una lista vacía', () => {
    expect(deriveHoldingPosition([])).toEqual({ amount: 0, buyPrice: 0 });
  });

  it('devuelve amount y buyPrice en 0 para undefined/null', () => {
    expect(deriveHoldingPosition(undefined)).toEqual({ amount: 0, buyPrice: 0 });
    expect(deriveHoldingPosition(null)).toEqual({ amount: 0, buyPrice: 0 });
  });

  it('una sola compra reproduce sus valores exactos (camino rápido)', () => {
    const tx = [{ id: 't1', type: 'buy', amount: 0.1, price: 33333.333, date: '2026-01-01T00:00:00.000Z' }];
    expect(deriveHoldingPosition(tx)).toEqual({ amount: 0.1, buyPrice: 33333.333 });
  });

  it('promedia ponderado dos compras a distinto precio', () => {
    const tx = [
      { id: 't1', type: 'buy', amount: 2, price: 100, date: '2026-01-01' },
      { id: 't2', type: 'buy', amount: 2, price: 200, date: '2026-01-02' }
    ];
    expect(deriveHoldingPosition(tx)).toEqual({ amount: 4, buyPrice: 150 });
  });

  it('una venta parcial no cambia el costo promedio de lo que queda', () => {
    const tx = [
      { id: 't1', type: 'buy', amount: 2, price: 100, date: '2026-01-01' },
      { id: 't2', type: 'sell', amount: 1, price: 500, date: '2026-01-02' }
    ];
    expect(deriveHoldingPosition(tx)).toEqual({ amount: 1, buyPrice: 100 });
  });

  it('usa el promedio corriente (no FIFO) al vender tras dos compras', () => {
    const tx = [
      { id: 't1', type: 'buy', amount: 1, price: 100, date: '2026-01-01' },
      { id: 't2', type: 'buy', amount: 1, price: 300, date: '2026-01-02' },
      { id: 't3', type: 'sell', amount: 1, price: 999, date: '2026-01-03' }
    ];
    // Promedio antes de vender: (100+300)/2 = 200. Vender 1 a costo 200 dej
    // 1 unidad con costo total 200, buyPrice = 200 (no 100 como sería FIFO).
    expect(deriveHoldingPosition(tx)).toEqual({ amount: 1, buyPrice: 200 });
  });

  it('vender todo deja amount en 0 sin NaN', () => {
    const tx = [
      { id: 't1', type: 'buy', amount: 2, price: 100, date: '2026-01-01' },
      { id: 't2', type: 'sell', amount: 2, price: 150, date: '2026-01-02' }
    ];
    const pos = deriveHoldingPosition(tx);
    expect(pos.amount).toBe(0);
    expect(pos.buyPrice).toBe(0);
    expect(Number.isNaN(pos.buyPrice)).toBe(false);
  });

  it('el orden de entrada no importa, se ordena por fecha internamente', () => {
    const chronological = [
      { id: 't1', type: 'buy', amount: 1, price: 100, date: '2026-01-01' },
      { id: 't2', type: 'buy', amount: 1, price: 300, date: '2026-01-02' },
      { id: 't3', type: 'sell', amount: 1, price: 999, date: '2026-01-03' }
    ];
    const shuffled = [chronological[2], chronological[0], chronological[1]];
    expect(deriveHoldingPosition(shuffled)).toEqual(deriveHoldingPosition(chronological));
  });

  it('compone limpio con computeHoldingMetrics cuando no hay transacciones (investedValue 0)', () => {
    const { amount, buyPrice } = deriveHoldingPosition([]);
    const holding = { source: 'coingecko', sourceId: 'bitcoin', amount, buyPrice };
    const m = computeHoldingMetrics(holding, {});
    expect(m.investedValue).toBe(0);
    expect(m.profitPct).toBe(0);
    expect(m.currentValue).toBe(0);
  });
});

describe('migrateHoldingsV2ToV3', () => {
  it('devuelve [] para un array vacío', () => {
    expect(migrateHoldingsV2ToV3([])).toEqual([]);
  });

  it('devuelve [] para entradas que no son array', () => {
    expect(migrateHoldingsV2ToV3(null)).toEqual([]);
    expect(migrateHoldingsV2ToV3(undefined)).toEqual([]);
    expect(migrateHoldingsV2ToV3({})).toEqual([]);
  });

  it('migra un holding válido a una única transacción buy', () => {
    const v2 = [{ id: 'h1', source: 'coingecko', sourceId: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', assetType: 'crypto', amount: 0.5, buyPrice: 30000, addedAt: '2026-01-01T00:00:00.000Z' }];
    const v3 = migrateHoldingsV2ToV3(v2);
    expect(v3).toHaveLength(1);
    expect(v3[0].transactions).toEqual([{ id: 'h1-migrated-buy', type: 'buy', amount: 0.5, price: 30000, date: '2026-01-01T00:00:00.000Z' }]);
    expect(v3[0]).not.toHaveProperty('amount');
    expect(v3[0]).not.toHaveProperty('buyPrice');
    expect(v3[0].symbol).toBe('BTC');
  });

  it('usa una fecha por defecto definida si falta addedAt', () => {
    const v2 = [{ id: 'h1', amount: 1, buyPrice: 10 }];
    const v3 = migrateHoldingsV2ToV3(v2);
    expect(v3[0].transactions[0].date).toBeDefined();
    expect(Number.isNaN(new Date(v3[0].transactions[0].date).getTime())).toBe(false);
  });

  it('un holding con amount inválido sobrevive con transactions vacío', () => {
    const v2 = [
      { id: 'h1', symbol: 'BTC', amount: 0, buyPrice: 100 },
      { id: 'h2', symbol: 'ETH', amount: -1, buyPrice: 100 },
      { id: 'h3', symbol: 'SOL', amount: 'no-numero', buyPrice: 100 },
      { id: 'h4', symbol: 'ADA' }
    ];
    const v3 = migrateHoldingsV2ToV3(v2);
    v3.forEach(h => expect(h.transactions).toEqual([]));
    expect(v3.map(h => h.symbol)).toEqual(['BTC', 'ETH', 'SOL', 'ADA']);
  });

  it('una entrada inválida no afecta la migración de las demás', () => {
    const v2 = [
      { id: 'h1', symbol: 'BTC', amount: 0.5, buyPrice: 30000, addedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'h2', symbol: 'BAD', amount: NaN, buyPrice: 100 }
    ];
    const v3 = migrateHoldingsV2ToV3(v2);
    expect(v3[0].transactions).toHaveLength(1);
    expect(v3[1].transactions).toEqual([]);
  });

  it('round-trip exacto: deriveHoldingPosition sobre lo migrado reproduce amount/buyPrice originales', () => {
    const v2 = [
      { id: 'h1', symbol: 'BTC', amount: 0.00031337, buyPrice: 65432.1, addedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'h2', symbol: 'AAPL', amount: 250, buyPrice: 189.995, addedAt: '2025-06-15T00:00:00.000Z' },
      { id: 'h3', symbol: 'ETH', amount: 12.5, buyPrice: 0, addedAt: '2024-01-01T00:00:00.000Z' }
    ];
    v2.forEach(h => {
      const migrated = migrateHoldingsV2ToV3([h])[0];
      const position = deriveHoldingPosition(migrated.transactions);
      expect(position).toStrictEqual({ amount: h.amount, buyPrice: h.buyPrice });
    });
  });
});

describe('checkAlertTriggers', () => {
  const now = 1_700_000_000_000;
  const baseAlert = {
    id: 'a1', source: 'coingecko', sourceId: 'bitcoin', symbol: 'BTC',
    direction: 'above', threshold: 50000, createdAt: '2026-01-01T00:00:00.000Z',
    enabled: true, active: true, triggeredAt: null, bannerDismissedAt: null
  };
  const prices = usd => ({ 'coingecko:bitcoin': { usd } });

  it('dispara una alerta "above" cuando el precio cruza el umbral', () => {
    const { alerts, firedAlerts } = checkAlertTriggers([baseAlert], prices(51000), now);
    expect(firedAlerts).toHaveLength(1);
    expect(alerts[0].active).toBe(false);
    expect(alerts[0].triggeredAt).toBe(new Date(now).toISOString());
  });

  it('dispara una alerta "below" cuando el precio cae bajo el umbral', () => {
    const alert = { ...baseAlert, direction: 'below', threshold: 40000 };
    const { alerts, firedAlerts } = checkAlertTriggers([alert], prices(39000), now);
    expect(firedAlerts).toHaveLength(1);
    expect(alerts[0].active).toBe(false);
  });

  it('el límite exacto del umbral cuenta como disparo (>= y <=)', () => {
    const above = checkAlertTriggers([baseAlert], prices(50000), now);
    expect(above.firedAlerts).toHaveLength(1);
    const belowAlert = { ...baseAlert, direction: 'below', threshold: 40000 };
    const below = checkAlertTriggers([belowAlert], prices(40000), now);
    expect(below.firedAlerts).toHaveLength(1);
  });

  it('no vuelve a disparar mientras el precio sigue cruzado', () => {
    const alreadyFired = { ...baseAlert, active: false, triggeredAt: '2026-01-02T00:00:00.000Z' };
    const { alerts, firedAlerts } = checkAlertTriggers([alreadyFired], prices(52000), now);
    expect(firedAlerts).toHaveLength(0);
    expect(alerts[0].active).toBe(false);
    expect(alerts[0].triggeredAt).toBe('2026-01-02T00:00:00.000Z');
  });

  it('rearma cuando el precio cruza de vuelta al lado no disparado, sin volver a notificar', () => {
    const alreadyFired = { ...baseAlert, active: false, triggeredAt: '2026-01-02T00:00:00.000Z' };
    const { alerts, firedAlerts } = checkAlertTriggers([alreadyFired], prices(49000), now);
    expect(firedAlerts).toHaveLength(0);
    expect(alerts[0].active).toBe(true);
    expect(alerts[0].triggeredAt).toBe('2026-01-02T00:00:00.000Z');
  });

  it('deja una alerta armada sin tocar si el precio todavía no cruza', () => {
    const { alerts, firedAlerts } = checkAlertTriggers([baseAlert], prices(45000), now);
    expect(firedAlerts).toHaveLength(0);
    expect(alerts[0]).toEqual(baseAlert);
  });

  it('ignora alertas con enabled:false sin importar el precio', () => {
    const disabled = { ...baseAlert, enabled: false };
    const { alerts, firedAlerts } = checkAlertTriggers([disabled], prices(99999), now);
    expect(firedAlerts).toHaveLength(0);
    expect(alerts[0]).toEqual(disabled);
  });

  it('deja la alerta sin cambios si no hay precio disponible para esa fuente', () => {
    const { alerts, firedAlerts } = checkAlertTriggers([baseAlert], {}, now);
    expect(firedAlerts).toHaveLength(0);
    expect(alerts[0]).toEqual(baseAlert);
  });

  it('evalúa varias alertas independientemente en una sola llamada', () => {
    const a1 = { ...baseAlert, id: 'a1', threshold: 50000 };
    const a2 = { ...baseAlert, id: 'a2', direction: 'below', threshold: 60000 };
    const { firedAlerts } = checkAlertTriggers([a1, a2], prices(55000), now);
    // a1 (above 50000): 55000 cruza -> dispara. a2 (below 60000): 55000 cruza -> dispara.
    expect(firedAlerts.map(a => a.id).sort()).toEqual(['a1', 'a2']);
  });

  it('no muta el array de entrada ni sus objetos', () => {
    const original = { ...baseAlert };
    const alertsInput = [original];
    checkAlertTriggers(alertsInput, prices(51000), now);
    expect(alertsInput[0]).toEqual(baseAlert);
    expect(alertsInput).toHaveLength(1);
  });

  it('maneja un array vacío sin romper', () => {
    expect(checkAlertTriggers([], prices(51000), now)).toEqual({ alerts: [], firedAlerts: [] });
  });
});
