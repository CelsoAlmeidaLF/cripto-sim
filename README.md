# Cripto — Conversor & Portfólio PWA

> Aplicação web progressiva (PWA) client-side para conversão de moedas, gestão de carteira cripto com auditoria em blockchain local SHA-256, apuração fiscal (IRPF + DeCripto, regimes nacional e exterior) e segurança criptográfica avançada com 2FA via certificado de dispositivo.

---

## Sumário

- [Visão Geral](#visão-geral)
- [Funcionalidades Principais](#funcionalidades-principais)
- [Arquitetura & Segurança](#arquitetura--segurança)
  - [Blockchain Local SHA-256](#blockchain-local-sha-256)
  - [2FA Criptográfico & Certificado do Dispositivo](#2fa-criptográfico--certificado-do-dispositivo)
  - [Apuração Fiscal IRPF (DeCripto)](#apuração-fiscal-irpf-decripto)
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
  - Controle de depósitos em caixa e ordens de compra e venda com **taxa da corretora** (% ou USD) e **spread/slippage estimado** (padrão 1%, configurável), já que o preço é a cotação média de mercado. Taxa e spread entram no custo (compra) e reduzem o valor recebido (venda).
  - Cada operação grava a **cotação USD/BRL do momento**, a origem dessa cotação e o **local de custódia** (exchange nacional ou exterior).
  - Cálculo automático de preço médio ponderado (PM), saldo em custódia e lucros realizados vs. lucros não realizados (*mark-to-market*). O resumo mostra separadamente o resultado total, o não realizado (com sua porcentagem) e o realizado.
  - Vender cripto por USDT ou outra stablecoin é permuta tributável, igual a vender por reais.

- **Meta de Lucro & Projeção de Capital**:
  - Capital bruto necessário = lucro anual ÷ (rendimento × (1 − 15% de IR)), a partir do lucro desejado (mensal ou anual).
  - Os rendimentos (2%, 5%, 10%, 15% a.a.) são **hipóteses sem fonte**, não previsão nem promessa de retorno; renda passiva (lending/staking) também é tributável. A tabela não promete proteção contra quedas.

- **Relatório Fiscal IRPF (Brasil - DeCripto)**:
  - Apuração em **R$ histórico**: ganho = alienação (câmbio da data da venda) − custo (câmbios das compras). Operações antigas sem cotação gravada usam a cotação atual e aparecem como **estimadas**; sem nenhuma cotação usa-se R$ 5,50 (contingência, também sinalizada).
  - **Exchange nacional**: mensal; isenção se as vendas do mês (todas as criptos somadas) forem ≤ R$ 35.000,00 (comparado em centavos); acima disso, ganho tributado em faixas de 15% (até R$ 5 mi), 17,5% (até R$ 10 mi), 20% (até R$ 30 mi) e 22,5% (acima); DARF 4600; DARF abaixo de R$ 10,00 não é recolhido e acumula para o mês seguinte. Postura conservadora: soma dos ganhos positivos, sem compensar prejuízos do mesmo mês (pendente de validação com contador).
  - **Exterior** (Lei 14.754/2023; IN RFB 2.180/2024, art. 9º): 15% fixo, apuração anual na declaração, sem isenção de R$ 35 mil e sem DARF mensal; perdas compensam no ano e passam aos anos seguintes.
  - Gatilho DeCripto (IN RFB 2.291/2025) soma compras e vendas do mês. Mês de apuração pelo horário de Brasília.
  - O câmbio é indicativo, **não a PTAX do Banco Central** (cotação oficial da apuração).

> **Avisos**: simulação educativa, não substitui contador, o GCAP nem a declaração de ajuste anual. Legislação vigente em set/2026; a MP 1.303/2025 caducou, mas o tema pode voltar. Veja `docs/auditoria-financeira-2026-09.md`.

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

### Apuração Fiscal IRPF (DeCripto)

> A IN RFB 2.291/2025 (DeCripto) substituiu a IN 1888/2019; a declaração mensal vale desde julho de 2026. Em exchange nacional, isenção para vendas até R$ 35 mil/mês e ganho de capital acima disso; no exterior vale a Lei 14.754/2023.

O cálculo fiscal é executado em `src/finance-engine.js` (`computeTaxReport`), e a interface (`src/js/app.js`) usa exatamente essas funções, de modo que os testes cobrem o que o usuário vê:
- Separa operações por competência mensal (`AAAA-MM`, fuso America/Sao_Paulo).
- Converte cada operação para BRL com a cotação gravada na própria operação (custo pelas compras, alienação pela venda).
- Aplica isenção, faixas e DARF mínimo (nacional) ou apuração anual com compensação de perdas (exterior).
- Marca como estimado qualquer valor que dependa de cotação não gravada.

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
│       └── app.js             # Lógica de interface, Web Crypto e DOM (cálculos vêm do motor)
├── docs/
│   └── auditoria-financeira-2026-09.md  # Achados da auditoria e correções
└── test/
    ├── blockchain.test.js     # Testes de hash SHA-256 e integridade da blockchain
    ├── cert-2fa.test.js       # Compatibilidade de certificados e backups antigos
    ├── security-vault.test.js # Testes do cofre, PIN, migração e adulteração
    ├── trade-validation.test.js      # Registro de operações (bloqueios, taxas, câmbio, custódia)
    ├── auditoria-financeira.test.js  # Regressão da auditoria: câmbio, regimes, faixas, DARF, DeCripto
    └── financial.test.js      # Testes de caixa, custo médio, IRPF e Meta de Lucro
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
   - Regras de IRPF cripto (isenção até R$ 35k e imposto acima desse teto).
   - Meta de Lucro com IR de 15% e rendimentos hipotéticos.
   - Simulação DCA (função neutra, documentada, sem tela no app).
3. `test/auditoria-financeira.test.js` e `test/trade-validation.test.js`:
   - Câmbio histórico, regime exterior, faixas, DARF mínimo, gatilho DeCripto, taxas/spread, fuso de Brasília e migração de dados antigos.
4. `test/cert-2fa.test.js`:
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
