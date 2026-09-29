const test = require('node:test');
const assert = require('node:assert/strict');
const { Vault, protect, unprotect, pinOK } = require('../src/secure-vault.js');

class MemoryStorage {
  constructor(initial = {}) { this.data = new Map(Object.entries(initial)); }
  get length() { return this.data.size; }
  key(index) { return [...this.data.keys()][index] ?? null; }
  getItem(key) { return this.data.has(key) ? this.data.get(key) : null; }
  setItem(key, value) { this.data.set(key, String(value)); }
  removeItem(key) { this.data.delete(key); }
}

test('PIN aceita exatamente seis números', () => {
  assert.equal(pinOK('123456'), true);
  for (const value of ['12345', '1234567', 'abcdef', '12 456', '']) assert.equal(pinOK(value), false);
});

test('cofre migra, cifra e autentica os dados locais', async () => {
  const original = JSON.stringify({ saldo: 8750, descricao: 'dado-financeiro-secreto' });
  const storage = new MemoryStorage({ 'cripto-chain:real': original });
  const vault = new Vault(storage, 'cripito-sim');
  await vault.create('123456', { 'cripto-chain:real': original }, '00112233-44556677-8899aabb-ccddeeff');
  vault.cleanupLegacy(key => /^cripto[-:]/.test(key));

  assert.equal(storage.getItem('cripto-chain:real'), null);
  assert.doesNotMatch(storage.getItem(vault.storageKey), /dado-financeiro-secreto|8750/);
  await vault.lock();
  await assert.rejects(vault.unlock('654321'));
  await vault.unlock('123456');
  assert.equal(vault.getItem('cripto-chain:real'), original);

  vault.setItem('cripto-alerts:real', '[{"target":100000}]');
  await vault.flush();
  assert.doesNotMatch(storage.getItem(vault.storageKey), /100000|target/);
});

test('arquivo protegido rejeita adulteração e PIN incorreto', async () => {
  const protectedData = await protect({ valor: 321 }, '123456', 'test:backup');
  assert.deepEqual(await unprotect(protectedData, '123456', 'test:backup'), { valor: 321 });
  await assert.rejects(unprotect(protectedData, '654321', 'test:backup'));
  const tampered = structuredClone(protectedData);
  tampered.ciphertext = (tampered.ciphertext[0] === 'A' ? 'B' : 'A') + tampered.ciphertext.slice(1);
  await assert.rejects(unprotect(tampered, '123456', 'test:backup'));
});

test('biometria embrulha a chave e só abre com o segredo PRF correto', async () => {
  const storage = new MemoryStorage();
  const vault = new Vault(storage, 'cripito-sim');
  await vault.create('123456', { 'cripto-chain:real': 'saldo-secreto' }, '00112233-44556677-8899aabb-ccddeeff');
  const prf = crypto.getRandomValues(new Uint8Array(32));
  await assert.rejects(vault.enableBiometric('000000', 'cred', 'salt', prf));
  assert.equal(vault.biometric, null);
  await vault.enableBiometric('123456', 'cred', 'salt', prf);
  assert.deepEqual(vault.biometric, { credentialId: 'cred', prfSalt: 'salt' });
  assert.doesNotMatch(storage.getItem(vault.storageKey), /saldo-secreto/);
  await vault.lock();

  assert.deepEqual(vault.biometric, { credentialId: 'cred', prfSalt: 'salt' });
  await assert.rejects(vault.unlockBiometric(crypto.getRandomValues(new Uint8Array(32))));
  await assert.rejects(vault.unlockBiometric(new Uint8Array(8)));
  await vault.unlockBiometric(prf);
  assert.equal(vault.getItem('cripto-chain:real'), 'saldo-secreto');

  // PIN continua funcionando e a biometria sobrevive à gravação de novos dados.
  vault.setItem('cripto-alerts:real', '[]');
  await vault.lock();
  await vault.unlock('123456');
  assert.equal(vault.getItem('cripto-alerts:real'), '[]');
  await vault.lock();
  await vault.unlockBiometric(prf);

  await vault.disableBiometric();
  await vault.lock();
  assert.equal(vault.biometric, null);
  await assert.rejects(vault.unlockBiometric(prf));
  await vault.unlock('123456');
});

test('biometria continua válida após redefinir o PIN pelo código de recuperação', async () => {
  const storage = new MemoryStorage();
  const vault = new Vault(storage, 'cambio-sim');
  const recovery = '00112233-44556677-8899aabb-ccddeeff-00112233-44556677-8899aabb-ccddeeff';
  await vault.create('123456', { cambio_log: 'x' }, recovery);
  const prf = crypto.getRandomValues(new Uint8Array(32));
  await vault.enableBiometric('123456', 'cred', 'salt', prf);
  await vault.lock();
  await vault.resetPassword(recovery, '654321');
  await vault.lock();
  await assert.rejects(vault.unlock('123456'));
  await vault.unlock('654321');
  await vault.lock();
  await vault.unlockBiometric(prf);
  assert.equal(vault.getItem('cambio_log'), 'x');
});

