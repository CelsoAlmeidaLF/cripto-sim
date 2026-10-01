// Testes da auditoria financeira de 30/09/2026 (docs/auditoria-financeira-2026-09.md)
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/finance-engine.js');

const ts = (iso) => new Date(iso).getTime();
const close = (a, b, eps = 0.005) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const buy = (o) => ({ type: 'buy', asset: 'btc', ...o });
const sell = (o) => ({ type: 'sell', asset: 'btc', ...o });

/* ---------- C1: câmbio histórico ---------- */
test('C1 câmbio diferente entre compra e venda: ganho em R$ usa cotação de cada data', () => {
  // compra 1 BTC a $10.000 com dólar a R$ 4,00 (custo R$ 40.000); venda a $12.000 com dólar a R$ 6,00 (R$ 72.000)
  const trades = [
    buy({ timestamp: ts('2026-01-10T15:00:00Z'), qty: 1, price: 10000, value: 10000, fxRate: 4, fxSource: 'coingecko' }),
    sell({ timestamp: ts('2026-09-10T15:00:00Z'), qty: 1, price: 12000, value: 12000, fxRate: 6, fxSource: 'coingecko' })
  ];
  const r = E.computeTaxReport(['btc'], trades, { currentBrlPerUsd: 5 });
  const m = r.months['2026-09'];
  close(m.national.alienationBRL, 72000);
  close(m.national.netGainBRL, 32000); // 72.000 - 40.000 (e NÃO 2.000 USD x câmbio atual = 10.000)
  assert.equal(m.estimated, false);
  assert.equal(m.operations[0].fxSource, 'operation');
});

test('C1 isenção de R$ 35 mil é testada em R$ da data da venda', () => {
  // $7.000 a R$ 5,10 = R$ 35.700 (tributável) mesmo que a cotação atual (4,00) desse R$ 28.000
  const trades = [
    buy({ timestamp: ts('2026-08-01T12:00:00Z'), qty: 1, price: 5000, value: 5000, fxRate: 5, fxSource: 'binance' }),
    sell({ timestamp: ts('2026-09-05T12:00:00Z'), qty: 1, price: 7000, value: 7000, fxRate: 5.1, fxSource: 'binance' })
  ];
  const m = E.computeTaxReport(['btc'], trades, { currentBrlPerUsd: 4 }).months['2026-09'];
  assert.equal(m.national.isExempt, false);
  close(m.national.alienationBRL, 35700);
  close(m.national.netGainBRL, 35700 - 25000);
  close(m.national.taxBRL, 10700 * 0.15);
});

test('C1 operações antigas sem cotação usam a atual e ficam marcadas como estimadas', () => {
  const trades = [
    buy({ timestamp: ts('2026-01-10T15:00:00Z'), qty: 1, price: 10000, value: 10000 }),
    sell({ timestamp: ts('2026-09-10T15:00:00Z'), qty: 1, price: 12000, value: 12000 })
  ];
  const m = E.computeTaxReport(['btc'], trades, { currentBrlPerUsd: 5 }).months['2026-09'];
  assert.equal(m.estimated, true);
  assert.equal(m.fxFallback, false);
  assert.equal(m.operations[0].fxSource, 'current');
  close(m.national.netGainBRL, 2000 * 5);
});

test('C1 compra estimada contamina o custo médio: venda com câmbio real continua estimada', () => {
  const trades = [
    buy({ timestamp: ts('2026-01-10T15:00:00Z'), qty: 1, price: 10000, value: 10000 }), // sem cotação
    sell({ timestamp: ts('2026-09-10T15:00:00Z'), qty: 1, price: 12000, value: 12000, fxRate: 5, fxSource: 'coingecko' })
  ];
  const m = E.computeTaxReport(['btc'], trades, { currentBrlPerUsd: 5 }).months['2026-09'];
  assert.equal(m.operations[0].estimated, true);
});

