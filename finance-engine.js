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

  /* ---- Cálculos de Saldo e Carteira ---- */
  function computeCashBalance(deposits = [], trades = []) {
    const totalDeposited = deposits.reduce((s, d) => s + (Number(d.amount) || 0), 0);
    const totalBuy = trades.filter(t => t.type === 'buy').reduce((s, t) => s + (Number(t.value) || 0), 0);
    const totalSell = trades.filter(t => t.type === 'sell').reduce((s, t) => s + (Number(t.value) || 0), 0);
    return totalDeposited - totalBuy + totalSell;
  }

  function computeSummary(assetKeys, trades = [], currentUsdPrices = {}) {
    const perAsset = {};
    assetKeys.forEach(a => {
      perAsset[a] = {
        boughtQty: 0,
        boughtCost: 0,
        soldQty: 0,
        soldProceeds: 0,
        realized: 0
      };
    });

    const sortedTrades = [...trades].sort((a, b) => a.timestamp - b.timestamp);
    sortedTrades.forEach(t => {
      const a = t.asset;
      const s = perAsset[a];
      if (!s) return;

      const qty = Number(t.qty) || 0;
      const price = Number(t.price) || 0;

      if (t.type === 'buy') {
        s.boughtQty += qty;
        s.boughtCost += (qty * price);
      } else if (t.type === 'sell') {
        const avgCostAtSale = s.boughtQty > 0 ? (s.boughtCost / s.boughtQty) : 0;
        const netSaleProceeds = (qty * price);
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
      const costBasis = s.boughtCost;
      const unrealized = currentValue - costBasis;
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

  /* ---- Apuração Fiscal IRPF Cripto (IN 1888 - Brasil) ---- */
  function computeTaxMonthSummary(assetKeys, trades = [], targetYearMonth, brlPerUsd = 5.5) {
    const running = {};
    assetKeys.forEach(k => { running[k] = { boughtQty: 0, boughtCost: 0 }; });

    let totalAlienationBRL = 0;
    let totalRealizedGainBRL = 0;
    const monthSales = [];

    const sorted = [...trades].sort((a, b) => a.timestamp - b.timestamp);
    sorted.forEach(t => {
      const a = t.asset;
      const s = running[a] || { boughtQty: 0, boughtCost: 0 };
      running[a] = s;

      const qty = Number(t.qty) || 0;
      const price = Number(t.price) || 0;

      const d = new Date(t.timestamp);
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

      if (t.type === 'buy') {
        s.boughtQty += qty;
        s.boughtCost += (qty * price);
      } else if (t.type === 'sell') {
        const avgCost = s.boughtQty > 0 ? (s.boughtCost / s.boughtQty) : 0;
        const netProceedsUSD = (qty * price);
        const costBasisUSD = qty * avgCost;
        const gainUSD = netProceedsUSD - costBasisUSD;

        s.boughtQty = Math.max(0, s.boughtQty - qty);
        s.boughtCost = Math.max(0, s.boughtCost - costBasisUSD);

        if (ym === targetYearMonth) {
          const alienationBRL = netProceedsUSD * brlPerUsd;
          const gainBRL = gainUSD * brlPerUsd;
          totalAlienationBRL += alienationBRL;
          totalRealizedGainBRL += gainBRL;
          monthSales.push({
            asset: a,
            qty,
            price,
            proceedsUSD: netProceedsUSD,
            alienationBRL,
            gainBRL,
            timestamp: t.timestamp
          });
        }
      }
    });

    const exemptionLimit = 35000; // Limite de isenção no Brasil (R$ 35.000,00)
    const isExempt = totalAlienationBRL <= exemptionLimit;
    const taxEstimatedBRL = (!isExempt && totalRealizedGainBRL > 0) ? (totalRealizedGainBRL * 0.15) : 0;

    return {
      targetYearMonth,
      totalAlienationBRL,
      exemptionLimit,
      isExempt,
      totalRealizedGainBRL,
      taxEstimatedBRL,
      monthSales
    };
  }

  /* ---- Simulador DCA (Dollar Cost Averaging) ---- */
  function calculateDCASimulation(currentPrice, periodicAmountUSD, frequencyDays, totalMonths, change24hPct = 0) {
    const price = Math.max(0.000001, Number(currentPrice) || 1);
    const amount = Math.max(0.01, Number(periodicAmountUSD) || 10);
    const freq = Math.max(1, Number(frequencyDays) || 30);
    const months = Math.max(1, Number(totalMonths) || 12);

    const totalDays = months * 30.5;
    const totalInstallments = Math.max(1, Math.floor(totalDays / freq));
    const totalInvestedUSD = totalInstallments * amount;

    const trend = (Number(change24hPct) || 0) / 100;
    let accumulatedCoins = 0;

    for (let i = 0; i < totalInstallments; i++) {
      const cycleProgress = i / totalInstallments;
      // Modela oscilação cíclica típica do mercado para a média ponderada
      const wave = Math.sin(cycleProgress * Math.PI * 2) * 0.20;
      const simPrice = Math.max(price * 0.15, price * (1 - 0.15 + wave + (trend * 0.3)));
      accumulatedCoins += amount / simPrice;
    }

    const finalValueUSD = accumulatedCoins * price;
    const avgCostUSD = totalInvestedUSD / accumulatedCoins;
    const profitUSD = finalValueUSD - totalInvestedUSD;
    const profitPct = totalInvestedUSD > 0 ? (profitUSD / totalInvestedUSD) * 100 : 0;

    // Comparativo: Lump Sum (comprar tudo no primeiro dia)
    const startPrice = Math.max(price * 0.15, price * (1 - 0.15 + (trend * 0.3)));
    const lumpSumCoins = totalInvestedUSD / startPrice;
    const lumpSumFinalUSD = lumpSumCoins * price;
    const lumpSumProfitPct = ((lumpSumFinalUSD - totalInvestedUSD) / totalInvestedUSD) * 100;

    return {
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
  function calculateTargetProfitScenarios(targetAmountUSD, periodicity = 'month') {
    const rawTarget = Number(targetAmountUSD);
    const target = isNaN(rawTarget) || rawTarget < 0 ? 0 : rawTarget;
    const isMonthly = String(periodicity).toLowerCase() === 'month';
    const annualProfitUSD = isMonthly ? target * 12 : target;

    const scenarios = [
      {
        cenario: 'Conservador (Com folga)',
        rendimentoPct: 5,
        rendimentoLabel: '5% a.a.',
        margem: 'Alta proteção contra quedas'
      },
      {
        cenario: 'Moderado',
        rendimentoPct: 10,
        rendimentoLabel: '10% a.a.',
        margem: 'Média de médio prazo'
      },
      {
        cenario: 'Ciclo de Alta',
        rendimentoPct: 15,
        rendimentoLabel: '15% a.a.',
        margem: 'Depende de forte valorização'
      },
      {
        cenario: 'Lending / Juros',
        rendimentoPct: 2,
        rendimentoLabel: '2% a.a.',
        margem: 'Renda passiva (sem vender moedas)'
      }
    ];

    const rows = scenarios.map(s => {
      const rate = s.rendimentoPct / 100;
      const capitalUSD = rate > 0 ? (annualProfitUSD / rate) : 0;
      return {
        cenario: s.cenario,
        rendimentoEstimado: s.rendimentoLabel,
        capitalUSD,
        margemSeguranca: s.margem
      };
    });

    return {
      targetAmountUSD: target,
      periodicity: isMonthly ? 'month' : 'year',
      annualProfitUSD,
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
    calculateDCASimulation,
    calculateTargetProfitScenarios
  };
});
