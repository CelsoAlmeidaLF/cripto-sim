// Correções de 19/11: gravação sem erro engolido, verificação da cadeia ao abrir, validação na importação
// do formato antigo (regras no engine) e exclusão de carteira com confirmação.
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const engine = require('../src/finance-engine.js');

const source = readFileSync(require.resolve('../src/js/app.js'), 'utf8');
const html = readFileSync(require.resolve('../src/cripto-app.html'), 'utf8');
const css = readFileSync(require.resolve('../src/css/style.css'), 'utf8');
const KEYS = ['btc', 'eth'];

function between(start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `marcadores não encontrados: ${start} / ${end}`);
  return source.slice(a, b);
}

/* ---------- DOM mínimo para os avisos ---------- */
function fakeDom() {
  const host = { children: [], appendChild(el) { el.parent = host; host.children.push(el); } };
  const make = () => {
    const el = {
      dataset: {}, className: '', textContent: '', innerHTML: '', parts: [], attrs: {},
      setAttribute(k, v) { el.attrs[k] = v; },
      append(...n) { el.parts.push(...n); },
      appendChild(n) { el.parts.push(n); },
      addEventListener() {},
      remove() { if (el.parent) el.parent.children = el.parent.children.filter(c => c !== el); }
    };
    return el;
  };
  return {
    host,
    document: { getElementById: id => (id === 'appNotices' ? host : null), createElement: make }
  };
}

/* ======================= ENGINE: regras de operação ======================= */
const ok = (over = {}) => ({ asset: 'btc', type: 'buy', value: 100, price: 50000, feeUSD: 0, spreadUSD: 0, ...over });

test('validateTrade: compra válida devolve a quantidade calculada', () => {
  const r = engine.validateTrade(ok(), { assetKeys: KEYS, availableQty: 0 });
  assert.equal(r.ok, true);
  assert.equal(r.qty, 100 / 50000);
});

for (const [name, op, ctx, code, reason] of [
  ['ativo desconhecido', ok({ asset: 'doge' }), {}, 'unknown_asset', /ativo desconhecido/],
  ['tipo inválido', ok({ type: 'swap' }), {}, 'invalid_type', /compra ou venda/],
  ['valor zero', ok({ value: 0 }), {}, 'invalid_number', /números positivos/],
  ['valor negativo', ok({ value: -5 }), {}, 'invalid_number', /números positivos/],
  ['preço NaN', ok({ price: NaN }), {}, 'invalid_number', /números positivos/],
  ['valor em texto', ok({ value: '100' }), {}, 'invalid_number', /números positivos/],
  ['quantidade negativa', ok({ qty: -1 }), {}, 'invalid_number', /números positivos/],
  ['taxa negativa', ok({ feeUSD: -1 }), {}, 'invalid_costs', /taxa e spread/],
  ['venda sem custódia', ok({ type: 'sell' }), { availableQty: 0 }, 'no_custody', /não há saldo/],
  ['venda acima do saldo', ok({ type: 'sell', value: 5001 }), { availableQty: 0.1 }, 'sell_exceeds_custody', /maior que o saldo/],
  ['taxa maior que a venda', ok({ type: 'sell', value: 100, feeUSD: 100 }), { availableQty: 1 }, 'costs_exceed_sale', /taxa e spread somam mais/]
]) {
  test(`validateTrade recusa: ${name}`, () => {
    const r = engine.validateTrade(op, { assetKeys: KEYS, ...ctx });
    assert.equal(r.ok, false);
    assert.equal(r.code, code);
    assert.match(r.reason, reason);
    assert.equal(r.message, 'operação bloqueada: ' + r.reason);
  });
}

test('validateTrade: venda da posição inteira tolera só arredondamento', () => {
  const r = engine.validateTrade(ok({ type: 'sell', value: 0.3, price: 3 }), { assetKeys: KEYS, availableQty: 0.1 });
  assert.equal(r.ok, true);
  assert.ok(r.qty <= 0.1);
});