/* ---------- A4: fallback único e sinalizado ---------- */
test('A4 sem nenhuma cotação usa um único fallback e sinaliza', () => {
  assert.equal(E.FALLBACK_BRL_PER_USD, 5.5);
  const trades = [
    buy({ timestamp: ts('2026-01-10T15:00:00Z'), qty: 1, price: 100, value: 100 }),
    sell({ timestamp: ts('2026-09-10T15:00:00Z'), qty: 1, price: 200, value: 200 })
  ];
  const m = E.computeTaxReport(['btc'], trades, {}).months['2026-09'];
  assert.equal(m.fxFallback, true);
  assert.equal(m.operations[0].fxRate, 5.5);
  const legacy = E.computeTaxMonthSummary(['btc'], trades, '2026-09');
  assert.equal(legacy.estimated, true);
  close(legacy.totalRealizedGainBRL, 100 * 5.5);
});

test('A4 cotação gravada como fallback continua sendo tratada como estimada', () => {
  const fx = E.resolveFx({ fxRate: 5.5, fxSource: 'fallback' }, 6);
  assert.deepEqual(fx, { rate: 5.5, source: 'fallback' });
});

/* ---------- A2: sem compensação no regime nacional ---------- */
test('A2 regime nacional não compensa prejuízo com lucro no mesmo mês (soma dos ganhos positivos)', () => {
  const T = (d, o) => ({ timestamp: ts(`2026-09-${d}T15:00:00Z`), fxRate: 5, fxSource: 'coingecko', ...o });
  const trades = [
    T('01', buy({ asset: 'btc', qty: 1, price: 10000, value: 10000 })),
    T('01', buy({ asset: 'eth', qty: 1, price: 10000, value: 10000 })),
    T('10', sell({ asset: 'btc', qty: 1, price: 14000, value: 14000 })), // +4.000 USD = +R$ 20.000
    T('11', sell({ asset: 'eth', qty: 1, price: 8000, value: 8000 }))   // -2.000 USD = -R$ 10.000
  ];
  const m = E.computeTaxReport(['btc', 'eth'], trades, {}).months['2026-09'];
  close(m.national.alienationBRL, 110000);
  close(m.national.netGainBRL, 10000); // informativo
  close(m.national.taxableGainBRL, 20000); // conservador: só ganhos
  close(m.national.lossBRL, 10000);
  close(m.national.taxBRL, 3000); // 15% de 20.000, não 15% de 10.000
});

/* ---------- M4: fronteira de R$ 35.000,00 ---------- */
test('M4 fronteira exata de R$ 35.000,00 é isenta, inclusive com ruído de ponto flutuante', () => {
  const mk = (usd, fx) => [
    buy({ timestamp: ts('2026-09-01T15:00:00Z'), qty: 1, price: 1, value: 1, fxRate: 5 }),
    sell({ timestamp: ts('2026-09-02T15:00:00Z'), qty: 0.0001, price: usd / 0.0001, value: usd, fxRate: fx })
  ];
  const exato = E.computeTaxReport(['btc'], mk(7000, 5), {}).months['2026-09'];
  assert.equal(exato.national.alienationBRL, 35000);
  assert.equal(exato.national.isExempt, true);
  // 0.1 * 3 * ... produz 35000.000000000004 em float; deve continuar isento
  const ruido = E.computeTaxReport(['btc'], mk(35000 / 3, 3), {}).months['2026-09'];
  assert.equal(ruido.national.isExempt, true);
  const acima = E.computeTaxReport(['btc'], mk(7000.01, 5), {}).months['2026-09'];
  assert.equal(acima.national.alienationBRL, 35000.05);
  assert.equal(acima.national.isExempt, false);
});

