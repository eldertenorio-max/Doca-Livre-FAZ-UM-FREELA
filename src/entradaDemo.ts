// Importado antes de tudo no main.tsx, antes de o app ler o modo (estado salvo, cliente do banco e login dependem
// dele). No desenvolvimento, /demo ou ?demo entram na demonstração; no site publicado a demonstração não existe mais
// e este passo só limpa o que ela tinha deixado no navegador.
import { entrarNaDemoPeloLink } from './lib/modo'

entrarNaDemoPeloLink()
