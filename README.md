# Doca Livre fazumfreela

Plataforma de força de trabalho para logística — marketplace operacional para conectar empresas a profissionais (motoristas, armazém, equipamentos, manutenção e administrativo).

## Rodar em localhost

```bash
npm install
npm run dev
```

Abra o endereço do Vite (geralmente `http://localhost:5173`).

O site local usa a API real (Azure). Para explorar sem tocar em dados reais, abra `http://localhost:5173/demo`: dados fictícios, só no seu navegador. As contas de demonstração aparecem na própria tela de login do modo demo. A demonstração só existe no ambiente de desenvolvimento (`npm run dev`); no site publicado ela foi retirada em 20/11/2026 e `/demo` apenas volta para o início.

## Como funciona

- **Login e senhas** ficam na API (`api/`): a senha é guardada em hash, o login devolve um token de sessão e o banco só mostra a cada pessoa o que é dela. Admin vê tudo.
- **Privacidade (LGPD)**: a empresa vê dos profissionais aprovados só o que a política de privacidade promete — nome, idade, cidade, cargos, experiência, certificações, CNH, disponibilidade, avaliação e a situação dos documentos (sem o arquivo). CPF, RG, telefone, endereço, PIX e foto ficam com a fazumfreela. O profissional vê das empresas aprovadas os dados da empresa, sem CPF do responsável nem dados financeiros.
- **Cadastro**: portal Empresa ou Trabalhador → *Criar conta* → código por e-mail → formulário → aprovação no Admin.
- **Marketplace**: vagas, candidaturas, contratos, ponto, pagamentos e avaliações vão para o banco e aparecem em qualquer aparelho.
- **Admin**: aprova/recusa cadastros (com e-mail), abre os documentos, gera senha provisória para quem perdeu o acesso.

## Fluxo ponta a ponta

1. **Empresa** publica a vaga (ou convida profissionais encontrados na busca).
2. **Trabalhador** vê a vaga, se candidata ou aceita o convite.
3. **Empresa** aprova a candidatura → contrato e documentos da missão.
4. **Trabalhador** registra entrada e saída em cada dia da missão.
5. **Empresa** encerra a missão (Documentação → Encerrar) → pagamento pelos dias com presença e recibo.
6. Os dois avaliam.

## Stack

- Vite + React 19 + TypeScript (site, publicado no Render)
- API Node + PostgREST + PostgreSQL + Azure Blob (pasta `api/`, publicada no Azure Container Apps)

Publicação e variáveis: veja `DEPLOY.md`.