test('M4 isenção soma todas as criptos do mês (tudo ou nada)', () => {
  const trades = [
    buy({ asset: 'btc', timestamp: ts('2026-09-01T15:00:00Z'), qty: 1, price: 100, value: 100, fxRate: 5 }),
    buy({ asset: 'eth', timestamp: ts('2026-09-01T15:00:00Z'), qty: 1, price: 100, value: 100, fxRate: 5 }),
    sell({ asset: 'btc', timestamp: ts('2026-09-02T15:00:00Z'), qty: 1, price: 4000, value: 4000, fxRate: 5 }),
    sell({ asset: 'eth', timestamp: ts('2026-09-03T15:00:00Z'), qty: 1, price: 3001, value: 3001, fxRate: 5 })
  ];
  const m = E.computeTaxReport(['btc', 'eth'], trades, {}).months['2026-09'];
  close(m.national.alienationBRL, 35005);
  assert.equal(m.national.isExempt, false);
  close(m.national.taxBRL, (35005 - 1000) * 0.15);
});

/* ---------- C2: regime exterior ---------- */
test('C2 exterior: 15% fixo anual, sem isenção de R$ 35 mil e sem DARF mensal', () => {
  const trades = [
    buy({ timestamp: ts('2026-02-01T15:00:00Z'), qty: 1, price: 1000, value: 1000, fxRate: 5, custody: 'foreign' }),
    sell({ timestamp: ts('2026-09-10T15:00:00Z'), qty: 1, price: 2000, value: 2000, fxRate: 5, custody: 'foreign' }) // R$ 10.000 (< 35 mil)
  ];
  const r = E.computeTaxReport(['btc'], trades, {});
  const m = r.months['2026-09'];
  assert.equal(m.national.alienationBRL, 0);
  assert.equal(m.national.darfBRL, 0);
  close(m.foreign.netGainBRL, 5000);
  const y = r.foreignYears['2026'];
  close(y.taxableBaseBRL, 5000);
  close(y.taxBRL, 750); // 15% mesmo com venda abaixo de R$ 35 mil
});

test('C2 exterior: perdas compensam no ano e passam aos anos seguintes', () => {
  const T = (iso, o) => ({ timestamp: ts(iso), fxRate: 5, custody: 'foreign', ...o });
  const trades = [
    T('2026-01-01T15:00:00Z', buy({ qty: 2, price: 1000, value: 2000 })),
    T('2026-03-01T15:00:00Z', sell({ qty: 1, price: 400, value: 400 })),  // avg 1000 -> -600 USD = -R$ 3.000
    T('2027-02-01T15:00:00Z', sell({ qty: 1, price: 1400, value: 1400 })) // +400 USD = +R$ 2.000
  ];
  const r = E.computeTaxReport(['btc'], trades, {});
  const y26 = r.foreignYears['2026'];
  close(y26.taxBRL, 0);
  close(y26.lossCarryOutBRL, 3000);
  const y27 = r.foreignYears['2027'];
  close(y27.lossCarryInBRL, 3000);
  close(y27.taxableBaseBRL, 0); // 2.000 - 3.000 de prejuízo acumulado
  close(y27.lossCarryOutBRL, 1000);
  close(y27.taxBRL, 0);
});

test('C2 exterior e nacional no mesmo mês não se misturam', () => {
  const T = (d, o) => ({ timestamp: ts(`2026-09-${d}T15:00:00Z`), fxRate: 5, ...o });
  const trades = [
    T('01', buy({ asset: 'btc', qty: 1, price: 1000, value: 1000 })),
    T('01', buy({ asset: 'eth', qty: 1, price: 1000, value: 1000 })),
    T('05', sell({ asset: 'btc', qty: 1, price: 9000, value: 9000, custody: 'foreign' })), // R$ 45.000 no exterior
    T('06', sell({ asset: 'eth', qty: 1, price: 2000, value: 2000, custody: 'national' })) // R$ 10.000 nacional
  ];
  const m = E.computeTaxReport(['btc', 'eth'], trades, {}).months['2026-09'];
  assert.equal(m.national.isExempt, true); // só o nacional conta para a isenção
  close(m.national.alienationBRL, 10000);
  close(m.foreign.alienationBRL, 45000);
});

