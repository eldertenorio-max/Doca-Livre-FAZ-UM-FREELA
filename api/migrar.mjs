import fs from 'node:fs'
import pg from 'pg'
import { gerarHashSenha } from './auth.mjs'

export const pool = new pg.Pool({
  ssl: process.env.PGHOST && process.env.PGSSL !== 'off' ? { rejectUnauthorized: false } : undefined,
})

const arquivos = ['001_tabelas.sql', '002_permissoes.sql', '003_seguranca.sql', '004_aplicativo.sql']

// Contas de gestão que já existiam no app (antes só no código do site, com a senha à vista).
// Entram no banco real com a senha inicial de sempre, em hash, e são obrigadas a trocar por
// uma senha forte no primeiro login. Se a conta já existe, nada é alterado.
// Único acesso de gestão do sistema real (decisão do Diego em 12/11/2026: as contas Diego e
// Elder saíram). Só é criado num banco novo; num banco que já tem a conta, nada muda aqui.
const CONTAS_INICIAIS = [
  {
    id: 'user_admin',
    usuario: 'admin',
    email: 'admin@docalivre.com',
    role: 'super',
    nivel: 'super',
    superior: null,
    hash: 'scrypt$16384$8$1$BUvJGxzORgc4wgIcLcRT7w==$6gPbzXWWwTWMLc2th6Y+T/Y/Z4j+2+QsiYXWWHE02poXpZpNjLPqNcjDzhy4afDmPi9AgXJ3A+c6mc33J8sVng==',
  },
]

/** Senhas antigas ("local:<senha>" em mao_contas) viram hash scrypt em mao_credenciais. */
async function migrarSenhasAntigas() {
  const { rows } = await pool.query(
    `select c.id, c.senha_hash from mao_contas c
     where coalesce(c.senha_hash, '') <> ''
       and not exists (select 1 from mao_credenciais k where k.conta_id = c.id)`,
  )
  for (const row of rows) {
    const bruto = String(row.senha_hash)
    const hash = bruto.startsWith('scrypt$')
      ? bruto
      : await gerarHashSenha(bruto.startsWith('local:') ? bruto.slice('local:'.length) : bruto)
    await pool.query(
      `insert into mao_credenciais (conta_id, senha_hash) values ($1, $2) on conflict (conta_id) do nothing`,
      [row.id, hash],
    )
  }
  // Nenhuma senha (nem hash) fica em mao_contas, que o app lê.
  await pool.query(`update mao_contas set senha_hash = '' where coalesce(senha_hash, '') <> ''`)
  return rows.length
}

async function criarContasIniciais() {
  for (const conta of CONTAS_INICIAIS) {
    const existe = await pool.query(
      `select 1 from mao_contas where id = $1 or lower(email) = lower($2) or lower(usuario) = lower($3) limit 1`,
      [conta.id, conta.email, conta.usuario],
    )
    if (existe.rowCount) continue
    await pool.query(
      `insert into mao_contas (id, usuario, email, senha_hash, role, nivel_hierarquia, superior_usuario, perfil_completo, ativo)
       values ($1, $2, $3, '', $4, $5, $6, true, true)`,
      [conta.id, conta.usuario, conta.email, conta.role, conta.nivel, conta.superior],
    )
    await pool.query(
      `insert into mao_credenciais (conta_id, senha_hash, trocar_senha) values ($1, $2, true)
       on conflict (conta_id) do nothing`,
      [conta.id, conta.hash],
    )
  }
}

export async function preparar() {
  for (const nome of arquivos) {
    const sql = fs.readFileSync(new URL(`./sql/${nome}`, import.meta.url), 'utf8')
    await pool.query(sql)
  }
  await migrarSenhasAntigas()
  await criarContasIniciais()
  try {
    await pool.query("notify pgrst, 'reload schema'")
  } catch {
    /* ignore se pgrst nao estiver escutando ainda */
  }
  // Em segundo plano (não segura a subida): posição de quem ainda está no centro da cidade, pelo endereço.
  void import('./localizacao.mjs').then((m) => m.atualizarLocalizacoes()).catch((erro) => console.error('[localizacao]', erro?.message || erro))
}
