/**
 * Gera public/login-bg.svg: ilustração do fundo das telas de entrada do fazumfreela, na mesma família visual do
 * WMS (corredor de armazém) e do Oferta de Carga (porto à noite): cena noturna chapada, azul-marinho com amarelo.
 * Tema: os profissionais da operação conectados às empresas. À esquerda, o galpão com as docas iluminadas, a
 * empilhadeira com o operador e a conferente com o tablet; à direita, o caminhão com o motorista e o mecânico.
 * Cada empresa e cada profissional tem um pino de localização, ligados por linhas pontilhadas (como no mapa do app).
 * O meio fica calmo (só céu, cidade ao longe e asfalto) porque é onde ficam os cartões.
 *
 *   node scripts/gerar-fundo-login.mjs            (grava public/login-bg.svg)
 *   node scripts/gerar-fundo-login.mjs saida.svg  (grava em outro lugar, para testar)
 */
import { writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const saida = process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'login-bg.svg')
const W = 1920
const H = 1080
const AMARELO = '#f9db00'
const AMARELO_ESCURO = '#d4b400'
const METAL = '#4b5c9e'

/* Gerador pseudoaleatório fixo: a imagem sai sempre igual. */
let semente = 7
const aleatorio = () => ((semente = (semente * 1664525 + 1013904223) % 4294967296) / 4294967296)
const r1 = (v) => Math.round(v * 10) / 10

const partes = []
const add = (s) => partes.push(s)

/* ---------- céu ---------- */
add(`<defs>
  <linearGradient id="ceu" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#050913"/><stop offset="0.55" stop-color="#0c1430"/><stop offset="1" stop-color="#1b2650"/>
  </linearGradient>
  <linearGradient id="asfalto" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#121a36"/><stop offset="1" stop-color="#070b18"/>
  </linearGradient>
  <linearGradient id="patio" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#1a2349"/><stop offset="1" stop-color="#10172f"/>
  </linearGradient>
  <linearGradient id="doca" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#fff2a8" stop-opacity="0.8"/><stop offset="1" stop-color="${AMARELO}" stop-opacity="0.3"/>
  </linearGradient>
  <radialGradient id="lua" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0" stop-color="#fff6c2" stop-opacity="0.5"/><stop offset="1" stop-color="#fff6c2" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="luz" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0" stop-color="${AMARELO}" stop-opacity="0.3"/><stop offset="1" stop-color="${AMARELO}" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="farol" cx="0" cy="0.5" r="1">
    <stop offset="0" stop-color="#fffbe0" stop-opacity="0.6"/><stop offset="1" stop-color="#fffbe0" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="brilho-pino" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0" stop-color="${AMARELO}" stop-opacity="0.4"/><stop offset="1" stop-color="${AMARELO}" stop-opacity="0"/>
  </radialGradient>
</defs>`)
add(`<rect width="${W}" height="${H}" fill="url(#ceu)"/>`)

// estrelas
const estrelas = []
for (let i = 0; i < 130; i++) {
  const x = r1(aleatorio() * W)
  const y = r1(aleatorio() * 540)
  const r = r1(0.6 + aleatorio() * 1.5)
  const o = (0.2 + aleatorio() * 0.55).toFixed(2)
  estrelas.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" opacity="${o}"/>`)
}
add(`<g>${estrelas.join('')}</g>`)

// lua (do lado esquerdo; no Oferta ela fica à direita)
add(`<circle cx="250" cy="150" r="130" fill="url(#lua)"/><circle cx="250" cy="150" r="34" fill="#fff4bf" opacity="0.9"/>`)

/* ---------- cidade ao longe ---------- */
const predios = []
const janelas = []
let x = -10
while (x < W) {
  const largura = 40 + aleatorio() * 70
  const altura = 40 + aleatorio() * 130
  const topo = 800 - altura
  predios.push(`<rect x="${r1(x)}" y="${r1(topo)}" width="${r1(largura)}" height="${r1(altura + 20)}"/>`)
  for (let jy = topo + 12; jy < 790; jy += 16) {
    for (let jx = x + 8; jx < x + largura - 8; jx += 14) {
      if (aleatorio() < 0.15) janelas.push(`<rect x="${r1(jx)}" y="${r1(jy)}" width="5" height="7"/>`)
    }
  }
  x += largura + 4
}
add(`<g fill="#121a38">${predios.join('')}</g>`)
add(`<g fill="${AMARELO}" opacity="0.3">${janelas.join('')}</g>`)

