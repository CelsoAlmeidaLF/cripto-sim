/* ============ PWA: registro do service worker (com auto-atualização) ============ */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
        .then((reg) => {
          reg.update(); // checa por versão nova assim que a página abre
        })
        .catch(() => { /* segue sem PWA se falhar */ });
    });

    // quando uma versão nova assume o controle, recarrega a página sozinho UMA vez
    let swRefreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (swRefreshing) return;
      swRefreshing = true;
      window.location.reload();
    });
  }

  /* ============ SEGURANÇA: PIN e tela de bloqueio ============ */
  const PIN_HASH_KEY = 'cripto-app-pin-hash';
  const PIN_SALT_KEY = 'cripto-app-pin-salt';

  function bufToB64(buf) { return btoa(String.fromCharCode(...new Uint8Array(buf))); }
  function b64ToBuf(b64) { return Uint8Array.from(atob(b64), c => c.charCodeAt(0)); }

  async function hashPin(pin, saltB64) {
    return sha256Hex(saltB64 + ':' + pin);
  }
  function hasPinConfigured() { return !!localStorage.getItem(PIN_HASH_KEY); }
  async function setPin(pin) {
    const salt = bufToB64(crypto.getRandomValues(new Uint8Array(16)));
    const hash = await hashPin(pin, salt);
    localStorage.setItem(PIN_SALT_KEY, salt);
    localStorage.setItem(PIN_HASH_KEY, hash);
  }
  async function checkPin(pin) {
    const salt = localStorage.getItem(PIN_SALT_KEY);
    const storedHash = localStorage.getItem(PIN_HASH_KEY);
    if (!salt || !storedHash) return false;
    const hash = await hashPin(pin, salt);
    return hash === storedHash;
  }
  function removePinConfig() {
    localStorage.removeItem(PIN_HASH_KEY);
    localStorage.removeItem(PIN_SALT_KEY);
    localStorage.removeItem('cripto-app-unlocked');
    removeBiometricsConfig();
  }

  /* ---- Autenticação Biométrica (WebAuthn / Passkey) ---- */
  const BIOMETRICS_KEY = 'cripto-app-biometrics-enabled';
  const BIOMETRICS_CRED_KEY = 'cripto-app-biometrics-cred-id';

  function isBiometricsSupported() {
    return !!(window.PublicKeyCredential && navigator.credentials && navigator.credentials.create);
  }
  function isBiometricsConfigured() {
    return localStorage.getItem(BIOMETRICS_KEY) === '1' && !!localStorage.getItem(BIOMETRICS_CRED_KEY);
  }
  function removeBiometricsConfig() {
    localStorage.removeItem(BIOMETRICS_KEY);
    localStorage.removeItem(BIOMETRICS_CRED_KEY);
  }

  async function registerBiometrics() {
    if (!isBiometricsSupported()) {
      alert('Seu navegador ou dispositivo não possui suporte a autenticação biométrica (WebAuthn).');
      return false;
    }
    try {
      const challenge = new Uint8Array(32);
      crypto.getRandomValues(challenge);
      const userId = new Uint8Array(16);
      crypto.getRandomValues(userId);
      const credential = await navigator.credentials.create({
        publicKey: {
          challenge,
          rp: { name: 'Cripto App' },
          user: {
            id: userId,
            name: 'usuario-cripto',
            displayName: 'Usuário Cripto'
          },
          pubKeyCredParams: [
            { type: 'public-key', alg: -7 },   // ES256
            { type: 'public-key', alg: -257 }  // RS256
          ],
          authenticatorSelection: {
            authenticatorAttachment: 'platform',
            userVerification: 'required'
          },
          timeout: 60000
        }
      });
      if (credential) {
        localStorage.setItem(BIOMETRICS_CRED_KEY, bufToB64(credential.rawId));
        localStorage.setItem(BIOMETRICS_KEY, '1');
        return true;
      }
    } catch (e) {
      if (e.name !== 'NotAllowedError') {
        alert('Erro ao ativar biometria: ' + (e.message || e));
      }
    }
    return false;
  }

  async function verifyBiometrics() {
    const credIdB64 = localStorage.getItem(BIOMETRICS_CRED_KEY);
    if (!credIdB64 || !isBiometricsSupported()) return false;
    try {
      const challenge = new Uint8Array(32);
      crypto.getRandomValues(challenge);
      const credential = await navigator.credentials.get({
        publicKey: {
          challenge,
          allowCredentials: [{
            type: 'public-key',
            id: b64ToBuf(credIdB64)
          }],
          userVerification: 'required',
          timeout: 60000
        }
      });
      return !!credential;
    } catch (e) {
      return false;
    }
  }

  /* ---- tela de bloqueio ---- */
  const UNLOCK_KEY = 'cripto-app-unlocked';
  function isUnlocked() {
    try { return localStorage.getItem(UNLOCK_KEY) === '1'; } catch (e) { return false; }
  }
  function markUnlocked() {
    try { localStorage.setItem(UNLOCK_KEY, '1'); } catch (e) {}
  }
  function markLocked() {
    try { localStorage.removeItem(UNLOCK_KEY); } catch (e) {}
  }

  function showLockScreen() {
    closeSecurityModal();
    document.getElementById('appWrap').style.display = 'none';
    document.getElementById('lockScreen').style.display = 'flex';
    document.getElementById('pinInput').value = '';
    document.getElementById('lockError').textContent = '';
    const bioBtn = document.getElementById('biometricsUnlockBtn');
    if (isBiometricsConfigured()) {
      bioBtn.style.display = 'block';
      setTimeout(async () => {
        const ok = await verifyBiometrics();
        if (ok) hideLockScreen();
      }, 250);
    } else {
      bioBtn.style.display = 'none';
    }
    setTimeout(() => document.getElementById('pinInput').focus(), 50);
  }
  function hideLockScreen() {
    markUnlocked();
    document.getElementById('lockScreen').style.display = 'none';
    document.getElementById('appWrap').style.display = 'block';
  }
  async function attemptPinUnlock() {
    const pin = document.getElementById('pinInput').value;
    const errEl = document.getElementById('lockError');
    if (!pin) return;
    const ok = await checkPin(pin);
    if (ok) { hideLockScreen(); }
    else { errEl.textContent = 'PIN incorreto'; document.getElementById('pinInput').value = ''; }
  }
  document.getElementById('unlockBtn').addEventListener('click', attemptPinUnlock);
  document.getElementById('pinInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') attemptPinUnlock(); });
  document.getElementById('biometricsUnlockBtn').addEventListener('click', async () => {
    const ok = await verifyBiometrics();
    if (ok) hideLockScreen();
    else document.getElementById('lockError').textContent = 'Biometria não reconhecida. Tente o PIN.';
  });

  function checkLockOnStart() {
    if (hasPinConfigured() && !isUnlocked()) {
      showLockScreen();
    }
  }
  function lockNow() {
    if (!hasPinConfigured()) { alert('Configure um PIN primeiro em Segurança.'); return; }
    markLocked();
    showLockScreen();
  }

  /* ---- renderização da seção "Segurança" ---- */
  function renderSecuritySection() {
    const el = document.getElementById('securityContent');
    const pinSet = hasPinConfigured();
    const bioSupported = isBiometricsSupported();
    const bioSet = isBiometricsConfigured();
    const cert = getDeviceCert();
    el.innerHTML = `
      <div class="security-row">
        <div>
          <div class="label">PIN de acesso</div>
          <div class="desc">${pinSet ? 'Ativado — pedido ao abrir o app pela primeira vez ou após bloquear' : 'Desativado — qualquer pessoa que abrir este navegador vê seus dados'}</div>
        </div>
        <button class="icon-btn" id="pinToggleBtn">${pinSet ? 'Remover' : 'Criar PIN'}</button>
      </div>
      <div id="pinSetupArea"></div>
      ${pinSet && bioSupported ? `
      <div class="security-row">
        <div>
          <div class="label">Desbloqueio por Biometria</div>
          <div class="desc">${bioSet ? 'Ativado — Touch ID, Face ID ou Windows Hello' : 'Desativado — use sua digital ou reconhecimento facial no desbloqueio'}</div>
        </div>
        <button class="icon-btn" id="bioToggleBtn">${bioSet ? 'Desativar' : 'Ativar'}</button>
      </div>` : ''}
      <div class="security-row">
        <div>
          <div class="label">Certificado do Celular / Aparelho (2FA Criptográfico)</div>
          <div class="desc">${cert ? `Ativado — ID: <code>${cert.id.slice(0, 10)}…</code> (protege a abertura de qualquer JSON gerado neste aparelho)` : 'Nenhum certificado ativo neste navegador'}</div>
        </div>
        <button class="icon-btn" id="manageCertBtn">Gerenciar</button>
      </div>
      ${pinSet ? `
      <div class="security-row">
        <div>
          <div class="label">Bloquear agora</div>
          <div class="desc">Trava o app na hora — vai pedir o PIN ou Biometria na próxima vez</div>
        </div>
        <button class="icon-btn" id="lockNowBtn">Bloquear</button>
      </div>` : ''}
    `;
    if (pinSet) document.getElementById('lockNowBtn').addEventListener('click', lockNow);
    document.getElementById('manageCertBtn').addEventListener('click', () => {
      closeSecurityModal();
      openCertModal();
    });
    if (pinSet && bioSupported) {
      document.getElementById('bioToggleBtn').addEventListener('click', async () => {
        if (bioSet) {
          removeBiometricsConfig();
          renderSecuritySection();
        } else {
          const success = await registerBiometrics();
          if (success) renderSecuritySection();
        }
      });
    }
    document.getElementById('pinToggleBtn').addEventListener('click', () => {
      if (pinSet) {
        const current = prompt('Digite seu PIN atual para remover a proteção:');
        if (current == null) return;
        checkPin(current).then(ok => {
          if (ok) { removePinConfig(); renderSecuritySection(); }
          else alert('PIN incorreto.');
        });
      } else {
        const area = document.getElementById('pinSetupArea');
        area.innerHTML = `
          <div class="pin-setup-row">
            <input type="password" inputmode="numeric" id="newPin" placeholder="Novo PIN (4-6 dígitos)" maxlength="6">
            <input type="password" inputmode="numeric" id="confirmPin" placeholder="Confirmar" maxlength="6">
            <button class="submit-btn" id="savePinBtn" type="button">Salvar PIN</button>
          </div>`;
        const doSavePin = async () => {
          const p1 = document.getElementById('newPin').value;
          const p2 = document.getElementById('confirmPin').value;
          if (p1.length < 4) { alert('Use pelo menos 4 dígitos.'); return; }
          if (p1 !== p2) { alert('Os PINs não conferem.'); return; }
          await setPin(p1);
          renderSecuritySection();
        };
        document.getElementById('savePinBtn').addEventListener('click', doSavePin);
        document.getElementById('confirmPin').addEventListener('keydown', (e) => { if (e.key === 'Enter') doSavePin(); });
      }
    });
  }

  /* ---- modal de Segurança ---- */
  function openSecurityModal() {
    renderSecuritySection();
    document.getElementById('securityModalOverlay').style.display = 'flex';
  }
  function closeSecurityModal() {
    document.getElementById('securityModalOverlay').style.display = 'none';
  }
  document.getElementById('openSecurityBtn').addEventListener('click', openSecurityModal);
  document.getElementById('closeSecurityModalBtn').addEventListener('click', closeSecurityModal);
  document.getElementById('securityModalOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'securityModalOverlay') closeSecurityModal();
  });

  /* ---- modal de ajuda: navegador sem suporte a escrita direta em arquivo ---- */
  function renderFileAccessHelp() {
    const flagUrl = 'brave://flags/#file-system-access-api';
    const el = document.getElementById('fileAccessContent');
    el.innerHTML = `
      <p style="font-size:14px; line-height:1.6; margin:0 0 10px;">
        Este navegador não expõe a <strong>File System Access API</strong>, então o app não consegue
        gravar automaticamente num arquivo JSON no seu disco. No Brave isso costuma estar desativado
        por padrão (proteção contra fingerprinting) — dá pra ligar manualmente:
      </p>
      <ol class="help-steps">
        <li>Copie o link abaixo e cole numa nova aba</li>
        <li>Ative a opção <strong>"File System Access API"</strong></li>
        <li>Clique em <strong>Reiniciar</strong> quando o Brave pedir</li>
        <li>Volte aqui e clique de novo em "Conectar arquivo JSON"</li>
      </ol>
      <div class="code-row">
        <code>${flagUrl}</code>
        <button type="button" id="copyFlagUrlBtn">Copiar</button>
      </div>
      <p style="font-size:12.5px; color:var(--ink-dim); line-height:1.6; margin:10px 0 16px;">
        Por segurança, nenhum site (nem este) consegue ligar essa flag sozinho ou abrir
        <code>brave://flags</code> diretamente — é uma configuração do navegador, não uma permissão do app.
      </p>
      <button class="submit-btn" id="useExportInsteadBtn" type="button">Usar Exportar/Importar agora</button>
    `;
    document.getElementById('copyFlagUrlBtn').addEventListener('click', async () => {
      const btn = document.getElementById('copyFlagUrlBtn');
      try {
        await navigator.clipboard.writeText(flagUrl);
        btn.textContent = 'Copiado!';
      } catch (e) {
        btn.textContent = 'não foi possível copiar';
      }
      setTimeout(() => { btn.textContent = 'Copiar'; }, 2000);
    });
    document.getElementById('useExportInsteadBtn').addEventListener('click', () => {
      closeFileAccessModal();
      document.getElementById('exportBtn').click();
    });
  }
  function openFileAccessModal() {
    renderFileAccessHelp();
    document.getElementById('fileAccessModalOverlay').style.display = 'flex';
  }
  function closeFileAccessModal() {
    document.getElementById('fileAccessModalOverlay').style.display = 'none';
  }
  document.getElementById('closeFileAccessModalBtn').addEventListener('click', closeFileAccessModal);
  document.getElementById('fileAccessModalOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'fileAccessModalOverlay') closeFileAccessModal();
  });

  /* ============ CERTIFICADO DIGITAL DO CELULAR / DISPOSITIVO (2FA CRIPTOGRÁFICO) ============ */
  const DEVICE_CERT_KEY = 'cripto-app-device-cert';

  function getDeviceCert() {
    try {
      const raw = localStorage.getItem(DEVICE_CERT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function ensureDeviceCert() {
    let cert = getDeviceCert();
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

  function renderCertModal() {
    const cert = ensureDeviceCert();
    const el = document.getElementById('certModalContent');
    el.innerHTML = `
      <div style="font-size:13.5px; line-height:1.6; color:var(--ink); margin-bottom:14px;">
        Este aparelho possui um <strong>Certificado Digital Exclusivo</strong> gerado no navegador.
        Se alguém descobrir seu PIN ou senha, <strong>ainda assim NÃO conseguirá abrir seu arquivo JSON</strong>
        em outro computador ou celular sem importar este arquivo de certificado antes.
      </div>

      <div class="card" style="margin-bottom:14px; background:var(--surface-2);">
        <div style="font-size:11px; color:var(--ink-dim); font-family:'IBM Plex Mono',monospace;">ID DO CERTIFICADO</div>
        <div style="font-size:16px; font-family:'IBM Plex Mono',monospace; font-weight:600; margin:4px 0 8px; color:var(--accent);">${cert.id}</div>
        <div style="font-size:11px; color:var(--ink-dim); font-family:'IBM Plex Mono',monospace;">CRIADO EM</div>
        <div style="font-size:12.5px; font-family:'IBM Plex Mono',monospace;">${new Date(cert.createdAt).toLocaleString('pt-BR')}</div>
      </div>

      <div style="display:flex; flex-direction:column; gap:10px;">
        <button class="submit-btn" id="downloadCertBtn" type="button">📥 Baixar Certificado (.cert.json)</button>
        <button class="icon-btn" id="uploadCertBtn" type="button" style="padding:11px;">📤 Importar Certificado de Outro Aparelho</button>
        <input type="file" id="importCertFileInput" accept="application/json" style="display:none;">
        <button class="icon-btn" id="regenCertBtn" type="button" style="color:var(--down); padding:11px;">⚠️ Gerar Novo Certificado</button>
      </div>
      <div class="status" id="certStatus" style="margin-top:12px;"></div>
    `;

    document.getElementById('downloadCertBtn').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(cert, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cripto-device-${cert.id}.cert.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      document.getElementById('certStatus').textContent = 'Certificado baixado! Guarde em local seguro ou envie para seus aparelhos autorizados.';
    });

    document.getElementById('uploadCertBtn').addEventListener('click', () => {
      document.getElementById('importCertFileInput').click();
    });

    document.getElementById('importCertFileInput').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const importedCert = JSON.parse(reader.result);
          if (importedCert && importedCert.id && importedCert.secret) {
            localStorage.setItem(DEVICE_CERT_KEY, JSON.stringify(importedCert));
            renderCertModal();
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
    });

    document.getElementById('regenCertBtn').addEventListener('click', () => {
      if (!confirm('Atenção: Gerar um novo certificado fará com que este celular não consiga abrir arquivos JSON anteriores a menos que você tenha guardado o certificado antigo. Deseja continuar?')) return;
      localStorage.removeItem(DEVICE_CERT_KEY);
      ensureDeviceCert();
      renderCertModal();
      document.getElementById('certStatus').textContent = 'Novo certificado digital gerado com sucesso.';
    });
  }

  function openCertModal() {
    renderCertModal();
    document.getElementById('certModalOverlay').style.display = 'flex';
  }
  function closeCertModal() {
    document.getElementById('certModalOverlay').style.display = 'none';
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

  async function deriveAesKey(combinedSecret, saltBytes) {
    if (!subtleCryptoSupported) throw new Error('Criptografia não suportada neste navegador (precisa de HTTPS ou localhost).');
    const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(combinedSecret), { name: 'PBKDF2' }, false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: saltBytes, iterations: 150000, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async function encryptJSON(obj, password, certSecret) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cert = ensureDeviceCert();
    const effectiveCertSecret = certSecret !== undefined ? certSecret : cert.secret;
    const combined = getCombinedSecret(password, effectiveCertSecret);
    const key = await deriveAesKey(combined, salt);
    const plaintext = new TextEncoder().encode(JSON.stringify(obj));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
    return {
      encrypted: true,
      certProtected: true,
      certId: cert.id,
      salt: bufToB64(salt),
      iv: bufToB64(iv),
      ciphertext: bufToB64(ciphertext),
    };
  }

  async function decryptJSON(payload, password, certSecret) {
    const salt = b64ToBuf(payload.salt);
    const iv = b64ToBuf(payload.iv);
    const ciphertext = b64ToBuf(payload.ciphertext);

    let effectiveCertSecret = certSecret;
    if (effectiveCertSecret === undefined && payload.certProtected) {
      const cert = getDeviceCert();
      effectiveCertSecret = cert ? cert.secret : null;
    }

    // Se o payload foi protegido com certificado, usa a chave combinada
    if (payload.certProtected) {
      if (!effectiveCertSecret) {
        throw new Error('CERT_REQUIRED');
      }
      const combined = getCombinedSecret(password, effectiveCertSecret);
      const key = await deriveAesKey(combined, salt);
      const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
      return JSON.parse(new TextDecoder().decode(plainBuf));
    }

    // Compatibilidade com arquivos antigos protegidos apenas com senha
    const key = await deriveAesKey(password, salt);
    const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    return JSON.parse(new TextDecoder().decode(plainBuf));
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
  const ALLOC_COLORS = ['#6FCF97','#7FA6CF','#CFA36F','#B48FE0','#E0A7CF','#8FE0D0','#E0D08F','#A7B4E0','#E08F9A','#9AE08F'];
  const AVATAR = {
    usd:  { symbol: '$', bg: 'rgba(111,207,151,0.15)', color: 'var(--accent)' },
    brl:  { symbol: 'R$', bg: 'rgba(143,160,152,0.18)', color: 'var(--ink)' },
    btc:  { symbol: '₿', bg: 'rgba(247,147,26,0.18)', color: '#F7931A' },
    eth:  { symbol: 'Ξ', bg: 'rgba(139,140,247,0.18)', color: '#8B8CF7' },
    sol:  { symbol: '◎', bg: 'rgba(111,207,151,0.18)', color: '#6FCF97' },
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
    return `<span class="asset-avatar" style="background:${a.bg}; color:${a.color};">${a.symbol}</span>`;
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

  /* ============ TABS ============ */
  const tabButtonsList = Array.from(document.querySelectorAll('.tab-btn'));
  tabButtonsList.forEach((btn, i) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('panel-' + btn.dataset.tab).classList.add('active');
      document.getElementById('tabsIndicator').style.transform = i === 0 ? 'translateX(0)' : 'translateX(100%)';
    });
  });

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
  } catch (e) {}
  let showAllAssets = false;
  let editingFavorites = false;

  function saveFavorites() {
    try { localStorage.setItem(FAVORITES_KEY, JSON.stringify(favoriteAssets)); } catch (e) {}
  }

  function renderFavoritesEditor() {
    const el = document.getElementById('favoritesEditor');
    if (!editingFavorites) { el.style.display = 'none'; el.innerHTML = ''; return; }
    el.style.display = 'block';
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
      cb.addEventListener('change', () => {
        const key = cb.dataset.fav;
        if (cb.checked) { if (!favoriteAssets.includes(key)) favoriteAssets.push(key); }
        else { favoriteAssets = favoriteAssets.filter(k => k !== key); }
        saveFavorites();
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
        changeHtml = `<span class="change" style="color:${up ? 'var(--up)' : 'var(--down)'}">${up ? '+' : ''}${change24h[c.id].toFixed(2)}%</span>`;
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
          <span style="display:flex; gap:8px;">
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
    if (!ASSETS[from]) { wrap.style.display = 'none'; return; }
    wrap.style.display = 'block';
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
    const color = up ? '#6FCF97' : '#E08585';
    const areaPath = path + ` L${coords[coords.length-1][0].toFixed(1)},${h-pad} L${coords[0][0].toFixed(1)},${h-pad} Z`;
    document.getElementById('sparklineSvg').innerHTML = `
      <svg viewBox="0 0 ${w} ${h}" style="width:100%; height:${h}px; display:block;">
        <path d="${areaPath}" fill="${color}" opacity="0.12" stroke="none"/>
        <path d="${path}" fill="none" stroke="${color}" stroke-width="2"/>
      </svg>`;
  }

  /* ============ PORTFÓLIOS (múltiplas carteiras) ============ */
  const PORTFOLIOS_KEY = 'cripto-app-portfolios';
  const CURRENT_PORTFOLIO_KEY = 'cripto-app-current-portfolio';
  let portfolios = [];
  let currentPortfolioId = null;

  function loadPortfolioList() {
    try { portfolios = JSON.parse(localStorage.getItem(PORTFOLIOS_KEY)) || []; }
    catch (e) { portfolios = []; }
    if (portfolios.length === 0) {
      portfolios = [{ id: 'real', name: 'Real' }, { id: 'teste', name: 'Teste' }];
      localStorage.setItem(PORTFOLIOS_KEY, JSON.stringify(portfolios));
    }
    currentPortfolioId = localStorage.getItem(CURRENT_PORTFOLIO_KEY) || portfolios[0].id;
    if (!portfolios.find(p => p.id === currentPortfolioId)) currentPortfolioId = portfolios[0].id;
  }
  function savePortfolioList() {
    localStorage.setItem(PORTFOLIOS_KEY, JSON.stringify(portfolios));
    localStorage.setItem(CURRENT_PORTFOLIO_KEY, currentPortfolioId);
  }
  function renderPortfolioSelect() {
    const sel = document.getElementById('portfolioSelect');
    sel.innerHTML = portfolios.map(p => `<option value="${p.id}" ${p.id === currentPortfolioId ? 'selected' : ''}>${p.name}</option>`).join('');
  }
  document.getElementById('portfolioSelect').addEventListener('change', async (e) => {
    currentPortfolioId = e.target.value;
    localStorage.setItem(CURRENT_PORTFOLIO_KEY, currentPortfolioId);
    resetFileConnectionState();
    await loadCurrentPortfolioData();
    renderSimulator();
    await tryAutoConnect();
  });
  document.getElementById('newPortfolioBtn').addEventListener('click', async () => {
    const name = prompt('Nome da nova carteira:');
    if (!name || !name.trim()) return;
    const id = 'p' + Date.now();
    portfolios.push({ id, name: name.trim() });
    currentPortfolioId = id;
    savePortfolioList();
    renderPortfolioSelect();
    resetFileConnectionState();
    await loadCurrentPortfolioData();
    renderSimulator();
    await tryAutoConnect();
  });
  document.getElementById('renamePortfolioBtn').addEventListener('click', () => {
    const p = portfolios.find(p => p.id === currentPortfolioId);
    if (!p) return;
    const name = prompt('Novo nome da carteira:', p.name);
    if (!name || !name.trim()) return;
    p.name = name.trim();
    savePortfolioList();
    renderPortfolioSelect();
  });
  document.getElementById('deletePortfolioBtn').addEventListener('click', async () => {
    if (portfolios.length <= 1) { alert('Precisa manter ao menos uma carteira.'); return; }
    if (!confirm('Excluir esta carteira e todos os seus dados?')) return;
    ['trades','chain','deposits','depositsMigrated','history','alerts','settings'].forEach(k => localStorage.removeItem(`cripto-${k}:${currentPortfolioId}`));
    await idbDelete('fileHandle:' + currentPortfolioId);
    portfolios = portfolios.filter(p => p.id !== currentPortfolioId);
    currentPortfolioId = portfolios[0].id;
    savePortfolioList();
    renderPortfolioSelect();
    resetFileConnectionState();
    await loadCurrentPortfolioData();
    renderSimulator();
    await tryAutoConnect();
  });

  /* ============ DADOS DA CARTEIRA ATUAL ============ */
  let trades = [], chain = [], deposits = [], netWorthHistory = [], alerts = [], settings = { blockOverdraft: false };
  let fileHandle = null;
  let connectedFilePassword = null; // fica só na memória desta sessão — nunca é salva

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
  function saveChain() {
    try { localStorage.setItem(keyFor('chain'), JSON.stringify(chain)); } catch (e) {}
    writeToFile();
  }
  async function rebuildChainFromDataList(dataList) {
    const sorted = [...dataList].sort((a, b) => a.timestamp - b.timestamp);
    const newChain = [await makeGenesisBlock()];
    for (const d of sorted) await appendBlock(newChain, d);
    return newChain;
  }

  async function loadCurrentPortfolioData() {
    try { chain = JSON.parse(localStorage.getItem(keyFor('chain'))) || []; } catch (e) { chain = []; }
    const depositsMigrated = localStorage.getItem(keyFor('depositsMigrated')) === '1';

    if (chain.length === 0) {
      // primeira vez nesta carteira: cria o bloco gênese e migra operações + depósitos antigos (formato pré-blockchain), se existirem
      let legacyTrades = [], legacyDeposits = [];
      try { legacyTrades = JSON.parse(localStorage.getItem(keyFor('trades'))) || []; } catch (e) {}
      try { legacyDeposits = JSON.parse(localStorage.getItem(keyFor('deposits'))) || []; } catch (e) {}
      const combined = [
        ...legacyTrades.map(t => ({ ...t, kind: 'trade' })),
        ...legacyDeposits.map(d => ({ ...d, kind: 'deposit' })),
      ];
      chain = await rebuildChainFromDataList(combined);
      saveChain();
      localStorage.setItem(keyFor('depositsMigrated'), '1');
    } else if (!depositsMigrated) {
      // chain já existia de uma versão anterior (só com operações); junta os depósitos legados agora
      let legacyDeposits = [];
      try { legacyDeposits = JSON.parse(localStorage.getItem(keyFor('deposits'))) || []; } catch (e) {}
      const existingData = chain.filter(b => b.data).map(b => ({ ...b.data, kind: b.data.kind || 'trade' }));
      const combined = [...existingData, ...legacyDeposits.map(d => ({ ...d, kind: 'deposit' }))];
      chain = await rebuildChainFromDataList(combined);
      saveChain();
      localStorage.setItem(keyFor('depositsMigrated'), '1');
    }

    trades = chainToTrades();
    deposits = chainToDeposits();
    try { netWorthHistory = JSON.parse(localStorage.getItem(keyFor('history'))) || []; } catch (e) { netWorthHistory = []; }
    try { alerts = JSON.parse(localStorage.getItem(keyFor('alerts'))) || []; } catch (e) { alerts = []; }
    try { settings = JSON.parse(localStorage.getItem(keyFor('settings'))) || { blockOverdraft: false }; } catch (e) { settings = { blockOverdraft: false }; }
    document.getElementById('blockOverdraftCheck').checked = !!settings.blockOverdraft;
  }
  function saveHistory() {
    try { localStorage.setItem(keyFor('history'), JSON.stringify(netWorthHistory)); } catch (e) {}
  }
  function saveAlerts() {
    try { localStorage.setItem(keyFor('alerts'), JSON.stringify(alerts)); } catch (e) {}
  }
  function saveSettings() {
    try { localStorage.setItem(keyFor('settings'), JSON.stringify(settings)); } catch (e) {}
  }
  document.getElementById('blockOverdraftCheck').addEventListener('change', (e) => {
    settings.blockOverdraft = e.target.checked;
    saveSettings();
  });

  function computeCashBalance() {
    const totalDeposited = deposits.reduce((s, d) => s + d.amount, 0);
    const totalBuy = trades.filter(t => t.type === 'buy').reduce((s, t) => s + (t.value != null ? t.value : t.qty * t.price), 0);
    const totalSell = trades.filter(t => t.type === 'sell').reduce((s, t) => s + (t.value != null ? t.value : t.qty * t.price), 0);
    return totalDeposited - totalBuy + totalSell;
  }
  function computeSummary() {
    const perAsset = {};
    ASSET_KEYS.forEach(a => { perAsset[a] = { boughtQty: 0, boughtCost: 0, soldQty: 0, soldProceeds: 0, realized: 0 }; });
    [...trades].sort((a, b) => a.timestamp - b.timestamp).forEach(t => {
      const s = perAsset[t.asset];
      if (!s) return;
      if (t.type === 'buy') {
        s.boughtQty += t.qty;
        s.boughtCost += (t.qty * t.price);
      } else {
        const avgCostAtSale = s.boughtQty > 0 ? (s.boughtCost / s.boughtQty) : 0;
        s.realized += ((t.price - avgCostAtSale) * t.qty);
        s.soldQty += t.qty;
        s.soldProceeds += (t.qty * t.price);
        s.boughtCost -= avgCostAtSale * t.qty;
        s.boughtQty -= t.qty;
      }
    });
    return perAsset;
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
    bar.innerHTML = items.map(i => `<div style="width:${(i.value/total*100).toFixed(2)}%; background:${i.color};"></div>`).join('');
    legend.innerHTML = items.map(i => `
      <div class="item"><span class="swatch" style="background:${i.color};"></span>${i.label} · ${(i.value/total*100).toFixed(1)}%</div>
    `).join('');
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
      if (hoverInfo) hoverInfo.style.display = 'none';
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
    const color = up ? '#6FCF97' : '#E08585';

    if (rangeSummaryEl) {
      rangeSummaryEl.textContent = `mín: ${fmt(min, 'usd')} · máx: ${fmt(max, 'usd')}`;
    }

    el.innerHTML = `
      <div style="position:relative; width:100%; cursor:crosshair;">
        <svg id="netWorthSvg" viewBox="0 0 ${w} ${h}" style="width:100%; height:${h}px; display:block; overflow:visible;">
          <defs>
            <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="${color}" stop-opacity="0.25"/>
              <stop offset="100%" stop-color="${color}" stop-opacity="0.0"/>
            </linearGradient>
          </defs>
          <path d="${areaPath}" fill="url(#chartGrad)"/>
          <path d="${linePath}" fill="none" stroke="${color}" stroke-width="2"/>
          <line id="crosshairLine" x1="0" y1="0" x2="0" y2="${h}" stroke="var(--ink-dim)" stroke-dasharray="3,3" stroke-width="1" style="display:none;"/>
          <circle id="crosshairDot" cx="0" cy="0" r="4.5" fill="${color}" stroke="var(--bg)" stroke-width="2" style="display:none;"/>
        </svg>
      </div>
      <div class="secondary" style="margin-top:6px; display:flex; justify-content:space-between;">
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
      crossLine.style.display = 'block';

      crossDot.setAttribute('cx', pt[0]);
      crossDot.setAttribute('cy', pt[1]);
      crossDot.style.display = 'block';

      if (hoverInfo) {
        hoverInfo.style.display = 'flex';
        document.getElementById('chartHoverDate').textContent = `${new Date(dataPoint.t).toLocaleString('pt-BR')}`;
        document.getElementById('chartHoverVal').innerHTML = `${fmt(dataPoint.v, 'usd')} <span style="font-weight:normal; font-size:11px; color:var(--ink-dim);">${fmtBRLSecondary(dataPoint.v)}</span>`;
      }
    }

    svg.addEventListener('mousemove', (e) => onPointerMove(e.clientX));
    svg.addEventListener('touchmove', (e) => {
      if (e.touches && e.touches[0]) onPointerMove(e.touches[0].clientX);
    }, { passive: true });

    svg.addEventListener('mouseleave', () => {
      crossLine.style.display = 'none';
      crossDot.style.display = 'none';
      if (hoverInfo) hoverInfo.style.display = 'none';
    });
    svg.addEventListener('touchend', () => {
      setTimeout(() => {
        crossLine.style.display = 'none';
        crossDot.style.display = 'none';
        if (hoverInfo) hoverInfo.style.display = 'none';
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
        <button class="del" data-id="${a.id}">✕</button>
      </div>`).join('') : '<div class="empty-note">Nenhum alerta criado.</div>';
    list.querySelectorAll('.del').forEach(btn => {
      btn.addEventListener('click', () => {
        alerts = alerts.filter(a => String(a.id) !== btn.dataset.id);
        saveAlerts();
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
      try { await Notification.requestPermission(); } catch (e) {}
    }

    alerts.push({ id: Date.now() + Math.random(), asset, direction, target, triggered: false });
    saveAlerts();
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
        firedHtml += `<div class="alert-banner"><span>${ASSETS[a.asset].name} ${a.direction === 'above' ? 'passou de' : 'caiu abaixo de'} ${fmt(a.target,'usd')} — preço atual: ${fmt(price,'usd')}</span><button data-dismiss="${a.id}">✕</button></div>`;
        if ('Notification' in window && Notification.permission === 'granted') {
          try {
            new Notification(`Alerta: ${ASSETS[a.asset].name}`, {
              body: `${ASSETS[a.asset].name} ${a.direction === 'above' ? 'passou de' : 'caiu abaixo de'} ${fmt(a.target, 'usd')} (atual: ${fmt(price, 'usd')})`,
              icon: 'icon-192.png'
            });
          } catch (e) {}
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
    await appendBlock(chain, { kind: 'deposit', id: Date.now() + Math.random(), amount, timestamp: Date.now() });
    saveChain();
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
    preview.textContent = (value > 0 && price > 0) ? `≈ ${fmtQty(value / price, asset)} ao preço atual (${fmt(price,'usd')})` : '';
  }

  function renderSimulator() {
    renderPortfolioSelect();
    const asset = document.getElementById('assetSelect').value;
    if (usdPrice[asset]) document.getElementById('priceInput').value = usdPrice[asset];

    const cashBalance = computeCashBalance();
    document.getElementById('cashBalanceValue').innerHTML = `${fmt(cashBalance,'usd')}<div class="secondary">${fmtBRLSecondary(cashBalance)}</div>`;
    document.getElementById('cashBalanceValue').style.color = cashBalance < 0 ? 'var(--down)' : 'var(--ink)';

    const summary = computeSummary();
    const summaryCard = document.getElementById('summaryCard');
    let totalValue = 0, totalGain = 0, hasHoldings = false;
    let totalRealized = 0, totalFees = 0;
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
          <div style="display:flex; align-items:center;">
            ${avatarHtml(a)}
            <div>
              <div class="asset-name">${ASSETS[a].name}</div>
              <div class="asset-meta">${qty > 0 ? fmtQty(qty, a) + ' em carteira · custo médio ' + fmt(avgCost, 'usd') : 'sem posição aberta'}</div>
            </div>
          </div>
          <div class="figures">
            <div class="value">${fmt(qty > 0 ? currentValue : 0, 'usd')}</div>
            <div class="secondary">${qty > 0 ? fmtBRLSecondary(currentValue) : ''}</div>
            <div class="gain ${totalAssetGain >= 0 ? 'pos' : 'neg'}">${fmtGain(totalAssetGain)}${qty > 0 ? ' (' + (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%)' : ''} ${s.realized !== 0 ? '· realizado ' + fmtGain(s.realized) : ''}</div>
          </div>
        </div>`;
    }).join('');

    summaryCard.innerHTML = rows || '<div class="empty-note">Nenhuma operação registrada ainda.</div>';
    const totalUnrealized = totalGain - totalRealized;
    if (hasHoldings || totalGain !== 0) {
      summaryCard.innerHTML += `
        <div class="totals"><div class="label">Valor total em ativos</div><div class="value">${fmt(totalValue,'usd')}<div class="secondary">${fmtBRLSecondary(totalValue)}</div></div></div>
        <div class="totals"><div class="label">Lucro não-realizado (posições abertas)</div><div class="value" style="color:${totalUnrealized >= 0 ? 'var(--up)' : 'var(--down)'}">${fmtGain(totalUnrealized)}</div></div>
        <div class="totals"><div class="label">Lucro realizado (vendas encerradas)</div><div class="value" style="color:${totalRealized >= 0 ? 'var(--up)' : 'var(--down)'}">${fmtGain(totalRealized)}</div></div>
        <div class="totals" style="border-top:2px solid var(--line); font-weight:600;"><div class="label" style="color:var(--ink);">Resultado global líquido</div><div class="value" style="color:${totalGain >= 0 ? 'var(--up)' : 'var(--down)'}">${fmtGain(totalGain)}</div></div>`;
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
          <div class="sub" style="opacity:0.6;">${new Date(t.timestamp).toLocaleString('pt-BR')} · bloco #${t._index} · hash ${t._hash ? t._hash.slice(0,12) + '…' : '—'}</div>
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
    const asset = document.getElementById('assetSelect').value;
    const value = parseFloat(document.getElementById('valueInput').value);
    const price = usdPrice[asset];
    if (!value || value <= 0 || !price) return;

    if (currentType === 'buy' && value > computeCashBalance()) {
      if (settings.blockOverdraft) {
        document.getElementById('ioStatus').textContent = 'operação bloqueada: valor maior que o saldo disponível';
        return;
      }
      document.getElementById('ioStatus').textContent = 'atenção: valor da compra é maior que o saldo não alocado (saldo ficará negativo)';
    } else {
      document.getElementById('ioStatus').textContent = '';
    }
    const qty = value / price;
    const submitBtn = document.getElementById('submitBtn');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Minerando bloco…';
    await appendBlock(chain, {
      kind: 'trade',
      id: Date.now() + Math.random(),
      asset,
      type: currentType,
      value,
      price,
      qty,
      timestamp: Date.now()
    });
    saveChain();
    trades = chainToTrades();
    document.getElementById('valueInput').value = '';
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
      ? `<span style="color:var(--up);">✓ íntegro</span> — ${chain.length} blocos verificados, encadeamento de hashes confere do início ao fim`
      : `<span style="color:var(--down);">✗ adulteração detectada</span> no bloco #${result.at} (${result.reason})`;
  });

  /* ---- exportar / importar ---- */
  document.getElementById('exportBtn').addEventListener('click', async () => {
    if (!subtleCryptoSupported) {
      alert('Criptografia indisponível neste navegador ou contexto não seguro (precisa de HTTPS ou localhost). Operação cancelada para proteger seus dados.');
      return;
    }
    const password = prompt('Defina uma senha obrigatória para criptografar o arquivo JSON (AES-256-GCM):');
    if (!password) {
      document.getElementById('ioStatus').textContent = 'exportação cancelada: a senha é obrigatória para criptografar todos os dados';
      return;
    }
    const data = { chain, deposits, netWorthHistory, alerts, settings };
    let payload;
    try {
      document.getElementById('ioStatus').textContent = 'criptografando dados com AES-256-GCM…';
      payload = await encryptJSON(data, password);
    } catch (e) {
      document.getElementById('ioStatus').textContent = 'erro ao criptografar: ' + (e.message || e);
      return;
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `portfolio-${currentPortfolioId}-${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    document.getElementById('ioStatus').textContent = 'arquivo exportado com 100% dos dados criptografados (AES-256)';
  });
  document.getElementById('importBtn').addEventListener('click', () => document.getElementById('importFile').click());
  document.getElementById('importFile').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        let imported = JSON.parse(reader.result);
        if (imported && imported.encrypted) {
          const password = prompt('Este arquivo está criptografado. Digite a senha:');
          if (password === null) return;
          try {
            imported = await decryptJSON(imported, password);
          } catch (e) {
            if (e && e.message === 'CERT_REQUIRED') {
              alert(`Este arquivo foi criptografado com Certificado Digital deste ou de outro aparelho (ID: ${imported.certId || 'desconhecido'}). Importe o certificado em "Segurança > Certificado Digital" antes de abrir.`);
              document.getElementById('ioStatus').textContent = 'abertura bloqueada: certificado digital do aparelho ausente';
            } else {
              document.getElementById('ioStatus').textContent = 'senha incorreta ou certificado do aparelho não corresponde ao arquivo';
            }
            return;
          }
        }
        if (imported && Array.isArray(imported.chain)) {
          const result = await verifyChainIntegrity(imported.chain);
          if (!result.valid) {
            document.getElementById('ioStatus').textContent = `arquivo rejeitado: blockchain adulterada (bloco #${result.at})`;
            return;
          }
          chain = imported.chain;
        } else if (imported && Array.isArray(imported.trades)) {
          // formato antigo (pré-blockchain): reconstrói a chain a partir de operações e depósitos
          const combined = [
            ...imported.trades.map(t => ({ ...t, kind: 'trade' })),
            ...(Array.isArray(imported.deposits) ? imported.deposits.map(d => ({ ...d, kind: 'deposit' })) : []),
          ];
          chain = await rebuildChainFromDataList(combined);
        } else { throw new Error('formato inválido'); }
        trades = chainToTrades();
        deposits = chainToDeposits();
        netWorthHistory = Array.isArray(imported.netWorthHistory) ? imported.netWorthHistory : [];
        alerts = Array.isArray(imported.alerts) ? imported.alerts : [];
        settings = imported.settings || settings;
        saveChain(); saveHistory(); saveAlerts(); saveSettings();
        renderSimulator();
        document.getElementById('ioStatus').textContent = `${trades.length} operações e ${deposits.length} depósitos importados — integridade da blockchain verificada`;
      } catch (err) {
        document.getElementById('ioStatus').textContent = 'arquivo inválido — não foi possível importar';
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  /* ---- exportação para CSV (extrato contábil / planilhas) ---- */
  function exportCsv() {
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
        blockHash: t._hash || '—'
      });
    });

    allEvents.sort((a, b) => a.timestamp - b.timestamp);

    const headers = ['Data/Hora (ISO)', 'Data/Hora (Local)', 'Tipo', 'Ativo', 'Nome', 'Quantidade', 'Preço Unitário (USD)', 'Valor Total (USD)', 'Saldo Posição Após', 'Bloco #', 'Hash do Bloco'];
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
        `"${e.blockHash}"`
      ].join(';'));
    });

    const blob = new Blob(['\uFEFF' + csvLines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `extrato-cripto-${currentPortfolioId}-${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    document.getElementById('ioStatus').textContent = 'extrato CSV exportado com sucesso!';
  }
  document.getElementById('exportCsvBtn').addEventListener('click', exportCsv);

  /* ---- modal de Relatório Fiscal & IRPF (IN 1888) ---- */
  let selectedTaxMonth = '';

  function computeTaxReport() {
    const monthsData = {};
    const brlRate = usdPrice.brl ? (1 / usdPrice.brl) : 5.4;

    const runningPerAsset = {};
    ASSET_KEYS.forEach(a => { runningPerAsset[a] = { qty: 0, cost: 0 }; });

    [...trades].sort((a,b) => a.timestamp - b.timestamp).forEach(t => {
      const s = runningPerAsset[t.asset];
      if (!s) return;
      const d = new Date(t.timestamp);
      const mKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!monthsData[mKey]) {
        monthsData[mKey] = {
          monthKey: mKey,
          label: d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }),
          salesUsd: 0,
          salesBrl: 0,
          realizedUsd: 0,
          realizedBrl: 0,
          operations: []
        };
      }

      if (t.type === 'buy') {
        s.qty += t.qty;
        s.cost += (t.qty * t.price);
      } else {
        const avgCost = s.qty > 0 ? (s.cost / s.qty) : 0;
        const saleProceedsUsd = t.value != null ? t.value : (t.qty * t.price);
        const realizedGainUsd = ((t.price - avgCost) * t.qty);
        const saleProceedsBrl = saleProceedsUsd * brlRate;
        const realizedGainBrl = realizedGainUsd * brlRate;

        monthsData[mKey].salesUsd += saleProceedsUsd;
        monthsData[mKey].salesBrl += saleProceedsBrl;
        monthsData[mKey].realizedUsd += realizedGainUsd;
        monthsData[mKey].realizedBrl += realizedGainBrl;

        monthsData[mKey].operations.push({
          date: d,
          asset: t.asset,
          qty: t.qty,
          price: t.price,
          saleProceedsUsd,
          avgCost,
          realizedGainUsd
        });

        s.cost -= avgCost * t.qty;
        s.qty -= t.qty;
      }
    });

    return monthsData;
  }

  function renderTaxModal() {
    const taxData = computeTaxReport();
    const months = Object.keys(taxData).sort().reverse();
    const currentMonthKey = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;

    if (!selectedTaxMonth || !taxData[selectedTaxMonth]) {
      selectedTaxMonth = months[0] || currentMonthKey;
    }

    const current = taxData[selectedTaxMonth] || {
      monthKey: selectedTaxMonth,
      label: new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }),
      salesUsd: 0,
      salesBrl: 0,
      realizedUsd: 0,
      realizedBrl: 0,
      operations: []
    };

    const isExempt = current.salesBrl <= 35000;
    const estimatedTaxBrl = (!isExempt && current.realizedBrl > 0) ? (current.realizedBrl * 0.15) : 0;
    const in1888Applies = current.salesBrl >= 30000;

    const content = document.getElementById('taxModalContent');
    content.innerHTML = `
      <div style="margin-bottom:14px;">
        <label>Selecione o Mês de Apuração</label>
        <select id="taxMonthSelect">
          ${months.length ? months.map(m => `<option value="${m}" ${m === selectedTaxMonth ? 'selected' : ''}>${taxData[m].label.toUpperCase()} (${taxData[m].operations.length} vendas)</option>`).join('') : `<option value="${currentMonthKey}">${new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }).toUpperCase()}</option>`}
        </select>
      </div>

      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <span style="font-size:13px; font-weight:600;">Status Tributário:</span>
        <span class="tax-badge ${isExempt ? 'exempt' : 'taxable'}">
          ${isExempt ? '✓ ISENTO (Vendas ≤ R$ 35.000)' : '⚠️ TRIBUTÁVEL (Vendas > R$ 35.000)'}
        </span>
      </div>

      <div class="tax-stat-grid">
        <div class="tax-card">
          <div class="k">TOTAL ALIENADO (VENDAS)</div>
          <div class="v">${current.salesBrl.toLocaleString('pt-BR', {style:'currency', currency:'BRL'})}</div>
          <div style="font-size:11px; color:var(--ink-dim); margin-top:2px;">≈ ${fmt(current.salesUsd, 'usd')}</div>
        </div>
        <div class="tax-card">
          <div class="k">LIMITE DE ISENÇÃO</div>
          <div class="v" style="color:var(--ink-dim);">R$ 35.000,00</div>
          <div style="font-size:11px; color:var(--ink-dim); margin-top:2px;">${((current.salesBrl / 35000) * 100).toFixed(1)}% do teto atingido</div>
        </div>
        <div class="tax-card">
          <div class="k">LUCRO REALIZADO LÍQUIDO</div>
          <div class="v" style="color:${current.realizedBrl >= 0 ? 'var(--up)' : 'var(--down)'};">
            ${current.realizedBrl.toLocaleString('pt-BR', {style:'currency', currency:'BRL'})}
          </div>
          <div style="font-size:11px; color:var(--ink-dim); margin-top:2px;">≈ ${fmtGain(current.realizedUsd)}</div>
        </div>
        <div class="tax-card">
          <div class="k">IMPOSTO ESTIMADO (15%)</div>
          <div class="v" style="color:${estimatedTaxBrl > 0 ? 'var(--down)' : 'var(--up)'};">
            ${estimatedTaxBrl.toLocaleString('pt-BR', {style:'currency', currency:'BRL'})}
          </div>
          <div style="font-size:11px; color:var(--ink-dim); margin-top:2px;">${isExempt ? 'Isento de DARF' : 'DARF código 4600'}</div>
        </div>
      </div>

      <div class="tax-notice">
        <strong>Regras da Receita Federal (Brasil):</strong><br>
        • Vendas totais de criptoativos em qualquer mês até R$ 35.000,00 contam com isenção sobre o ganho de capital.<br>
        • Se o valor de vendas ultrapassar R$ 35.000,00 no mês, todo o ganho de capital líquido é tributado a 15% (DARF 4600 com vencimento até o último dia útil do mês seguinte).<br>
        ${in1888Applies ? '• <strong>Atenção IN 1888/2019:</strong> Volume mensal atingiu R$ 30.000,00 — pode exigir reporte no e-CAC se realizado em exchanges do exterior ou P2P.' : '• IN 1888/2019: Reporte obrigatório caso movimentações no exterior/P2P atinjam R$ 30.000,00/mês.'}
      </div>

      <div style="margin-top:16px;">
        <div style="font-size:13px; font-weight:600; margin-bottom:8px;">Vendas registradas neste mês (${current.operations.length})</div>
        ${current.operations.length ? current.operations.map(op => `
          <div class="timeline-item">
            <div class="timeline-dot sell"></div>
            <div class="timeline-text">
              <div class="main">Venda de ${fmtQty(op.qty, op.asset)} (${ASSETS[op.asset].name})</div>
              <div class="sub">Total: ${fmt(op.saleProceedsUsd, 'usd')} · Ganho: <span style="color:${op.realizedGainUsd >= 0 ? 'var(--up)' : 'var(--down)'};">${fmtGain(op.realizedGainUsd)}</span></div>
              <div class="sub" style="opacity:0.6;">${op.date.toLocaleString('pt-BR')}</div>
            </div>
          </div>
        `).join('') : '<div class="empty-note">Nenhuma venda registrada neste mês.</div>'}
      </div>
    `;

    document.getElementById('taxMonthSelect').addEventListener('change', (e) => {
      selectedTaxMonth = e.target.value;
      renderTaxModal();
    });
  }

  function openTaxModal() {
    renderTaxModal();
    document.getElementById('taxModalOverlay').style.display = 'flex';
  }
  function closeTaxModal() {
    document.getElementById('taxModalOverlay').style.display = 'none';
  }
  document.getElementById('closeTaxModalBtn').addEventListener('click', closeTaxModal);
  document.getElementById('taxModalOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'taxModalOverlay') closeTaxModal();
  });
  document.getElementById('openTaxModalBtn').addEventListener('click', openTaxModal);

  /* ---- arquivo real (File System Access API) ---- */
  const IDB_NAME = 'cripto-app-db';
  const IDB_STORE = 'handles';
  function idbOpen() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function idbSet(key, value) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(value, key);
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    });
  }
  async function idbGet(key) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
    });
  }
  async function idbDelete(key) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(key);
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    });
  }
  function resetFileConnectionState() {
    // cada carteira tem seu próprio arquivo conectado — precisa "esquecer" o handle anterior
    // antes de trocar de carteira, senão a próxima gravação vai parar no arquivo errado
    fileHandle = null;
    connectedFilePassword = null;
    const btn = document.getElementById('connectFileBtn');
    btn.style.display = '';
    btn.textContent = 'Conectar arquivo JSON';
    document.getElementById('fileStatus').textContent = '';
  }
  async function writeToFile() {
    if (!fileHandle) return;
    try {
      if (!connectedFilePassword) {
        document.getElementById('fileStatus').textContent = 'arquivo não salvo: defina uma senha de criptografia';
        return;
      }
      const data = { chain, deposits, netWorthHistory, alerts, settings };
      const payload = await encryptJSON(data, connectedFilePassword);
      const writable = await fileHandle.createWritable();
      await writable.write(JSON.stringify(payload, null, 2));
      await writable.close();
      document.getElementById('fileStatus').textContent = `salvo em ${fileHandle.name} · ${new Date().toLocaleTimeString('pt-BR')} 🔒 (100% criptografado)`;
    } catch (e) {
      document.getElementById('fileStatus').textContent = 'não foi possível escrever no arquivo conectado: ' + (e.message || e);
    }
  }
  async function loadFileIntoTrades() {
    const file = await fileHandle.getFile();
    const text = (await file.text()).trim();
    if (!text) return;
    try {
      let parsed = JSON.parse(text);
      if (parsed && parsed.encrypted) {
        let pwd = connectedFilePassword;
        if (!pwd) {
          pwd = prompt('Este arquivo está protegido por senha. Digite a senha:');
          if (pwd === null) return;
        }
        try {
          parsed = await decryptJSON(parsed, pwd);
          connectedFilePassword = pwd;
        } catch (e) {
          if (e && e.message === 'CERT_REQUIRED') {
            alert(`Este arquivo foi criptografado com Certificado Digital deste ou de outro aparelho (ID: ${parsed.certId || 'desconhecido'}). Importe o certificado em "Segurança > Certificado Digital" antes de abrir.`);
            document.getElementById('fileStatus').textContent = 'bloqueado: certificado digital do aparelho ausente';
          } else {
            document.getElementById('fileStatus').textContent = 'senha incorreta ou certificado do aparelho não confere';
          }
          return;
        }
      }
      if (parsed && Array.isArray(parsed.chain)) {
        const result = await verifyChainIntegrity(parsed.chain);
        if (!result.valid) {
          document.getElementById('fileStatus').textContent = `arquivo ignorado: blockchain adulterada (bloco #${result.at})`;
          return;
        }
        chain = parsed.chain;
      } else if (parsed && Array.isArray(parsed.trades)) {
        const combined = [
          ...parsed.trades.map(t => ({ ...t, kind: 'trade' })),
          ...(Array.isArray(parsed.deposits) ? parsed.deposits.map(d => ({ ...d, kind: 'deposit' })) : []),
        ];
        chain = await rebuildChainFromDataList(combined);
      } else { return; }
      trades = chainToTrades();
      deposits = chainToDeposits();
      netWorthHistory = Array.isArray(parsed.netWorthHistory) ? parsed.netWorthHistory : [];
      alerts = Array.isArray(parsed.alerts) ? parsed.alerts : [];
      settings = parsed.settings || settings;
      saveChain(); saveHistory(); saveAlerts(); saveSettings();
      renderSimulator();
    } catch (e) {}
  }
  function markConnected(name) {
    document.getElementById('fileStatus').textContent = `conectado automaticamente a ${name} — tudo salvo sozinho`;
    document.getElementById('connectFileBtn').style.display = 'none';
  }
  async function tryAutoConnect() {
    if (!window.showSaveFilePicker) return;
    try {
      const handle = await idbGet('fileHandle:' + currentPortfolioId);
      if (!handle) return;
      const perm = await handle.queryPermission({ mode: 'readwrite' });
      if (perm === 'granted') {
        fileHandle = handle;
        await loadFileIntoTrades();
        markConnected(fileHandle.name);
      } else {
        fileHandle = handle;
        document.getElementById('connectFileBtn').textContent = `Reautorizar ${handle.name}`;
        document.getElementById('fileStatus').textContent = 'clique uma vez para retomar a conexão automática com o arquivo';
      }
    } catch (e) {}
  }
  document.getElementById('connectFileBtn').addEventListener('click', async () => {
    if (fileHandle) {
      try {
        const perm = await fileHandle.requestPermission({ mode: 'readwrite' });
        if (perm === 'granted') { await loadFileIntoTrades(); markConnected(fileHandle.name); writeToFile(); }
      } catch (e) {}
      return;
    }
    if (!window.showSaveFilePicker) {
      openFileAccessModal();
      return;
    }
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: `portfolio-${currentPortfolioId}.json`,
        types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }]
      });
      fileHandle = handle;
      await idbSet('fileHandle:' + currentPortfolioId, handle);
      await loadFileIntoTrades(); // se o arquivo já tinha conteúdo criptografado, pede a senha aqui
      if (!connectedFilePassword) {
        if (!subtleCryptoSupported) {
          alert('Criptografia indisponível no navegador.');
          return;
        }
        let pwd = prompt('Digite uma senha obrigatória para criptografar o arquivo no disco (AES-256):');
        while (!pwd) {
          pwd = prompt('Atenção: A senha é obrigatória para proteger todos os seus dados. Digite a senha:');
          if (pwd === null) {
            document.getElementById('fileStatus').textContent = 'conexão cancelada — senha é obrigatória';
            return;
          }
        }
        connectedFilePassword = pwd;
      }
      await writeToFile();
      markConnected(fileHandle.name);
    } catch (e) {}
  });

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
    } catch (e) {}
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
    } catch (e) {}
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
          if (usdtBrl > 0) usdPrice.brl = 1 / usdtBrl;
        }
        sourceName = 'Binance (fallback)';
        success = true;
      } catch (errBinance) {
        // 3. Fallback: cache local do localStorage se tudo estiver offline
        const cachedTime = loadCachedPrices();
        if (cachedTime) {
          sourceName = 'Cache local (offline)';
          success = true;
        }
      }
    }

    if (success) {
      lastPriceFetchTime = Date.now();
      saveCachedPrices();
      const statusTextEl = document.getElementById('statusText');
      if (sourceName.includes('offline')) {
        statusTextEl.innerHTML = `<span class="live" style="color:var(--warn);">● preços em cache (${sourceName})</span>`;
      } else if (sourceName.includes('fallback')) {
        statusTextEl.innerHTML = `<span class="live" style="color:var(--accent);">● preços ao vivo (${sourceName})</span>`;
      } else {
        statusTextEl.innerHTML = '<span class="live">● preços ao vivo</span>';
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
      checkLockOnStart();
      loadPortfolioList();
      renderPortfolioSelect();
      await loadCurrentPortfolioData();
      renderConverter();
      renderSimulator();
      fetchPrices();
      tryAutoConnect();
      setInterval(fetchPrices, 20000);
    } catch (e) {
      // nunca deixa a tela em branco: mostra o app mesmo se algo falhar, com um aviso
      document.getElementById('appWrap').style.display = 'block';
      document.getElementById('lockScreen').style.display = 'none';
      const banner = document.getElementById('alertBanners');
      if (banner) banner.innerHTML = `<div class="alert-banner"><span>Ocorreu um erro ao carregar alguns dados (${e.message || e}). Tente recarregar a página.</span></div>`;
      console.error('Erro na inicialização:', e);
    }
  })();