/* ======================= ENGINE: validação de importação ======================= */
const T = (over) => ({ kind: 'trade', asset: 'btc', type: 'buy', qty: 1, price: 100, value: 100, timestamp: 1, ...over });

test('validateImportedRecords aceita arquivo coerente (compra, venda parcial, depósito)', () => {
  const r = engine.validateImportedRecords(KEYS, [
    { kind: 'deposit', amount: 500, timestamp: 0 }, T({}), T({ type: 'sell', qty: 0.5, value: 50, timestamp: 2 })
  ]);
  assert.equal(r.invalid.length, 0);
  assert.equal(r.valid.length, 3);
});

test('validateImportedRecords valida em ordem cronológica, não na do arquivo', () => {
  const r = engine.validateImportedRecords(KEYS, [T({ type: 'sell', qty: 1, value: 100, timestamp: 5 }), T({ timestamp: 1 })]);
  assert.equal(r.invalid.length, 0);
});

test('validateImportedRecords acusa venda acima do saldo, taxa maior que a venda, ativo e números ruins', () => {
  const r = engine.validateImportedRecords(KEYS, [
    T({ timestamp: 1 }),
    T({ type: 'sell', qty: 2, value: 200, timestamp: 2 }),               // nº 2: acima do saldo
    T({ asset: 'xyz', timestamp: 3 }),                                   // nº 3: ativo desconhecido
    T({ qty: -1, timestamp: 4 }),                                        // nº 4: número negativo
    T({ type: 'sell', qty: 0.5, value: 50, feeUSD: 60, timestamp: 5 }), // nº 5: taxa >= venda
    { kind: 'deposit', amount: 'dez', timestamp: 6 },                    // nº 6: depósito não numérico
    T({ timestamp: 'ontem' })                                            // nº 7: data inválida
  ]);
  assert.deepEqual(r.invalid.map(i => [i.number, i.code]), [
    [2, 'sell_exceeds_custody'], [3, 'unknown_asset'], [4, 'invalid_number'], [5, 'costs_exceed_sale'], [6, 'invalid_deposit'], [7, 'invalid_timestamp']
  ]);
  assert.equal(r.valid.length, 1);
});

test('validateImportedRecords usa value = qty * price quando o registro antigo não tem value', () => {
  const r = engine.validateImportedRecords(KEYS, [T({ value: undefined })]);
  assert.equal(r.invalid.length, 0);
});

test('describeImportRejection diz quantas e por quê (limita a 3 exemplos)', () => {
  const invalid = [1, 2, 3, 4, 5].map(n => ({ number: n, reason: 'quantidade de venda maior que o saldo do ativo em custódia' }));
  const msg = engine.describeImportRejection(invalid, 9);
  assert.match(msg, /^Importação rejeitada: 5 de 9 registros são inválidos\. Nada foi importado\./);
  assert.match(msg, /registro nº 1: quantidade de venda maior/);
  assert.match(msg, /\(e mais 2\)\.$/);
  assert.match(engine.describeImportRejection(invalid.slice(0, 1), 1), /1 de 1 registro é inválido/);
});

test('summarizeChain conta operações e depósitos sem o bloco gênese', () => {
  const chain = [engine.makeGenesisBlock(1)];
  engine.appendBlock(chain, T({}));
  engine.appendBlock(chain, T({ timestamp: 2 }));
  engine.appendBlock(chain, { kind: 'deposit', amount: 5, timestamp: 3 });
  assert.deepEqual(engine.summarizeChain(chain), { trades: 2, deposits: 1 });
  assert.deepEqual(engine.summarizeChain([]), { trades: 0, deposits: 0 });
});

