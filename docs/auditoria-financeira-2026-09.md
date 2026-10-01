# Auditoria financeira de 30/09/2026 — correções (v1.8.0)

Branch: `fix/auditoria-financeira`. Legislação considerada: vigente em set/2026 (a MP 1.303/2025 caducou, mas o tema pode voltar).
Testes: `node --test test/*.test.js` (86/86). Suítes novas: `test/auditoria-financeira.test.js` (motor) e acréscimos em `test/trade-validation.test.js` (interface).

## Mudança de arquitetura (feita primeiro)

A tela calculava com funções próprias em `src/js/app.js` (`computeSummary`, `computeTaxReport`, regras fiscais dentro de `renderTaxModal`, fallback duplicado da Meta de Lucro), enquanto os testes cobriam `src/finance-engine.js`. Agora:

- `computeCashBalance`, `computeSummary`, `computeTaxReport` e a Meta de Lucro do `app.js` são apenas adaptadores que chamam `FinanceEngine.*`.
- Constantes fiscais (limite R$ 35 mil, faixas, DARF mínimo, alíquota exterior, câmbio de contingência, avisos legais) existem só no motor.
- Teste de guarda: `app.js delega cálculo ao finance-engine` (falha se reaparecer `35000`, `* 0.15`, fallback `5.4` ou cálculo local).

## Migração de dados antigos

- Operações já gravadas na blockchain local **não são alteradas** (mudar um bloco quebraria o hash). Os campos novos (`fxRate`, `fxSource`, `custody`, `feeUSD`, `spreadUSD`) são opcionais e o motor tem fallback:
  - sem `fxRate`: usa a cotação atual (`source: current`) e, sem cotação nenhuma, R$ 5,50 (`source: fallback`); em ambos os casos o valor é marcado **estimado** no relatório fiscal (mês, operação e cálculo do custo médio, que "contamina" as vendas seguintes do mesmo ativo);
  - sem `custody`: usa a custódia padrão da configuração (padrão: exchange nacional);
  - sem taxa/spread: custo zero (como antes); `fee` legado é lido como USD absoluto.
- Configurações antigas (`settings`) recebem `custody: 'national'` e `spreadPct: 1` (`normalizeSettings`), na carga, na importação de backup e na importação de arquivo conectado.
- Teste: `Configurações antigas ganham custódia e spread padrão (migração)`, `C1 operações antigas sem cotação...`, `A3 operações antigas sem taxa...`.

## Status por item

| ID | Status |
|----|--------|
| C1 | Corrigido |
| C2 | Corrigido (limitação: um único preço médio por ativo, ver item) |
| A1 | Corrigido |
| A2 | Pendente de validação com contador (postura conservadora implementada) |
| A3 | Corrigido |
| A4 | Corrigido (PTAX oficial não integrada, apenas sinalizada) |
| A5 | Parcial (app não registra permutas nem transferências) |
| M1 | Corrigido (removido do README; função neutra e documentada) |
| M2 | Corrigido |
| M3 | Corrigido |
| M4 | Corrigido |
| B1 | Corrigido |
| B2 | Corrigido |
| B3 | Corrigido |
| B4 | Corrigido |
| Disclaimers | Corrigido |

## Detalhe

### C1 — Câmbio atual aplicado a vendas antigas
- **Problema:** ganho e alienação em R$ multiplicados pelo câmbio de hoje, não pelo da data de cada operação; distorcia ganho e o teste de isenção.
- **Correção:** cada operação grava `fxRate` (R$ por US$) e `fxSource` ao ser registrada. `computeTaxReport` mantém custo médio em USD e em R$; ganho = alienação em R$ (câmbio da venda) − custo em R$ (câmbios das compras); isenção testada na alienação em R$ histórico. Operações antigas: câmbio atual, marcadas "estimado" (modal mostra aviso e "estimado" por venda).
- **Arquivos:** `src/finance-engine.js` (`resolveFx`, `computeTaxReport`), `src/js/app.js` (submit do `tradeForm`, `currentFx`, `renderTaxModal`).
- **Testes:** `C1 câmbio diferente entre compra e venda...`, `C1 isenção de R$ 35 mil é testada em R$ da data da venda`, `C1 operações antigas sem cotação...`, `C1 compra estimada contamina...`, `Nova operação grava taxa, spread, custódia e câmbio da data`.

