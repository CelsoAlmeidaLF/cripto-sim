const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const engine = require('../src/finance-engine.js');

const source = readFileSync(require.resolve('../src/js/app.js'), 'utf8');
// Executa o cálculo e o listener reais da interface, sem depender do navegador.
const balances = source.slice(source.indexOf('  function computeCashBalance()'), source.indexOf('  function computeRunningBalances()'));
const submit = source.slice(source.indexOf("  document.getElementById('tradeForm').addEventListener('submit'"), source.indexOf("  document.getElementById('verifyChainBtn').addEventListener"));

function setup({ trades = [], deposits = [], value = 100, asset = 'btc', type = 'sell', blockOverdraft = false, price = 50000 } = {}) {
  let onSubmit;
  const elements = {
    tradeForm: { addEventListener: (_, listener) => { onSubmit = listener; } },
    assetSelect: { value: asset },
    valueInput: { value: String(value) },
    submitBtn: { disabled: false, textContent: '' },
    ioStatus: { textContent: '' },
    qtyPreview: { textContent: '' }
  };
  const chain = [engine.makeGenesisBlock(1)];
  for (const trade of trades) engine.appendBlock(chain, { kind: 'trade', ...trade });
  let saves = 0;
  const context = vm.createContext({
    document: { getElementById: id => elements[id] },
    ASSET_KEYS: ['btc', 'eth'], trades, deposits, chain,
    usdPrice: { btc: price, eth: 2000 }, currentType: type,
    settings: { blockOverdraft },
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
