import { describe, it, expect } from 'vitest';
import PortfolioUtils from './portfolio-utils.js';

const { formatCurrency, formatNumber, computeHoldingMetrics, computePortfolioTotals, isStale, mergePriceCache } = PortfolioUtils;

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
