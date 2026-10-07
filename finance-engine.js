/**
 * finance-engine.js — Núcleo de regras financeiras, blockchain SHA-256 e cálculos tributários
 * Refatorado para Arquitetura Hexagonal, Orientação a Objetos e Criptografia.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FinanceEngine = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ==========================================
  // INFRASTRUCTURE LAYER
  // ==========================================
  
  class CryptoAdapter {
    static async encryptData(plainText, key) {
      const cryptoObj = typeof crypto !== 'undefined' ? crypto : (typeof globalThis !== 'undefined' ? globalThis.crypto : null);
      if (!cryptoObj || !cryptoObj.subtle) throw new Error('Web Cryptography API não suportada');
      const iv = cryptoObj.getRandomValues(new Uint8Array(12));
      const encoded = new TextEncoder().encode(plainText);
      const ciphertext = await cryptoObj.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, encoded);
      return { iv: Array.from(iv), cipher: Array.from(new Uint8Array(ciphertext)) };
    }

    static async decryptData(encryptedObj, key) {
      const cryptoObj = typeof crypto !== 'undefined' ? crypto : (typeof globalThis !== 'undefined' ? globalThis.crypto : null);
      if (!cryptoObj || !cryptoObj.subtle) throw new Error('Web Cryptography API não suportada');
      const iv = new Uint8Array(encryptedObj.iv);
      const cipher = new Uint8Array(encryptedObj.cipher);
      const decrypted = await cryptoObj.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, cipher);
      return new TextDecoder().decode(decrypted);
    }
  }

  class Sha256Algorithm {
    static _rrot(x, n) { return (x >>> n) | (x << (32 - n)); }

    static get _K() {
      return [
        0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
        0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
        0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
        0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
        0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
        0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
        0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
        0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
      ];
    }

    static hash(message) {
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
      const K = this._K;
      for (let chunk = 0; chunk < withOne.length; chunk += 64) {
        for (let i = 0; i < 16; i++) w[i] = dv.getUint32(chunk + i * 4);
        for (let i = 16; i < 64; i++) {
          const s0 = this._rrot(w[i-15], 7) ^ this._rrot(w[i-15], 18) ^ (w[i-15] >>> 3);
          const s1 = this._rrot(w[i-2], 17) ^ this._rrot(w[i-2], 19) ^ (w[i-2] >>> 10);
          w[i] = (w[i-16] + s0 + w[i-7] + s1) >>> 0;
        }
        let [a,b,c,d,e,f,g,h] = H;
        for (let i = 0; i < 64; i++) {
          const S1 = this._rrot(e,6) ^ this._rrot(e,11) ^ this._rrot(e,25);
          const ch = (e & f) ^ (~e & g);
          const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
          const S0 = this._rrot(a,2) ^ this._rrot(a,13) ^ this._rrot(a,22);
          const maj = (a & b) ^ (a & c) ^ (b & c);
          const t2 = (S0 + maj) >>> 0;
          h=g; g=f; f=e; e=(d+t1)>>>0; d=c; c=b; b=a; a=(t1+t2)>>>0;
        }
        H = [H[0]+a, H[1]+b, H[2]+c, H[3]+d, H[4]+e, H[5]+f, H[6]+g, H[7]+h].map(x => x >>> 0);
      }
      return H.map(x => x.toString(16).padStart(8, '0')).join('');
    }
  }

  // ==========================================
  // DOMAIN LAYER (Entities & Value Objects)
  // ==========================================
  
  class FinanceConstants {
    constructor() {
      this._fallbackBrlPerUsd = 5.5;
      this._exemptionLimitBrl = 35000;
      this._darfMinBrl = 10;
      this._foreignRate = 0.15;
      this._defaultSpreadPct = 1;
      this._taxTimezone = 'America/Sao_Paulo';
      this._capitalGainsBrackets = [
        { upTo: 5000000, rate: 0.15 },
        { upTo: 10000000, rate: 0.175 },
        { upTo: 30000000, rate: 0.20 },
        { upTo: Infinity, rate: 0.225 }
      ];
      this._taxDisclaimers = [
        'Simulação educativa: não substitui contador, o GCAP nem a declaração de ajuste anual.',
        'O regime depende do local de custódia: exchange nacional (ganho de capital mensal, isenção de R$ 35 mil, DARF 4600) ou exterior (Lei 14.754/2023: 15% fixo, apuração anual na declaração, sem isenção de R$ 35 mil e sem DARF mensal).',
        'O câmbio USD/BRL usado é indicativo (mercado/cripto), não a PTAX do Banco Central, que é a cotação oficial da apuração.',
        'Os rendimentos da Meta de Lucro são hipóteses sem fonte, não promessa nem previsão de retorno; renda passiva (lending/staking) também é tributável.',
        'Legislação vigente em set/2026. A MP 1.303/2025 (alíquota única) caducou, mas o tema pode voltar; confira as regras antes de decidir.'
      ];
    }
    
    get fallbackBrlPerUsd() { return this._fallbackBrlPerUsd; }
    get exemptionLimitBrl() { return this._exemptionLimitBrl; }
    get darfMinBrl() { return this._darfMinBrl; }
    get foreignRate() { return this._foreignRate; }
    get defaultSpreadPct() { return this._defaultSpreadPct; }
    get taxTimezone() { return this._taxTimezone; }
    get capitalGainsBrackets() { return this._capitalGainsBrackets; }
    get taxDisclaimers() { return this._taxDisclaimers; }
  }

  class MathHelper {
    static round2(x) { return Math.round((Number(x) + Number.EPSILON) * 100) / 100; }
  }

  class Block {
    constructor(index, timestamp, data, previousHash) {
      this.index = index;
      this.timestamp = timestamp;
      this.data = data;
      this.previousHash = previousHash;
      this.hash = this.computeHash();
    }
    
    computeHash() {
      const raw = this.index + '|' + this.timestamp + '|' + JSON.stringify(this.data) + '|' + this.previousHash;
      return Sha256Algorithm.hash(raw);
    }
  }

  class TradeOperation {
    constructor(data) {
      this._type = data.type;
      this._qty = Number(data.qty) || 0;
      this._price = Number(data.price) || 0;
      this._value = data.value != null ? Number(data.value) : null;
      this._fee = Number(data.feeUSD != null ? data.feeUSD : data.fee) || 0;
      this._spread = Number(data.spreadUSD) || 0;
      this._timestamp = data.timestamp;
      this._asset = data.asset;
      this._custody = data.custody;
      this._fxRate = Number(data.fxRate);
      this._fxSource = data.fxSource;
    }
    
    get type() { return this._type; }
    get timestamp() { return this._timestamp; }
    get asset() { return this._asset; }
    get custody() { return this._custody; }

    getGrossUSD() {
      if (this._value != null && Number.isFinite(this._value)) return this._value;
      return this._qty * this._price;
    }

    getCostsUSD() {
      return { fee: Math.max(0, this._fee), spread: Math.max(0, this._spread) };
    }

    getNetUSD() {
      const gross = this.getGrossUSD();
      const c = this.getCostsUSD();
      return this._type === 'buy' ? gross + c.fee + c.spread : gross - c.fee - c.spread;
    }

    resolveFx(currentBrlPerUsd, fallbackRate) {
      if (Number.isFinite(this._fxRate) && this._fxRate > 0) {
        return { rate: this._fxRate, source: this._fxSource === 'fallback' ? 'fallback' : 'operation' };
      }
      const cur = Number(currentBrlPerUsd);
      if (Number.isFinite(cur) && cur > 0) return { rate: cur, source: 'current' };
      return { rate: fallbackRate, source: 'fallback' };
    }
  }

  // ==========================================
  // APPLICATION LAYER (Use Cases)
  // ==========================================

  class BlockchainService {
    static makeGenesisBlock(timestamp = Date.now()) {
      return new Block(0, timestamp, null, '0'.repeat(64));
    }

    static appendBlock(chainArr, data, timestamp = Date.now()) {
      if (!chainArr || chainArr.length === 0) throw new Error('Cadeia vazia: crie o bloco gênese antes de adicionar blocos.');
      const prev = chainArr[chainArr.length - 1];
      const block = new Block(prev.index + 1, data.timestamp || timestamp, data, prev.hash);
      chainArr.push(block);
      return block;
    }

    static verifyChainIntegrity(chainArr) {
      if (!Array.isArray(chainArr) || chainArr.length === 0) return { valid: false, at: 0, reason: 'cadeia vazia ou formato inválido' };
      for (let i = 0; i < chainArr.length; i++) {
        const b = chainArr[i];
        const dummy = new Block(b.index, b.timestamp, b.data, b.previousHash);
        if (dummy.computeHash() !== b.hash) return { valid: false, at: i, reason: 'hash do bloco não confere' };
        if (i > 0 && b.previousHash !== chainArr[i - 1].hash) return { valid: false, at: i, reason: 'encadeamento quebrado com o bloco anterior' };
      }
      return { valid: true };
    }
  }

  class TaxReportService {
    constructor() {
      this._constants = new FinanceConstants();
    }

    monthKeySP(timestamp) {
      let parts;
      try {
        parts = new Intl.DateTimeFormat('en-CA', { timeZone: this._constants.taxTimezone, year: 'numeric', month: '2-digit' }).formatToParts(new Date(timestamp));
      } catch (e) {
        const d = new Date(Number(timestamp) - 3 * 3600 * 1000); 
        return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      }
      const y = parts.find(p => p.type === 'year').value;
      const m = parts.find(p => p.type === 'month').value;
      return `${y}-${m}`;
    }

    capitalGainsTax(gainBRL) {
      const gain = Math.max(0, Number(gainBRL) || 0);
      let lower = 0;
      let tax = 0;
      const detail = [];
      for (const b of this._constants.capitalGainsBrackets) {
        if (gain <= lower) break;
        const slice = Math.min(gain, b.upTo) - lower;
        const part = slice * b.rate;
        tax += part;
        detail.push({ rate: b.rate, base: slice, tax: part });
        lower = b.upTo;
      }
      return { tax: MathHelper.round2(tax), detail };
    }

    computeTaxReport(assetKeys, tradesRaw = [], opts = {}) {
      const currentBrlPerUsd = opts.currentBrlPerUsd;
      const defaultCustody = opts.defaultCustody === 'foreign' ? 'foreign' : 'national';
      const pools = {};
      (assetKeys || []).forEach(k => { pools[k] = { qty: 0, costUSD: 0, costBRL: 0, estimated: false }; });
  
      const months = {};
      const newMonth = (key) => ({
        monthKey: key, operations: [], volumeBRL: 0, volumeUSD: 0, operationsCount: 0, estimated: false, fxFallback: false,
        national: { alienationBRL: 0, alienationUSD: 0, netGainBRL: 0, taxableGainBRL: 0, lossBRL: 0, salesCount: 0 },
        foreign: { alienationBRL: 0, alienationUSD: 0, netGainBRL: 0, salesCount: 0 }
      });
  
      const trades = tradesRaw.map(t => new TradeOperation(t));
      const sorted = [...trades].sort((a, b) => a.timestamp - b.timestamp);
      
      sorted.forEach(t => {
        const pool = pools[t.asset] || (pools[t.asset] = { qty: 0, costUSD: 0, costBRL: 0, estimated: false });
        const qty = t._qty;
        const key = this.monthKeySP(t.timestamp);
        const m = months[key] || (months[key] = newMonth(key));
        const fx = t.resolveFx(currentBrlPerUsd, this._constants.fallbackBrlPerUsd);
        const grossUSD = t.getGrossUSD();
        const netUSD = t.getNetUSD();
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
          const alienationBRL = grossUSD * fx.rate;
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
            timestamp: t.timestamp, asset: t.asset, qty, price: t._price, custody,
            saleProceedsUsd: grossUSD, netProceedsUsd: netUSD, costsUsd: grossUSD - netUSD,
            alienationBRL, gainBRL, gainUSD, fxRate: fx.rate, fxSource: fx.source, estimated,
            avgCost: avgUSD, realizedGainUsd: gainUSD
          });
        }
      });
  
      const monthKeys = Object.keys(months).sort();
      let darfCarry = 0;
      monthKeys.forEach(key => {
        const m = months[key];
        const n = m.national;
        n.alienationBRL = MathHelper.round2(n.alienationBRL);
        n.isExempt = n.alienationBRL <= this._constants.exemptionLimitBrl;
        n.exemptionLimit = this._constants.exemptionLimitBrl;
        const cg = (!n.isExempt && n.taxableGainBRL > 0) ? this.capitalGainsTax(n.taxableGainBRL) : { tax: 0, detail: [] };
        n.taxBRL = cg.tax;
        n.brackets = cg.detail;
        n.darfCarryInBRL = darfCarry;
        const accumulated = MathHelper.round2(darfCarry + n.taxBRL);
        if (accumulated > 0 && accumulated < this._constants.darfMinBrl) {
          n.darfBRL = 0;
          n.darfCarryOutBRL = accumulated;
          n.darfDeferred = true;
        } else {
          n.darfBRL = accumulated;
          n.darfCarryOutBRL = 0;
          n.darfDeferred = false;
        }
        darfCarry = n.darfCarryOutBRL;
        m.volumeBRL = MathHelper.round2(m.volumeBRL);
        m.decripto = { volumeBRL: m.volumeBRL, limitBRL: this._constants.exemptionLimitBrl, triggered: m.volumeBRL > this._constants.exemptionLimitBrl };
        m.foreign.alienationBRL = MathHelper.round2(m.foreign.alienationBRL);
      });
  
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
        fy.taxBRL = MathHelper.round2(fy.taxableBaseBRL * this._constants.foreignRate);
        lossCarry = fy.lossCarryOutBRL;
      });
  
      return { months, monthKeys, foreignYears, fallbackBrlPerUsd: this._constants.fallbackBrlPerUsd };
    }
  }

  class PortfolioService {
    static computeCashBalance(deposits = [], tradesRaw = []) {
      const trades = tradesRaw.map(t => new TradeOperation(t));
      const totalDeposited = deposits.reduce((s, d) => s + (Number(d.amount) || 0), 0);
      const totalBuy = trades.filter(t => t.type === 'buy').reduce((s, t) => s + t.getNetUSD(), 0);
      const totalSell = trades.filter(t => t.type === 'sell').reduce((s, t) => s + t.getNetUSD(), 0);
      return totalDeposited - totalBuy + totalSell;
    }

    static totalTradeCostsUSD(tradesRaw = []) {
      const trades = tradesRaw.map(t => new TradeOperation(t));
      return trades.reduce((s, t) => { const c = t.getCostsUSD(); return s + c.fee + c.spread; }, 0);
    }

    static computeSummary(assetKeys, tradesRaw = [], currentUsdPrices = {}) {
      const perAsset = {};
      assetKeys.forEach(a => { perAsset[a] = { boughtQty: 0, boughtCost: 0, soldQty: 0, soldProceeds: 0, realized: 0 }; });
      const trades = tradesRaw.map(t => new TradeOperation(t));
      const sortedTrades = [...trades].sort((a, b) => a.timestamp - b.timestamp);
      
      sortedTrades.forEach(t => {
        const s = perAsset[t.asset];
        if (!s) return;
        const qty = t._qty;
  
        if (t.type === 'buy') {
          s.boughtQty += qty;
          s.boughtCost += t.getNetUSD();
        } else if (t.type === 'sell') {
          const avgCostAtSale = s.boughtQty > 0 ? (s.boughtCost / s.boughtQty) : 0;
          const netSaleProceeds = t.getNetUSD();
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
  
      return { perAsset, totalCryptoValue, totalUnrealizedGain, totalRealizedGain, totalNetGain: totalUnrealizedGain + totalRealizedGain };
    }
  }

  class SimulationService {
    static calculateDCASimulation(currentPrice, periodicAmountUSD, frequencyDays, totalMonths, scenario = 'flat') {
      const DCA_SCENARIO_DRIFT = { flat: 0, up: 0.2, down: -0.2 };
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
        scenario: scenarioKey, hypothetical: true, totalInstallments, totalInvestedUSD, accumulatedCoins,
        avgCostUSD, finalValueUSD, profitUSD, profitPct, lumpSumFinalUSD, lumpSumProfitPct
      };
    }
    
    static calculateTargetProfitScenarios(targetAmountUSD, periodicity = 'month') {
      const rawTarget = Number(targetAmountUSD);
      const target = isNaN(rawTarget) || rawTarget < 0 ? 0 : rawTarget;
      const isMonthly = String(periodicity).toLowerCase() === 'month';
      const annualProfitUSD = isMonthly ? target * 12 : target;
      const TARGET_PROFIT_TAX_RATE = 0.15;
  
      const scenarios = [
        { cenario: 'Conservador (Com folga)', rendimentoPct: 5, observacao: 'Hipótese: não protege contra quedas de preço' },
        { cenario: 'Moderado', rendimentoPct: 10, observacao: 'Hipótese de médio prazo, sem garantia' },
        { cenario: 'Ciclo de Alta', rendimentoPct: 15, observacao: 'Hipótese: depende de forte valorização' },
        { cenario: 'Lending / Juros', rendimentoPct: 2, observacao: 'Renda passiva também é tributável' }
      ];
  
      const rows = scenarios.map(s => {
        const rate = s.rendimentoPct / 100;
        const capitalUSD = rate > 0 ? (annualProfitUSD / (rate * (1 - TARGET_PROFIT_TAX_RATE))) : 0;
        return {
          cenario: s.cenario, rendimentoEstimado: `${s.rendimentoPct}% a.a. (hipotético)`,
          rendimentoPct: s.rendimentoPct, hipotetico: true, capitalUSD, observacao: s.observacao
        };
      });
  
      return { targetAmountUSD: target, periodicity: isMonthly ? 'month' : 'year', annualProfitUSD, taxRate: TARGET_PROFIT_TAX_RATE, hypothetical: true, rows };
    }
  }

  // ==========================================
  // ADAPTER EXPORT (Mantendo assinatura legada)
  // ==========================================
  const taxSvc = new TaxReportService();
  const cst = taxSvc._constants;

  return {
    sha256Sync: Sha256Algorithm.hash.bind(Sha256Algorithm),
    computeBlockHash: block => new Block(block.index, block.timestamp, block.data, block.previousHash).computeHash(),
    makeGenesisBlock: BlockchainService.makeGenesisBlock,
    appendBlock: BlockchainService.appendBlock,
    verifyChainIntegrity: BlockchainService.verifyChainIntegrity,
    computeCashBalance: PortfolioService.computeCashBalance,
    computeSummary: PortfolioService.computeSummary,
    computeTaxMonthSummary: (assetKeys, trades, targetYearMonth, brlPerUsd = cst.fallbackBrlPerUsd) => {
      const report = taxSvc.computeTaxReport(assetKeys, trades, { currentBrlPerUsd: brlPerUsd });
      const m = report.months[targetYearMonth] || { monthKey: targetYearMonth, operations: [], estimated: false, volumeBRL: 0, national: { alienationBRL: 0, netGainBRL: 0, isExempt: true, taxBRL: 0, darfBRL: 0 } };
      return {
        targetYearMonth, totalAlienationBRL: m.national.alienationBRL, exemptionLimit: cst.exemptionLimitBrl,
        isExempt: m.national.isExempt, totalRealizedGainBRL: m.national.netGainBRL, taxEstimatedBRL: m.national.taxBRL,
        darfBRL: m.national.darfBRL, estimated: m.estimated, monthSales: m.operations
      };
    },
    computeTaxReport: (assets, trades, opts) => taxSvc.computeTaxReport(assets, trades, opts),
    capitalGainsTax: (gainBRL) => taxSvc.capitalGainsTax(gainBRL),
    resolveFx: (t, cur) => (new TradeOperation(t)).resolveFx(cur, cst.fallbackBrlPerUsd),
    monthKeySP: (ts) => taxSvc.monthKeySP(ts),
    tradeGrossUSD: (t) => (new TradeOperation(t)).getGrossUSD(),
    tradeCostsUSD: (t) => (new TradeOperation(t)).getCostsUSD(),
    tradeNetUSD: (t) => (new TradeOperation(t)).getNetUSD(),
    totalTradeCostsUSD: PortfolioService.totalTradeCostsUSD,
    calculateDCASimulation: SimulationService.calculateDCASimulation,
    calculateTargetProfitScenarios: SimulationService.calculateTargetProfitScenarios,
    FALLBACK_BRL_PER_USD: cst.fallbackBrlPerUsd,
    EXEMPTION_LIMIT_BRL: cst.exemptionLimitBrl,
    DARF_MIN_BRL: cst.darfMinBrl,
    FOREIGN_RATE: cst.foreignRate,
    DEFAULT_SPREAD_PCT: cst.defaultSpreadPct,
    CAPITAL_GAINS_BRACKETS: cst.capitalGainsBrackets,
    TAX_DISCLAIMERS: cst.taxDisclaimers,

    encryptData: CryptoAdapter.encryptData,
    decryptData: CryptoAdapter.decryptData,

    CryptoAdapter,
    TradeOperation,
    Block,
    Sha256Algorithm,
    TaxReportService,
    PortfolioService,
    SimulationService,
    FinanceConstants
  };
});
