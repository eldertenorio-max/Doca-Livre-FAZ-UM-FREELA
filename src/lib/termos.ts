import type { AceiteTermo, User } from './types'

export const VERSAO_TERMOS = '2026-10-07'

export type TermoId = AceiteTermo['documento']

export type TermoPlataforma = {
  id: TermoId
  titulo: string
  rotuloAceite: string
  paragrafos: string[]
}

const TERMOS: Record<TermoId, TermoPlataforma> = {
  termos_uso: {
    id: 'termos_uso',
    titulo: 'Termos de uso',
    rotuloAceite: 'Li e concordo com os Termos de uso da Doca Livre fazumfreela.',
    paragrafos: [
      'A Doca Livre fazumfreela atua como empresa de trabalho temporário, na forma da Lei 6.019/1974. Ela contrata o trabalhador e o coloca à disposição da empresa tomadora pelo prazo e pelo motivo de cada missão.',
      'A empresa tomadora publica a vaga, informa o motivo da contratação temporária, o período, a jornada e a remuneração, e assina o contrato de prestação de serviços com a fazumfreela.',
      'O trabalhador mantém o cadastro verdadeiro e atualizado, se candidata às vagas e assina o contrato individual de trabalho temporário antes de começar.',
      'Cada contratação gera documentos com número, data e registro de quem assinou. As assinaturas eletrônicas seguem a MP 2.200-2/2001 e a Lei 14.063/2020.',
      'Cadastros com informação falsa, uso indevido da plataforma ou descumprimento das normas de segurança levam ao bloqueio da conta.',
    ],
  },
  privacidade: {
    id: 'privacidade',
    titulo: 'Política de privacidade (LGPD)',
    rotuloAceite: 'Li e concordo com a Política de privacidade.',
    paragrafos: [
      'Os dados pessoais são tratados conforme a Lei 13.709/2018 (LGPD), para cadastro, seleção, contratação, pagamento, segurança e cumprimento de obrigações legais.',
      'A empresa tomadora recebe do trabalhador o necessário para a missão: nome, idade, cidade, cargos, experiência, certificações, categoria da CNH, disponibilidade, avaliação e a foto de perfil, se o trabalhador colocar uma. CPF, RG, telefone, endereço e dados bancários ficam com a fazumfreela.',
      'O titular pode pedir acesso, correção ou exclusão dos dados. Alguns registros ficam guardados pelo prazo que a lei trabalhista e fiscal exige.',
    ],
  },
  dados: {
    id: 'dados',
    titulo: 'Consentimento para documentos, selfie e localização',
    rotuloAceite: 'Autorizo o uso dos meus documentos, da selfie e da localização do aparelho para validar o cadastro e registrar entrada e saída nas missões.',
    paragrafos: [
      'Os documentos e a selfie servem para conferir a identidade e as habilitações. A conferência é feita pela equipe da fazumfreela.',
      'A localização do aparelho é usada para mostrar a distância das vagas e registrar entrada e saída no local da missão.',
      'O consentimento pode ser retirado a qualquer momento. Sem ele, a participação em missões fica suspensa.',
    ],
  },
  veracidade: {
    id: 'veracidade',
    titulo: 'Declaração de veracidade',
    rotuloAceite: 'Declaro que as informações e os documentos enviados são verdadeiros.',
    paragrafos: [
      'Quem se cadastra declara que os dados e os documentos enviados são verdadeiros e pertencem a si ou à empresa que representa.',
      'Documento falso leva ao bloqueio do cadastro e pode gerar responsabilização civil e criminal.',
    ],
  },
}

export function termosDoPerfil(role: User['role'] | undefined): TermoPlataforma[] {
  if (role === 'profissional') return [TERMOS.termos_uso, TERMOS.privacidade, TERMOS.dados, TERMOS.veracidade]
  if (role === 'empresa') return [TERMOS.termos_uso, TERMOS.privacidade, TERMOS.veracidade]
  return []
}

export function termosPendentes(user: User | null): TermoPlataforma[] {
  if (!user) return []
  const aceitos = new Set(
    (user.aceites ?? []).filter((item) => item.versao === VERSAO_TERMOS).map((item) => item.documento),
  )
  return termosDoPerfil(user.role).filter((termo) => !aceitos.has(termo.id))
}
