const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const ler = (arquivo) => readFileSync(path.join(__dirname, '..', 'src', arquivo), 'utf8');
const css = ler('css/style.css');
const index = ler('index.html');
const espelho = ler('cripto-app.html');
const sw = ler('sw.js');

// Trecho do formulário "Registrar operação" (aba Portfólio).
const formulario = (html) => html.slice(html.indexOf('<form class="trade-form"'), html.indexOf('</form>', html.indexOf('<form class="trade-form"')));

test('formulário de operação vira uma coluna no celular', () => {
  const media = css.match(/@media \(max-width: (\d+)px\) \{ form\.trade-form \{ grid-template-columns: minmax\(0, 1fr\); \} \}/);
  assert.ok(media, 'regra de uma coluna ausente');
  assert.ok(Number(media[1]) >= 480, 'o ponto de quebra precisa cobrir celulares de até 480px');
  assert.match(css, /form\.trade-form \{[^}]*grid-template-columns: 1fr 1fr;[^}]*align-items: end;/);
});

test('taxa da corretora usa .fee-row com largura útil e seletor fixo', () => {
  assert.match(css, /\.fee-row \{ display: flex; gap: 6px; \}/);
  assert.match(css, /\.fee-row input \{ flex: 1; min-width: 0; \}/);
  assert.match(css, /\.fee-row select \{ flex: 0 0 88px; width: 88px; \}/);
  const form = formulario(index);
  assert.match(form, /<div class="fee-row">\s*<input type="number" id="feeInput"[^>]*>\s*<select id="feeUnitSelect"/);
  // estilos inline antigos sobrescreviam a regra e espremiam o campo
  assert.doesNotMatch(form, /id="feeInput"[^>]*style=/);
  assert.doesNotMatch(form, /id="feeUnitSelect"[^>]*style=/);
});

test('spread fica fora da linha da taxa', () => {
  const form = formulario(index);
  const linhaTaxa = form.slice(form.indexOf('<div class="fee-row">'), form.indexOf('</div>', form.indexOf('<div class="fee-row">')));
  assert.doesNotMatch(linhaTaxa, /spreadInput/);
  assert.match(form, /id="spreadInput"/);
});

test('cripto-app.html espelha o formulário do index.html', () => {
  assert.equal(formulario(espelho), formulario(index));
});

test('versão igual no index, no espelho e no cache do service worker', () => {
  const versao = index.match(/data-vault-version="(\d+\.\d+\.\d+)"/)[1];
  assert.equal(espelho.match(/data-vault-version="(\d+\.\d+\.\d+)"/)[1], versao);
  assert.match(sw, new RegExp(`CACHE_NAME = 'cripto-app-v${versao.replace(/\./g, '\\.')}'`));
});
