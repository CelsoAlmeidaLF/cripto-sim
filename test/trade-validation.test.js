const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const engine = require('../src/finance-engine.js');

const source = readFileSync(require.resolve('../src/js/app.js'), 'utf8');
// Executa o cálculo e o listener reais da interface, sem depender do navegador.
const balances = source.slice(source.indexOf('  function computeCashBalance()'), source.indexOf('  function computeRunningBalances()'));
const submit = source.slice(source.indexOf("  document.getElementById('tradeForm').addEventListener('submit'"), source.indexOf("  document.getElementById('verifyChainBtn').addEventListener"));

function setup({ trades = [], deposits = [], value = 100, asset = 'btc', type = 'sell', blockOverdraft = false, price = 50000, fee = '', feeUnit = 'pct', spread, custody = 'national', brlPerUsd = null } = {}) {
  let onSubmit;
  const elements = {
    tradeForm: { addEventListener: (_, listener) => { onSubmit = listener; } },
    assetSelect: { value: asset },
    valueInput: { value: String(value) },
    submitBtn: { disabled: false, textContent: '' },
    ioStatus: { textContent: '' },
    qtyPreview: { textContent: '' },
    feeInput: { value: String(fee) },
    feeUnitSelect: { value: feeUnit },
    spreadInput: { value: spread == null ? '' : String(spread) },
    custodySelect: { value: custody }
  };
  const chain = [engine.makeGenesisBlock(1)];
  for (const trade of trades) engine.appendBlock(chain, { kind: 'trade', ...trade });
  let saves = 0;
  const context = vm.createContext({
    document: { getElementById: id => elements[id] },
    FinanceEngine: engine,
    ASSET_KEYS: ['btc', 'eth'], trades, deposits, chain,
    usdPrice: { btc: price, eth: 2000, brl: brlPerUsd ? 1 / brlPerUsd : null }, currentType: type,
    settings: { blockOverdraft, custody: 'national', spreadPct: 1 },
    appendBlock: async (...args) => engine.appendBlock(...args),
    saveChain: () => { saves++; },
    chainToTrades: () => chain.filter(b => b.data).map(b => b.data),
    renderSimulator: () => {}
  });
  vm.runInContext(balances + submit, context);
  return { context, elements, chain, submit: () => onSubmit({ preventDefault() {} }), saves: () => saves };
}

const buy = (qty, asset = 'btc') => ({ type: 'buy', asset, qty, price: 50000, value: qty * 50000, timestamp: 10 });
const sold = { ...buy(1), type: 'sell', timestamp: 20 };

for (const [name, options] of [
  ['carteira vazia e sem dinheiro', {}],
  ['depósito em dinheiro sem BTC', { deposits: [{ amount: 10000 }] }],
  ['custódia apenas de outro ativo', { trades: [buy(1, 'eth')] }],
  ['posição já totalmente vendida', { trades: [buy(1), sold] }],
  ['venda maior que a custódia', { trades: [buy(0.1)], value: 5001 }],
  ['saldo negativo de histórico antigo', { trades: [sold] }]
]) {
  test(`Venda bloqueada: ${name}`, async () => {
    const app = setup(options);
    const before = JSON.stringify(app.chain);
    const cashBefore = vm.runInContext('computeCashBalance()', app.context);
    await app.submit();
    assert.equal(JSON.stringify(app.chain), before);
    assert.equal(vm.runInContext('computeCashBalance()', app.context), cashBefore);
    assert.equal(app.saves(), 0);
    assert.match(app.elements.ioStatus.textContent, /operação bloqueada.*custódia/);
    assert.equal(app.elements.submitBtn.disabled, false);
  });
}

for (const qty of [0.1, 1]) {
  test(`Venda válida de ${qty} BTC mesmo com caixa zerado`, async () => {
    const app = setup({ trades: [buy(1)], deposits: [{ amount: 50000 }], value: qty * 50000, blockOverdraft: true });
    await app.submit();
    assert.equal(app.chain.at(-1).data.type, 'sell');
    assert.equal(app.chain.at(-1).data.qty, qty);
    assert.equal(vm.runInContext('computeSummary().btc.boughtQty', app.context), 1 - qty);
    assert.equal(app.saves(), 1);
    assert.equal(engine.verifyChainIntegrity(app.chain).valid, true);
  });
}

test('Venda total tolera arredondamento e impede nova venda ou envio simultâneo', async () => {
  const app = setup({ trades: [buy(0.1)], value: 0.1 * 3, price: 3 });
  await Promise.all([app.submit(), app.submit()]);
  assert.equal(app.saves(), 1);
  assert.equal(vm.runInContext('computeSummary().btc.boughtQty', app.context), 0);
  app.elements.valueInput.value = '1';
  await app.submit();
  assert.equal(app.saves(), 1);
  assert.match(app.elements.ioStatus.textContent, /operação bloqueada/);
});