/* ---------- pátio e asfalto ---------- */
add(`<rect x="0" y="800" width="${W}" height="70" fill="url(#patio)"/>`)
add(`<rect x="0" y="870" width="${W}" height="210" fill="url(#asfalto)"/>`)
add(`<rect x="0" y="870" width="${W}" height="5" fill="#2b3666"/>`)
add(`<rect x="0" y="880" width="${W}" height="3" fill="#cbd5e1" opacity="0.2"/>`)
const faixas = []
for (let fx = -20; fx < W; fx += 120) faixas.push(`<rect x="${fx}" y="1052" width="64" height="7" rx="2"/>`)
add(`<g fill="${AMARELO}" opacity="0.8">${faixas.join('')}</g>`)

/* ---------- área de atuação no chão (o raio do mapa, em perspectiva) ---------- */
function raio(cx, cy, rx, ry) {
  return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${AMARELO}" opacity="0.045"/>` +
    `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="none" stroke="${AMARELO}" stroke-width="3" stroke-dasharray="14 12" opacity="0.35"/>`
}
add(raio(330, 985, 330, 50))
add(raio(1600, 990, 330, 50))

/* ---------- galpão com docas ---------- */
function galpao(gx, base) {
  const docas = []
  for (let i = 0; i < 3; i++) {
    const dx = gx + 50 + i * 175
    docas.push(`
      <circle cx="${dx + 70}" cy="${base - 190}" r="105" fill="url(#luz)"/>
      <rect x="${dx}" y="${base - 165}" width="140" height="165" fill="#0a1024"/>
      <rect x="${dx}" y="${base - 125}" width="140" height="125" fill="url(#doca)"/>
      <g fill="#1b2756" opacity="0.9">
        <rect x="${dx + 12}" y="${base - 118}" width="6" height="118"/><rect x="${dx + 122}" y="${base - 118}" width="6" height="118"/>
        <rect x="${dx + 12}" y="${base - 82}" width="116" height="5"/><rect x="${dx + 12}" y="${base - 44}" width="116" height="5"/>
      </g>
      <g fill="#7a5a2e" opacity="0.85">
        <rect x="${dx + 26}" y="${base - 112}" width="30" height="30"/><rect x="${dx + 60}" y="${base - 108}" width="26" height="26"/>
        <rect x="${dx + 90}" y="${base - 74}" width="30" height="30"/><rect x="${dx + 28}" y="${base - 74}" width="28" height="30"/>
        <rect x="${dx + 62}" y="${base - 36}" width="30" height="36"/>
      </g>
      <rect x="${dx - 4}" y="${base - 170}" width="148" height="48" rx="3" fill="#2a3870"/>
      <g fill="#223064">${[0, 1, 2, 3, 4].map((k) => `<rect x="${dx - 4}" y="${base - 166 + k * 9}" width="148" height="3"/>`).join('')}</g>
      <rect x="${dx + 54}" y="${base - 186}" width="32" height="6" rx="2" fill="#fff3a6"/>
      <g fill="${AMARELO}"><rect x="${dx - 6}" y="${base - 22}" width="10" height="22"/><rect x="${dx + 136}" y="${base - 22}" width="10" height="22"/></g>`)
  }
  return `<g>
    <polygon points="${gx - 12},${base - 250} ${gx + 300},${base - 318} ${gx + 612},${base - 250}" fill="#1d2a5c"/>
    <polyline points="${gx - 12},${base - 250} ${gx + 300},${base - 318} ${gx + 612},${base - 250}" fill="none" stroke="${AMARELO}" stroke-width="3" opacity="0.55"/>
    <rect x="${gx}" y="${base - 250}" width="600" height="250" fill="#17224a"/>
    <g fill="#1b2756">${[0, 1, 2, 3].map((k) => `<rect x="${gx}" y="${base - 232 + k * 16}" width="600" height="4"/>`).join('')}</g>
    ${docas.join('')}
  </g>`
}
add(galpao(30, 812))