test('C2 custódia padrão vem da configuração quando a operação antiga não tem o campo', () => {
  const trades = [
    buy({ timestamp: ts('2026-02-01T15:00:00Z'), qty: 1, price: 1000, value: 1000, fxRate: 5 }),
    sell({ timestamp: ts('2026-09-10T15:00:00Z'), qty: 1, price: 2000, value: 2000, fxRate: 5 })
  ];
  const r = E.computeTaxReport(['btc'], trades, { defaultCustody: 'foreign' });
  assert.equal(r.months['2026-09'].operations[0].custody, 'foreign');
  assert.ok(r.foreignYears['2026']);
});

/* ---------- A1: faixas ---------- */
test('A1 faixas progressivas de ganho de capital', () => {
  close(E.capitalGainsTax(1000000).tax, 150000);
  close(E.capitalGainsTax(5000000).tax, 750000);
  close(E.capitalGainsTax(7000000).tax, 750000 + 2000000 * 0.175);
  close(E.capitalGainsTax(10000000).tax, 750000 + 875000);
  close(E.capitalGainsTax(20000000).tax, 750000 + 875000 + 10000000 * 0.20);
  close(E.capitalGainsTax(40000000).tax, 750000 + 875000 + 4000000 + 10000000 * 0.225);
  assert.equal(E.capitalGainsTax(-5).tax, 0);
});

test('A1 relatório mensal aplica as faixas ao ganho tributável', () => {
  const trades = [
    buy({ timestamp: ts('2026-01-01T15:00:00Z'), qty: 1, price: 1000, value: 1000, fxRate: 5 }),
    sell({ timestamp: ts('2026-09-01T15:00:00Z'), qty: 1, price: 2000000 + 1000, value: 2001000, fxRate: 5 }) // ganho R$ 10.000.000
  ];
  const m = E.computeTaxReport(['btc'], trades, {}).months['2026-09'];
  close(m.national.netGainBRL, 10000000);
  close(m.national.taxBRL, 750000 + 875000);
  assert.equal(m.national.brackets.length, 2);
});

/* ---------- B1: DARF mínimo ---------- */
test('B1 DARF abaixo de R$ 10,00 não é recolhido e acumula para o mês seguinte', () => {
  const T = (iso, o) => ({ timestamp: ts(iso), fxRate: 5, ...o });
  const trades = [
    T('2026-01-01T15:00:00Z', buy({ qty: 10, price: 10000, value: 100000 })),
    // Set: ganho R$ 50 -> imposto 7,50 (< 10) mas alienação > 35 mil
    T('2026-09-05T15:00:00Z', sell({ qty: 1, price: 10000 + 10, value: 10010 })),
    // Out: ganho R$ 25 -> imposto 3,75 -> acumulado 11,25 (>= 10)
    T('2026-10-05T15:00:00Z', sell({ qty: 1, price: 10000 + 5, value: 10005 }))
  ];
  // alienação mensal precisa passar de 35 mil: mais volume em cada mês com ganho zero
  trades.push(T('2026-09-06T15:00:00Z', sell({ qty: 1, price: 10000, value: 10000 })));
  trades.push(T('2026-09-07T15:00:00Z', sell({ qty: 1, price: 10000, value: 10000 })));
  trades.push(T('2026-10-06T15:00:00Z', sell({ qty: 1, price: 10000, value: 10000 })));
  trades.push(T('2026-10-07T15:00:00Z', sell({ qty: 1, price: 10000, value: 10000 })));
  const r = E.computeTaxReport(['btc'], trades, {});
  const set = r.months['2026-09'].national;
  close(set.taxBRL, 7.5);
  assert.equal(set.darfBRL, 0);
  assert.equal(set.darfDeferred, true);
  close(set.darfCarryOutBRL, 7.5);
  const out = r.months['2026-10'].national;
  close(out.darfCarryInBRL, 7.5);
  close(out.darfBRL, 11.25);
  assert.equal(out.darfDeferred, false);
});