test('Compra continua seguindo a configuração de bloqueio de saldo', async () => {
  for (const blockOverdraft of [false, true]) {
    const app = setup({ type: 'buy', blockOverdraft });
    await app.submit();
    assert.equal(app.saves(), blockOverdraft ? 0 : 1);
  }
});

/* ---- Auditoria financeira: campos gravados na operação (A3, C1, C2, A4) ---- */
test('Nova operação grava taxa, spread, custódia e câmbio da data (C1/C2/A3)', async () => {
  const app = setup({ type: 'buy', value: 1000, fee: 0.5, feeUnit: 'pct', spread: 1, custody: 'foreign', brlPerUsd: 5.2, deposits: [{ amount: 5000 }] });
  await app.submit();
  const d = app.chain.at(-1).data;
  assert.equal(d.feeUSD, 5);
  assert.equal(d.spreadUSD, 10);
  assert.equal(d.custody, 'foreign');
  assert.ok(Math.abs(d.fxRate - 5.2) < 1e-9);
  assert.equal(d.fxSource, 'cache');
  // caixa: 5000 - (1000 + 5 + 10)
  assert.ok(Math.abs(vm.runInContext('computeCashBalance()', app.context) - (5000 - 1015)) < 1e-9);
  assert.equal(engine.verifyChainIntegrity(app.chain).valid, true);
});

test('Sem cotação USD/BRL a operação grava o câmbio de contingência marcado como fallback (A4)', async () => {
  const app = setup({ type: 'buy', value: 100, deposits: [{ amount: 500 }] });
  await app.submit();
  const d = app.chain.at(-1).data;
  assert.equal(d.fxSource, 'fallback');
  assert.equal(d.fxRate, engine.FALLBACK_BRL_PER_USD);
});

test('Taxa em USD e spread padrão da configuração quando o campo está vazio (A3)', async () => {
  const app = setup({ type: 'buy', value: 200, fee: 3, feeUnit: 'usd', deposits: [{ amount: 500 }] });
  await app.submit();
  const d = app.chain.at(-1).data;
  assert.equal(d.feeUSD, 3);
  assert.equal(d.spreadPct, 1);
  assert.equal(d.spreadUSD, 2);
});

test('Compra com taxa+spread acima do saldo respeita o bloqueio de saldo (A3)', async () => {
  // saldo 1000, compra 1000 + 1% de spread = 1010 -> bloqueada
  const app = setup({ type: 'buy', value: 1000, blockOverdraft: true, deposits: [{ amount: 1000 }] });
  await app.submit();
  assert.equal(app.saves(), 0);
  assert.match(app.elements.ioStatus.textContent, /saldo disponível/);
});

test('Venda com taxa+spread maiores que o valor é bloqueada (A3)', async () => {
  const app = setup({ trades: [buy(1)], value: 100, fee: 200, feeUnit: 'usd' });
  await app.submit();
  assert.equal(app.saves(), 0);
  assert.match(app.elements.ioStatus.textContent, /taxa e spread/);
});

/* ---- Arquitetura: a UI usa o motor, sem cálculo próprio ---- */
test('app.js delega cálculo ao finance-engine (sem regras fiscais/duplicações locais)', () => {
  assert.match(source, /FinanceEngine\.computeTaxReport\(/);
  assert.match(source, /FinanceEngine\.computeSummary\(/);
  assert.match(source, /FinanceEngine\.computeCashBalance\(/);
  assert.match(source, /FinanceEngine\.calculateTargetProfitScenarios\(/);
  assert.doesNotMatch(source, /\b35000\b/, 'limite de isenção deve vir do motor');
  assert.doesNotMatch(source, /\*\s*0\.15/, 'alíquota deve vir do motor');
  assert.doesNotMatch(source, /:\s*5\.4\b/, 'fallback de câmbio único no motor');
  assert.doesNotMatch(source, /Alta proteção contra quedas/);
});

test('Configurações antigas ganham custódia e spread padrão (migração)', () => {
  const start = source.indexOf('  const defaultSettings');
  const end = source.indexOf('  let trades = [], chain');
  const ctx = vm.createContext({ FinanceEngine: engine });
  vm.runInContext(source.slice(start, end) + '\nthis.n = normalizeSettings;', ctx);
  assert.deepEqual({ ...ctx.n({ blockOverdraft: true }) }, { blockOverdraft: true, custody: 'national', spreadPct: 1 });
  assert.equal(ctx.n(null).spreadPct, 1);
  assert.equal(ctx.n({ custody: 'foreign', spreadPct: 2.5 }).custody, 'foreign');
  assert.equal(ctx.n({ spreadPct: -3 }).spreadPct, 1);
});