/* ---------- pessoas (figuras simples, sem rosto; 180 de altura na escala 1) ---------- */
const PELES = ['#c99a6e', '#8d5a3b', '#e0b48c', '#a8714a']
function colete(x0, y0) {
  // colete refletivo sobre um tronco de 42 x 66 com o canto em (x0, y0)
  return `<path d="M${x0} ${y0 + 14} Q${x0} ${y0} ${x0 + 12} ${y0} L${x0 + 18} ${y0} L${x0 + 21} ${y0 + 16} L${x0 + 24} ${y0} L${x0 + 30} ${y0} Q${x0 + 42} ${y0} ${x0 + 42} ${y0 + 14} L${x0 + 42} ${y0 + 58} L${x0} ${y0 + 58} Z" fill="${AMARELO}"/>` +
    `<rect x="${x0}" y="${y0 + 32}" width="42" height="5" fill="#e9ecf3" opacity="0.9"/><rect x="${x0}" y="${y0 + 44}" width="42" height="5" fill="#e9ecf3" opacity="0.9"/>`
}
function capacete(cx, cy) {
  // cy = centro da cabeça
  return `<path d="M${cx - 17} ${cy - 2} A17 17 0 0 1 ${cx + 17} ${cy - 2} Z" fill="${AMARELO}"/><rect x="${cx - 21}" y="${cy - 4}" width="42" height="5" rx="2.5" fill="${AMARELO_ESCURO}"/>`
}
function pessoa(px, base, escala, op = {}) {
  const pele = op.pele || PELES[0]
  const camisa = op.camisa || '#2c3f7a'
  const calca = op.calca || '#1a2552'
  const virar = op.virar ? -1 : 1
  const p = []
  p.push(`<ellipse cx="0" cy="2" rx="34" ry="7" fill="#000" opacity="0.35"/>`)
  // pernas e sapatos
  p.push(`<rect x="-17" y="-82" width="15" height="80" rx="6" fill="${calca}"/><rect x="2" y="-82" width="15" height="80" rx="6" fill="${calca}"/>`)
  p.push(`<rect x="-20" y="-7" width="19" height="8" rx="3" fill="#05080f"/><rect x="1" y="-7" width="21" height="8" rx="3" fill="#05080f"/>`)
  // cabelo comprido fica atrás do tronco
  if (op.cabelo === 'longo') p.push(`<path d="M-19 -166 Q-21 -186 0 -184 Q21 -186 19 -166 L20 -134 Q0 -128 -20 -134 Z" fill="#1c140e"/>`)
  // tronco
  p.push(`<rect x="-21" y="-142" width="42" height="66" rx="12" fill="${camisa}"/>`)
  if (op.colete) p.push(colete(-21, -142))
  // braço de trás (para baixo)
  p.push(`<rect x="-30" y="-138" width="11" height="58" rx="5.5" fill="${camisa}"/><circle cx="-24.5" cy="-79" r="6" fill="${pele}"/>`)
  // braço da frente conforme o que a pessoa faz
  if (op.tablet) {
    p.push(`<rect x="18" y="-138" width="11" height="34" rx="5.5" fill="${camisa}"/>`)
    p.push(`<rect x="18" y="-112" width="30" height="11" rx="5.5" fill="${camisa}"/><circle cx="48" cy="-106.5" r="6" fill="${pele}"/>`)
    p.push(`<rect x="44" y="-140" width="26" height="36" rx="3" fill="#0b1430"/><rect x="47" y="-137" width="20" height="28" rx="1.5" fill="#8fb3ff" opacity="0.6"/>`)
  } else if (op.chave) {
    // braço dobrado para cima segurando a chave de boca
    p.push(`<rect x="18" y="-138" width="11" height="34" rx="5.5" fill="${camisa}"/>`)
    p.push(`<rect x="22" y="-142" width="11" height="36" rx="5.5" fill="${camisa}" transform="rotate(24 27 -108)"/><circle cx="42" cy="-138" r="6" fill="${pele}"/>`)
    p.push(`<g stroke="#dbe2ef" stroke-linecap="round" fill="none"><line x1="42" y1="-132" x2="42" y2="-176" stroke-width="6"/><path d="M34 -190 V-182 A8 8 0 0 0 50 -182 V-190" stroke-width="5.5"/></g>`)
  } else {
    p.push(`<rect x="19" y="-138" width="11" height="58" rx="5.5" fill="${camisa}"/><circle cx="24.5" cy="-79" r="6" fill="${pele}"/>`)
    if (op.prancheta) p.push(`<rect x="22" y="-106" width="22" height="30" rx="2" fill="#7a5a2e"/><rect x="25" y="-101" width="16" height="21" fill="#e9ecf3"/><rect x="29" y="-109" width="8" height="5" rx="1.5" fill="#cbd5e1"/>`)
  }
  // pescoço e cabeça
  p.push(`<rect x="-5.5" y="-150" width="11" height="10" fill="${pele}"/><circle cx="0" cy="-164" r="16" fill="${pele}"/>`)
  if (op.capacete) p.push(capacete(0, -164))
  else if (op.bone) p.push(`<path d="M-16 -167 A16 14 0 0 1 16 -167 Z" fill="${op.bone}"/><rect x="2" y="-169" width="24" height="5" rx="2.5" fill="${op.bone}"/>`)
  else p.push(`<path d="M-16 -166 A16 16 0 0 1 16 -166 Q8 -173 0 -172 Q-10 -172 -16 -166 Z" fill="#1c140e"/>`)
  return `<g transform="translate(${px} ${base}) scale(${virar * escala} ${escala})">${p.join('')}</g>`
}