### C2 — Regime único
- **Problema:** tudo tratado como exchange nacional.
- **Correção:** campo "local de custódia" por operação (padrão configurável). Exterior (Lei 14.754/2023; IN RFB 2.180/2024, art. 9º): 15% fixo, apuração **anual** (`foreignYears`), sem isenção de R$ 35 mil, sem DARF mensal, perdas compensam no ano e são levadas aos anos seguintes. Vendas no exterior não entram na isenção nem no DARF nacional. O modal mostra o bloco anual.
- **Arquivos:** `finance-engine.js` (`computeTaxReport`, `foreignYears`), `index.html` (`custodySelect`), `app.js`.
- **Testes:** `C2 exterior: 15% fixo anual...`, `C2 exterior: perdas compensam...`, `C2 exterior e nacional no mesmo mês não se misturam`, `C2 custódia padrão vem da configuração...`.
- **Limitação:** o custo médio é um só por ativo (não separa lotes por custódia); só a classificação da venda para fins de regime vem da custódia. Transferência entre custódias não é modelada.

### A1 — Faixas de ganho de capital
- **Correção:** `capitalGainsTax` progressivo por faixa: 15% até R$ 5 mi, 17,5% até R$ 10 mi, 20% até R$ 30 mi, 22,5% acima (Lei 8.981/95 art. 21, red. Lei 13.259/2016), aplicado ao ganho tributável do mês; o modal mostra "15% a 22,5%".
- **Testes:** `A1 faixas progressivas de ganho de capital`, `A1 relatório mensal aplica as faixas...`.
- **Observação:** as faixas são aplicadas à base mensal total (não por alienação individual); vale confirmar com o contador em valores acima de R$ 5 mi.

### A2 — Compensação de perda no mesmo mês
- **Correção:** regime nacional tributa a **soma dos ganhos positivos por operação**, sem abater perdas (postura conservadora). O relatório mostra o resultado líquido (informativo), a base tributável e a perda separadamente.
- **Teste:** `A2 regime nacional não compensa prejuízo...`.
- **Status: pendente de validação com contador** (a regra pode ser mais favorável ao contribuinte se a compensação no mês for permitida).

### A3 — Taxas
- **Problema:** README prometia taxas, mas `totalFees` não era usado e o motor ignorava `fee`.
- **Correção:** formulário com taxa (% ou USD) e spread/slippage estimado (padrão 1%, salvo em configurações, pois o preço é a cotação média). Compra: taxa + spread entram no custo e no caixa; venda: reduzem a alienação (ganho e caixa). O limite de isenção usa o valor **bruto** (conservador). `computeSummary`, `computeCashBalance` e o relatório fiscal usam a mesma regra (`tradeNetUSD`). O resumo exibe "Custos pagos". Venda em que taxa+spread ≥ valor é bloqueada; compra com taxa+spread acima do saldo respeita o bloqueio de saldo.
- **Testes:** `A3 taxa de compra entra no custo...`, `A3 relatório fiscal usa custo com taxa...`, `A3 operações antigas sem taxa...`, `Taxa em USD e spread padrão...`, `Compra com taxa+spread acima do saldo...`, `Venda com taxa+spread maiores que o valor...`.

### A4 — Câmbio não oficial e fallback escondido
- **Correção:** um único fallback (`FALLBACK_BRL_PER_USD = 5.5`, antes 5,40 no app e 5,50 no motor). Quando usado, a operação grava `fxSource: 'fallback'`, o relatório mostra "câmbio de contingência" e o modal avisa. Texto: câmbio indicativo, a apuração oficial usa a PTAX do BCB (modal, rodapé e README).
- **Testes:** `A4 sem nenhuma cotação usa um único fallback e sinaliza`, `A4 cotação gravada como fallback...`, `Sem cotação USD/BRL a operação grava o câmbio de contingência...`.
- **Limite:** a PTAX não é consultada (o app não usa serviço pago nem envia dados); o usuário deve conferir a PTAX na declaração.