/* ======================= APP: gravação e leitura locais ======================= */
function storageSetup({ failSet = false, failFlush = false, initial = {} } = {}) {
  const dom = fakeDom();
  const store = { ...initial };
  const errors = [];
  const localStorage = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { if (failSet) throw new Error('quota'); store[k] = String(v); },
    removeItem: k => { delete store[k]; },
    flush: async () => { if (failFlush) throw new Error('disco cheio'); }
  };
  const ctx = vm.createContext({ document: dom.document, localStorage, window: {}, console: { error: (...a) => errors.push(a) } });
  vm.runInContext(between('  /* ---- avisos ao usuário', '  function renderSecuritySection') , ctx);
  return { ctx, dom, store, errors };
}

test('writeLocal grava, confirma com flush e não deixa aviso', async () => {
  const s = storageSetup();
  assert.equal(await vm.runInContext("writeLocal('chain', 'k', [1,2])", s.ctx), true);
  assert.equal(s.store.k, '[1,2]');
  assert.equal(s.dom.host.children.length, 0);
});

test('writeLocal com falha no flush: devolve false, registra console.error fixo, avisa e desfaz o valor no cofre', async () => {
  const s = storageSetup({ failFlush: true, initial: { k: '"antigo"' } });
  assert.equal(await vm.runInContext("writeLocal('chain', 'k', 'novo')", s.ctx), false);
  assert.equal(s.store.k, '"antigo"', 'o valor recusado não pode seguir no cofre');
  assert.equal(s.errors[0][0], 'Falha de gravação local: chain');
  assert.equal(s.dom.host.children.length, 1);
  assert.match(vm.runInContext('SAVE_FAILURE_NOTICE.chain', s.ctx), /^Não foi possível salvar o histórico de operações/);
  assert.equal(s.dom.host.children[0].dataset.notice, 'save-chain');
});

test('writeLocal com setItem estourando cota: false e aviso (nada engolido)', async () => {
  const s = storageSetup({ failSet: true });
  assert.equal(await vm.runInContext("writeLocal('alerts', 'k', [])", s.ctx), false);
  assert.equal(s.errors.length >= 1, true);
  assert.equal(s.dom.host.children[0].dataset.notice, 'save-alerts');
});

test('sucesso depois de falha limpa o aviso daquele dado', async () => {
  const s = storageSetup({ failFlush: true });
  await vm.runInContext("writeLocal('history', 'k', [])", s.ctx);
  assert.equal(s.dom.host.children.length, 1);
  s.ctx.localStorage.flush = async () => {};
  await vm.runInContext("writeLocal('history', 'k', [])", s.ctx);
  assert.equal(s.dom.host.children.length, 0);
});

test('readLocalJson ilegível: devolve o padrão, guarda cópia do original e avisa em flushLoadProblems', () => {
  const s = storageSetup({ initial: { k: '{quebrado' } });
  const r = vm.runInContext("readLocalJson('histórico de operações', 'k', [], { keepCopy: true })", s.ctx);
  assert.deepEqual([...r], []);
  assert.equal(s.store['k.corrompido'], '{quebrado');
  assert.equal(s.errors[0][0], 'Falha de leitura local: histórico de operações');
  vm.runInContext('flushLoadProblems()', s.ctx);
  assert.equal(s.dom.host.children[0].dataset.notice, 'load-problems');
});

test('readLocalJson sem dado ou com dado válido não gera aviso', () => {
  const s = storageSetup({ initial: { k: '[3]' } });
  assert.deepEqual([...vm.runInContext("readLocalJson('x', 'k', [])", s.ctx)], [3]);
  assert.deepEqual([...vm.runInContext("readLocalJson('x', 'ausente', [])", s.ctx)], []);
  vm.runInContext('flushLoadProblems()', s.ctx);
  assert.equal(s.dom.host.children.length, 0);
});

test('Nenhum catch vazio sem comentário: todo catch trata, registra ou explica por que é opcional', () => {
  const lines = source.split('\n');
  const offenders = [];
  lines.forEach((line, i) => { if (/catch\s*(\([^)]*\))?\s*\{\s*\}/.test(line)) offenders.push(i + 1); });
  assert.deepEqual(offenders, [], `catch vazio nas linhas ${offenders.join(', ')}`);
  // catch com bloco só de comentário continua exigindo o comentário (explica por quê)
  const re = /catch\s*(?:\([^)]*\))?\s*\{\s*(\/\/[^\n]*|\/\*[^*]*\*\/)?\s*\}/g;
  let m;
  while ((m = re.exec(source))) assert.ok(m[1], `catch vazio sem justificativa perto de: ${source.slice(m.index, m.index + 60)}`);
});