/* ---------- empilhadeira com o operador sentado e um palete nos garfos ---------- */
function caixas(cx, cy) {
  return `<g>
    <rect x="${cx}" y="${cy - 40}" width="36" height="40" fill="#b58a52"/><rect x="${cx + 38}" y="${cy - 40}" width="36" height="40" fill="#a07a45"/>
    <rect x="${cx + 6}" y="${cy - 78}" width="36" height="38" fill="#a07a45"/><rect x="${cx + 44}" y="${cy - 78}" width="30" height="38" fill="#b58a52"/>
    <g fill="#e9d6a8" opacity="0.6"><rect x="${cx + 16}" y="${cy - 40}" width="4" height="40"/><rect x="${cx + 54}" y="${cy - 40}" width="4" height="40"/>
      <rect x="${cx + 22}" y="${cy - 78}" width="4" height="38"/><rect x="${cx + 57}" y="${cy - 78}" width="4" height="38"/></g>
  </g>`
}
function palete(cx, cy) {
  return `<g fill="#8a6a3a"><rect x="${cx}" y="${cy}" width="78" height="6"/><rect x="${cx}" y="${cy + 12}" width="78" height="5"/>
    <rect x="${cx + 2}" y="${cy + 6}" width="10" height="6"/><rect x="${cx + 34}" y="${cy + 6}" width="10" height="6"/><rect x="${cx + 66}" y="${cy + 6}" width="10" height="6"/></g>`
}
function empilhadeira(ex, base, escala, op = {}) {
  const pele = op.pele || PELES[1]
  const camisa = '#2c3f7a'
  const calca = '#1a2552'
  return `<g transform="translate(${ex} ${base}) scale(${escala})">
    <ellipse cx="130" cy="3" rx="180" ry="10" fill="#000" opacity="0.35"/>
    <ellipse cx="344" cy="-50" rx="130" ry="36" fill="url(#farol)"/>
    <g fill="${METAL}"><rect x="216" y="-272" width="9" height="266"/><rect x="230" y="-272" width="8" height="266"/>
      <rect x="216" y="-272" width="22" height="6"/><rect x="216" y="-170" width="22" height="5"/></g>
    <g fill="#8794c4"><rect x="238" y="-104" width="7" height="52"/><rect x="238" y="-58" width="84" height="6"/></g>
    ${palete(242, -75)}
    ${caixas(244, -75)}
    <g stroke="${METAL}" stroke-width="7" stroke-linecap="round" fill="none"><line x1="24" y1="-110" x2="34" y2="-236"/><line x1="166" y1="-100" x2="158" y2="-236"/></g>
    <rect x="22" y="-243" width="150" height="9" rx="4" fill="${METAL}"/>
    <rect x="52" y="-168" width="12" height="68" rx="5" fill="#0b1430"/>
    <rect x="72" y="-118" width="62" height="16" rx="8" fill="${calca}"/><rect x="120" y="-112" width="15" height="46" rx="7" fill="${calca}"/>
    <rect x="62" y="-176" width="42" height="68" rx="12" fill="${camisa}"/>
    ${colete(62, -176)}
    <rect x="90" y="-166" width="54" height="11" rx="5.5" fill="${camisa}" transform="rotate(26 90 -160)"/>
    <circle cx="140" cy="-138" r="6" fill="${pele}"/>
    <rect x="77.5" y="-186" width="11" height="10" fill="${pele}"/><circle cx="83" cy="-200" r="16" fill="${pele}"/>
    ${capacete(83, -200)}
    <line x1="152" y1="-100" x2="145" y2="-134" stroke="#0b1430" stroke-width="5" stroke-linecap="round"/>
    <ellipse cx="143" cy="-137" rx="11" ry="4.5" fill="#0b1430"/>
    <path d="M-8 -34 V-92 Q-8 -112 12 -112 H46 V-34 Z" fill="${AMARELO_ESCURO}"/>
    <path d="M40 -34 V-100 H176 Q214 -100 214 -66 V-34 Z" fill="${AMARELO}"/>
    <rect x="-8" y="-46" width="222" height="12" fill="#000" opacity="0.2"/>
    <rect x="58" y="-88" width="70" height="6" rx="3" fill="#000" opacity="0.18"/>
    <rect x="204" y="-88" width="9" height="11" rx="2" fill="#fffbe0"/>
    <g fill="#04060d"><circle cx="30" cy="-24" r="24"/><circle cx="178" cy="-30" r="30"/></g>
    <g fill="#3a4675"><circle cx="30" cy="-24" r="9"/><circle cx="178" cy="-30" r="11"/></g>
  </g>`
}

