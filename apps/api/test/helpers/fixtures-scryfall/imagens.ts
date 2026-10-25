// Imagens mínimas para a Scryfall falsa (task 052). O limite do snapshot é 1 MB e só JPEG/PNG
// (specs/005 §Comportamento), então os testes precisam de bytes reais de cada formato.

/**
 * JPEG 1x1 baseline (JFIF, DQT, SOF0, DHT, SOS e EOI), gerado com Pillow
 * (`Image.new('RGB', (1, 1)).save(..., 'JPEG', progressive=False)`).
 */
const JPEG_1X1_BASE64 =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDg' +
  'sLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQU' +
  'FBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAw' +
  'QFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkK' +
  'FhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmq' +
  'KjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEB' +
  'AQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRob' +
  'HBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOE' +
  'hYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+P' +
  'n6/9oADAMBAAIRAxEAPwDwKiiivzI/uM//2Q==';

/** PNG 1x1 RGB (assinatura, IHDR, IDAT e IEND com CRCs válidos). */
const PNG_1X1_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';

/** GIF 1x1: formato que a API deve recusar (só JPEG e PNG). */
const GIF_1X1_BASE64 = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

export const LIMITE_IMAGEM_BYTES = 1_048_576;

export const JPEG_MINIMO: Buffer = Buffer.from(JPEG_1X1_BASE64, 'base64');
export const PNG_MINIMO: Buffer = Buffer.from(PNG_1X1_BASE64, 'base64');
export const GIF_MINIMO: Buffer = Buffer.from(GIF_1X1_BASE64, 'base64');

/** JPEG com exatamente `tamanho` bytes: preenchimento entre o corpo e o EOI. */
export function jpegDeTamanho(tamanho: number): Buffer {
  const corpo = JPEG_MINIMO.subarray(0, JPEG_MINIMO.length - 2);
  const preenchimento = Buffer.alloc(tamanho - JPEG_MINIMO.length);
  return Buffer.concat([corpo, preenchimento, Buffer.from([0xff, 0xd9])]);
}

/** JPEG com 1 byte a mais que o limite. */
export function jpegGrande(): Buffer {
  return jpegDeTamanho(LIMITE_IMAGEM_BYTES + 1);
}