/* ======================= APP: verificação da cadeia ao abrir ======================= */
function integritySetup(chain) {
  const dom = fakeDom();
  const errors = [];
  const ctx = vm.createContext({
    document: dom.document, window: {}, console: { error: (...a) => errors.push(a) },
    chain, verifyChainIntegrity: async c => engine.verifyChainIntegrity(c)
  });
  vm.runInContext(between('  /* ---- avisos ao usuário', '  /* ---- gravação e leitura locais')
    + between('  // Verificação da cadeia ao abrir', '  function saveChain()'), ctx);
  return { ctx, dom, errors };
}

test('Abrir com cadeia íntegra: nenhum aviso', async () => {
  const chain = [engine.makeGenesisBlock(1)];
  engine.appendBlock(chain, T({}));
  const s = integritySetup(chain);
  const r = await vm.runInContext('checkChainOnOpen()', s.ctx);
  assert.equal(r.valid, true);
  assert.equal(s.dom.host.children.length, 0);
});

test('Abrir com cadeia adulterada: aviso persistente (sem botão de fechar) com a mensagem exata', async () => {
  const chain = [engine.makeGenesisBlock(1)];
  engine.appendBlock(chain, T({}));
  chain[1].data = { ...chain[1].data, value: 999999 };
  const s = integritySetup(chain);
  const r = await vm.runInContext('checkChainOnOpen()', s.ctx);
  assert.equal(r.valid, false);
  const [notice] = s.dom.host.children;
  assert.equal(notice.dataset.notice, 'chain-integrity');
  const text = notice.parts.find(p => p.className === 'notice-text');
  assert.equal(text.textContent, 'O histórico tem inconsistências; os relatórios de IR podem estar errados. Restaure um backup ou exporte para conferência.');
  assert.match(text.parts[0].textContent, /^Bloco #1: /);
  assert.equal(notice.parts.some(p => p.className === 'notice-close'), false, 'aviso persistente não tem fechar');
  assert.equal(s.errors.length, 1);
  // repetir a verificação não empilha avisos; e voltar a íntegro limpa
  await vm.runInContext('checkChainOnOpen()', s.ctx);
  assert.equal(s.dom.host.children.length, 1);
  s.ctx.chain = [engine.makeGenesisBlock(1)];
  await vm.runInContext('checkChainOnOpen()', s.ctx);
  assert.equal(s.dom.host.children.length, 0);
});

test('Falha ao verificar também vira aviso (não bloqueia o app)', async () => {
  const s = integritySetup([]);
  s.ctx.verifyChainIntegrity = async () => { throw new Error('boom'); };
  const r = await vm.runInContext('checkChainOnOpen()', s.ctx);
  assert.equal(r.valid, false);
  assert.equal(s.dom.host.children[0].dataset.notice, 'chain-integrity');
});

test('loadCurrentPortfolioData chama a verificação ao final (abertura e troca de carteira)', () => {
  const fn = between('  async function loadCurrentPortfolioData()', '  function saveHistory()');
  assert.match(fn, /await checkChainOnOpen\(\);\s*\}\s*$/);
});