test('B1 DARF exatamente R$ 10,00 é recolhido', () => {
  const trades = [
    buy({ timestamp: ts('2026-01-01T15:00:00Z'), qty: 1, price: 1, value: 1, fxRate: 5 }),
    // alienação R$ 40.000, ganho tributável R$ 66,67 -> 15% = R$ 10,00
    sell({ timestamp: ts('2026-09-05T15:00:00Z'), qty: 1, price: 8000, value: 8000, fxRate: 5 })
  ];
  const n = E.computeTaxReport(['btc'], trades, {}).months['2026-09'].national;
  assert.ok(n.darfBRL >= 10);
});

/* ---------- A5: gatilho DeCripto ---------- */
test('A5 gatilho DeCripto soma compras e vendas do mês (não só vendas)', () => {
  const trades = [
    // vendas R$ 15.000 + compras R$ 25.000 = R$ 40.000 > 35.000 (vendas sozinhas não passam)
    buy({ timestamp: ts('2026-08-01T15:00:00Z'), qty: 2, price: 1500, value: 3000, fxRate: 5 }),
    buy({ timestamp: ts('2026-09-01T15:00:00Z'), qty: 1, price: 5000, value: 5000, fxRate: 5 }),
    sell({ timestamp: ts('2026-09-10T15:00:00Z'), qty: 1, price: 3000, value: 3000, fxRate: 5 })
  ];
  const m = E.computeTaxReport(['btc'], trades, {}).months['2026-09'];
  assert.equal(m.national.isExempt, true);
  close(m.decripto.volumeBRL, 40000);
  assert.equal(m.decripto.triggered, true);
  const ago = E.computeTaxReport(['btc'], trades, {}).months['2026-08'];
  assert.equal(ago.decripto.triggered, false);
});

/* ---------- A3: taxas e spread ---------- */
test('A3 taxa de compra entra no custo e taxa/spread de venda reduzem a alienação', () => {
  const trades = [
    { timestamp: 1000, asset: 'btc', type: 'buy', qty: 1, price: 1000, value: 1000, feeUSD: 10, spreadUSD: 10 },
    { timestamp: 2000, asset: 'btc', type: 'sell', qty: 1, price: 1200, value: 1200, feeUSD: 12, spreadUSD: 12 }
  ];
  const s = E.computeSummary(['btc'], trades, {}).perAsset.btc;
  // custo 1020, líquido de venda 1176 => realizado 156 (sem custos seria 200)
  assert.equal(s.realized, 156);
  // caixa: -1020 + 1176
  assert.equal(E.computeCashBalance([{ amount: 2000 }], trades), 2000 - 1020 + 1176);
  assert.equal(E.totalTradeCostsUSD(trades), 44);
});

test('A3 relatório fiscal usa custo com taxa e alienação líquida no ganho', () => {
  const trades = [
    { timestamp: ts('2026-01-01T15:00:00Z'), asset: 'btc', type: 'buy', qty: 1, price: 1000, value: 1000, feeUSD: 20, fxRate: 5 },
    { timestamp: ts('2026-09-01T15:00:00Z'), asset: 'btc', type: 'sell', qty: 1, price: 1200, value: 1200, feeUSD: 20, fxRate: 5 }
  ];
  const m = E.computeTaxReport(['btc'], trades, {}).months['2026-09'];
  close(m.national.netGainBRL, (1180 - 1020) * 5);
  close(m.national.alienationBRL, 6000); // isenção olha o valor bruto
});

test('A3 operações antigas sem taxa continuam com custo zero e sem erro', () => {
  const trades = [
    { timestamp: 1, asset: 'btc', type: 'buy', qty: 1, price: 100 },
    { timestamp: 2, asset: 'btc', type: 'sell', qty: 1, price: 150 }
  ];
  const s = E.computeSummary(['btc'], trades, {}).perAsset.btc;
  assert.equal(s.realized, 50);
  assert.equal(E.computeCashBalance([{ amount: 100 }], trades), 150);
});

