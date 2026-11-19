(async function () {
  await window.vaultReady;
  const localStorage = window.secureStorage;
  function bufToB64(buf) { return btoa(String.fromCharCode(...new Uint8Array(buf))); }
  function b64ToBuf(b64) { return Uint8Array.from(atob(b64), c => c.charCodeAt(0)); }
  function escapeHtml(value) { return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  /* ---- avisos ao usuário (faixa no topo; no lugar de alert nativo) ---- */
  // Um aviso por id: repetir o mesmo id substitui o texto em vez de empilhar. persistent: sem botão de fechar.
  function showNotice(id, text, { persistent = false, detail = '' } = {}) {
    const host = document.getElementById('appNotices');
    if (!host) return;
    let el = Array.from(host.children).find(n => n.dataset.notice === id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'notice-banner';
      el.dataset.notice = id;
      el.setAttribute('role', 'alert');
      host.appendChild(el);
    }
    el.textContent = '';
    const icon = document.createElement('span');
    icon.className = 'notice-icon';
    icon.innerHTML = window.FinancIcons ? window.FinancIcons.svg('alert', { size: 18 }) : '';
    const body = document.createElement('span');
    body.className = 'notice-text';
    body.textContent = text;
    if (detail) {
      const small = document.createElement('small');
      small.className = 'notice-detail';
      small.textContent = detail;
      body.appendChild(small);
    }
    el.append(icon, body);
    if (!persistent) {
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'notice-close';
      close.setAttribute('aria-label', 'Dispensar aviso');
      close.innerHTML = window.FinancIcons ? window.FinancIcons.svg('x', { size: 16 }) : '';
      close.addEventListener('click', () => el.remove());
      el.appendChild(close);
    }
  }
  function clearNotice(id) {
    const host = document.getElementById('appNotices');
    if (!host) return;
    Array.from(host.children).filter(n => n.dataset.notice === id).forEach(n => n.remove());
  }

  /* ---- gravação e leitura locais (nenhuma falha é engolida) ---- */
  // O cofre (secureStorage) guarda na memória na hora e grava cifrado depois: só o flush() confirma que foi para o disco.
  const SAVE_FAILURE_NOTICE = {
    chain: 'Não foi possível salvar o histórico de operações. O que foi feito agora não foi gravado; tente de novo ou faça um backup.',
    history: 'Não foi possível salvar o histórico de patrimônio. O gráfico pode perder pontos; faça um backup.',
    alerts: 'Não foi possível salvar os alertas de preço. A alteração não foi gravada; tente de novo ou faça um backup.',
    settings: 'Não foi possível salvar as configurações. A alteração não foi gravada; tente de novo ou faça um backup.',
    favorites: 'Não foi possível salvar seus ativos favoritos. A alteração não foi gravada; tente de novo.',
    portfolios: 'Não foi possível salvar a lista de carteiras. A alteração não foi gravada; tente de novo ou faça um backup.'
  };
  // Devolve true se gravou e confirmou; false se falhou (já registrou o erro, avisou o usuário e desfez a gravação em memória).
  async function writeLocal(name, key, value) {
    let previous = null;
    try {
      previous = localStorage.getItem(key);
      localStorage.setItem(key, JSON.stringify(value));
      if (typeof localStorage.flush === 'function') await localStorage.flush();
      clearNotice('save-' + name);
      return true;
    } catch (e) {
      console.error('Falha de gravação local: ' + name, e);
      try {
        // Sem isto, o valor recusado seguiria no cofre e seria gravado no próximo flush bem-sucedido.
        if (previous === null) localStorage.removeItem(key); else localStorage.setItem(key, previous);
      } catch (undoError) {
        console.error('Falha ao desfazer a gravação local: ' + name, undoError);
      }
      showNotice('save-' + name, SAVE_FAILURE_NOTICE[name] || 'Não foi possível salvar. Tente de novo ou faça um backup.');
      return false;
    }
  }
  // Leitura de JSON gravado. Se estiver ilegível: registra, guarda uma cópia do texto original (para recuperação) e
  // devolve o padrão; o chamador avisa o usuário com flushLoadProblems().
  const loadProblems = [];
  // Com array: true, um JSON válido que não seja lista também conta como dado ilegível (mesmo tratamento: log, cópia e aviso).
  function readLocalJson(label, key, fallback, { keepCopy = false, array = false } = {}) {
    let raw = null;
    try {
      raw = localStorage.getItem(key);
      const parsed = JSON.parse(raw);
      if (array && parsed != null && !Array.isArray(parsed)) throw new Error('formato inesperado: esperava uma lista');
      return parsed == null ? fallback : parsed;
    } catch (e) {
      console.error('Falha de leitura local: ' + label, e);
      loadProblems.push(label);
      if (keepCopy && raw) {
        try { localStorage.setItem(key + '.corrompido', raw); }
        catch (copyError) { console.error('Falha ao guardar cópia do dado ilegível: ' + label, copyError); }
      }
      return fallback;
    }
  }
  function flushLoadProblems() {
    if (!loadProblems.length) return;
    const names = Array.from(new Set(loadProblems.splice(0)));
    showNotice('load-problems', `Não foi possível ler dados salvos (${names.join(', ')}). Eles foram reiniciados nesta carteira; se precisar deles, restaure um backup.`);
  }
  function renderSecuritySection() {
    const el = document.getElementById('securityContent');
    el.innerHTML = '<p>Seus dados locais são criptografados. Abra com o PIN de 6 números ou com a biometria do aparelho. Guarde as 12 palavras mostradas na configuração: elas recuperam o PIN e abrem seus backups.</p><button class="icon-btn" id="bioSettingsBtn">' + FinancIcons.svg('settings', { size: 15 }) + ' Configurações de segurança</button><button class="icon-btn" id="manageCertBtn">' + FinancIcons.svg('shield', { size: 15 }) + ' Gerenciar certificado</button><button class="icon-btn" id="lockNowBtn">' + FinancIcons.svg('lock', { size: 15 }) + ' Bloquear agora</button>';
    document.getElementById('bioSettingsBtn').onclick = () => { closeSecurityModal(); window.vaultSettings(); };
    document.getElementById('manageCertBtn').onclick = () => { closeSecurityModal(); openCertModal(); };
    document.getElementById('lockNowBtn').onclick = window.lockVault;
  }

  /* ---- modal de Segurança ---- */
  function openSecurityModal() {
    renderSecuritySection();
    document.getElementById('securityModalOverlay').classList.remove('is-hidden');
  }
  function closeSecurityModal() {
    document.getElementById('securityModalOverlay').classList.add('is-hidden');
  }
  document.getElementById('openSecurityBtn').addEventListener('click', openSecurityModal);
  document.getElementById('closeSecurityModalBtn').addEventListener('click', closeSecurityModal);
  document.getElementById('securityModalOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'securityModalOverlay') closeSecurityModal();
  });

  /* ============ CERTIFICADO DIGITAL (2FA CRIPTOGRÁFICO) ============ */
  // Com o PIN FINANC, o certificado é o FINANC (um só para todos os apps; o kit já trouxe o antigo deste app).
  // Sem ele (app ainda com PIN próprio), segue o certificado próprio guardado no cofre do app.
  const DEVICE_CERT_KEY = 'cripto-app-device-cert';
  const FinancCert = window.FinancCert;

  function ownCert() {
    try {
      const raw = localStorage.getItem(DEVICE_CERT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      // Certificado próprio é opcional: ilegível, o app segue sem ele (cai no certificado FINANC ou pede o certificado ao abrir o backup).
      return null;
    }
  }
  // Backup antigo pode ter sido cifrado com um certificado anterior: procura pelo id.
  function certFor(id) {
    if (FinancCert.linked) return (id && FinancCert.find(id)) || FinancCert.current;
    return ownCert();
  }

  async function ensureDeviceCert() {
    if (FinancCert.linked) return FinancCert.ensure();
    let cert = ownCert();
    if (!cert) {
      const randomBytes = crypto.getRandomValues(new Uint8Array(32));
      const idBytes = crypto.getRandomValues(new Uint8Array(8));
      cert = {
        id: bufToB64(idBytes).replace(/[^a-zA-Z0-9]/g, '').slice(0, 12),
        secret: bufToB64(randomBytes),
        name: navigator.userAgent.includes('Mobile') ? 'Celular' : 'Dispositivo Local',
        createdAt: Date.now()
      };
      localStorage.setItem(DEVICE_CERT_KEY, JSON.stringify(cert));
    }
    return cert;
  }

  async function renderCertModal() {
    const cert = await ensureDeviceCert();
    const el = document.getElementById('certModalContent');
    el.innerHTML = `
      <div class="cert-intro">
        ${FinancCert.fromSeed ? 'O certificado sai das suas <strong>12 palavras</strong>: é o mesmo em qualquer aparelho onde você usar as mesmas palavras. Em outro celular, basta digitar as 12 palavras para abrir seus backups; gerar ou baixar o certificado pede só o PIN.'
          : (FinancCert.linked ? 'Este aparelho usa um <strong>certificado digital único</strong>, o mesmo em todos os apps.' : 'Este aparelho possui um <strong>Certificado Digital Exclusivo</strong> gerado no navegador.')
            + ' Se alguém descobrir seu PIN ou senha, <strong>ainda assim NÃO conseguirá abrir seu arquivo JSON</strong> em outro computador ou celular sem importar este arquivo de certificado antes.'}
      </div>

      <div class="card cert-card">
        <div class="cert-label">ID DO CERTIFICADO</div>
        <div class="cert-id">${escapeHtml(cert.id)}</div>
        <div class="cert-label">CRIADO EM</div>
        <div class="cert-date">${new Date(cert.createdAt).toLocaleString('pt-BR')}</div>
      </div>

      <div class="stack-10">
        <button class="submit-btn" id="downloadCertBtn" type="button">Baixar Certificado (.cert.json)</button>
        <button class="icon-btn cert-btn" id="uploadCertBtn" type="button">Importar Certificado de Outro Aparelho</button>
        <input type="file" id="importCertFileInput" accept="application/json" class="is-hidden">
        <button class="icon-btn cert-btn${FinancCert.fromSeed ? '' : ' is-danger'}" id="regenCertBtn" type="button">${FinancCert.fromSeed ? 'Gerar certificado das 12 palavras' : 'Gerar Novo Certificado'}</button>
      </div>
      <div class="status status-spaced" id="certStatus"></div>
    `;

    const UiEventsCert = {
      downloadCertBtn_click: async () => {
        try {
          // Só o PIN, nunca senha: o arquivo sai protegido pelas 12 palavras.
          if (await FinancCert.export()) document.getElementById('certStatus').textContent = 'Certificado baixado, protegido pelas 12 palavras.';
        }
        catch (err) { document.getElementById('certStatus').textContent = (err && err.message) || 'Não foi possível exportar o certificado protegido.'; }
      },
      uploadCertBtn_click: () => {
        document.getElementById('importCertFileInput').click();
      },
      importCertFileInput_change: (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async () => {
          try {
            const payload = JSON.parse(reader.result);
            const importedCert = FinancCert.linked ? await FinancCert.importFile(payload) : await window.importCertificate(payload, 'cripito-sim:certificate');
            if (importedCert && importedCert.id && importedCert.secret) {
              if (!FinancCert.linked) localStorage.setItem(DEVICE_CERT_KEY, JSON.stringify(importedCert));
              await renderCertModal();
              document.getElementById('certStatus').textContent = `Certificado "${importedCert.id}" ativado com sucesso neste aparelho!`;
            } else {
              document.getElementById('certStatus').textContent = 'Arquivo de certificado inválido.';
            }
          } catch (err) {
            document.getElementById('certStatus').textContent = 'Erro ao ler o arquivo de certificado.';
          }
        };
        reader.readAsText(file);
        e.target.value = '';
      },
      regenCertBtn_click: async () => {
        if (FinancCert.fromSeed || FinancCert.linked) {
          try {
            const made = await FinancCert.regenerate();
            if (!made) return;
            await renderCertModal();
            document.getElementById('certStatus').textContent = `Certificado "${made.id}" gerado a partir das 12 palavras.`;
          } catch (err) { document.getElementById('certStatus').textContent = (err && err.message) || 'Não foi possível gerar o certificado.'; }
          return;
        }
        if (!confirm(FinancCert.linked ? 'Gerar um novo certificado? Ele passa a valer para os backups novos de todos os apps; o anterior continua guardado para abrir os backups antigos.' : 'Atenção: Gerar um novo certificado fará com que este celular não consiga abrir arquivos JSON anteriores a menos que você tenha guardado o certificado antigo. Deseja continuar?')) return;
        if (FinancCert.linked) await FinancCert.regenerate();
        else { localStorage.removeItem(DEVICE_CERT_KEY); await ensureDeviceCert(); }
        await renderCertModal();
        document.getElementById('certStatus').textContent = 'Novo certificado digital gerado com sucesso.';
      }
    };

    document.getElementById('downloadCertBtn').addEventListener('click', UiEventsCert.downloadCertBtn_click);
    document.getElementById('uploadCertBtn').addEventListener('click', UiEventsCert.uploadCertBtn_click);
    document.getElementById('importCertFileInput').addEventListener('change', UiEventsCert.importCertFileInput_change);
    document.getElementById('regenCertBtn').addEventListener('click', UiEventsCert.regenCertBtn_click);
  }

  async function openCertModal() {
    await renderCertModal();
    document.getElementById('certModalOverlay').classList.remove('is-hidden');
  }
  function closeCertModal() {
    document.getElementById('certModalOverlay').classList.add('is-hidden');
  }
  document.getElementById('closeCertModalBtn').addEventListener('click', closeCertModal);
  document.getElementById('certModalOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'certModalOverlay') closeCertModal();
  });

  /* ============ CRIPTOGRAFIA DO JSON EXPORTADO (AES-GCM + PBKDF2 COM 2FA CERTIFICADO) ============ */
  const subtleCryptoSupported = !!(window.crypto && window.crypto.subtle);

  function getCombinedSecret(password, certSecret) {
    return password + '::DEVICE_CERT::' + (certSecret || '');
  }

  async function deriveAesKey(combinedSecret, saltBytes, iterations = 600000) {
    if (!subtleCryptoSupported) throw new Error('Criptografia não suportada neste navegador (precisa de HTTPS ou localhost).');
    const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(combinedSecret), { name: 'PBKDF2' }, false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: saltBytes, iterations, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async function encryptJSON(obj, password, certSecret) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cert = await ensureDeviceCert();
    const effectiveCertSecret = certSecret !== undefined ? certSecret : cert.secret;
    const combined = getCombinedSecret(password, effectiveCertSecret);
    const key = await deriveAesKey(combined, salt);
    const plaintext = new TextEncoder().encode(JSON.stringify(obj));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
    return {
      encrypted: true,
      certProtected: true,
      certId: cert.id,
      iterations: 600000,
      salt: bufToB64(salt),
      iv: bufToB64(iv),
      ciphertext: bufToB64(ciphertext),
    };
  }

  async function decryptJSON(payload, password, certSecret) {
    const salt = b64ToBuf(payload.salt);
    const iv = b64ToBuf(payload.iv);
    const ciphertext = b64ToBuf(payload.ciphertext);
    const iterations = payload.iterations == null ? 150000 : Number(payload.iterations);
    if (iterations !== 150000 && iterations !== 600000) throw new Error('Parâmetro criptográfico inválido.');

    let effectiveCertSecret = certSecret;
    if (effectiveCertSecret === undefined && payload.certProtected) {
      const cert = certFor(payload.certId);
      effectiveCertSecret = cert ? cert.secret : null;
    }

    // Se o payload foi protegido com certificado, usa a chave combinada
    if (payload.certProtected) {
      if (!effectiveCertSecret) {
        throw new Error('CERT_REQUIRED');
      }
      const combined = getCombinedSecret(password, effectiveCertSecret);
      const key = await deriveAesKey(combined, salt, iterations);
      const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
      return JSON.parse(new TextDecoder().decode(plainBuf));
    }

    // Compatibilidade com arquivos antigos protegidos apenas com senha
    const key = await deriveAesKey(password, salt, iterations);
    const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    return JSON.parse(new TextDecoder().decode(plainBuf));
  }

  /* Valores calculados em runtime (largura de barra, cor de série): vão para
     custom properties via CSSOM, o que a CSP aceita sem 'unsafe-inline'. */
  function paintDynamic(root) {
    root.querySelectorAll('[data-pct]').forEach(el => el.style.setProperty('--pct', el.dataset.pct + '%'));
    root.querySelectorAll('[data-color]').forEach(el => el.style.setProperty('--c', el.dataset.color));
  }

  /* ============ ATIVOS ============ */
  const ASSETS = {
    btc:  { name: 'Bitcoin',    geckoId: 'bitcoin',     binanceSymbol: 'BTCUSDT' },
    eth:  { name: 'Ethereum',   geckoId: 'ethereum',    binanceSymbol: 'ETHUSDT' },
    sol:  { name: 'Solana',     geckoId: 'solana',      binanceSymbol: 'SOLUSDT' },
    bnb:  { name: 'BNB',        geckoId: 'binancecoin', binanceSymbol: 'BNBUSDT' },
    xrp:  { name: 'XRP',        geckoId: 'ripple',       binanceSymbol: 'XRPUSDT' },
    ada:  { name: 'Cardano',    geckoId: 'cardano',     binanceSymbol: 'ADAUSDT' },
    doge: { name: 'Dogecoin',   geckoId: 'dogecoin',    binanceSymbol: 'DOGEUSDT' },
    link: { name: 'Chainlink',  geckoId: 'chainlink',   binanceSymbol: 'LINKUSDT' },
    ltc:  { name: 'Litecoin',   geckoId: 'litecoin',    binanceSymbol: 'LTCUSDT' },
    avax: { name: 'Avalanche',  geckoId: 'avalanche-2', binanceSymbol: 'AVAXUSDT' },
  };
  const ASSET_KEYS = Object.keys(ASSETS);
  const ALLOC_COLORS = [0,1,2,3,4,5,6,7,8,9].map(n => `var(--alloc-${n})`);
  const AVATAR = {
    usd:  { symbol: '$', bg: 'rgba(111,207,151,0.15)', color: 'var(--accent)' },
    brl:  { symbol: 'R$', bg: 'rgba(143,160,152,0.18)', color: 'var(--ink)' },
    btc:  { symbol: '₿', bg: 'rgba(247,147,26,0.18)', color: '#F7931A' },
    eth:  { symbol: 'Ξ', bg: 'rgba(139,140,247,0.18)', color: '#8B8CF7' },
    sol:  { symbol: 'S', bg: 'rgba(111,207,151,0.18)', color: '#6FCF97' },
    bnb:  { symbol: 'B',  bg: 'rgba(240,185,11,0.18)', color: '#F0B90B' },
    xrp:  { symbol: 'X',  bg: 'rgba(35,35,35,0.25)', color: '#AEB4BC' },
    ada:  { symbol: 'A',  bg: 'rgba(0,51,173,0.20)', color: '#5B7FE0' },
    doge: { symbol: 'Ð',  bg: 'rgba(194,158,66,0.20)', color: '#C29E42' },
    link: { symbol: 'L',  bg: 'rgba(42,91,222,0.20)', color: '#5C87F0' },
    ltc:  { symbol: 'Ł',  bg: 'rgba(166,166,166,0.20)', color: '#BFBFBF' },
    avax: { symbol: 'A',  bg: 'rgba(232,65,66,0.18)', color: '#E84142' },
  };
  function avatarHtml(assetKey) {
    const a = AVATAR[assetKey] || { symbol: assetKey.charAt(0).toUpperCase(), bg: 'var(--surface-2)', color: 'var(--ink)' };
    return `<span class="asset-avatar" data-asset="${assetKey}">${a.symbol}</span>`;
  }

  const CURRENCIES = [
    { id: 'usd', name: 'Dólar americano', symbol: 'USD' },
    { id: 'brl', name: 'Real brasileiro', symbol: 'BRL' },
    ...ASSET_KEYS.map(k => ({ id: k, name: ASSETS[k].name, symbol: k.toUpperCase() })),
  ];

  let usdPrice = { usd: 1, brl: null };
  let change24h = {};
  ASSET_KEYS.forEach(k => { usdPrice[k] = null; change24h[k] = null; });

  function fmt(value, currencyId) {
    if (value === null || isNaN(value)) return '—';
    if (currencyId === 'usd') return value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
    if (currencyId === 'brl') return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const decimals = value < 1 ? 6 : value < 100 ? 4 : 2;
    return value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + ' ' + currencyId.toUpperCase();
  }
  function fmtGain(value) {
    const abs = Math.abs(value);
    const decimals = abs > 0 && abs < 1 ? 4 : 2;
    const formatted = Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    return (value >= 0 ? '+$' : '-$') + formatted;
  }
  function toBRL(usdValue) { return usdPrice.brl ? usdValue / usdPrice.brl : null; }
  function fmtBRLSecondary(usdValue) {
    const brl = toBRL(usdValue);
    return brl !== null ? fmt(brl, 'brl') : '';
  }
  function fmtQty(v, asset) {
    const decimals = v < 1 ? 6 : v < 100 ? 4 : 2;
    return v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + ' ' + asset.toUpperCase();
  }

  /* ============ AJUSTES ============ */
  const clickById = id => () => document.getElementById(id).click();
  FinancSettings.addSection({ title: 'Dados e backup', rows: [
    { icon: 'download', label: 'Exportar backup (JSON)', description: 'Protegido pelas suas 12 palavras: abre em qualquer aparelho com elas.', onClick: clickById('exportBtn') },
    { icon: 'upload', label: 'Importar backup (JSON)', description: 'Restaura um backup exportado.', onClick: clickById('importBtn') },
    { icon: 'file-text', label: 'Exportar extrato (CSV)', description: 'Operações para planilha.', onClick: clickById('exportCsvBtn') },
    { icon: 'shield', label: 'Certificado digital', description: 'Sai das 12 palavras; gerar e baixar pedem só o PIN.', onClick: () => openCertModal() },
    { icon: 'file-text', label: 'Relatório fiscal e IRPF', description: 'Alienações mensais e ganho de capital.', onClick: clickById('openTaxModalBtn') },
  ] });

  /* ============ TABS ============ */
  const tabButtonsList = Array.from(document.querySelectorAll('.tab-btn'));
  const tabsIndicator = document.getElementById('tabsIndicator');
  // Acompanha o tamanho real de cada aba.
  function moveTabsIndicator(btn) {
    tabsIndicator.style.setProperty('--tab-w', btn.offsetWidth + 'px');
    tabsIndicator.style.setProperty('--tab-x', (btn.offsetLeft - tabsIndicator.offsetLeft) + 'px');
  }
  tabButtonsList.forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const panel = document.getElementById('panel-' + btn.dataset.tab);
      if (panel) panel.classList.add('active');
      if (btn.dataset.tab === 'metas') renderTargetProfit();
      moveTabsIndicator(btn);
      // Cabeçalho padrão (⋮ + título) acompanha a aba.
      document.getElementById('headEyebrow').textContent = btn.dataset.eyebrow;
      document.getElementById('headTitle').textContent = btn.dataset.title;
      document.getElementById('headLede').textContent = btn.dataset.lede;
    });
  });
  const activeTab = () => tabButtonsList.find(b => b.classList.contains('active')) || tabButtonsList[0];
  moveTabsIndicator(activeTab());
  window.addEventListener('resize', () => moveTabsIndicator(activeTab()));

  document.getElementById('fabAddTrade').addEventListener('click', () => {
    document.getElementById('registrarSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
    document.getElementById('valueInput').focus();
  });

  /* ============ POPULA SELECTS ============ */
  function populateSelects() {
    const fromSel = document.getElementById('fromCurrency');
    fromSel.innerHTML = CURRENCIES.map(c => `<option value="${c.id}">${c.symbol}</option>`).join('');

    const assetSel = document.getElementById('assetSelect');
    assetSel.innerHTML = ASSET_KEYS.map(k => `<option value="${k}">${ASSETS[k].name} (${k.toUpperCase()})</option>`).join('');

    const alertAssetSel = document.getElementById('alertAsset');
    alertAssetSel.innerHTML = ASSET_KEYS.map(k => `<option value="${k}">${ASSETS[k].name} (${k.toUpperCase()})</option>`).join('');
  }
  populateSelects();

  /* ============ CONVERSOR ============ */
  const FAVORITES_KEY = 'cripto-app-favorite-assets';
  let favoriteAssets = ['btc', 'eth', 'sol'];
  try {
    const stored = JSON.parse(localStorage.getItem(FAVORITES_KEY));
    if (Array.isArray(stored) && stored.length) favoriteAssets = stored;
  } catch (e) {
    // Favoritos são só preferência visual: ilegíveis, vale a lista padrão acima.
  }
  let showAllAssets = false;
  let editingFavorites = false;

  function saveFavorites() {
    return writeLocal('favorites', FAVORITES_KEY, favoriteAssets);
  }

  function renderFavoritesEditor() {
    const el = document.getElementById('favoritesEditor');
    if (!editingFavorites) { el.classList.add('is-hidden'); el.innerHTML = ''; return; }
    el.classList.remove('is-hidden');
    el.innerHTML = `
      <div class="favorites-editor">
        <div class="fe-title">MOEDAS PRINCIPAIS — ficam sempre visíveis</div>
        ${ASSET_KEYS.map(k => `
          <label>
            <input type="checkbox" data-fav="${k}" ${favoriteAssets.includes(k) ? 'checked' : ''}>
            ${ASSETS[k].name} (${k.toUpperCase()})
          </label>
        `).join('')}
      </div>`;
    el.querySelectorAll('input[data-fav]').forEach(cb => {
      cb.addEventListener('change', async () => {
        const key = cb.dataset.fav;
        const previous = favoriteAssets;
        favoriteAssets = cb.checked ? (previous.includes(key) ? previous : [...previous, key]) : previous.filter(k => k !== key);
        // Não gravou: volta a lista e a caixa marcada ao que estava (a tela não mostra como salvo).
        if (!await saveFavorites()) { favoriteAssets = previous; cb.checked = previous.includes(key); }
        renderConverter();
      });
    });
  }

  let assetFilterQuery = '';
  const searchInputEl = document.getElementById('assetSearchInput');
  if (searchInputEl) {
    searchInputEl.addEventListener('input', (e) => {
      assetFilterQuery = e.target.value.trim().toLowerCase();
      renderConverter();
    });
  }

  function renderConverter() {
    const amount = parseFloat(document.getElementById('amountInput').value) || 0;
    const from = document.getElementById('fromCurrency').value;
    const baseUsdValue = amount * (usdPrice[from] || 0);

    const others = CURRENCIES.filter(c => c.id !== from);
    const fiat = others.filter(c => c.id === 'usd' || c.id === 'brl');
    const favorites = others.filter(c => ASSETS[c.id] && favoriteAssets.includes(c.id));
    const rest = others.filter(c => ASSETS[c.id] && !favoriteAssets.includes(c.id));
    let visible = showAllAssets ? [...fiat, ...favorites, ...rest] : [...fiat, ...favorites];

    if (assetFilterQuery) {
      visible = others.filter(c =>
        c.name.toLowerCase().includes(assetFilterQuery) ||
        c.symbol.toLowerCase().includes(assetFilterQuery) ||
        c.id.toLowerCase().includes(assetFilterQuery)
      );
    }

    function rowHtml(c) {
      const converted = usdPrice[c.id] ? baseUsdValue / usdPrice[c.id] : null;
      let changeHtml = '';
      if (change24h[c.id] != null) {
        const up = change24h[c.id] >= 0;
        changeHtml = `<span class="change ${up ? 'is-up' : 'is-down'}">${up ? '+' : ''}${change24h[c.id].toFixed(2)}%</span>`;
      }
      return `
        <div class="result-row">
          <div class="label">${avatarHtml(c.id)}<span class="name">${c.name}</span><span class="symbol">${c.symbol}</span></div>
          <div class="value">${fmt(converted, c.id)}${changeHtml}</div>
        </div>`;
    }

    let html = visible.map(rowHtml).join('');
    if (!assetFilterQuery && rest.length > 0) {
      html += `
        <div class="toggle-more-row">
          <span>${showAllAssets ? `mostrando todas as ${others.length} moedas` : `${rest.length} moeda${rest.length > 1 ? 's' : ''} oculta${rest.length > 1 ? 's' : ''}`}</span>
          <span class="toggle-more-actions">
            <button id="editFavoritesBtn">${editingFavorites ? 'Concluir' : 'Editar principais'}</button>
            <button id="toggleMoreBtn">${showAllAssets ? 'Mostrar menos' : 'Mostrar mais'}</button>
          </span>
        </div>`;
    } else {
      html += `
        <div class="toggle-more-row">
          <span>${assetFilterQuery ? `${visible.length} moeda${visible.length !== 1 ? 's' : ''} encontrada${visible.length !== 1 ? 's' : ''}` : ''}</span>
          <button id="editFavoritesBtn">${editingFavorites ? 'Concluir' : 'Editar principais'}</button>
        </div>`;
    }
    document.getElementById('results').innerHTML = html;

    const toggleBtn = document.getElementById('toggleMoreBtn');
    if (toggleBtn) toggleBtn.addEventListener('click', () => { showAllAssets = !showAllAssets; renderConverter(); });
    document.getElementById('editFavoritesBtn').addEventListener('click', () => {
      editingFavorites = !editingFavorites;
      renderFavoritesEditor();
    });
    renderFavoritesEditor();

    document.getElementById('ticker').innerHTML = ASSET_KEYS.slice(0,6).map(id => `
      <div class="ticker-item">
        <div class="t-name">${id.toUpperCase()} / USD</div>
        <div class="t-price">${fmt(usdPrice[id], 'usd')}</div>
      </div>`).join('');

    updateSparkline();
  }

  let previousFrom = 'usd';
  document.getElementById('amountInput').addEventListener('input', renderConverter);
  document.getElementById('fromCurrency').addEventListener('change', () => {
    const newFrom = document.getElementById('fromCurrency').value;
    const amountEl = document.getElementById('amountInput');
    const currentAmount = parseFloat(amountEl.value) || 0;
    if (usdPrice[previousFrom] && usdPrice[newFrom]) {
      const usdValue = currentAmount * usdPrice[previousFrom];
      const converted = usdValue / usdPrice[newFrom];
      const decimals = (newFrom === 'usd' || newFrom === 'brl') ? 2 : (converted < 1 ? 6 : converted < 100 ? 4 : 2);
      amountEl.value = Number(converted.toFixed(decimals));
    }
    previousFrom = newFrom;
    renderConverter();
  });

  /* ---- sparkline 7 dias no conversor ---- */
  const sparkCache = {};
  async function updateSparkline() {
    const from = document.getElementById('fromCurrency').value;
    const wrap = document.getElementById('sparklineWrap');
    if (!ASSETS[from]) { wrap.classList.add('is-hidden'); return; }
    wrap.classList.remove('is-hidden');
    document.getElementById('sparklineLabel').textContent = `${ASSETS[from].name} — últimos 7 dias (USD)`;

    const cached = sparkCache[from];
    if (cached && Date.now() - cached.time < 5 * 60 * 1000) {
      renderSparklineSvg(cached.points);
      return;
    }
    document.getElementById('sparklineSvg').innerHTML = '<div class="empty-note">carregando gráfico…</div>';
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(`https://api.coingecko.com/api/v3/coins/${ASSETS[from].geckoId}/market_chart?vs_currency=usd&days=7`, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (!res.ok) throw new Error('gecko ' + res.status);
      const data = await res.json();
      const points = data.prices.map(p => p[1]);
      sparkCache[from] = { time: Date.now(), points };
      renderSparklineSvg(points);
    } catch (e) {
      // Falha do CoinGecko (rede, limite ou resposta ruim) é esperada: cai no fallback da Binance abaixo; se ambos falharem, a tela avisa.
      // Fallback para Binance klines (42 candles de 4h = 7 dias)
      try {
        const symbol = ASSETS[from].binanceSymbol;
        const bRes = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=4h&limit=42`);
        if (!bRes.ok) throw new Error('binance ' + bRes.status);
        const klines = await bRes.json();
        const points = klines.map(k => parseFloat(k[4]));
        sparkCache[from] = { time: Date.now(), points };
        renderSparklineSvg(points);
      } catch (err2) {
        document.getElementById('sparklineSvg').innerHTML = '<div class="empty-note">não foi possível carregar o gráfico agora</div>';
      }
    }
  }
  function renderSparklineSvg(points) {
    if (!points || points.length < 2) { document.getElementById('sparklineSvg').innerHTML = ''; return; }
    const w = 600, h = 120, pad = 6;
    const min = Math.min(...points), max = Math.max(...points);
    const range = (max - min) || 1;
    const step = (w - pad * 2) / (points.length - 1);
    const coords = points.map((p, i) => {
      const x = pad + i * step;
      const y = pad + (h - pad * 2) * (1 - (p - min) / range);
      return [x, y];
    });
    const path = coords.map((c, i) => (i === 0 ? 'M' : 'L') + c[0].toFixed(1) + ',' + c[1].toFixed(1)).join(' ');
    const up = points[points.length - 1] >= points[0];
    const color = up ? 'var(--up)' : 'var(--down)';
    const areaPath = path + ` L${coords[coords.length-1][0].toFixed(1)},${h-pad} L${coords[0][0].toFixed(1)},${h-pad} Z`;
    document.getElementById('sparklineSvg').innerHTML = `
      <svg class="chart-svg" viewBox="0 0 ${w} ${h}" width="100%" height="${h}">
        <path d="${areaPath}" fill="${color}" opacity="0.12" stroke="none"/>
        <path d="${path}" fill="none" stroke="${color}" stroke-width="2"/>
      </svg>`;
  }

  /* ============ PORTFÓLIOS (múltiplas carteiras) ============ */
  const PORTFOLIOS_KEY = 'cripto-app-portfolios';
  const CURRENT_PORTFOLIO_KEY = 'cripto-app-current-portfolio';
  let portfolios = [];
  let currentPortfolioId = null;

  async function loadPortfolioList() {
    portfolios = readLocalJson('lista de carteiras', PORTFOLIOS_KEY, [], { keepCopy: true, array: true });
    if (portfolios.length === 0) {
      portfolios = [{ id: 'real', name: 'Real' }, { id: 'teste', name: 'Teste' }];
      await writeLocal('portfolios', PORTFOLIOS_KEY, portfolios);
    }
    currentPortfolioId = localStorage.getItem(CURRENT_PORTFOLIO_KEY) || portfolios[0].id;
    if (!portfolios.find(p => p.id === currentPortfolioId)) currentPortfolioId = portfolios[0].id;
  }
  async function savePortfolioList() {
    const listSaved = await writeLocal('portfolios', PORTFOLIOS_KEY, portfolios);
    if (!listSaved) return false;
    // A carteira atual é texto puro (não JSON): grava e confirma como a lista.
    try {
      localStorage.setItem(CURRENT_PORTFOLIO_KEY, currentPortfolioId);
      if (typeof localStorage.flush === 'function') await localStorage.flush();
      return true;
    } catch (e) {
      console.error('Falha de gravação local: carteira atual', e);
      showNotice('save-portfolios', SAVE_FAILURE_NOTICE.portfolios);
      return false;
    }
  }
  function renderPortfolioSelect() {
    const sel = document.getElementById('portfolioSelect');
    sel.innerHTML = portfolios.map(p => `<option value="${escapeHtml(p.id)}" ${p.id === currentPortfolioId ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('');
  }
  document.getElementById('portfolioSelect').addEventListener('change', async (e) => {
    currentPortfolioId = e.target.value;
    localStorage.setItem(CURRENT_PORTFOLIO_KEY, currentPortfolioId);
    await loadCurrentPortfolioData();
    renderSimulator();
  });
  document.getElementById('newPortfolioBtn').addEventListener('click', async () => {
    const name = prompt('Nome da nova carteira:');
    if (!name || !name.trim()) return;
    const id = 'p' + Date.now();
    const previousId = currentPortfolioId;
    portfolios.push({ id, name: name.trim() });
    currentPortfolioId = id;
    if (!await savePortfolioList()) {
      // Não gravou: a carteira nova não pode aparecer como criada.
      portfolios = portfolios.filter(p => p.id !== id);
      currentPortfolioId = previousId;
      renderPortfolioSelect();
      return;
    }
    renderPortfolioSelect();
    await loadCurrentPortfolioData();
    renderSimulator();
  });
  document.getElementById('renamePortfolioBtn').addEventListener('click', async () => {
    const p = portfolios.find(p => p.id === currentPortfolioId);
    if (!p) return;
    const name = prompt('Novo nome da carteira:', p.name);
    if (!name || !name.trim()) return;
    const previousName = p.name;
    p.name = name.trim();
    if (!await savePortfolioList()) p.name = previousName;
    renderPortfolioSelect();
  });
  /* ---- excluir carteira: confirmação em modal (nome + nº de operações), com backup oferecido antes ---- */
  function pluralize(n, one, many) { return `${n} ${n === 1 ? one : many}`; }
  function describePortfolioDeletion(name, counts) {
    return `Você vai excluir a carteira "${name}", com ${pluralize(counts.trades, 'operação', 'operações')} e ${pluralize(counts.deposits, 'depósito', 'depósitos')}. `
      + 'Todos os dados dela serão apagados deste aparelho e não há como desfazer.';
  }
  function openDeletePortfolioModal() {
    const p = portfolios.find(x => x.id === currentPortfolioId);
    if (!p) return;
    document.getElementById('deletePortfolioText').textContent = describePortfolioDeletion(p.name, FinanceEngine.summarizeChain(chain));
    document.getElementById('deletePortfolioStatus').textContent = '';
    document.getElementById('deletePortfolioOverlay').classList.remove('is-hidden');
    document.getElementById('deletePortfolioCancelBtn').focus();
  }
  function closeDeletePortfolioModal() {
    document.getElementById('deletePortfolioOverlay').classList.add('is-hidden');
  }
  async function confirmDeletePortfolio() {
    const confirmBtn = document.getElementById('deletePortfolioConfirmBtn');
    confirmBtn.disabled = true;
    const doomedId = currentPortfolioId;
    const previousList = portfolios;
    const remaining = portfolios.filter(p => p.id !== doomedId);
    portfolios = remaining;
    currentPortfolioId = remaining[0].id;
    // Primeiro grava a lista sem a carteira: se falhar, nada foi apagado.
    if (!await savePortfolioList()) {
      portfolios = previousList;
      currentPortfolioId = doomedId;
      document.getElementById('deletePortfolioStatus').textContent = 'Não foi possível excluir: a lista de carteiras não foi gravada. Nada foi apagado.';
      confirmBtn.disabled = false;
      return;
    }
    try {
      ['trades','chain','deposits','depositsMigrated','history','alerts','settings'].forEach(k => localStorage.removeItem(`cripto-${k}:${doomedId}`));
      if (typeof localStorage.flush === 'function') await localStorage.flush();
    } catch (e) {
      console.error('Falha ao apagar os dados da carteira excluída', e);
      showNotice('delete-portfolio', 'A carteira saiu da lista, mas seus dados antigos não puderam ser apagados deste aparelho. Eles não aparecem mais no app.');
    }
    confirmBtn.disabled = false;
    closeDeletePortfolioModal();
    renderPortfolioSelect();
    await loadCurrentPortfolioData();
    renderSimulator();
  }
  document.getElementById('deletePortfolioBtn').addEventListener('click', () => {
    if (portfolios.length <= 1) { showNotice('delete-portfolio', 'Precisa manter ao menos uma carteira.'); return; }
    openDeletePortfolioModal();
  });
  document.getElementById('deletePortfolioExportBtn').addEventListener('click', async () => {
    const status = document.getElementById('deletePortfolioStatus');
    status.textContent = 'Preparando o backup…';
    const ok = await exportBackup();
    status.textContent = ok ? 'Backup preparado. Confira se o arquivo foi salvo antes de excluir.' : 'O backup não foi gerado. Veja o aviso na tela antes de excluir.';
  });
  document.getElementById('deletePortfolioConfirmBtn').addEventListener('click', confirmDeletePortfolio);
  document.getElementById('deletePortfolioCancelBtn').addEventListener('click', closeDeletePortfolioModal);
  document.getElementById('closeDeletePortfolioBtn').addEventListener('click', closeDeletePortfolioModal);
  document.getElementById('deletePortfolioOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'deletePortfolioOverlay') closeDeletePortfolioModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !document.getElementById('deletePortfolioOverlay').classList.contains('is-hidden')) closeDeletePortfolioModal();
  });

  /* ============ DADOS DA CARTEIRA ATUAL ============ */
  // Configurações da carteira. Cópias antigas não têm custódia/spread: normalizeSettings preenche os padrões.
  const defaultSettings = () => ({ blockOverdraft: false, custody: 'national', spreadPct: FinanceEngine.DEFAULT_SPREAD_PCT });
  function normalizeSettings(raw) {
    const base = defaultSettings();
    const s = (raw && typeof raw === 'object') ? raw : {};
    const spread = Number(s.spreadPct);
    return {
      ...s,
      blockOverdraft: !!s.blockOverdraft,
      custody: s.custody === 'foreign' ? 'foreign' : base.custody,
      spreadPct: Number.isFinite(spread) && spread >= 0 && spread <= 50 ? spread : base.spreadPct
    };
  }
  let trades = [], chain = [], deposits = [], netWorthHistory = [], alerts = [], settings = defaultSettings();

  function keyFor(name) { return `cripto-${name}:${currentPortfolioId}`; }

  /* ---- blockchain local (hash chain SHA-256, implementação em JS puro — não depende de crypto.subtle) ---- */
  function sha256Sync(message) {
    function rrot(x, n) { return (x >>> n) | (x << (32 - n)); }
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
  async function sha256Hex(str) {
    return sha256Sync(str);
  }
  async function computeBlockHash(block) {
    return sha256Hex(block.index + '|' + block.timestamp + '|' + JSON.stringify(block.data) + '|' + block.previousHash);
  }
  async function makeGenesisBlock() {
    const block = { index: 0, timestamp: Date.now(), data: null, previousHash: '0'.repeat(64) };
    block.hash = await computeBlockHash(block);
    return block;
  }
  async function appendBlock(chainArr, data) {
    const prev = chainArr[chainArr.length - 1];
    const block = { index: prev.index + 1, timestamp: data.timestamp || Date.now(), data, previousHash: prev.hash };
    block.hash = await computeBlockHash(block);
    chainArr.push(block);
    return block;
  }
  async function verifyChainIntegrity(chainArr) {
    for (let i = 0; i < chainArr.length; i++) {
      const b = chainArr[i];
      const recomputed = await computeBlockHash({ index: b.index, timestamp: b.timestamp, data: b.data, previousHash: b.previousHash });
      if (recomputed !== b.hash) return { valid: false, at: i, reason: 'hash do bloco não confere' };
      if (i > 0 && b.previousHash !== chainArr[i - 1].hash) return { valid: false, at: i, reason: 'encadeamento quebrado com o bloco anterior' };
    }
    return { valid: true };
  }
  function chainToTrades() {
    return chain.filter(b => b.data && (b.data.kind === 'trade' || !b.data.kind)).map(b => ({ ...b.data, _hash: b.hash, _index: b.index }));
  }
  function chainToDeposits() {
    return chain.filter(b => b.data && b.data.kind === 'deposit').map(b => ({ ...b.data, _hash: b.hash, _index: b.index }));
  }
  // Verificação da cadeia ao abrir (e a cada carteira carregada): aviso persistente e não bloqueante.
  const CHAIN_INTEGRITY_WARNING = 'O histórico tem inconsistências; os relatórios de IR podem estar errados. Restaure um backup ou exporte para conferência.';
  function applyChainIntegrity(result) {
    if (result && result.valid) { clearNotice('chain-integrity'); return; }
    const at = result && Number.isFinite(result.at) ? result.at : 0;
    const reason = (result && result.reason) || 'não foi possível verificar';
    console.error('Cadeia de operações com inconsistência detectada na verificação');
    showNotice('chain-integrity', CHAIN_INTEGRITY_WARNING, { persistent: true, detail: `Bloco #${at}: ${reason}` });
  }
  async function checkChainOnOpen() {
    let result;
    try { result = await verifyChainIntegrity(chain); }
    catch (e) {
      console.error('Falha ao verificar a integridade da cadeia na abertura', e);
      result = { valid: false, at: 0, reason: 'a verificação não pôde ser concluída' };
    }
    applyChainIntegrity(result);
    return result;
  }
  function saveChain() {
    return writeLocal('chain', keyFor('chain'), chain);
  }
  async function rebuildChainFromDataList(dataList) {
    const sorted = [...dataList].sort((a, b) => a.timestamp - b.timestamp);
    const newChain = [await makeGenesisBlock()];
    for (const d of sorted) await appendBlock(newChain, d);
    return newChain;
  }

  async function loadCurrentPortfolioData() {
    chain = readLocalJson('histórico de operações', keyFor('chain'), [], { keepCopy: true, array: true });
    const depositsMigrated = localStorage.getItem(keyFor('depositsMigrated')) === '1';

    if (chain.length === 0) {
      // primeira vez nesta carteira: cria o bloco gênese e migra operações + depósitos antigos (formato pré-blockchain), se existirem
      const legacyTrades = readLocalJson('operações antigas', keyFor('trades'), [], { array: true });
      const legacyDeposits = readLocalJson('depósitos antigos', keyFor('deposits'), [], { array: true });
      const combined = [
        ...legacyTrades.map(t => ({ ...t, kind: 'trade' })),
        ...legacyDeposits.map(d => ({ ...d, kind: 'deposit' })),
      ];
      chain = await rebuildChainFromDataList(combined);
      await saveChain();
      localStorage.setItem(keyFor('depositsMigrated'), '1');
    } else if (!depositsMigrated) {
      // chain já existia de uma versão anterior (só com operações); junta os depósitos legados agora
      const legacyDeposits = readLocalJson('depósitos antigos', keyFor('deposits'), [], { array: true });
      const existingData = chain.filter(b => b.data).map(b => ({ ...b.data, kind: b.data.kind || 'trade' }));
      const combined = [...existingData, ...legacyDeposits.map(d => ({ ...d, kind: 'deposit' }))];
      chain = await rebuildChainFromDataList(combined);
      await saveChain();
      localStorage.setItem(keyFor('depositsMigrated'), '1');
    }

    trades = chainToTrades();
    deposits = chainToDeposits();
    netWorthHistory = readLocalJson('histórico de patrimônio', keyFor('history'), [], { array: true });
    alerts = readLocalJson('alertas', keyFor('alerts'), [], { array: true });
    settings = normalizeSettings(readLocalJson('configurações', keyFor('settings'), null));
    document.getElementById('blockOverdraftCheck').checked = !!settings.blockOverdraft;
    syncTradeFormSettings();
    flushLoadProblems();
    await checkChainOnOpen();
  }
  function saveHistory() { return writeLocal('history', keyFor('history'), netWorthHistory); }
  function saveAlerts() { return writeLocal('alerts', keyFor('alerts'), alerts); }
  function saveSettings() { return writeLocal('settings', keyFor('settings'), settings); }
  document.getElementById('blockOverdraftCheck').addEventListener('change', async (e) => {
    const previous = settings.blockOverdraft;
    settings.blockOverdraft = e.target.checked;
    if (!await saveSettings()) { settings.blockOverdraft = previous; e.target.checked = previous; }
  });

  // Todo cálculo financeiro vem do finance-engine.js (coberto pelos testes automatizados).
  function computeCashBalance() {
    return FinanceEngine.computeCashBalance(deposits, trades);
  }
  function computeSummary() {
    return FinanceEngine.computeSummary(ASSET_KEYS, trades, {}).perAsset;
  }
  // Origem da cotação USD/BRL em uso ('CoinGecko', 'Binance', 'cache') — gravada em cada operação.
  let fxSourceName = null;
  function currentFx() {
    if (usdPrice.brl) return { fxRate: 1 / usdPrice.brl, fxSource: fxSourceName || 'cache' };
    return { fxRate: FinanceEngine.FALLBACK_BRL_PER_USD, fxSource: 'fallback' };
  }
  function numberFrom(id) {
    const el = document.getElementById(id);
    const n = el ? parseFloat(el.value) : NaN;
    return Number.isFinite(n) && n > 0 ? n : 0;
  }
  // Taxa da corretora (% ou USD) + spread/slippage estimado (%), em USD, para um valor de operação.
  function readTradeCosts(value) {
    const unitEl = document.getElementById('feeUnitSelect');
    const fee = numberFrom('feeInput');
    const feeUSD = unitEl && unitEl.value === 'usd' ? fee : value * fee / 100;
    const spreadEl = document.getElementById('spreadInput');
    const spreadPct = spreadEl && spreadEl.value !== ''
      ? numberFrom('spreadInput')
      : (Number.isFinite(Number(settings.spreadPct)) ? Number(settings.spreadPct) : FinanceEngine.DEFAULT_SPREAD_PCT);
    return { feeUSD, spreadPct, spreadUSD: value * spreadPct / 100 };
  }
  function computeRunningBalances() {
    const running = {}; ASSET_KEYS.forEach(a => running[a] = 0);
    return [...trades].sort((a, b) => a.timestamp - b.timestamp).map(t => {
      running[t.asset] = (running[t.asset] || 0) + (t.type === 'buy' ? t.qty : -t.qty);
      return { ...t, balanceAfter: running[t.asset] };
    });
  }

  /* ---- alocação da carteira ---- */
  function renderAllocation(cashBalance, assetValues) {
    const items = [];
    if (cashBalance > 0) items.push({ label: 'Saldo (caixa)', value: cashBalance, color: 'var(--ink-dim)' });
    let colorIdx = 0;
    Object.keys(assetValues).forEach(a => {
      if (assetValues[a] > 0.005) {
        items.push({ label: ASSETS[a].name, value: assetValues[a], color: ALLOC_COLORS[colorIdx % ALLOC_COLORS.length] });
        colorIdx++;
      }
    });
    const total = items.reduce((s, i) => s + i.value, 0);
    const bar = document.getElementById('allocationBar');
    const legend = document.getElementById('allocationLegend');
    if (total <= 0) {
      bar.innerHTML = '';
      legend.innerHTML = '<div class="empty-note">Sem dados suficientes ainda.</div>';
      return;
    }
    bar.innerHTML = items.map(i => `<div class="alloc-seg" data-pct="${(i.value/total*100).toFixed(2)}" data-color="${i.color}"></div>`).join('');
    legend.innerHTML = items.map(i => `
      <div class="item"><span class="swatch" data-color="${i.color}"></span>${i.label} · ${(i.value/total*100).toFixed(1)}%</div>
    `).join('');
    paintDynamic(bar);
    paintDynamic(legend);
  }

  /* ---- gráfico de patrimônio interativo ---- */
  let chartPeriod = 'all';

  function recordNetWorthSnapshot(netWorth) {
    const last = netWorthHistory[netWorthHistory.length - 1];
    if (last && Date.now() - last.t < 60 * 1000) return; // no máximo 1 ponto por minuto
    netWorthHistory.push({ t: Date.now(), v: netWorth });
    if (netWorthHistory.length > 300) netWorthHistory = netWorthHistory.slice(-300);
    saveHistory();
  }

  function renderNetWorthChart() {
    const el = document.getElementById('netWorthChart');
    const rangeSummaryEl = document.getElementById('chartRangeSummary');
    const hoverInfo = document.getElementById('chartHoverInfo');

    if (netWorthHistory.length < 2) {
      el.innerHTML = '<div class="empty-note">O histórico aparece conforme os preços forem atualizando com o app aberto.</div>';
      if (rangeSummaryEl) rangeSummaryEl.textContent = '';
      if (hoverInfo) hoverInfo.classList.add('is-hidden');
      return;
    }

    const now = Date.now();
    let filteredHistory = [...netWorthHistory];
    if (chartPeriod === '24h') {
      filteredHistory = netWorthHistory.filter(p => now - p.t <= 24 * 3600 * 1000);
    } else if (chartPeriod === '7d') {
      filteredHistory = netWorthHistory.filter(p => now - p.t <= 7 * 24 * 3600 * 1000);
    } else if (chartPeriod === '30d') {
      filteredHistory = netWorthHistory.filter(p => now - p.t <= 30 * 24 * 3600 * 1000);
    }

    if (filteredHistory.length < 2) {
      filteredHistory = netWorthHistory;
    }

    const points = filteredHistory.map(p => p.v);
    const w = 600, h = 140, pad = 10;
    const min = Math.min(...points), max = Math.max(...points);
    const range = (max - min) || 1;
    const step = (w - pad * 2) / (points.length - 1);
    const coords = points.map((p, i) => [pad + i * step, pad + (h - pad * 2) * (1 - (p - min) / range)]);
    const linePath = coords.map((c, i) => (i === 0 ? 'M' : 'L') + c[0].toFixed(1) + ',' + c[1].toFixed(1)).join(' ');
    const areaPath = `${linePath} L ${coords[coords.length-1][0].toFixed(1)},${h} L ${coords[0][0].toFixed(1)},${h} Z`;
    const up = points[points.length - 1] >= points[0];
    const color = up ? 'var(--up)' : 'var(--down)';

    if (rangeSummaryEl) {
      rangeSummaryEl.textContent = `mín: ${fmt(min, 'usd')} · máx: ${fmt(max, 'usd')}`;
    }

    el.innerHTML = `
      <div class="chart-wrap">
        <svg id="netWorthSvg" class="chart-svg chart-svg-overflow" viewBox="0 0 ${w} ${h}" width="100%" height="${h}">
          <defs>
            <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="${color}" stop-opacity="0.25"/>
              <stop offset="100%" stop-color="${color}" stop-opacity="0.0"/>
            </linearGradient>
          </defs>
          <path d="${areaPath}" fill="url(#chartGrad)"/>
          <path d="${linePath}" fill="none" stroke="${color}" stroke-width="2"/>
          <line id="crosshairLine" x1="0" y1="0" x2="0" y2="${h}" stroke="var(--ink-dim)" stroke-dasharray="3,3" stroke-width="1" class="is-hidden"/>
          <circle id="crosshairDot" cx="0" cy="0" r="4.5" fill="${color}" stroke="var(--bg)" stroke-width="2" class="is-hidden"/>
        </svg>
      </div>
      <div class="secondary chart-footer">
        <span>${filteredHistory.length} pontos registrados</span>
        <span>${new Date(filteredHistory[0].t).toLocaleDateString('pt-BR')} — ${new Date(filteredHistory[filteredHistory.length-1].t).toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'})}</span>
      </div>`;

    const svg = document.getElementById('netWorthSvg');
    const crossLine = document.getElementById('crosshairLine');
    const crossDot = document.getElementById('crosshairDot');

    function onPointerMove(clientX) {
      const rect = svg.getBoundingClientRect();
      const relX = clientX - rect.left;
      const pct = Math.max(0, Math.min(1, relX / rect.width));
      const idx = Math.min(filteredHistory.length - 1, Math.max(0, Math.round(pct * (filteredHistory.length - 1))));
      const pt = coords[idx];
      const dataPoint = filteredHistory[idx];

      crossLine.setAttribute('x1', pt[0]);
      crossLine.setAttribute('x2', pt[0]);
      crossLine.classList.remove('is-hidden');

      crossDot.setAttribute('cx', pt[0]);
      crossDot.setAttribute('cy', pt[1]);
      crossDot.classList.remove('is-hidden');

      if (hoverInfo) {
        hoverInfo.classList.remove('is-hidden');
        document.getElementById('chartHoverDate').textContent = `${new Date(dataPoint.t).toLocaleString('pt-BR')}`;
        document.getElementById('chartHoverVal').innerHTML = `${fmt(dataPoint.v, 'usd')} <span class="chart-hover-sub">${fmtBRLSecondary(dataPoint.v)}</span>`;
      }
    }

    svg.addEventListener('mousemove', (e) => onPointerMove(e.clientX));
    svg.addEventListener('touchmove', (e) => {
      if (e.touches && e.touches[0]) onPointerMove(e.touches[0].clientX);
    }, { passive: true });

    svg.addEventListener('mouseleave', () => {
      crossLine.classList.add('is-hidden');
      crossDot.classList.add('is-hidden');
      if (hoverInfo) hoverInfo.classList.add('is-hidden');
    });
    svg.addEventListener('touchend', () => {
      setTimeout(() => {
        crossLine.classList.add('is-hidden');
        crossDot.classList.add('is-hidden');
        if (hoverInfo) hoverInfo.classList.add('is-hidden');
      }, 2500);
    });
  }

  document.addEventListener('click', (e) => {
    if (e.target && e.target.classList.contains('chart-period-btn')) {
      chartPeriod = e.target.dataset.period;
      document.querySelectorAll('.chart-period-btn').forEach(b => b.classList.toggle('active', b === e.target));
      renderNetWorthChart();
    }
  });

  /* ---- alertas de preço com Web Notifications ---- */
  function renderAlerts() {
    const list = document.getElementById('alertList');
    list.innerHTML = alerts.length ? alerts.map(a => `
      <div class="alert-row">
        <div class="details">${ASSETS[a.asset].name} ${a.direction === 'above' ? 'acima de' : 'abaixo de'} ${fmt(a.target, 'usd')}</div>
        <button class="del" data-id="${a.id}" aria-label="Remover alerta">${FinancIcons.svg('x', { size: 16 })}</button>
      </div>`).join('') : '<div class="empty-note">Nenhum alerta criado.</div>';
    list.querySelectorAll('.del').forEach(btn => {
      btn.addEventListener('click', async () => {
        const previous = alerts;
        alerts = alerts.filter(a => String(a.id) !== btn.dataset.id);
        if (!await saveAlerts()) alerts = previous;
        renderAlerts();
      });
    });
  }
  document.getElementById('addAlertBtn').addEventListener('click', async () => {
    const asset = document.getElementById('alertAsset').value;
    const direction = document.getElementById('alertDirection').value;
    const target = parseFloat(document.getElementById('alertTarget').value);
    if (!target || target <= 0) return;

    if ('Notification' in window && Notification.permission === 'default') {
      // Notificação do navegador é opcional: se o pedido de permissão falhar, o alerta continua valendo como faixa na tela.
      try { await Notification.requestPermission(); } catch (e) { /* recurso do navegador ausente ou bloqueado */ }
    }

    const created = { id: Date.now() + Math.random(), asset, direction, target, triggered: false };
    alerts.push(created);
    if (!await saveAlerts()) {
      // Não gravou: o alerta não pode aparecer na lista como criado.
      alerts = alerts.filter(a => a !== created);
      renderAlerts();
      return;
    }
    document.getElementById('alertTarget').value = '';
    renderAlerts();
  });

  function checkAlerts() {
    const banner = document.getElementById('alertBanners');
    let firedHtml = '';
    alerts.forEach(a => {
      const price = usdPrice[a.asset];
      if (price == null) return;
      const met = a.direction === 'above' ? price >= a.target : price <= a.target;
      if (met && !a.triggered) {
        a.triggered = true;
        firedHtml += `<div class="alert-banner"><span>${ASSETS[a.asset].name} ${a.direction === 'above' ? 'passou de' : 'caiu abaixo de'} ${fmt(a.target,'usd')} — preço atual: ${fmt(price,'usd')}</span><button data-dismiss="${a.id}" aria-label="Dispensar">${FinancIcons.svg('x', { size: 16 })}</button></div>`;
        if ('Notification' in window && Notification.permission === 'granted') {
          try {
            new Notification(`Alerta: ${ASSETS[a.asset].name}`, {
              body: `${ASSETS[a.asset].name} ${a.direction === 'above' ? 'passou de' : 'caiu abaixo de'} ${fmt(a.target, 'usd')} (atual: ${fmt(price, 'usd')})`,
              icon: 'icon-192.png'
            });
          } catch (e) {
            // Notificação do navegador é opcional (recurso ausente/bloqueado): a faixa na tela já avisou.
          }
        }
      } else if (!met && a.triggered) {
        a.triggered = false;
      }
    });
    saveAlerts();
    if (firedHtml) {
      banner.innerHTML += firedHtml;
      banner.querySelectorAll('[data-dismiss]').forEach(btn => {
        btn.addEventListener('click', () => btn.closest('.alert-banner').remove());
      });
    }
  }

  /* ---- depósitos ---- */
  function renderDeposits() {
    const list = document.getElementById('depositList');
    const sorted = [...deposits].sort((a,b) => b.timestamp - a.timestamp);
    list.innerHTML = sorted.length ? sorted.map(d => `
      <div class="timeline-item">
        <div class="timeline-dot deposit"></div>
        <div class="timeline-text">
          <div class="main">Depósito de ${fmt(d.amount,'usd')}</div>
          <div class="sub">${new Date(d.timestamp).toLocaleString('pt-BR')} · bloco #${d._index} · hash ${d._hash ? d._hash.slice(0,12) + '…' : '—'}</div>
        </div>
      </div>`).join('') : '';
  }
  document.getElementById('depositBtn').addEventListener('click', async () => {
    const input = document.getElementById('depositInput');
    const amount = parseFloat(input.value);
    if (!amount || amount === 0) return;
    const btn = document.getElementById('depositBtn');
    btn.disabled = true;
    btn.textContent = 'Minerando bloco…';
    const lengthBefore = chain.length;
    await appendBlock(chain, { kind: 'deposit', id: Date.now() + Math.random(), amount, timestamp: Date.now() });
    if (!await saveChain()) {
      // Não gravou: tira o bloco da memória para a tela não mostrar o depósito como salvo.
      chain.length = lengthBefore;
      deposits = chainToDeposits();
      showNotice('save-chain', 'Não foi possível salvar o depósito. Ele não foi gravado; tente de novo ou faça um backup.');
      btn.disabled = false;
      btn.textContent = 'Adicionar saldo';
      renderSimulator();
      return;
    }
    deposits = chainToDeposits();
    input.value = '';
    btn.disabled = false;
    btn.textContent = 'Adicionar saldo';
    renderSimulator();
  });

  /* ---- render principal do portfólio ---- */
  function updateQtyPreview() {
    const value = parseFloat(document.getElementById('valueInput').value) || 0;
    const asset = document.getElementById('assetSelect').value;
    const price = usdPrice[asset] || 0;
    const preview = document.getElementById('qtyPreview');
    let text = (value > 0 && price > 0) ? `≈ ${fmtQty(value / price, asset)} ao preço atual (${fmt(price,'usd')})` : '';
    if (text && value > 0) {
      const c = readTradeCosts(value);
      const total = c.feeUSD + c.spreadUSD;
      if (total > 0) text += ` · custos estimados ${fmt(total, 'usd')} (taxa ${fmt(c.feeUSD, 'usd')} + spread ${fmt(c.spreadUSD, 'usd')})`;
    }
    preview.textContent = text;
  }
  function syncTradeFormSettings() {
    const spread = document.getElementById('spreadInput');
    const custody = document.getElementById('custodySelect');
    if (spread) spread.value = settings.spreadPct;
    if (custody) custody.value = settings.custody;
  }
  ['feeInput', 'spreadInput', 'feeUnitSelect'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', updateQtyPreview);
  });
  document.getElementById('spreadInput').addEventListener('change', async (e) => {
    const v = parseFloat(e.target.value);
    const previous = settings.spreadPct;
    settings.spreadPct = Number.isFinite(v) && v >= 0 && v <= 50 ? v : FinanceEngine.DEFAULT_SPREAD_PCT;
    e.target.value = settings.spreadPct;
    updateQtyPreview();
    if (!await saveSettings()) { settings.spreadPct = previous; e.target.value = previous; updateQtyPreview(); }
  });
  document.getElementById('custodySelect').addEventListener('change', async (e) => {
    const previous = settings.custody;
    settings.custody = e.target.value === 'foreign' ? 'foreign' : 'national';
    if (!await saveSettings()) { settings.custody = previous; e.target.value = previous; }
  });

  function renderSimulator() {
    renderPortfolioSelect();
    const asset = document.getElementById('assetSelect').value;
    if (usdPrice[asset]) document.getElementById('priceInput').value = usdPrice[asset];

    const cashBalance = computeCashBalance();
    document.getElementById('cashBalanceValue').innerHTML = `${fmt(cashBalance,'usd')}<div class="secondary">${fmtBRLSecondary(cashBalance)}</div>`;
    document.getElementById('cashBalanceValue').classList.toggle('is-down', cashBalance < 0);

    const summary = computeSummary();
    const summaryCard = document.getElementById('summaryCard');
    let totalValue = 0, totalGain = 0, hasHoldings = false;
    let totalRealized = 0;
    const totalFees = FinanceEngine.totalTradeCostsUSD(trades);
    const assetValues = {};

    let rows = ASSET_KEYS.map(a => {
      const s = summary[a];
      const qty = s.boughtQty;
      const avgCost = qty > 0 ? s.boughtCost / qty : 0;
      const price = usdPrice[a] || 0;
      const currentValue = qty * price;
      assetValues[a] = currentValue;
      const unrealized = qty * (price - avgCost);
      const totalAssetGain = unrealized + s.realized;
      const costBasis = qty * avgCost;
      const pct = costBasis > 0 ? (unrealized / costBasis) * 100 : 0;
      if (qty > 0.00000001) hasHoldings = true;
      totalValue += currentValue;
      totalGain += totalAssetGain;
      totalRealized += s.realized;

      if (qty < 0.00000001 && s.realized === 0) return '';
      return `
        <div class="summary-row">
          <div class="summary-asset">
            ${avatarHtml(a)}
            <div>
              <div class="asset-name">${ASSETS[a].name}</div>
              <div class="asset-meta">${qty > 0 ? fmtQty(qty, a) + ' em carteira · custo médio ' + fmt(avgCost, 'usd') : 'sem posição aberta'}</div>
            </div>
          </div>
          <div class="figures">
            <div class="value">${fmt(qty > 0 ? currentValue : 0, 'usd')}</div>
            <div class="secondary">${qty > 0 ? fmtBRLSecondary(currentValue) : ''}</div>
            <div class="gain ${totalAssetGain >= 0 ? 'pos' : 'neg'}">${fmtGain(totalAssetGain)} total${qty > 0 ? ' · não realizado ' + fmtGain(unrealized) + ' (' + (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%)' : ''}${s.realized !== 0 ? ' · realizado ' + fmtGain(s.realized) : ''}</div>
          </div>
        </div>`;
    }).join('');

    summaryCard.innerHTML = rows || '<div class="empty-note">Nenhuma operação registrada ainda.</div>';
    const totalUnrealized = totalGain - totalRealized;
    if (hasHoldings || totalGain !== 0) {
      summaryCard.innerHTML += `
        <div class="totals"><div class="label">Valor total em ativos</div><div class="value">${fmt(totalValue,'usd')}<div class="secondary">${fmtBRLSecondary(totalValue)}</div></div></div>
        <div class="totals"><div class="label">Lucro não-realizado (posições abertas)</div><div class="value ${totalUnrealized >= 0 ? 'is-up' : 'is-down'}">${fmtGain(totalUnrealized)}</div></div>
        <div class="totals"><div class="label">Lucro realizado (vendas encerradas)</div><div class="value ${totalRealized >= 0 ? 'is-up' : 'is-down'}">${fmtGain(totalRealized)}</div></div>
        <div class="totals"><div class="label">Custos pagos (taxas + spread estimado, já incluídos no resultado)</div><div class="value">${fmt(totalFees,'usd')}</div></div>
        <div class="totals totals-final"><div class="label">Resultado global líquido</div><div class="value ${totalGain >= 0 ? 'is-up' : 'is-down'}">${fmtGain(totalGain)}</div></div>`;
    }
    const netWorth = cashBalance + totalValue;
    document.getElementById('netWorthValue').innerHTML = `${fmt(netWorth,'usd')}<div class="secondary">${fmtBRLSecondary(netWorth)}</div>`;

    document.getElementById('heroAmount').textContent = fmt(netWorth, 'usd');
    const heroDeltaEl = document.getElementById('heroDelta');
    heroDeltaEl.textContent = fmtGain(totalGain);
    heroDeltaEl.className = 'hero-delta ' + (totalGain >= 0 ? 'pos' : 'neg');

    renderAllocation(cashBalance, assetValues);
    renderNetWorthChart();
    renderDeposits();
    renderAlerts();

    const historyCard = document.getElementById('historyCard');
    const withBalances = computeRunningBalances();
    const sortedDesc = [...withBalances].sort((a, b) => b.timestamp - a.timestamp);
    historyCard.innerHTML = sortedDesc.length ? sortedDesc.map(t => {
      return `
      <div class="timeline-item">
        <div class="timeline-dot ${t.type}"></div>
        <div class="timeline-text">
          <div class="main">${t.type === 'buy' ? 'Compra' : 'Venda'} de ${fmt(t.value != null ? t.value : t.qty * t.price, 'usd')} em ${ASSETS[t.asset].name}</div>
          <div class="sub">${fmtQty(t.qty, t.asset)} a ${fmt(t.price,'usd')} · saldo após: ${fmtQty(Math.max(t.balanceAfter,0), t.asset)}</div>
          ${(() => { const c = FinanceEngine.tradeCostsUSD(t); const tot = c.fee + c.spread; const fxTxt = t.fxRate ? ` · USD/BRL ${Number(t.fxRate).toFixed(4)}${t.fxSource === 'fallback' ? ' (estimado)' : ''}` : ' · USD/BRL não gravado (antigo)'; return `<div class="sub">${tot > 0 ? 'custos ' + fmt(tot, 'usd') + ' · ' : ''}${t.custody === 'foreign' ? 'exterior' : 'exchange nacional'}${fxTxt}</div>`; })()}
          <div class="sub is-faint">${new Date(t.timestamp).toLocaleString('pt-BR')} · bloco #${t._index} · hash ${t._hash ? t._hash.slice(0,12) + '…' : '—'}</div>
        </div>
      </div>`;
    }).join('') : '<div class="empty-note">Nenhuma operação registrada ainda.</div>';
  }

  document.querySelectorAll('.type-toggle button').forEach(btn => {
    btn.addEventListener('click', () => {
      currentType = btn.dataset.type;
      document.querySelectorAll('.type-toggle button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('submitBtn').textContent = currentType === 'buy' ? 'Registrar compra' : 'Registrar venda';
    });
  });
  let currentType = 'buy';

  document.getElementById('assetSelect').addEventListener('change', () => { renderSimulator(); updateQtyPreview(); });
  document.getElementById('valueInput').addEventListener('input', updateQtyPreview);

  document.getElementById('tradeForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = document.getElementById('submitBtn');
    if (submitBtn.disabled) return;
    const asset = document.getElementById('assetSelect').value;
    const value = parseFloat(document.getElementById('valueInput').value);
    const price = usdPrice[asset];
    const costs = readTradeCosts(Number.isFinite(value) ? value : 0);
    const totalCosts = costs.feeUSD + costs.spreadUSD;
    // As regras de operação (venda acima do saldo, taxa maior que a venda, números positivos) vivem no engine
    // e são as mesmas usadas na importação de backups antigos.
    const check = FinanceEngine.validateTrade(
      { asset, type: currentType, value, price, feeUSD: costs.feeUSD, spreadUSD: costs.spreadUSD },
      { assetKeys: ASSET_KEYS, availableQty: computeSummary()[asset]?.boughtQty || 0 }
    );
    if (!check.ok) {
      // Valor/cotação ainda não preenchidos não merecem mensagem; as demais recusas explicam o motivo.
      if (check.code !== 'invalid_number') document.getElementById('ioStatus').textContent = check.message;
      return;
    }
    const qty = check.qty;

    if (currentType === 'buy' && value + totalCosts > computeCashBalance()) {
      if (settings.blockOverdraft) {
        document.getElementById('ioStatus').textContent = 'operação bloqueada: valor maior que o saldo disponível';
        return;
      }
      document.getElementById('ioStatus').textContent = 'atenção: valor da compra é maior que o saldo não alocado (saldo ficará negativo)';
    } else {
      document.getElementById('ioStatus').textContent = '';
    }
    submitBtn.disabled = true;
    submitBtn.textContent = 'Minerando bloco…';
    const lengthBefore = chain.length;
    await appendBlock(chain, {
      kind: 'trade',
      id: Date.now() + Math.random(),
      asset,
      type: currentType,
      value,
      price,
      qty,
      feeUSD: costs.feeUSD,
      spreadUSD: costs.spreadUSD,
      spreadPct: costs.spreadPct,
      custody: (document.getElementById('custodySelect') || {}).value === 'foreign' ? 'foreign' : (settings.custody === 'foreign' ? 'foreign' : 'national'),
      ...currentFx(),
      timestamp: Date.now()
    });
    if (!await saveChain()) {
      // Não gravou: tira o bloco da memória para a tela não mostrar a operação como salva. Os campos ficam como estão.
      chain.length = lengthBefore;
      trades = chainToTrades();
      showNotice('save-chain', 'Não foi possível salvar a operação. Ela não foi gravada; tente de novo ou faça um backup.');
      submitBtn.disabled = false;
      submitBtn.textContent = currentType === 'buy' ? 'Registrar compra' : 'Registrar venda';
      renderSimulator();
      return;
    }
    trades = chainToTrades();
    document.getElementById('valueInput').value = '';
    if (document.getElementById('feeInput')) document.getElementById('feeInput').value = '';
    document.getElementById('qtyPreview').textContent = '';
    submitBtn.disabled = false;
    submitBtn.textContent = currentType === 'buy' ? 'Registrar compra' : 'Registrar venda';
    renderSimulator();
  });

  document.getElementById('verifyChainBtn').addEventListener('click', async () => {
    const statusEl = document.getElementById('chainStatus');
    statusEl.textContent = 'verificando…';
    const result = await verifyChainIntegrity(chain);
    statusEl.innerHTML = result.valid
      ? `<span class="is-up">Íntegro</span> — ${chain.length} blocos verificados, encadeamento de hashes confere do início ao fim`
      : `<span class="is-down">Adulteração detectada</span> no bloco #${result.at} (${result.reason})`;
    applyChainIntegrity(result);
  });

  /* ---- Calculadora de Meta de Lucro (Target Profit) ---- */
  function renderTargetProfit() {
    const tableBody = document.getElementById('targetProfitTableBody');
    const targetInput = document.getElementById('profitTargetInput');
    const periodSelect = document.getElementById('profitPeriodSelect');
    if (!tableBody || !targetInput || !periodSelect) return;

    const targetVal = parseFloat(targetInput.value);
    const periodicity = periodSelect.value;
    
    const calc = FinanceEngine.calculateTargetProfitScenarios(targetVal, periodicity);

    tableBody.innerHTML = calc.rows.map(row => `
      <tr>
        <td class="cell-scenario">${row.cenario}</td>
        <td class="col-center">${row.rendimentoEstimado}</td>
        <td class="col-right cell-capital">
          ${row.capitalUSD > 0 ? fmt(row.capitalUSD, 'usd') : '$0.00'}
        </td>
        <td class="col-right">${row.observacao}</td>
      </tr>
    `).join('');
  }

  const profitTargetInputEl = document.getElementById('profitTargetInput');
  if (profitTargetInputEl) {
    profitTargetInputEl.addEventListener('input', renderTargetProfit);
  }
  const profitPeriodSelectEl = document.getElementById('profitPeriodSelect');
  if (profitPeriodSelectEl) {
    profitPeriodSelectEl.addEventListener('change', renderTargetProfit);
  }

  const targetProfitFormEl = document.getElementById('targetProfitForm');
  if (targetProfitFormEl) {
    targetProfitFormEl.addEventListener('submit', (event) => {
      event.preventDefault();
      renderTargetProfit();
    });
  }
  // A meta depende apenas dos campos acima, sem aguardar carteira ou cotações.
  renderTargetProfit();

  /* ---- exportar / importar ---- */
  // Devolve true se o backup foi preparado; false se algo impediu (o motivo já foi mostrado ao usuário).
  async function exportBackup() {
    if (!subtleCryptoSupported) {
      showNotice('export-backup', 'Criptografia indisponível neste navegador ou contexto não seguro (precisa de HTTPS ou localhost). Operação cancelada para proteger seus dados.');
      return false;
    }
    // Com as 12 palavras: sem senha, abre em qualquer aparelho com elas (app ainda com PIN próprio: pede senha).
    const data = { chain, deposits, netWorthHistory, alerts, settings };
    try {
      document.getElementById('ioStatus').textContent = 'criptografando dados com AES-256-GCM…';
      await window.exportProtected(data, 'cripito-sim:backup', `portfolio-${currentPortfolioId}-${new Date().toISOString().slice(0,10)}.json`);
    } catch (e) {
      console.error('Falha ao exportar o backup', e);
      document.getElementById('ioStatus').textContent = 'erro ao criptografar: ' + (e.message || e);
      return false;
    }
    document.getElementById('ioStatus').textContent = 'backup exportado com 100% dos dados criptografados (AES-256)';
    return true;
  }
  document.getElementById('exportBtn').addEventListener('click', exportBackup);
  document.getElementById('importBtn').addEventListener('click', () => document.getElementById('importFile').click());
  // Mensagens ao usuário na importação (um lugar só, para a tela e os testes).
  const IMPORT_MSG = {
    notJson: 'Arquivo inválido: o conteúdo não é um JSON legível. Use um backup exportado por este app.',
    unknownFormat: 'Arquivo inválido: não tem a blockchain nem a lista de operações (trades) de um backup. Use um backup exportado por este app.',
    unreadable: 'Não foi possível ler o arquivo selecionado. Tente de novo.',
    notSaved: 'Não foi possível salvar os dados importados. Nada foi alterado; tente de novo ou faça um backup.'
  };
  document.getElementById('importFile').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onerror = () => {
      console.error('Falha ao ler o arquivo de importação', reader.error);
      document.getElementById('ioStatus').textContent = IMPORT_MSG.unreadable;
    };
    reader.onload = async () => {
      try {
        let imported;
        try { imported = JSON.parse(reader.result); }
        catch (parseError) { document.getElementById('ioStatus').textContent = IMPORT_MSG.notJson; return; }
        // Backups antigos usam 150 mil iterações: abrem, mas vale exportar um novo (600 mil e senha longa).
        const weakBackup = Boolean(imported && imported.encrypted && Number(imported.iterations ?? 150000) < 600000);
        if (imported && (imported.format === FinancVault.seed.BACKUP_FORMAT || imported.format === 'financ-encrypted-v1')) {
          try { imported = await window.importProtected(imported, 'cripito-sim:backup'); }
          catch (e) { document.getElementById('ioStatus').textContent = e.message || 'não foi possível abrir o backup'; return; }
          if (imported === null) { document.getElementById('ioStatus').textContent = 'importação cancelada'; return; }
        } else if (imported && imported.encrypted) {
          const password = await window.askSecret('Senha do backup (arquivos antigos podem usar PIN):', false, true);
          if (password === null) return;
          try {
            imported = await decryptJSON(imported, password);
          } catch (e) {
            if (e && e.message === 'CERT_REQUIRED') {
              showNotice('import-cert', `Este arquivo foi criptografado com Certificado Digital deste ou de outro aparelho (ID: ${imported.certId || 'desconhecido'}). Importe o certificado em "Segurança > Certificado Digital" antes de abrir.`);
              document.getElementById('ioStatus').textContent = 'abertura bloqueada: certificado digital do aparelho ausente';
            } else {
              document.getElementById('ioStatus').textContent = 'PIN incorreto ou certificado do aparelho não corresponde ao arquivo';
            }
            return;
          }
        }
        let newChain;
        if (imported && Array.isArray(imported.chain)) {
          const result = await verifyChainIntegrity(imported.chain);
          if (!result.valid) {
            document.getElementById('ioStatus').textContent = `arquivo rejeitado: blockchain adulterada (bloco #${result.at})`;
            return;
          }
          newChain = imported.chain;
        } else if (imported && Array.isArray(imported.trades)) {
          // formato antigo (pré-blockchain): valida cada registro com as regras de operação ANTES de reconstruir a cadeia
          const combined = [
            ...imported.trades.map(t => ({ ...t, kind: 'trade' })),
            ...(Array.isArray(imported.deposits) ? imported.deposits.map(d => ({ ...d, kind: 'deposit' })) : []),
          ];
          const check = FinanceEngine.validateImportedRecords(ASSET_KEYS, combined);
          if (check.invalid.length) {
            document.getElementById('ioStatus').textContent = FinanceEngine.describeImportRejection(check.invalid, combined.length);
            return;
          }
          newChain = await rebuildChainFromDataList(check.valid);
        } else {
          document.getElementById('ioStatus').textContent = IMPORT_MSG.unknownFormat;
          return;
        }
        // Troca o estado e grava; se qualquer gravação falhar, volta tudo como estava (memória e cofre).
        const before = { chain, trades, deposits, netWorthHistory, alerts, settings };
        chain = newChain;
        trades = chainToTrades();
        deposits = chainToDeposits();
        netWorthHistory = Array.isArray(imported.netWorthHistory) ? imported.netWorthHistory : [];
        alerts = Array.isArray(imported.alerts) ? imported.alerts : [];
        settings = normalizeSettings(imported.settings || settings);
        const saved = await saveChain() && await saveHistory() && await saveAlerts() && await saveSettings();
        if (!saved) {
          ({ chain, trades, deposits, netWorthHistory, alerts, settings } = before);
          await saveChain(); await saveHistory(); await saveAlerts(); await saveSettings();
          renderSimulator();
          document.getElementById('ioStatus').textContent = IMPORT_MSG.notSaved;
          showNotice('import-save', IMPORT_MSG.notSaved);
          return;
        }
        applyChainIntegrity({ valid: true });
        renderSimulator();
        document.getElementById('ioStatus').textContent = `${trades.length} operações e ${deposits.length} depósitos importados — integridade da blockchain verificada`
          + (weakBackup ? '. Este backup usa a proteção antiga: exporte um novo backup para ficar com a proteção atual.' : '');
      } catch (err) {
        console.error('Falha inesperada ao importar o backup', err);
        document.getElementById('ioStatus').textContent = `Não foi possível importar: erro inesperado (${(err && err.message) || err}). Nada foi alterado.`;
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  /* ---- exportação para CSV (extrato contábil / planilhas) ---- */
  async function exportCsv() {
    const allEvents = [];
    deposits.forEach(d => {
      allEvents.push({
        timestamp: d.timestamp,
        dateIso: new Date(d.timestamp).toISOString(),
        dateLocal: new Date(d.timestamp).toLocaleString('pt-BR'),
        type: 'Depósito',
        asset: 'USD',
        assetName: 'Dólar (Saldo)',
        qty: d.amount,
        price: 1,
        totalValue: d.amount,
        balanceAfter: '—',
        blockIndex: d._index != null ? d._index : '—',
        blockHash: d._hash || '—'
      });
    });
    const running = computeRunningBalances();
    running.forEach(t => {
      const isBuy = t.type === 'buy';
      allEvents.push({
        timestamp: t.timestamp,
        dateIso: new Date(t.timestamp).toISOString(),
        dateLocal: new Date(t.timestamp).toLocaleString('pt-BR'),
        type: isBuy ? 'Compra' : 'Venda',
        asset: t.asset.toUpperCase(),
        assetName: ASSETS[t.asset] ? ASSETS[t.asset].name : t.asset,
        qty: t.qty,
        price: t.price,
        totalValue: t.value != null ? t.value : t.qty * t.price,
        balanceAfter: t.balanceAfter != null ? t.balanceAfter.toFixed(6) : '—',
        blockIndex: t._index != null ? t._index : '—',
        blockHash: t._hash || '—',
        costs: (() => { const c = FinanceEngine.tradeCostsUSD(t); return c.fee + c.spread; })(),
        fxRate: t.fxRate ? Number(t.fxRate) : '',
        fxSource: t.fxRate ? t.fxSource : 'não gravado',
        custody: t.custody === 'foreign' ? 'exterior' : 'nacional'
      });
    });

    allEvents.sort((a, b) => a.timestamp - b.timestamp);

    const headers = ['Data/Hora (ISO)', 'Data/Hora (Local)', 'Tipo', 'Ativo', 'Nome', 'Quantidade', 'Preço Unitário (USD)', 'Valor Total (USD)', 'Saldo Posição Após', 'Bloco #', 'Hash do Bloco', 'Taxa+Spread (USD)', 'Câmbio USD/BRL', 'Origem do câmbio', 'Custódia'];
    const csvLines = [headers.map(h => `"${h}"`).join(';')];

    allEvents.forEach(e => {
      csvLines.push([
        `"${e.dateIso}"`,
        `"${e.dateLocal}"`,
        `"${e.type}"`,
        `"${e.asset}"`,
        `"${e.assetName}"`,
        typeof e.qty === 'number' ? e.qty.toFixed(8).replace('.', ',') : `"${e.qty}"`,
        typeof e.price === 'number' ? e.price.toFixed(4).replace('.', ',') : `"${e.price}"`,
        typeof e.totalValue === 'number' ? e.totalValue.toFixed(2).replace('.', ',') : `"${e.totalValue}"`,
        `"${e.balanceAfter}"`,
        `"${e.blockIndex}"`,
        `"${e.blockHash}"`,
        typeof e.costs === 'number' ? e.costs.toFixed(2).replace('.', ',') : '""',
        typeof e.fxRate === 'number' ? e.fxRate.toFixed(4).replace('.', ',') : '""',
        `"${e.fxSource || ''}"`,
        `"${e.custody || ''}"`
      ].join(';'));
    });

    try {
      await window.exportProtected(csvLines.join('\r\n'), 'cripito-sim:statement', `extrato-cripto-${currentPortfolioId}.csv.secure.json`);
    } catch (_) { document.getElementById('ioStatus').textContent = 'Não foi possível exportar o extrato protegido.'; }
  }
  document.getElementById('exportCsvBtn').addEventListener('click', exportCsv);

  /* ---- modal de Relatório Fiscal & IRPF (DeCripto, IN RFB 2.291/2025) ---- */
  let selectedTaxMonth = '';

  // Cálculo fiscal 100% no finance-engine.js (R$ histórico por operação, regimes, faixas, DARF mínimo).
  function computeTaxReport() {
    return FinanceEngine.computeTaxReport(ASSET_KEYS, trades, {
      currentBrlPerUsd: usdPrice.brl ? (1 / usdPrice.brl) : null,
      defaultCustody: settings.custody
    });
  }

  const brl = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  function renderTaxModal() {
    const report = computeTaxReport();
    const months = [...report.monthKeys].reverse();
    const nowKey = FinanceEngine.monthKeySP(Date.now());
    const labelOf = (key) => {
      const [y, m] = key.split('-').map(Number);
      return new Date(y, m - 1, 15).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    };

    if (!selectedTaxMonth || !report.months[selectedTaxMonth]) {
      selectedTaxMonth = months[0] || nowKey;
    }
    const empty = { monthKey: selectedTaxMonth, operations: [], estimated: false, fxFallback: false, volumeBRL: 0,
      national: { alienationBRL: 0, netGainBRL: 0, taxableGainBRL: 0, lossBRL: 0, isExempt: true, taxBRL: 0, darfBRL: 0, darfCarryInBRL: 0, darfCarryOutBRL: 0, darfDeferred: false, brackets: [] },
      foreign: { alienationBRL: 0, netGainBRL: 0, salesCount: 0 }, decripto: { volumeBRL: 0, triggered: false } };
    const current = report.months[selectedTaxMonth] || empty;
    const n = current.national;
    const year = selectedTaxMonth.slice(0, 4);
    const fy = report.foreignYears[year];
    const LIMIT = FinanceEngine.EXEMPTION_LIMIT_BRL;
    const anyFallback = usdPrice.brl == null;

    const fxWarn = [];
    if (current.estimated) fxWarn.push('<strong>Valores estimados:</strong> há operações sem a cotação USD/BRL do dia gravada (registradas em versões anteriores); foi usada a cotação atual. Revise antes de declarar.');
    if (current.fxFallback) fxWarn.push('<strong>Câmbio de contingência:</strong> sem cotação disponível, usado R$ ' + FinanceEngine.FALLBACK_BRL_PER_USD.toFixed(2).replace('.', ',') + ' por dólar (valor fixo do aplicativo, não é cotação real).');
    if (anyFallback) fxWarn.push('A cotação USD/BRL atual não foi carregada; novas operações registradas agora usam o câmbio de contingência.');

    const statusBadge = n.alienationBRL === 0
      ? '<span class="tax-badge exempt">SEM VENDAS NACIONAIS</span>'
      : `<span class="tax-badge ${n.isExempt ? 'exempt' : 'taxable'}">${n.isExempt ? 'ISENTO (vendas nacionais ≤ R$ 35.000,00)' : 'TRIBUTÁVEL (vendas nacionais > R$ 35.000,00)'}</span>`;

    const darfNote = n.darfDeferred
      ? `Imposto abaixo de R$ 10,00: não recolher; ${brl(n.darfCarryOutBRL)} acumulam para o mês seguinte`
      : (n.darfBRL > 0 ? `DARF 4600${n.darfCarryInBRL > 0 ? ' (inclui ' + brl(n.darfCarryInBRL) + ' acumulados)' : ''}` : (n.isExempt ? 'Isento de DARF' : 'Sem DARF neste mês'));

    const opRows = current.operations.map(op => {
      const foreign = op.custody === 'foreign';
      return `
          <div class="timeline-item">
            <div class="timeline-dot sell"></div>
            <div class="timeline-text">
              <div class="main">Venda de ${fmtQty(op.qty, op.asset)} (${ASSETS[op.asset].name}) · ${foreign ? 'exterior' : 'exchange nacional'}</div>
              <div class="sub">Alienação: ${brl(op.alienationBRL)} (${fmt(op.saleProceedsUsd, 'usd')} a R$ ${op.fxRate.toFixed(4).replace('.', ',')}/USD${op.fxSource === 'operation' ? '' : ', ' + (op.fxSource === 'fallback' ? 'câmbio de contingência' : 'câmbio atual estimado')})</div>
              <div class="sub">Ganho: <span class="${op.gainBRL >= 0 ? 'is-up' : 'is-down'}">${brl(op.gainBRL)}</span> (${fmtGain(op.gainUSD)})${op.estimated ? ' · <strong>estimado</strong>' : ''}</div>
              <div class="sub is-faint">${new Date(op.timestamp).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} (Brasília)</div>
            </div>
          </div>`;
    }).join('');

    const foreignBlock = (current.foreign.salesCount || fy) ? `
      <div class="tax-notice tax-notice--accent">
        <strong>Custódia no exterior (Lei 14.754/2023; IN RFB 2.180/2024, art. 9º):</strong> 15% fixo, apuração anual na declaração, sem isenção de R$ 35.000,00 e sem DARF mensal. Perdas compensam no ano e passam aos anos seguintes.<br>
        ${current.foreign.salesCount ? `Neste mês: alienação ${brl(current.foreign.alienationBRL)}, resultado ${brl(current.foreign.netGainBRL)}.<br>` : ''}
        ${fy ? `Ano ${year}: resultado ${brl(fy.netGainBRL)}${fy.lossCarryInBRL > 0 ? ' − prejuízo de anos anteriores ' + brl(fy.lossCarryInBRL) : ''} = base ${brl(fy.taxableBaseBRL)} → imposto anual estimado <strong>${brl(fy.taxBRL)}</strong>${fy.lossCarryOutBRL > 0 ? ' · prejuízo a compensar em ' + (Number(year) + 1) + ': ' + brl(fy.lossCarryOutBRL) : ''}${fy.estimated ? ' · <strong>estimado</strong>' : ''}.` : ''}
      </div>` : '';

    const content = document.getElementById('taxModalContent');
    content.innerHTML = `
      <div class="field-spaced">
        <label>Selecione o Mês de Apuração</label>
        <select id="taxMonthSelect">
          ${months.length ? months.map(m => `<option value="${m}" ${m === selectedTaxMonth ? 'selected' : ''}>${labelOf(m).toUpperCase()} (${report.months[m].operations.length} vendas)</option>`).join('') : `<option value="${nowKey}">${labelOf(nowKey).toUpperCase()}</option>`}
        </select>
      </div>

      ${fxWarn.length ? `<div class="tax-notice tax-notice--fx">${fxWarn.join('<br>')}</div>` : ''}

      <div class="tax-status-row">
        <span class="tax-status-label">Status Tributário (exchange nacional):</span>
        ${statusBadge}
      </div>

      <div class="tax-stat-grid">
        <div class="tax-card">
          <div class="k">TOTAL ALIENADO (NACIONAL)</div>
          <div class="v">${brl(n.alienationBRL)}</div>
          <div class="hint">em R$ da data de cada venda</div>
        </div>
        <div class="tax-card">
          <div class="k">LIMITE DE ISENÇÃO</div>
          <div class="v is-dim">R$ 35.000,00</div>
          <div class="hint">${((n.alienationBRL / LIMIT) * 100).toFixed(1)}% do teto atingido</div>
        </div>
        <div class="tax-card">
          <div class="k">RESULTADO REALIZADO (NACIONAL)</div>
          <div class="v ${n.netGainBRL >= 0 ? 'is-up' : 'is-down'}">${brl(n.netGainBRL)}</div>
          <div class="hint">base tributável (só ganhos, sem compensar perdas): ${brl(n.taxableGainBRL)}</div>
        </div>
        <div class="tax-card">
          <div class="k">IMPOSTO ESTIMADO (15% A 22,5%)</div>
          <div class="v ${n.taxBRL > 0 ? 'is-down' : 'is-up'}">${brl(n.taxBRL)}</div>
          <div class="hint">${darfNote}</div>
        </div>
      </div>

      ${foreignBlock}

      <div class="tax-notice">
        <strong>Regras (exchange nacional):</strong><br>
        • Vendas totais de criptoativos no mês, somando todas as criptos, até R$ 35.000,00 têm isenção do ganho de capital (limite comparado em centavos); acima disso todo o ganho é tributado.<br>
        • Alíquotas progressivas por faixa de ganho: 15% até R$ 5 mi; 17,5% até R$ 10 mi; 20% até R$ 30 mi; 22,5% acima.<br>
        • Postura conservadora: o imposto incide sobre a soma dos ganhos positivos, sem abater prejuízos do mesmo mês (compensação pendente de validação com contador).<br>
        • DARF código 4600 até o último dia útil do mês seguinte; imposto abaixo de R$ 10,00 não é recolhido e acumula para os meses seguintes.<br>
        • Vender cripto por USDT ou outra stablecoin (permuta) é tributável como venda por reais.<br>
        • Mês de apuração pelo horário de Brasília. Taxas de corretagem entram no custo (compra) e reduzem a alienação (venda); o limite de isenção usa o valor bruto.<br>
        • <strong>DeCripto (IN RFB 2.291/2025):</strong> o gatilho soma compras, vendas, permutas e transferências do mês. Volume registrado neste mês: <strong>${brl(current.decripto.volumeBRL)}</strong>${current.decripto.triggered ? ' — <strong>acima de R$ 35.000,00: pode exigir declaração mensal (operações em exchange do exterior, P2P ou DeFi)</strong>.' : ' — abaixo de R$ 35.000,00.'} O app não registra permutas nem transferências, então o volume pode estar subestimado.
      </div>

      <div class="tax-notice tax-notice--dim">
        <strong>Avisos:</strong><br>
        ${FinanceEngine.TAX_DISCLAIMERS.map((d, i) => `${i + 1}. ${d}`).join('<br>')}
      </div>

      <div class="tax-ops">
        <div class="tax-ops-title">Vendas registradas neste mês (${current.operations.length})</div>
        ${opRows || '<div class="empty-note">Nenhuma venda registrada neste mês.</div>'}
      </div>
    `;

    document.getElementById('taxMonthSelect').addEventListener('change', (e) => {
      selectedTaxMonth = e.target.value;
      renderTaxModal();
    });
  }

  function openTaxModal() {
    renderTaxModal();
    document.getElementById('taxModalOverlay').classList.remove('is-hidden');
  }
  function closeTaxModal() {
    document.getElementById('taxModalOverlay').classList.add('is-hidden');
  }
  document.getElementById('closeTaxModalBtn').addEventListener('click', closeTaxModal);
  document.getElementById('taxModalOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'taxModalOverlay') closeTaxModal();
  });
  document.getElementById('openTaxModalBtn').addEventListener('click', openTaxModal);

  /* ---- arquivo conectado: removido na v1.16.0 ----
     Gravava sozinho num JSON do computador, com uma senha separada, e não funcionava no celular. O backup do kit
     (Configurações → Seus dados: cópia de segurança, lembrete, salvar no Drive) substitui. Arquivos antigos continuam
     abrindo em "Importar backup (JSON)" com a senha deles. Aqui só se apagam os atalhos de arquivo que ficaram guardados. */
  try { indexedDB.deleteDatabase('cripto-app-db'); } catch (e) {
    // Limpeza de atalhos antigos: sem IndexedDB (ou bloqueado) não há o que apagar.
  }

  /* ============ BUSCA DE PREÇOS (compartilhada e multi-provedor com fallback) ============ */
  const CACHED_PRICES_KEY = 'cripto-cached-prices-v2';
  let lastPriceFetchTime = 0;

  function saveCachedPrices() {
    try {
      localStorage.setItem(CACHED_PRICES_KEY, JSON.stringify({
        usdPrice,
        change24h,
        time: Date.now()
      }));
    } catch (e) {
      // Cache de cotações é descartável: sem ele só se busca a cotação de novo.
    }
  }

  function loadCachedPrices() {
    try {
      const raw = localStorage.getItem(CACHED_PRICES_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.usdPrice) {
          Object.assign(usdPrice, parsed.usdPrice);
          Object.assign(change24h, parsed.change24h || {});
          return parsed.time;
        }
      }
    } catch (e) {
      // Cache de cotações ilegível é descartável: ignora e busca cotações novas.
    }
    return 0;
  }

  async function fetchPrices(force = false) {
    const now = Date.now();
    if (!force && now - lastPriceFetchTime < 12000 && usdPrice.btc != null) {
      return; // throttle 12s para evitar chamadas redundantes
    }

    let success = false;
    let sourceName = '';

    // 1. Tenta CoinGecko com timeout
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4500);
      const ids = ASSET_KEYS.map(k => ASSETS[k].geckoId).join(',');
      const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd,brl&include_24hr_change=true`, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (!res.ok) throw new Error('status ' + res.status);
      const data = await res.json();
      ASSET_KEYS.forEach(k => {
        const g = data[ASSETS[k].geckoId];
        if (g) { usdPrice[k] = g.usd; change24h[k] = g.usd_24h_change; }
      });
      if (data.bitcoin && data.bitcoin.usd && data.bitcoin.brl) {
        usdPrice.brl = data.bitcoin.usd / data.bitcoin.brl;
        fxSourceName = 'CoinGecko';
      }
      sourceName = 'CoinGecko';
      success = true;
    } catch (errGecko) {
      // 2. Fallback: Binance 24hr ticker (rápido, sem rate limit e com CORS livre)
      try {
        const symbolsParam = JSON.stringify([...ASSET_KEYS.map(k => ASSETS[k].binanceSymbol), 'USDTBRL']);
        const bRes = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbols=${encodeURIComponent(symbolsParam)}`);
        if (!bRes.ok) throw new Error('binance status ' + bRes.status);
        const bList = await bRes.json();
        const bMap = {};
        bList.forEach(item => { bMap[item.symbol] = item; });
        ASSET_KEYS.forEach(k => {
          const item = bMap[ASSETS[k].binanceSymbol];
          if (item) {
            usdPrice[k] = parseFloat(item.lastPrice);
            change24h[k] = parseFloat(item.priceChangePercent);
          }
        });
        if (bMap['USDTBRL']) {
          const usdtBrl = parseFloat(bMap['USDTBRL'].lastPrice);
          if (usdtBrl > 0) { usdPrice.brl = 1 / usdtBrl; fxSourceName = 'Binance'; }
        }
        sourceName = 'Binance (fallback)';
        success = true;
      } catch (errBinance) {
        // 3. Fallback: cache local do localStorage se tudo estiver offline
        const cachedTime = loadCachedPrices();
        if (cachedTime) {
          sourceName = 'Cache local (offline)';
          if (usdPrice.brl) fxSourceName = 'cache';
          success = true;
        }
      }
    }

    if (success) {
      lastPriceFetchTime = Date.now();
      saveCachedPrices();
      const statusTextEl = document.getElementById('statusText');
      if (sourceName.includes('offline')) {
        statusTextEl.innerHTML = `<span class="live is-warn"><span class="live-dot"></span>preços em cache (${sourceName})</span>`;
      } else if (sourceName.includes('fallback')) {
        statusTextEl.innerHTML = `<span class="live is-accent"><span class="live-dot"></span>preços ao vivo (${sourceName})</span>`;
      } else {
        statusTextEl.innerHTML = '<span class="live"><span class="live-dot"></span>preços ao vivo</span>';
      }
      document.getElementById('statusTime').textContent = 'atualizado às ' + new Date().toLocaleTimeString('pt-BR');
      renderConverter();
      renderSimulator();
      updateQtyPreview();
      checkAlerts();
      const netWorth = computeCashBalance() + ASSET_KEYS.reduce((sum,a) => {
        const s = computeSummary()[a];
        return sum + s.boughtQty * (usdPrice[a] || 0);
      }, 0);
      recordNetWorthSnapshot(netWorth);
    } else {
      document.getElementById('statusText').textContent = 'não foi possível atualizar os preços agora';
    }
  }

  /* ============ INICIALIZAÇÃO ============ */
  (async function init() {
    try {
      await loadPortfolioList();
      renderPortfolioSelect();
      await loadCurrentPortfolioData();
      renderConverter();
      renderSimulator();
      fetchPrices();
      setInterval(fetchPrices, 20000);
    } catch (e) {
      // nunca deixa a tela em branco: mostra o app mesmo se algo falhar, com um aviso
      document.getElementById('appWrap').classList.remove('is-hidden');
      const banner = document.getElementById('alertBanners');
      if (banner) banner.innerHTML = `<div class="alert-banner"><span>Ocorreu um erro ao carregar alguns dados (${escapeHtml(e.message || e)}). Tente recarregar a página.</span></div>`;
      console.error('Erro na inicialização:', e);
    }
  })();

})().catch(() => window.lockVault());