/* ======================= APP: importação do formato antigo ======================= */
function importSetup({ saveOk = true } = {}) {
  const status = { textContent: '' };
  let onChange;
  const els = { ioStatus: status, importFile: { addEventListener: (_, fn) => { onChange = fn; } } };
  const notices = [];
  let saves = 0;
  const ctx = vm.createContext({
    document: { getElementById: id => els[id] },
    FinanceEngine: engine, ASSET_KEYS: KEYS, console: { error() {} },
    FinancVault: { seed: { BACKUP_FORMAT: 'x-backup' } }, window: {},
    chain: [engine.makeGenesisBlock(1)], trades: [], deposits: [], netWorthHistory: [], alerts: [], settings: { blockOverdraft: false },
    normalizeSettings: s => s,
    verifyChainIntegrity: async c => engine.verifyChainIntegrity(c),
    rebuildChainFromDataList: async list => {
      const c = [engine.makeGenesisBlock(1)];
      for (const d of [...list].sort((a, b) => a.timestamp - b.timestamp)) engine.appendBlock(c, d);
      return c;
    },
    chainToTrades: () => ctx.chain.filter(b => b.data && b.data.kind !== 'deposit').map(b => b.data),
    chainToDeposits: () => ctx.chain.filter(b => b.data && b.data.kind === 'deposit').map(b => b.data),
    saveChain: async () => { saves++; return saveOk; }, saveHistory: async () => true, saveAlerts: async () => true, saveSettings: async () => true,
    applyChainIntegrity: () => {}, renderSimulator: () => {}, showNotice: (id, text) => notices.push({ id, text })
  });
  ctx.FileReader = class { readAsText() { setImmediate(() => { this.result = ctx.__content; this.onload(); }); } };
  vm.runInContext(between("  // Mensagens ao usuário na importação", "  /* ---- exportação para CSV"), ctx);
  return {
    ctx, status, notices, saves: () => saves,
    run: async content => { ctx.__content = content; onChange({ target: { files: [{}], value: '' } }); await new Promise(r => setTimeout(r, 100)); }
  };
}
const legacy = (trades, deposits = []) => JSON.stringify({ trades, deposits });

test('Importação antiga com operações inválidas é rejeitada: diz quantas e por quê, e não altera nada', async () => {
  const app = importSetup();
  const before = JSON.stringify(app.ctx.chain);
  await app.run(legacy([T({}), T({ type: 'sell', qty: 5, value: 500, timestamp: 2 }), T({ asset: 'xyz', timestamp: 3 })]));
  assert.match(app.status.textContent, /^Importação rejeitada: 2 de 3 registros são inválidos\. Nada foi importado\./);
  assert.match(app.status.textContent, /registro nº 2: quantidade de venda maior que o saldo/);
  assert.match(app.status.textContent, /registro nº 3: ativo desconhecido \(xyz\)/);
  assert.equal(JSON.stringify(app.ctx.chain), before);
  assert.equal(app.saves(), 0);
});

test('Importação antiga válida reconstrói a cadeia e grava', async () => {
  const app = importSetup();
  await app.run(legacy([T({}), T({ type: 'sell', qty: 0.5, value: 50, timestamp: 2 })], [{ amount: 100, timestamp: 0 }]));
  assert.match(app.status.textContent, /^2 operações e 1 depósitos importados/);
  assert.equal(app.ctx.chain.length, 4);
  assert.equal(app.saves(), 1);
});

test('Importação com falha de gravação volta ao estado anterior e avisa', async () => {
  const app = importSetup({ saveOk: false });
  const before = JSON.stringify(app.ctx.chain);
  await app.run(legacy([T({})]));
  assert.equal(JSON.stringify(app.ctx.chain), before);
  assert.equal(app.status.textContent, 'Não foi possível salvar os dados importados. Nada foi alterado; tente de novo ou faça um backup.');
  assert.equal(app.notices[0].id, 'import-save');
});

test('Mensagens do arquivo inválido distinguem JSON ilegível de formato desconhecido', async () => {
  const app = importSetup();
  await app.run('isto não é json');
  assert.equal(app.status.textContent, 'Arquivo inválido: o conteúdo não é um JSON legível. Use um backup exportado por este app.');
  await app.run(JSON.stringify({ outra: 'coisa' }));
  assert.equal(app.status.textContent, 'Arquivo inválido: não tem a blockchain nem a lista de operações (trades) de um backup. Use um backup exportado por este app.');
});