/* ---------- caminhão (cabine para a esquerda, como no Oferta) ---------- */
function iconeDoca(ix, iy, escala) {
  return `<g transform="translate(${ix} ${iy}) scale(${escala})" fill="${AMARELO}">
    <path d="M0 0h44v6H6v38h38v6H0z"/><path d="M100 0H56v6h38v38H56v6h44z"/>
    <path d="M14 25 30 13v24z"/><rect x="28" y="20" width="18" height="10"/>
    <path d="M86 25 70 13v24z"/><rect x="54" y="20" width="18" height="10"/>
  </g>`
}
function caminhao(cx, base, escala) {
  return `<g transform="translate(${cx} ${base}) scale(${-escala} ${escala})">
    <ellipse cx="300" cy="4" rx="320" ry="14" fill="#000" opacity="0.35"/>
    <ellipse cx="740" cy="-52" rx="170" ry="48" fill="url(#farol)"/>
    <rect x="0" y="-210" width="420" height="168" rx="6" fill="#1f2d5c"/>
    <rect x="0" y="-210" width="420" height="5" fill="#fff" opacity="0.12"/>
    <rect x="0" y="-78" width="420" height="10" fill="${AMARELO}"/>
    ${iconeDoca(150, -176, 1.2)}
    <rect x="10" y="-44" width="590" height="14" fill="#0a0f22"/>
    <path d="M430 -44 V-176 H540 L580 -118 L588 -44 Z" fill="#e9ecf3"/>
    <path d="M456 -164 H530 L566 -118 H456 Z" fill="#0b1430"/>
    <path d="M462 -158 H492 L476 -124 H462 Z" fill="#fff" opacity="0.12"/>
    <rect x="430" y="-92" width="158" height="8" fill="${AMARELO}"/>
    <rect x="576" y="-66" width="14" height="14" rx="2" fill="#fffbe0"/>
    <g fill="#04060d">
      <circle cx="70" cy="-28" r="27"/><circle cx="132" cy="-28" r="27"/><circle cx="330" cy="-28" r="27"/>
      <circle cx="476" cy="-28" r="27"/><circle cx="548" cy="-28" r="27"/>
    </g>
    <g fill="#3a4675">
      <circle cx="70" cy="-28" r="10"/><circle cx="132" cy="-28" r="10"/><circle cx="330" cy="-28" r="10"/>
      <circle cx="476" cy="-28" r="10"/><circle cx="548" cy="-28" r="10"/>
    </g>
  </g>`
}