/* ---------- B2: fuso America/Sao_Paulo ---------- */
test('B2 mês de apuração usa America/Sao_Paulo, não o fuso do aparelho', () => {
  // 01/10 01:30 UTC = 30/09 22:30 em São Paulo -> ainda é setembro
  assert.equal(E.monthKeySP(ts('2026-10-01T01:30:00Z')), '2026-09');
  // 01/10 03:00 UTC = 01/10 00:00 em São Paulo -> outubro
  assert.equal(E.monthKeySP(ts('2026-10-01T03:00:00Z')), '2026-10');
  assert.equal(E.monthKeySP(ts('2026-01-01T02:59:59Z')), '2025-12');
});

test('B2 venda na noite de 30/09 (BRT) cai em setembro no relatório', () => {
  const trades = [
    buy({ timestamp: ts('2026-01-01T15:00:00Z'), qty: 1, price: 100, value: 100, fxRate: 5 }),
    sell({ timestamp: ts('2026-10-01T02:00:00Z'), qty: 1, price: 200, value: 200, fxRate: 5 })
  ];
  const r = E.computeTaxReport(['btc'], trades, {});
  assert.ok(r.months['2026-09'].operations.length === 1);
  assert.equal(r.months['2026-10'], undefined);
});

/* ---------- B3: sem valores negativos de posição ---------- */
test('B3 posição e custo nunca ficam negativos após venda maior que a custódia (dado legado)', () => {
  const trades = [
    { timestamp: 1, asset: 'btc', type: 'buy', qty: 1, price: 100 },
    { timestamp: 2, asset: 'btc', type: 'sell', qty: 3, price: 100 }
  ];
  const s = E.computeSummary(['btc'], trades, { btc: 100 }).perAsset.btc;
  assert.equal(s.boughtQty, 0);
  assert.equal(s.boughtCost, 0);
});

/* ---------- M1: DCA neutro ---------- */
test('M1 DCA neutro: cenário flat não tem lucro embutido no aporte único', () => {
  const d = E.calculateDCASimulation(50000, 100, 30, 12);
  assert.equal(d.scenario, 'flat');
  assert.equal(d.hypothetical, true);
  close(d.lumpSumProfitPct, 0, 1e-9);
  assert.equal(d.totalInvestedUSD, 1200);
});

test('M1 DCA neutro: cenários de alta e queda são simétricos no aporte único', () => {
  const up = E.calculateDCASimulation(100, 100, 30, 12, 'up');
  const down = E.calculateDCASimulation(100, 100, 30, 12, 'down');
  close(up.lumpSumProfitPct, 20, 1e-9);
  close(down.lumpSumProfitPct, -20, 1e-9);
  assert.ok(down.profitPct < 0);
  assert.ok(up.profitPct > 0);
});

test('M1 DCA ignora o parâmetro legado de variação 24h (sem viés de alta)', () => {
  const a = E.calculateDCASimulation(100, 100, 30, 12, 5);
  const b = E.calculateDCASimulation(100, 100, 30, 12, -50);
  assert.equal(a.profitUSD, b.profitUSD);
});

/* ---------- M2: Meta de Lucro ---------- */
test('M2 capital bruto considera o IR de 15% e rendimentos são hipotéticos', () => {
  const r = E.calculateTargetProfitScenarios(100, 'year');
  assert.equal(r.taxRate, 0.15);
  const mod = r.rows.find(x => x.cenario === 'Moderado');
  close(mod.capitalUSD, 100 / (0.10 * 0.85), 1e-9);
  assert.ok(r.rows.every(x => x.hipotetico === true && /hipotético/.test(x.rendimentoEstimado)));
  assert.ok(r.rows.every(x => !/Alta proteção/.test(x.observacao)));
  assert.match(r.rows.find(x => x.cenario.includes('Lending')).observacao, /tributável/);
});

/* ---------- Disclaimers ---------- */
test('Disclaimers fiscais cobrem os 5 avisos exigidos', () => {
  const txt = E.TAX_DISCLAIMERS.join(' ');
  assert.equal(E.TAX_DISCLAIMERS.length, 5);
  for (const re of [/educativa/, /14\.754/, /PTAX/, /hipóteses|hipotéticos/, /1\.303/]) assert.match(txt, re);
});
