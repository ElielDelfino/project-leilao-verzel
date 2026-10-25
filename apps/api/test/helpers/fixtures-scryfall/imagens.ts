// Imagens mínimas para a Scryfall falsa (task 052). O limite do snapshot é 1 MB e só JPEG/PNG
// (specs/005 §Comportamento), então os testes precisam de bytes reais de cada formato.

/** JPEG 1x1 (SOI, JFIF, quantização, frame, huffman, scan); o EOI (FF D9) é acrescentado abaixo. */
const JPEG_1X1_BASE64 =
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////' +
  '////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

/** PNG 1x1 RGB (assinatura, IHDR, IDAT e IEND com CRCs válidos). */
const PNG_1X1_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';

/** GIF 1x1: formato que a API deve recusar (só JPEG e PNG). */
const GIF_1X1_BASE64 = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

export const LIMITE_IMAGEM_BYTES = 1_048_576;

export const JPEG_MINIMO: Buffer = Buffer.concat([
  Buffer.from(JPEG_1X1_BASE64, 'base64'),
  Buffer.from([0xff, 0xd9]),
]);
export const PNG_MINIMO: Buffer = Buffer.from(PNG_1X1_BASE64, 'base64');
export const GIF_MINIMO: Buffer = Buffer.from(GIF_1X1_BASE64, 'base64');

/** JPEG com 1 byte a mais que o limite: preenchimento entre o corpo e o EOI. */
export function jpegGrande(): Buffer {
  const corpo = JPEG_MINIMO.subarray(0, JPEG_MINIMO.length - 2);
  const preenchimento = Buffer.alloc(LIMITE_IMAGEM_BYTES + 1 - JPEG_MINIMO.length);
  return Buffer.concat([corpo, preenchimento, Buffer.from([0xff, 0xd9])]);
}