function caixaFerramentas(fx, base) {
  return `<g><ellipse cx="${fx + 23}" cy="${base + 2}" rx="30" ry="5" fill="#000" opacity="0.3"/>
    <rect x="${fx}" y="${base - 26}" width="46" height="26" rx="3" fill="#c0392b"/><rect x="${fx}" y="${base - 26}" width="46" height="6" fill="#962d22"/>
    <path d="M${fx + 14} ${base - 26} V${base - 34} H${fx + 32} V${base - 26}" fill="none" stroke="${METAL}" stroke-width="4"/></g>`
}

/* ---------- conexões: pinos de localização ligados por linhas pontilhadas ---------- */
function pino(px, py, escala, tipo) {
  const icone = tipo === 'empresa'
    ? `<path d="M-11 -31 L0 -40 L11 -31 V-24 H-11 Z" fill="#0b1430"/><rect x="-3.5" y="-30" width="7" height="6" fill="#fff8cc"/>`
    : `<circle cx="0" cy="-38" r="5" fill="#0b1430"/><path d="M-9 -25 Q-9 -32 0 -32 Q9 -32 9 -25 Z" fill="#0b1430"/>`
  return `<g transform="translate(${px} ${py}) scale(${escala})">
    <circle cx="0" cy="-32" r="40" fill="url(#brilho-pino)"/>
    <path d="M0 0 C-12 -15 -20 -24 -20 -34 A20 20 0 1 1 20 -34 C20 -24 12 -15 0 0 Z" fill="${AMARELO}" stroke="#0b1430" stroke-width="2.5"/>
    <circle cx="0" cy="-34" r="13" fill="#fff8cc"/>
    ${icone}
  </g>`
}
// [x, y da ponta, escala, tipo]
const PINOS = {
  galpao: [330, 478, 1.25, 'empresa'],
  transportadora: [1700, 706, 1.1, 'empresa'],
  operador: [213, 776, 0.85, 'pessoa'],
  conferente: [520, 822, 0.85, 'pessoa'],
  motorista: [1378, 822, 0.85, 'pessoa'],
  mecanico: [1640, 826, 0.85, 'pessoa'],
}
const centro = ([px, py, escala]) => [px, r1(py - 34 * escala)]
function arco(de, para, cx, cy, opacidade) {
  const [x1, y1] = centro(PINOS[de])
  const [x2, y2] = centro(PINOS[para])
  return `<path d="M${x1} ${y1} Q${cx} ${cy} ${x2} ${y2}" fill="none" stroke="${AMARELO}" stroke-width="3" stroke-linecap="round" stroke-dasharray="1 12" opacity="${opacidade}"/>`
}
add(arco('galpao', 'motorista', 850, 170, 0.4))
add(arco('galpao', 'mecanico', 980, 60, 0.3))
add(arco('transportadora', 'conferente', 1120, 300, 0.32))
add(arco('galpao', 'operador', 200, 560, 0.5))
add(arco('galpao', 'conferente', 470, 560, 0.5))
add(arco('transportadora', 'motorista', 1500, 600, 0.5))
add(arco('transportadora', 'mecanico', 1640, 690, 0.5))

/* ---------- lado esquerdo: empilhadeira com o operador e a conferente com o tablet ---------- */
add(empilhadeira(140, 1000, 0.88, { pele: PELES[1] }))
add(pessoa(520, 1005, 0.95, { tablet: true, colete: true, virar: true, cabelo: 'longo', pele: PELES[3], camisa: '#24346e', calca: '#151d42' }))

/* ---------- lado direito: caminhão, motorista e mecânico ---------- */
add(caminhao(1960, 915, 0.92))
add(pessoa(1378, 1005, 0.95, { bone: '#24346e', prancheta: true, pele: PELES[2], camisa: '#3f57a6', calca: '#1a2552' }))
add(caixaFerramentas(1684, 1012))
add(pessoa(1640, 1010, 0.95, { chave: true, colete: true, capacete: true, pele: PELES[0], camisa: '#22346b' }))

/* ---------- pinos por cima de tudo ---------- */
for (const p of Object.values(PINOS)) add(pino(...p))

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Profissionais da operação logística conectados às empresas, à noite">
${partes.join('\n')}
</svg>
`
writeFileSync(saida, svg)
console.log(`fundo do login gerado: ${(svg.length / 1024).toFixed(1)} KB -> ${saida}`)