test('Importação de cadeia adulterada continua rejeitada', async () => {
  const app = importSetup();
  const c = [engine.makeGenesisBlock(1)];
  engine.appendBlock(c, T({}));
  c[1].data = { ...c[1].data, value: 1 };
  await app.run(JSON.stringify({ chain: c }));
  assert.match(app.status.textContent, /blockchain adulterada \(bloco #1\)/);
});

/* ======================= APP: excluir carteira ======================= */
test('Texto de exclusão traz o nome da carteira e o número de operações (singular/plural)', () => {
  const ctx = vm.createContext({});
  vm.runInContext(between('  function pluralize', '  function openDeletePortfolioModal'), ctx);
  assert.equal(
    vm.runInContext("describePortfolioDeletion('Real', { trades: 12, deposits: 1 })", ctx),
    'Você vai excluir a carteira "Real", com 12 operações e 1 depósito. Todos os dados dela serão apagados deste aparelho e não há como desfazer.'
  );
  assert.match(vm.runInContext("describePortfolioDeletion('Teste', { trades: 1, deposits: 0 })", ctx), /com 1 operação e 0 depósitos\./);
});

test('Excluir carteira: sem alert/confirm nativo, modal com Exportar backup antes / Excluir / Cancelar, ícones SVG e sem estilo inline', () => {
  const handler = between("  document.getElementById('deletePortfolioBtn').addEventListener", "  document.getElementById('deletePortfolioExportBtn')");
  assert.doesNotMatch(handler, /\b(alert|confirm)\(/);
  const modal = html.slice(html.indexOf('id="deletePortfolioOverlay"'), html.indexOf('id="appWrap"'));
  assert.match(modal, /Exportar backup antes/);
  assert.match(modal, /id="deletePortfolioConfirmBtn"[^>]*><i data-icon="trash"[^>]*><\/i> Excluir/);
  assert.match(modal, /data-icon="download"/);
  assert.doesNotMatch(modal, /style=/);
  assert.doesNotMatch(modal, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u, 'sem emoji');
  assert.match(css, /\.io-btn\.io-btn-danger/);
  assert.match(css, /\.notice-banner/);
});

test('Confirmar exclusão grava a lista antes de apagar os dados (falha na lista não apaga nada)', () => {
  const fn = between('  async function confirmDeletePortfolio', "  document.getElementById('deletePortfolioBtn')");
  assert.ok(fn.indexOf('savePortfolioList()') < fn.indexOf('localStorage.removeItem'));
  assert.match(fn, /Nada foi apagado/);
});

test('Backup exportado é o mesmo do menu (exportBackup compartilhado)', () => {
  assert.match(source, /document\.getElementById\('exportBtn'\)\.addEventListener\('click', exportBackup\)/);
  assert.match(source, /await exportBackup\(\)/);
});

/* ======================= Paridade dos HTML e tokens de CSS ======================= */
test('index.html (publicado) e cripto-app.html têm os mesmos ids; só o <script> muda', () => {
  const index = readFileSync(require.resolve('../src/index.html'), 'utf8');
  const ids = h => new Set([...h.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
  const a = ids(index), b = ids(html);
  assert.deepEqual([...a].sort(), [...b].sort());
  for (const id of ['appNotices', 'deletePortfolioOverlay', 'deletePortfolioText', 'deletePortfolioStatus', 'deletePortfolioExportBtn',
    'deletePortfolioConfirmBtn', 'deletePortfolioCancelBtn', 'closeDeletePortfolioBtn']) assert.ok(a.has(id), `index.html sem #${id}`);
  const strip = h => h.replace(/<script src="js\/(app|program)\.js"><\/script>/, '');
  assert.equal(strip(index), strip(html));
});

test('Todo id lido pelo app.js por getElementById existe no index.html', () => {
  const index = readFileSync(require.resolve('../src/index.html'), 'utf8');
  const have = new Set([...index.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
  const used = new Set([...source.matchAll(/getElementById\('([^']+)'\)/g)].map(m => m[1]));
  for (const id of ['appNotices', 'deletePortfolioOverlay', 'deletePortfolioText', 'deletePortfolioStatus', 'deletePortfolioExportBtn',
    'deletePortfolioConfirmBtn', 'deletePortfolioCancelBtn', 'closeDeletePortfolioBtn', 'deletePortfolioBtn']) assert.ok(used.has(id));
  const missing = [...used].filter(id => !have.has(id));
  // ids criados em JS (dinâmicos) ficam fora desta checagem
  const created = new Set([...source.matchAll(/\bid="([^"$]+)"/g)].map(m => m[1]));
  assert.deepEqual(missing.filter(id => !created.has(id)), []);
});

test('CSS: nenhum token --x é definido com var(--x) dentro dele (referência circular)', () => {
  const circular = [];
  for (const m of css.matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)) {
    if (new RegExp('var\\(\\s*' + m[1] + '\\s*[,)]').test(m[2])) circular.push(m[1]);
  }
  assert.deepEqual(circular, []);
  for (const t of ['--up-soft', '--down-soft', '--warn-soft']) assert.match(css, new RegExp(t + ':\\s*rgba\\('));
});

/* ======================= Ressalvas do QA ======================= */
test('readLocalJson com array: JSON válido que não é lista vira dado ilegível (cópia, log e aviso; não some em silêncio)', () => {
  for (const raw of ['{"a":1}', '"texto"', '42']) {
    const s = storageSetup({ initial: { k: raw } });
    const r = vm.runInContext("readLocalJson('histórico de operações', 'k', [], { keepCopy: true, array: true })", s.ctx);
    assert.deepEqual([...r], []);
    assert.equal(s.store['k.corrompido'], raw);
    assert.equal(s.store.k, raw, 'o original não é tocado pela leitura');
    assert.equal(s.errors[0][0], 'Falha de leitura local: histórico de operações');
    vm.runInContext('flushLoadProblems()', s.ctx);
    assert.equal(s.dom.host.children[0].dataset.notice, 'load-problems');
  }
});

test('readLocalJson com array aceita lista e ausência sem aviso', () => {
  const s = storageSetup({ initial: { k: '[1]' } });
  assert.deepEqual([...vm.runInContext("readLocalJson('x', 'k', [], { array: true })", s.ctx)], [1]);
  assert.deepEqual([...vm.runInContext("readLocalJson('x', 'nada', [], { array: true })", s.ctx)], []);
  assert.equal(s.errors.length, 0);
});

test('Leituras de chain, carteiras, histórico, alertas e legados usam array: true', () => {
  const load = between('  async function loadCurrentPortfolioData()', '  function saveHistory()');
  assert.match(load, /histórico de operações[^\n]*array: true/);
  for (const label of ['histórico de patrimônio', 'alertas', 'operações antigas', 'depósitos antigos']) assert.match(load, new RegExp(label + "[^\\n]*array: true"));
  assert.match(source, /lista de carteiras[^\n]*array: true/);
  assert.doesNotMatch(load, /if \(!Array\.isArray\(chain\)\) chain = \[\]/);
});

test('Favoritos: falha na gravação reverte a lista e a caixa marcada', () => {
  const block = between("    el.querySelectorAll('input[data-fav]')", '  let assetFilterQuery');
  assert.match(block, /if \(!await saveFavorites\(\)\) \{ favoriteAssets = previous; cb\.checked = previous\.includes\(key\); \}/);
  // execução real do listener
  let listener; const cb = { dataset: { fav: 'btc' }, checked: false, addEventListener: (_, fn) => { listener = fn; } };
  const ctx = vm.createContext({ favoriteAssets: ['btc', 'eth'], saveFavorites: async () => false, renderConverter: () => {}, el: { querySelectorAll: () => [cb] } });
  vm.runInContext(block.replace(/\n  \}\s*$/, ''), ctx);
  return listener().then(() => {
    assert.deepEqual([...ctx.favoriteAssets], ['btc', 'eth']);
    assert.equal(cb.checked, true);
  });
});
