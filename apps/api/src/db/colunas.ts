// Tipos de coluna do Postgres que o drizzle-orm 0.45 não traz em pg-core (tarefa 037). Os schema.ts
// dos módulos importam daqui; o drizzle-kit só lê os schema.ts e gera o SQL com o nome do tipo.
import { customType } from 'drizzle-orm/pg-core';

/** `citext` (extensão criada na 0000): texto comparado sem diferenciar maiúsculas. */
export const citext = customType<{ data: string; driverData: string }>({
  dataType: () => 'citext',
});

/** `bytea`: o `pg` devolve e aceita Buffer. */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});