test('alterar PIN exige o PIN atual e mantém dados e biometria', async () => {
  const storage = new MemoryStorage();
  const vault = new Vault(storage, 'gerenc-fin');
  await vault.create('123456', { livro_caixa_x: 'dados' }, '00112233-44556677-8899aabb-ccddeeff');
  const prf = crypto.getRandomValues(new Uint8Array(32));
  await vault.enableBiometric('123456', 'cred', 'salt', prf);
  await assert.rejects(vault.changePin('000000', '222222'));
  await assert.rejects(vault.changePin('123456', '12ab56'));
  await vault.changePin('123456', '222222');
  await vault.lock();
  await assert.rejects(vault.unlock('123456'));
  await vault.unlock('222222');
  assert.equal(vault.getItem('livro_caixa_x'), 'dados');
  await vault.lock();
  await vault.unlockBiometric(prf);
});

test('novo código de recuperação invalida o anterior', async () => {
  const storage = new MemoryStorage();
  const vault = new Vault(storage, 'taxometro');
  const old = '00112233-44556677-8899aabb-ccddeeff-00112233-44556677-8899aabb-ccddeeff';
  await vault.create('123456', {}, old);
  await assert.rejects(vault.rotateRecovery('000000'));
  const fresh = await vault.rotateRecovery('123456');
  assert.match(fresh, /^[0-9a-f]{8}(-[0-9a-f]{8}){7}$/);
  await vault.lock();
  await assert.rejects(vault.resetPassword(old, '333333'));
  await vault.resetPassword(fresh, '333333');
  await vault.lock();
  await vault.unlock('333333');
});

test('preferências são cifradas, validadas e sobrevivem ao bloqueio', async () => {
  const storage = new MemoryStorage();
  const vault = new Vault(storage, 'cambio-sim');
  await vault.create('123456', {});
  assert.deepEqual(vault.settings, { autoLockMinutes: 5, lockOnHide: false });
  await assert.rejects(vault.setSettings({ autoLockMinutes: 600 }));
  await assert.rejects(vault.setSettings({ lockOnHide: 'sim' }));
  await vault.setSettings({ autoLockMinutes: 5, lockOnHide: true });
  assert.doesNotMatch(storage.getItem(vault.storageKey), /lockOnHide|autoLockMinutes/);
  await vault.lock();
  await vault.unlock('123456');
  assert.deepEqual(vault.settings, { autoLockMinutes: 5, lockOnHide: true });
  await vault.lock();
  // Preferência adulterada no armazenamento é rejeitada pelo GCM e volta ao padrão seguro.
  const env = JSON.parse(storage.getItem(vault.storageKey));
  env.settings.ciphertext = (env.settings.ciphertext[0] === 'A' ? 'B' : 'A') + env.settings.ciphertext.slice(1);
  storage.setItem(vault.storageKey, JSON.stringify(env));
  await vault.unlock('123456');
  assert.deepEqual(vault.settings, { autoLockMinutes: 5, lockOnHide: false });
});

test('código de recuperação usado deixa de valer após redefinir o PIN', async () => {
  const storage = new MemoryStorage();
  const vault = new Vault(storage, 'gerenc-fin');
  const first = '00112233-44556677-8899aabb-ccddeeff-00112233-44556677-8899aabb-ccddeeff';
  await vault.create('123456', {}, first);
  await vault.lock();
  const { recovery: second } = await vault.resetPassword(first, '222222');
  assert.match(second, /^[0-9a-f]{8}(-[0-9a-f]{8}){7}$/);
  assert.notEqual(second, first);
  await vault.lock();
  await assert.rejects(vault.resetPassword(first, '333333'));
  await vault.resetPassword(second, '333333');
  await vault.lock();
  await vault.unlock('333333');
});

test('apagar o cofre exige o PIN', async () => {
  const storage = new MemoryStorage();
  const vault = new Vault(storage, 'cripito-sim');
  await vault.create('123456', { 'cripto-x': '1' });
  await assert.rejects(vault.destroy('000000'));
  assert.equal(vault.exists, true);
  await vault.destroy('123456');
  assert.equal(vault.exists, false);
  assert.equal(vault.key, null);
});

test('sessão da aba reabre o cofre após recarregar sem PIN, só com a chave de sessão certa', async () => {
  const storage = new MemoryStorage();
  const sessionKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const vault = new Vault(storage, 'cripito-sim');
  vault.sessionKey = sessionKey;
  await vault.create('123456');
  vault.setItem('saldo', '42'); await vault.flush();
  const blob = vault.session;
  assert.ok(blob && blob.ciphertext);

  // Recarregar: nova instância, mesma chave de sessão.
  const reloaded = new Vault(storage, 'cripito-sim');
  reloaded.sessionKey = sessionKey;
  await reloaded.resume(blob);
  assert.equal(reloaded.getItem('saldo'), '42');

  const other = new Vault(storage, 'cripito-sim');
  other.sessionKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  await assert.rejects(other.resume(blob));
  await assert.rejects(new Vault(storage, 'cripito-sim').resume(blob));

  await reloaded.lock();
  assert.equal(reloaded.session, null);
});
