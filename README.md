# Cripto — Conversor & Portfólio PWA

> Aplicação web progressiva (PWA) client-side para conversão de moedas, gestão de carteira cripto com auditoria em blockchain local SHA-256, simulador DCA, apuração fiscal (IN 1888) e segurança criptográfica avançada com 2FA via certificado de dispositivo.

---

## Sumário

- [Visão Geral](#visão-geral)
- [Funcionalidades Principais](#funcionalidades-principais)
- [Arquitetura & Segurança](#arquitetura--segurança)
  - [Blockchain Local SHA-256](#blockchain-local-sha-256)
  - [2FA Criptográfico & Certificado do Dispositivo](#2fa-criptográfico--certificado-do-dispositivo)
  - [Apuração Fiscal IRPF (IN 1888)](#apuração-fiscal-irpf-in-1888)
- [Estrutura do Projeto](#estrutura-do-projeto)
- [Como Executar](#como-executar)
  - [Navegador / Servidor Local](#navegador--servidor-local)
  - [Instalação como PWA](#instalação-como-pwa)
- [Testes Automatizados](#testes-automatizados)
- [Tecnologias Utilizadas](#tecnologias-utilizadas)
- [Licença](#licença)

---

## Visão Geral

O **Cripto** é um aplicativo financeiro *offline-first* focado em privacidade e soberania de dados. Não requer cadastro em servidores externos nem banco de dados em nuvem: todas as transações, chaves e históricos pertencem exclusivamente ao usuário e ficam armazenados localmente.

A aplicação combina um conversor com cotações em tempo real a um gerenciador de portfólio completo, assegurado por um livro-razão criptográfico próprio e rotinas de proteção baseadas na Web Cryptography API.

---

## ✨ Funcionalidades Principais

- **Conversor em Tempo Real**:
  - Conversão instantânea entre moedas fiduciárias (USD, BRL) e as principais criptomoedas (BTC, ETH, SOL, ADA, DOT, entre outras).
  - Consulta de preços dinâmicos via API (CoinGecko) com tratamento de cache e fallback.
  - Gráficos *sparkline* de tendência de 7 dias para acompanhamento de volatilidade.
  - Filtro em tempo real por nome/símbolo e personalização de ativos favoritos.

- **Gestão de Portfólio**:
  - Controle de depósitos em caixa e ordens de compra e venda com registro de taxas de rede/corretagem.
  - Cálculo automático de preço médio ponderado (PM), saldo em custódia e lucros realizados vs. lucros não realizados (*mark-to-market*).

- **Simulador DCA (Dollar Cost Averaging)**:
  - Projeção de aportes recorrentes com intervalos customizáveis (diário, semanal, quinzenal, mensal).
  - Comparativo de rentabilidade entre estratégia DCA e aporte único (*Lump Sum*), considerando ciclos de volatilidade.

- **Meta de Lucro & Projeção de Capital**:
  - Cálculo dinâmico do capital necessário a partir do lucro desejado pelo usuário (mensal ou anual).
  - Tabela comparativa com colunas focadas: Cenário de Mercado, Rendimento Estimado, Capital em Dólares e Margem de Segurança.

- **Relatório Fiscal IRPF (Brasil - IN 1888)**:
  - Apuração mensal automática de alienações em Reais (BRL).
  - Alerta do limite de isenção de **R$ 35.000,00/mês**.
  - Cálculo de ganho de capital e estimativa de imposto (alíquota base de 15%) sobre operações tributáveis.

- **Exportação & File System Access**:
  - Salve e sincronize os dados diretamente em um arquivo local do seu computador através da *File System Access API*.
  - Exportação e importação manual de backups no formato JSON.

---

## Arquitetura & Segurança

### Blockchain Local SHA-256
Para garantir que o histórico de operações financeiras não sofra adulteração acidental ou intencional no armazenamento local, o motor financeiro implementa uma **blockchain local encadeada**:
- Implementação pura em JavaScript do algoritmo de hash **SHA-256**.
- Gênese automática e encadeamento criptográfico contínuo (`hash = SHA256(index + timestamp + data + previousHash)`).
- Rotina de verificação de integridade (`verifyChainIntegrity`) executada a cada carregamento e importação de arquivo.

### Cofre local e certificado do dispositivo
- **PIN numérico**: o acesso exige exatamente seis números; tentativas incorretas recebem atraso progressivo.
- **Criptografia integral**: carteiras, operações, depósitos, histórico, alertas e configurações ficam em um único cofre AES-256-GCM autenticado.
- **Derivação de chave**: PBKDF2-SHA-256 com 600.000 iterações e salt aleatório protege a chave de dados; a chave aberta existe apenas na memória da sessão.
- **Recuperação**: um código aleatório, exibido uma única vez, permite definir outro PIN sem manter o PIN original.
- **Bloqueio de sessão**: o cofre bloqueia após 15 minutos sem atividade e impede duas abas de editarem os mesmos dados ao mesmo tempo.
- **Migração segura**: registros antigos só são removidos depois que a gravação criptografada é confirmada.
- **Certificados e backups**: certificados, backups JSON e extratos exportados exigem PIN e usam AES-256-GCM; formatos antigos continuam importáveis para migração.

### Apuração Fiscal IRPF (IN 1888)
O cálculo fiscal é executado em `src/finance-engine.js`:
- Separa compras e vendas por competência mensal (`AAAA-MM`).
- Converte a alienação para BRL com base na cotação cambial do período.
- Discrimina vendas isentas de operações sujeitas à apuração de Ganho de Capital.

---

## Estrutura do Projeto

```text
cripito-sim/
├── LICENSE                    # Licença GNU General Public License v3.0
├── README.md                  # Documentação do projeto
├── src/
│   ├── index.html             # Interface principal da aplicação
│   ├── cripto-app.html        # Ponto de entrada PWA / standalone
│   ├── finance-engine.js      # Motor financeiro universal (Node.js & Browser)
│   ├── secure-vault.js        # Cofre AES-GCM e derivação de chave por PIN
│   ├── secure-ui.js           # Bloqueio, recuperação e migração segura
│   ├── secure-ui.css          # Interface de segurança integrada ao tema
│   ├── manifest.json          # Manifesto PWA com metadados e ícones
│   ├── sw.js                  # Service Worker com cache e modo offline
│   ├── icon-192.png           # Ícone PWA (192x192)
│   ├── icon-512.png           # Ícone PWA (512x512)
│   ├── css/
│   │   └── style.css          # Estilização responsiva em tema escuro
│   └── js/
│       └── app.js             # Lógica de interface, Web Crypto e DOM
└── test/
    ├── blockchain.test.js     # Testes de hash SHA-256 e integridade da blockchain
    ├── cert-2fa.test.js       # Compatibilidade de certificados e backups antigos
    ├── security-vault.test.js # Testes do cofre, PIN, migração e adulteração
    └── financial.test.js      # Testes de caixa, custo médio, IRPF e DCA
```

---

## Como Executar

### Navegador / Servidor Local

Por ser uma aplicação web estática que utiliza Service Worker e Web Crypto, é recomendado servi-la via HTTP local:

```bash
# Opção 1: Usando o servidor embutido do Python
python3 -m http.server 8080 --directory src

# Opção 2: Usando Node.js (npx serve / http-server)
npx serve src -p 8080
```

Abra em seu navegador:
```text
http://localhost:8080
```

### Instalação como PWA
- **No Chrome / Brave / Edge**: Clique no ícone de instalação na barra de navegação ou acesse o menu e selecione *"Instalar Cripto"*.
- **No Android**: Acesse pelo Chrome, abra o menu e clique em *"Adicionar à tela inicial"*.
- **No iOS (Safari)**: Toque no botão Compartilhar e selecione *"Adicionar à Tela de Início"*.

---

## Testes Automatizados

O projeto utiliza o runner de testes nativo do Node.js (`node:test`), não dependendo de pacotes externos no `node_modules`:

```bash
# Executar todos os testes da suíte
node --test test/*.test.js
```

### Suítes cobertas:
1. `test/blockchain.test.js`:
   - Consistência dos hashes SHA-256 puros.
   - Construção do bloco gênese e novos blocos.
   - Rejeição de adulteração em valores de transações e corrupção de ponteiros anteriores.
2. `test/financial.test.js`:
   - Saldo de caixa com depósitos, compras e vendas.
   - Preço médio ponderado e lucros realizados/não realizados.
   - Regras da IN 1888 (isenção até R$ 35k e imposto acima desse teto).
   - Simulação periódica DCA.
3. `test/cert-2fa.test.js`:
   - Validação do fluxo 2FA criptográfico com PBKDF2 + AES-GCM.
   - Rejeição de decifragem sem certificado do dispositivo ou com certificado inválido.

---

## Tecnologias Utilizadas

- **Frontend Core**: HTML5 Semântico, CSS3 Moderno (CSS Variables, Flexbox, Grid), JavaScript Moderno (ES6+).
- **Tipografia**: Space Grotesk & IBM Plex Mono via Google Fonts.
- **PWA**: Service Worker API, Cache Storage API, Web App Manifest.
- **Criptografia & Segurança**: Web Crypto API (SubtleCrypto, PBKDF2, AES-GCM), WebAuthn / Passkeys, SHA-256 nativo.
- **APIs de Cotação**: CoinGecko API v3.
- **Testes**: Node.js Test Runner nativo (`node:test`, `node:assert`).

---

## Licença

Este projeto é software livre distribuído sob os termos da licença [GNU General Public License v3.0 (GPL-3.0)](LICENSE).