### A5 — Gatilho DeCripto
- **Correção:** `decripto.volumeBRL` soma compras + vendas (e qualquer outro tipo de operação registrada) do mês, em R$ histórico, e dispara acima de R$ 35.000,00.
- **Teste:** `A5 gatilho DeCripto soma compras e vendas do mês`.
- **Status: parcial:** o app não registra permutas nem transferências entre carteiras, então o volume pode ficar subestimado; o modal avisa isso. O motor já soma qualquer operação futura desses tipos.

### M1 — DCA
- **Correção:** DCA não tem tela; removido do README (funcionalidade e resumo). A função `calculateDCASimulation` ficou neutra e documentada como ilustrativa: onda cíclica de média zero, cenários `flat`/`up`/`down` (0%, +20%, −20%), aporte único comprando no mesmo preço inicial (sem o "lump sum a 85%") e sem viés de alta; o parâmetro antigo de variação 24h é ignorado.
- **Testes:** `M1 DCA neutro: cenário flat...`, `M1 ... simétricos...`, `M1 DCA ignora o parâmetro legado...`.

### M2 — Meta de Lucro
- **Correção:** capital bruto = lucro anual ÷ (rendimento × (1 − 15%)); rendimentos rotulados "(hipotético)" e explicados como sem fonte; removido "Alta proteção contra quedas" (coluna virou "Observação"); lending/renda passiva marcado como tributável; fallback duplicado do `app.js` removido (usa só o motor).
- **Testes:** `M2 capital bruto considera o IR...`, dois testes de `financial.test.js` atualizados.

### M3 — Porcentagem do não realizado
- **Correção:** a linha do ativo mostra "total · não realizado (X%) · realizado", com a porcentagem ao lado do valor a que se refere.
- **Arquivo:** `app.js` (`renderSimulator`). Sem teste automatizado (rótulo de DOM); verificado por leitura.
- **Status:** corrigido.

### M4 — Limite em float
- **Correção:** alienação arredondada a centavos (`round2`) antes de comparar `≤ 35000`.
- **Testes:** `M4 fronteira exata de R$ 35.000,00...`, `M4 isenção soma todas as criptos do mês`.

### B1 — DARF mínimo
- **Correção:** imposto do mês + acumulado anterior < R$ 10,00 não gera DARF e acumula (Lei 9.430/96, art. 68); ≥ R$ 10,00 é recolhido com o acumulado. Modal informa.
- **Testes:** `B1 DARF abaixo de R$ 10,00...`, `B1 DARF exatamente R$ 10,00 é recolhido`.

### B2 — Fuso
- **Correção:** mês (e ano) de apuração por `Intl` no fuso `America/Sao_Paulo` (`monthKeySP`, com fallback UTC−3); datas do modal em horário de Brasília.
- **Testes:** `B2 mês de apuração usa America/Sao_Paulo...`, `B2 venda na noite de 30/09 (BRT) cai em setembro...`.

### B3 — computeSummary sem `Math.max(0, …)`
- **Correção:** o app usa o motor (com `Math.max(0, …)` em posição e custo).
- **Teste:** `B3 posição e custo nunca ficam negativos...`.

### B4 — Venda por stablecoin
- **Correção:** aviso no formulário de operação e no modal fiscal: vender cripto por USDT/stablecoin é permuta tributável.
- **Status:** corrigido (texto de UI, sem teste automatizado).

### Disclaimers
Cinco avisos (simulação educativa; regime nacional × exterior; câmbio indicativo, não PTAX; rendimentos hipotéticos; legislação de set/2026 e MP 1.303/2025) no rodapé de `src/index.html` (e `cripto-app.html`) e no modal fiscal (`FinanceEngine.TAX_DISCLAIMERS`, teste `Disclaimers fiscais cobrem os 5 avisos exigidos`).

## Mantido (não alterado)
Preço médio ponderado; isenção inclusiva ≤ R$ 35.000 tudo-ou-nada somando todas as criptos do mês (regime nacional); DARF 4600 até o último dia útil do mês seguinte; bloqueio de venda acima da custódia.

## Outros
- Versão 1.8.0 (`data-vault-version` e cache do service worker `cripto-app-v1.8.0`).
- CSV do extrato ganhou colunas: taxa+spread, câmbio USD/BRL, origem do câmbio e custódia.
- Não alterados: `../.security/`, `../.documents/`, arquivos `secure-*`.
