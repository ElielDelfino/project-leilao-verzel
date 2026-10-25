// Scryfall falsa como processo para o e2e (task 052). Uso:
//   node --import apps/api/src/db/resolver-ts.mjs e2e/apoio/scryfall-falsa-servidor.ts [porta]
// Aponte a API para ele com SCRYFALL_BASE_URL=http://127.0.0.1:<porta>. O modo e o contador ficam
// em /__controle: GET lê {modo,total,requisicoes}; POST {"modo":"429"} ou {"zerar":true} altera.
import { iniciarScryfallFalsa } from '../../apps/api/test/helpers/scryfall-falsa.js';

const PORTA_MAXIMA = 65_535;
const argumento = process.argv[2];
const porta = argumento === undefined ? 0 : Number(argumento);
if (!Number.isInteger(porta) || porta < 0 || porta > PORTA_MAXIMA) {
  process.stderr.write('scryfall-falsa: porta inválida\n');
  process.exit(2);
}

const falsa = await iniciarScryfallFalsa({ porta, controle: true });
process.stdout.write(`scryfall-falsa em ${falsa.url}\n`);

const encerrar = () => {
  void falsa.fechar().finally(() => process.exit(0));
};
process.once('SIGTERM', encerrar);
process.once('SIGINT', encerrar);
