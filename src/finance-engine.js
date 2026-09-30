/**
 * finance-engine.js — Núcleo de regras financeiras, blockchain SHA-256 e cálculos tributários
 * Compatível com navegador (global) e Node.js (CommonJS / ESM).
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.FinanceEngine = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ---- SHA-256 em JS Puro ---- */
  function rrot(x, n) {
    return (x >>> n) | (x << (32 - n));
  }

  const K = [
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
  ];

  function sha256Sync(message) {
    let H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    const bytes = new TextEncoder().encode(message);
    const bitLen = bytes.length * 8;
    const withOne = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6);
    withOne.set(bytes);
    withOne[bytes.length] = 0x80;
    const dv = new DataView(withOne.buffer);
    dv.setUint32(withOne.length - 4, bitLen >>> 0);
    dv.setUint32(withOne.length - 8, Math.floor(bitLen / 4294967296));

    const w = new Array(64);
    for (let chunk = 0; chunk < withOne.length; chunk += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(chunk + i * 4);
      for (let i = 16; i < 64; i++) {
        const s0 = rrot(w[i-15], 7) ^ rrot(w[i-15], 18) ^ (w[i-15] >>> 3);
        const s1 = rrot(w[i-2], 17) ^ rrot(w[i-2], 19) ^ (w[i-2] >>> 10);
        w[i] = (w[i-16] + s0 + w[i-7] + s1) >>> 0;
      }
      let [a,b,c,d,e,f,g,h] = H;
      for (let i = 0; i < 64; i++) {
        const S1 = rrot(e,6) ^ rrot(e,11) ^ rrot(e,25);
        const ch = (e & f) ^ (~e & g);
        const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
        const S0 = rrot(a,2) ^ rrot(a,13) ^ rrot(a,22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + maj) >>> 0;
        h=g; g=f; f=e; e=(d+t1)>>>0; d=c; c=b; b=a; a=(t1+t2)>>>0;
      }
      H = [H[0]+a, H[1]+b, H[2]+c, H[3]+d, H[4]+e, H[5]+f, H[6]+g, H[7]+h].map(x => x >>> 0);
    }
    return H.map(x => x.toString(16).padStart(8, '0')).join('');
  }

  function computeBlockHash(block) {
    const raw = block.index + '|' + block.timestamp + '|' + JSON.stringify(block.data) + '|' + block.previousHash;
    return sha256Sync(raw);
  }

  function makeGenesisBlock(timestamp = Date.now()) {
    const block = {
      index: 0,
      timestamp,
      data: null,
      previousHash: '0'.repeat(64)
    };
    block.hash = computeBlockHash(block);
    return block;
  }

  function appendBlock(chainArr, data, timestamp = Date.now()) {
    if (!chainArr || chainArr.length === 0) {
      throw new Error('Cadeia vazia: crie o bloco gênese antes de adicionar blocos.');
    }
    const prev = chainArr[chainArr.length - 1];
    const block = {
      index: prev.index + 1,
      timestamp: data.timestamp || timestamp,
      data,
      previousHash: prev.hash
    };
    block.hash = computeBlockHash(block);
    chainArr.push(block);
    return block;
  }

  function verifyChainIntegrity(chainArr) {
    if (!Array.isArray(chainArr) || chainArr.length === 0) {
      return { valid: false, at: 0, reason: 'cadeia vazia ou formato inválido' };
    }
    for (let i = 0; i < chainArr.length; i++) {
      const b = chainArr[i];
      const recomputed = computeBlockHash({
        index: b.index,
        timestamp: b.timestamp,
        data: b.data,
        previousHash: b.previousHash
      });
      if (recomputed !== b.hash) {
        return { valid: false, at: i, reason: 'hash do bloco não confere' };
      }
      if (i > 0 && b.previousHash !== chainArr[i - 1].hash) {
        return { valid: false, at: i, reason: 'encadeamento quebrado com o bloco anterior' };
      }
    }
    return { valid: true };
  }

  /* ---- Constantes fiscais e de câmbio (legislação vigente em set/2026) ---- */
  // Cotação usada SOMENTE quando não há nenhuma cotação disponível (nem da operação, nem atual).
  // Único fallback do app: sempre sinalizado como "estimado" na UI e no relatório.
  const FALLBACK_BRL_PER_USD = 5.5;
  const EXEMPTION_LIMIT_BRL = 35000; // isenção mensal (regime nacional)
  const DARF_MIN_BRL = 10; // Lei 9.430/96 art. 68: abaixo disso acumula para o mês seguinte
  const FOREIGN_RATE = 0.15; // Lei 14.754/2023: alíquota fixa, apuração anual
  const DEFAULT_SPREAD_PCT = 1; // spread/slippage estimado sobre a cotação média
  const TAX_TIMEZONE = 'America/Sao_Paulo';
  // Lei 8.981/95 art. 21 (red. Lei 13.259/2016): faixas progressivas de ganho de capital
  const CAPITAL_GAINS_BRACKETS = [
    { upTo: 5000000, rate: 0.15 },
    { upTo: 10000000, rate: 0.175 },
    { upTo: 30000000, rate: 0.20 },
    { upTo: Infinity, rate: 0.225 }
  ];
  const TAX_DISCLAIMERS = [
    'Simulação educativa: não substitui contador, o GCAP nem a declaração de ajuste anual.',
    'O regime depende do local de custódia: exchange nacional (ganho de capital mensal, isenção de R$ 35 mil, DARF 4600) ou exterior (Lei 14.754/2023: 15% fixo, apuração anual na declaração, sem isenção de R$ 35 mil e sem DARF mensal).',
    'O câmbio USD/BRL usado é indicativo (mercado/cripto), não a PTAX do Banco Central, que é a cotação oficial da apuração.',
    'Os rendimentos da Meta de Lucro são hipóteses sem fonte, não promessa nem previsão de retorno; renda passiva (lending/staking) também é tributável.',
    'Legislação vigente em set/2026. A MP 1.303/2025 (alíquota única) caducou, mas o tema pode voltar; confira as regras antes de decidir.'
  ];

  const round2 = (x) => Math.round((Number(x) + Number.EPSILON) * 100) / 100;

  /** Chave AAAA-MM no fuso America/Sao_Paulo (não depende do fuso do aparelho). */
  function monthKeySP(timestamp) {
    let parts;
    try {
      parts = new Intl.DateTimeFormat('en-CA', { timeZone: TAX_TIMEZONE, year: 'numeric', month: '2-digit' }).formatToParts(new Date(timestamp));
    } catch (e) {
      const d = new Date(Number(timestamp) - 3 * 3600 * 1000); // BRT fixo (sem horário de verão desde 2019)
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    }
    const y = parts.find(p => p.type === 'year').value;
    const m = parts.find(p => p.type === 'month').value;
    return `${y}-${m}`;
  }

  /* ---- Economia de uma operação (valor, taxas, spread) ---- */
  function tradeGrossUSD(t) {
    if (t.value != null && Number.isFinite(Number(t.value))) return Number(t.value);
    return (Number(t.qty) || 0) * (Number(t.price) || 0);
  }
  function tradeCostsUSD(t) {
    const fee = Number(t.feeUSD != null ? t.feeUSD : t.fee) || 0; // `fee` legado = USD absoluto
    const spread = Number(t.spreadUSD) || 0;
    return { fee: Math.max(0, fee), spread: Math.max(0, spread) };
  }
  /** Compra: total pago (valor + taxa + spread). Venda: líquido recebido (valor − taxa − spread). */
  function tradeNetUSD(t) {
    const gross = tradeGrossUSD(t);
    const c = tradeCostsUSD(t);
    return t.type === 'buy' ? gross + c.fee + c.spread : gross - c.fee - c.spread;
  }

  /* ---- Cálculos de Saldo e Carteira ---- */
  function computeCashBalance(deposits = [], trades = []) {
    const totalDeposited = deposits.reduce((s, d) => s + (Number(d.amount) || 0), 0);
    const totalBuy = trades.filter(t => t.type === 'buy').reduce((s, t) => s + tradeNetUSD(t), 0);
    const totalSell = trades.filter(t => t.type === 'sell').reduce((s, t) => s + tradeNetUSD(t), 0);
    return totalDeposited - totalBuy + totalSell;
  }

  function totalTradeCostsUSD(trades = []) {
    return trades.reduce((s, t) => { const c = tradeCostsUSD(t); return s + c.fee + c.spread; }, 0);
  }

  function computeSummary(assetKeys, trades = [], currentUsdPrices = {}) {
    const perAsset = {};
    assetKeys.forEach(a => {
      perAsset[a] = { boughtQty: 0, boughtCost: 0, soldQty: 0, soldProceeds: 0, realized: 0 };
    });

    const sortedTrades = [...trades].sort((a, b) => a.timestamp - b.timestamp);
    sortedTrades.forEach(t => {
      const s = perAsset[t.asset];
      if (!s) return;
      const qty = Number(t.qty) || 0;

      if (t.type === 'buy') {
        s.boughtQty += qty;
        s.boughtCost += tradeNetUSD(t); // taxa e spread de compra entram no custo
      } else if (t.type === 'sell') {
        const avgCostAtSale = s.boughtQty > 0 ? (s.boughtCost / s.boughtQty) : 0;
        const netSaleProceeds = tradeNetUSD(t); // taxa e spread de venda reduzem a alienação
        const costBasisSold = avgCostAtSale * qty;
        s.realized += netSaleProceeds - costBasisSold;
        s.soldQty += qty;
        s.soldProceeds += netSaleProceeds;
        s.boughtCost = Math.max(0, s.boughtCost - costBasisSold);
        s.boughtQty = Math.max(0, s.boughtQty - qty);
      }
    });

    let totalCryptoValue = 0;
    let totalUnrealizedGain = 0;
    let totalRealizedGain = 0;

    assetKeys.forEach(a => {
      const s = perAsset[a];
      const price = Number(currentUsdPrices[a]) || 0;
      const currentValue = s.boughtQty * price;
      const unrealized = currentValue - s.boughtCost;
      s.currentValue = currentValue;
      s.avgCost = s.boughtQty > 0 ? (s.boughtCost / s.boughtQty) : 0;
      s.unrealized = unrealized;
      totalCryptoValue += currentValue;
      totalUnrealizedGain += unrealized;
      totalRealizedGain += s.realized;
    });

    return {
      perAsset,
      totalCryptoValue,
      totalUnrealizedGain,
      totalRealizedGain,
      totalNetGain: totalUnrealizedGain + totalRealizedGain
    };
  }

  /* ---- Câmbio por operação ---- */
  /**
   * Cotação BRL/USD de uma operação. Prioridade: gravada na operação ("operation"),
   * cotação atual ("current", estimada) e, por último, o fallback fixo ("fallback", estimada).
   */
  function resolveFx(t, currentBrlPerUsd) {
    const own = Number(t.fxRate);
    if (Number.isFinite(own) && own > 0) {
      return { rate: own, source: t.fxSource === 'fallback' ? 'fallback' : 'operation' };
    }
    const cur = Number(currentBrlPerUsd);
    if (Number.isFinite(cur) && cur > 0) return { rate: cur, source: 'current' };
    return { rate: FALLBACK_BRL_PER_USD, source: 'fallback' };
  }

  /* ---- Ganho de capital progressivo (regime nacional) ---- */
  function capitalGainsTax(gainBRL) {
    const gain = Math.max(0, Number(gainBRL) || 0);
    let lower = 0;
    let tax = 0;
    const detail = [];
    for (const b of CAPITAL_GAINS_BRACKETS) {
      if (gain <= lower) break;
      const slice = Math.min(gain, b.upTo) - lower;
      const part = slice * b.rate;
      tax += part;
      detail.push({ rate: b.rate, base: slice, tax: part });
      lower = b.upTo;
    }
    return { tax: round2(tax), detail };
  }

  /* ---- Apuração fiscal IRPF Cripto (Brasil; DeCripto IN RFB 2.291/2025) ---- */
  /**
   * Relatório completo, em R$ histórico: cada operação usa a cotação gravada no dia
   * (custo = cotações das compras; alienação = cotação da venda).
   *
   * Regime nacional (custódia em exchange brasileira): mensal, isenção se alienação
   * ≤ R$ 35.000,00 (em centavos), faixas de 15% a 22,5%, sem compensar perdas
   * (postura conservadora: soma dos ganhos positivos por operação), DARF 4600 só se ≥ R$ 10.
   * Regime exterior (Lei 14.754/2023): 15% fixo, anual, sem isenção, sem DARF mensal,
   * perdas compensam no ano e passam aos anos seguintes.
   *
   * opts: { currentBrlPerUsd, defaultCustody }
   */
  function computeTaxReport(assetKeys, trades = [], opts = {}) {
    const currentBrlPerUsd = opts.currentBrlPerUsd;
    const defaultCustody = opts.defaultCustody === 'foreign' ? 'foreign' : 'national';
    const pools = {};
    (assetKeys || []).forEach(k => { pools[k] = { qty: 0, costUSD: 0, costBRL: 0, estimated: false }; });

    const months = {};
    const newMonth = (key) => ({
      monthKey: key,
      operations: [],
      volumeBRL: 0,
      volumeUSD: 0,
      operationsCount: 0,
      estimated: false,
      fxFallback: false,
      national: { alienationBRL: 0, alienationUSD: 0, netGainBRL: 0, taxableGainBRL: 0, lossBRL: 0, salesCount: 0 },
      foreign: { alienationBRL: 0, alienationUSD: 0, netGainBRL: 0, salesCount: 0 }
    });

    const sorted = [...trades].sort((a, b) => a.timestamp - b.timestamp);
    sorted.forEach(t => {
      const pool = pools[t.asset] || (pools[t.asset] = { qty: 0, costUSD: 0, costBRL: 0, estimated: false });
      const qty = Number(t.qty) || 0;
      const key = monthKeySP(t.timestamp);
      const m = months[key] || (months[key] = newMonth(key));
      const fx = resolveFx(t, currentBrlPerUsd);
      const grossUSD = tradeGrossUSD(t);
      const netUSD = tradeNetUSD(t);
      const custody = (t.custody === 'foreign' || t.custody === 'national') ? t.custody : defaultCustody;

      m.volumeBRL += grossUSD * fx.rate;
      m.volumeUSD += grossUSD;
      m.operationsCount += 1;
      if (fx.source !== 'operation') m.estimated = true;
      if (fx.source === 'fallback') m.fxFallback = true;

      if (t.type === 'buy') {
        pool.qty += qty;
        pool.costUSD += netUSD;
        pool.costBRL += netUSD * fx.rate;
        if (fx.source !== 'operation') pool.estimated = true;
      } else if (t.type === 'sell') {
        const avgUSD = pool.qty > 0 ? pool.costUSD / pool.qty : 0;
        const avgBRL = pool.qty > 0 ? pool.costBRL / pool.qty : 0;
        const costBasisUSD = avgUSD * qty;
        const costBasisBRL = avgBRL * qty;
        const alienationBRL = grossUSD * fx.rate; // limite de isenção: valor bruto da venda
        const netAlienationBRL = netUSD * fx.rate;
        const gainBRL = netAlienationBRL - costBasisBRL;
        const gainUSD = netUSD - costBasisUSD;
        const estimated = fx.source !== 'operation' || pool.estimated;

        pool.qty = Math.max(0, pool.qty - qty);
        pool.costUSD = Math.max(0, pool.costUSD - costBasisUSD);
        pool.costBRL = Math.max(0, pool.costBRL - costBasisBRL);
        if (pool.qty <= 1e-12) { pool.qty = 0; pool.costUSD = 0; pool.costBRL = 0; pool.estimated = false; }

        if (estimated) m.estimated = true;
        const bucket = custody === 'foreign' ? m.foreign : m.national;
        bucket.alienationBRL += alienationBRL;
        bucket.alienationUSD += grossUSD;
        bucket.netGainBRL += gainBRL;
        bucket.salesCount += 1;
        if (custody !== 'foreign') {
          if (gainBRL > 0) m.national.taxableGainBRL += gainBRL; else m.national.lossBRL += -gainBRL;
        }
        m.operations.push({
          timestamp: t.timestamp, asset: t.asset, qty, price: Number(t.price) || 0, custody,
          saleProceedsUsd: grossUSD, netProceedsUsd: netUSD, costsUsd: grossUSD - netUSD,
          alienationBRL, gainBRL, gainUSD, fxRate: fx.rate, fxSource: fx.source, estimated,
          avgCost: avgUSD, realizedGainUsd: gainUSD
        });
      }
    });

    // Regime nacional: isenção, faixas e DARF mínimo com acúmulo entre meses
    const monthKeys = Object.keys(months).sort();
    let darfCarry = 0;
    monthKeys.forEach(key => {
      const m = months[key];
      const n = m.national;
      n.alienationBRL = round2(n.alienationBRL);
      n.isExempt = n.alienationBRL <= EXEMPTION_LIMIT_BRL; // compara em centavos (evita erro de float)
      n.exemptionLimit = EXEMPTION_LIMIT_BRL;
      const cg = (!n.isExempt && n.taxableGainBRL > 0) ? capitalGainsTax(n.taxableGainBRL) : { tax: 0, detail: [] };
      n.taxBRL = cg.tax;
      n.brackets = cg.detail;
      n.darfCarryInBRL = darfCarry;
      const accumulated = round2(darfCarry + n.taxBRL);
      if (accumulated > 0 && accumulated < DARF_MIN_BRL) {
        n.darfBRL = 0;
        n.darfCarryOutBRL = accumulated;
        n.darfDeferred = true;
      } else {
        n.darfBRL = accumulated;
        n.darfCarryOutBRL = 0;
        n.darfDeferred = false;
      }
      darfCarry = n.darfCarryOutBRL;
      m.volumeBRL = round2(m.volumeBRL);
      m.decripto = {
        volumeBRL: m.volumeBRL,
        limitBRL: EXEMPTION_LIMIT_BRL,
        triggered: m.volumeBRL > EXEMPTION_LIMIT_BRL
      };
      m.foreign.alienationBRL = round2(m.foreign.alienationBRL);
    });

    // Regime exterior: apuração anual, perdas compensam no ano e nos anos seguintes
    const foreignYears = {};
    monthKeys.forEach(key => {
      const f = months[key].foreign;
      if (!f.salesCount) return;
      const y = key.slice(0, 4);
      const fy = foreignYears[y] || (foreignYears[y] = { year: y, netGainBRL: 0, alienationBRL: 0, salesCount: 0, estimated: false });
      fy.netGainBRL += f.netGainBRL;
      fy.alienationBRL += f.alienationBRL;
      fy.salesCount += f.salesCount;
      if (months[key].operations.some(o => o.custody === 'foreign' && o.estimated)) fy.estimated = true;
    });
    let lossCarry = 0;
    Object.keys(foreignYears).sort().forEach(y => {
      const fy = foreignYears[y];
      fy.lossCarryInBRL = lossCarry;
      const adjusted = fy.netGainBRL - lossCarry;
      fy.taxableBaseBRL = adjusted > 0 ? adjusted : 0;
      fy.lossCarryOutBRL = adjusted < 0 ? -adjusted : 0;
      fy.taxBRL = round2(fy.taxableBaseBRL * FOREIGN_RATE);
      lossCarry = fy.lossCarryOutBRL;
    });

    return { months, monthKeys, foreignYears, fallbackBrlPerUsd: FALLBACK_BRL_PER_USD };
  }

  /** Compatibilidade: resumo de um mês (assinatura antiga). Operações sem cotação usam `brlPerUsd` (estimado). */
  function computeTaxMonthSummary(assetKeys, trades = [], targetYearMonth, brlPerUsd = FALLBACK_BRL_PER_USD) {
    const report = computeTaxReport(assetKeys, trades, { currentBrlPerUsd: brlPerUsd });
    const m = report.months[targetYearMonth] || newEmptyMonth(targetYearMonth);
    return {
      targetYearMonth,
      totalAlienationBRL: m.national.alienationBRL,
      exemptionLimit: EXEMPTION_LIMIT_BRL,
      isExempt: m.national.isExempt,
      totalRealizedGainBRL: m.national.netGainBRL,
      taxEstimatedBRL: m.national.taxBRL,
      darfBRL: m.national.darfBRL,
      estimated: m.estimated,
      monthSales: m.operations
    };
  }
  function newEmptyMonth(key) {
    return {
      monthKey: key, operations: [], estimated: false, volumeBRL: 0,
      national: { alienationBRL: 0, netGainBRL: 0, isExempt: true, taxBRL: 0, darfBRL: 0 }
    };
  }

  /* ---- Simulador DCA (Dollar Cost Averaging) ----
   * Ferramenta ilustrativa, SEM interface no app e sem previsão de retorno. Trajetória de preço
   * determinística e neutra: onda cíclica de média zero + deriva linear do cenário
   * ('flat' = 0%, 'up' = +20%, 'down' = -20% ao longo do período). Sem viés de alta embutido;
   * o aporte único (lump sum) compra tudo ao mesmo preço inicial do 1º aporte do DCA.
   */
  const DCA_SCENARIO_DRIFT = { flat: 0, up: 0.2, down: -0.2 };
  function calculateDCASimulation(currentPrice, periodicAmountUSD, frequencyDays, totalMonths, scenario = 'flat') {
    const price = Math.max(0.000001, Number(currentPrice) || 1);
    const amount = Math.max(0.01, Number(periodicAmountUSD) || 10);
    const freq = Math.max(1, Number(frequencyDays) || 30);
    const months = Math.max(1, Number(totalMonths) || 12);
    const scenarioKey = Object.prototype.hasOwnProperty.call(DCA_SCENARIO_DRIFT, scenario) ? scenario : 'flat';
    const drift = DCA_SCENARIO_DRIFT[scenarioKey];

    const totalDays = months * 30.5;
    const totalInstallments = Math.max(1, Math.floor(totalDays / freq));
    const totalInvestedUSD = totalInstallments * amount;

    const pathPrice = (t) => Math.max(price * 0.15, price * (1 + drift * t) * (1 + 0.2 * Math.sin(t * Math.PI * 2)));

    let accumulatedCoins = 0;
    for (let i = 0; i < totalInstallments; i++) {
      accumulatedCoins += amount / pathPrice(i / totalInstallments);
    }
    const finalPrice = pathPrice(1);
    const finalValueUSD = accumulatedCoins * finalPrice;
    const avgCostUSD = totalInvestedUSD / accumulatedCoins;
    const profitUSD = finalValueUSD - totalInvestedUSD;
    const profitPct = totalInvestedUSD > 0 ? (profitUSD / totalInvestedUSD) * 100 : 0;

    const lumpSumCoins = totalInvestedUSD / pathPrice(0);
    const lumpSumFinalUSD = lumpSumCoins * finalPrice;
    const lumpSumProfitPct = ((lumpSumFinalUSD - totalInvestedUSD) / totalInvestedUSD) * 100;

    return {
      scenario: scenarioKey,
      hypothetical: true,
      totalInstallments,
      totalInvestedUSD,
      accumulatedCoins,
      avgCostUSD,
      finalValueUSD,
      profitUSD,
      profitPct,
      lumpSumFinalUSD,
      lumpSumProfitPct
    };
  }

  /* ---- Calculadora de Meta de Lucro (Target Profit) ---- */
  // Rendimentos HIPOTÉTICOS, sem fonte: não são previsão nem promessa de retorno.
  const TARGET_PROFIT_TAX_RATE = 0.15;
  function calculateTargetProfitScenarios(targetAmountUSD, periodicity = 'month') {
    const rawTarget = Number(targetAmountUSD);
    const target = isNaN(rawTarget) || rawTarget < 0 ? 0 : rawTarget;
    const isMonthly = String(periodicity).toLowerCase() === 'month';
    const annualProfitUSD = isMonthly ? target * 12 : target;

    const scenarios = [
      { cenario: 'Conservador (Com folga)', rendimentoPct: 5, observacao: 'Hipótese: não protege contra quedas de preço' },
      { cenario: 'Moderado', rendimentoPct: 10, observacao: 'Hipótese de médio prazo, sem garantia' },
      { cenario: 'Ciclo de Alta', rendimentoPct: 15, observacao: 'Hipótese: depende de forte valorização' },
      { cenario: 'Lending / Juros', rendimentoPct: 2, observacao: 'Renda passiva também é tributável' }
    ];

    const rows = scenarios.map(s => {
      const rate = s.rendimentoPct / 100;
      // capital bruto necessário para que o lucro LÍQUIDO (após 15% de IR) atinja a meta
      const capitalUSD = rate > 0 ? (annualProfitUSD / (rate * (1 - TARGET_PROFIT_TAX_RATE))) : 0;
      return {
        cenario: s.cenario,
        rendimentoEstimado: `${s.rendimentoPct}% a.a. (hipotético)`,
        rendimentoPct: s.rendimentoPct,
        hipotetico: true,
        capitalUSD,
        observacao: s.observacao
      };
    });

    return {
      targetAmountUSD: target,
      periodicity: isMonthly ? 'month' : 'year',
      annualProfitUSD,
      taxRate: TARGET_PROFIT_TAX_RATE,
      hypothetical: true,
      rows
    };
  }

  return {
    sha256Sync,
    computeBlockHash,
    makeGenesisBlock,
    appendBlock,
    verifyChainIntegrity,
    computeCashBalance,
    computeSummary,
    computeTaxMonthSummary,
    computeTaxReport,
    capitalGainsTax,
    resolveFx,
    monthKeySP,
    tradeGrossUSD,
    tradeCostsUSD,
    tradeNetUSD,
    totalTradeCostsUSD,
    calculateDCASimulation,
    calculateTargetProfitScenarios,
    FALLBACK_BRL_PER_USD,
    EXEMPTION_LIMIT_BRL,
    DARF_MIN_BRL,
    FOREIGN_RATE,
    DEFAULT_SPREAD_PCT,
    CAPITAL_GAINS_BRACKETS,
    TAX_DISCLAIMERS
  };
});
