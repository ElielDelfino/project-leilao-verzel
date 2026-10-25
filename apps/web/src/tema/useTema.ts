import { useEffect, useState } from 'react';

import {
  aplicarTema,
  consultaSistemaEscuro,
  lerTemaSalvo,
  salvarTema,
  temaDoSistema,
  type Tema,
} from './tema';

interface EstadoDoTema {
  tema: Tema;
  /** true depois que o usuário escolheu; a partir daí o sistema não muda mais o tema. */
  escolhido: boolean;
}

const inverso = (tema: Tema): Tema => (tema === 'dark' ? 'light' : 'dark');

function estadoInicial(): EstadoDoTema {
  const salvo = lerTemaSalvo();
  return salvo ? { tema: salvo, escolhido: true } : { tema: temaDoSistema(), escolhido: false };
}

export interface ControleDoTema {
  tema: Tema;
  alternar: () => void;
}

export function useTema(): ControleDoTema {
  const [estado, setEstado] = useState<EstadoDoTema>(estadoInicial);

  useEffect(() => {
    aplicarTema(estado.tema);
  }, [estado.tema]);

  // Grava fora do updater: updaters precisam ser puros (o StrictMode os executa duas vezes).
  useEffect(() => {
    if (estado.escolhido) salvarTema(estado.tema);
  }, [estado.escolhido, estado.tema]);

  useEffect(() => {
    const consulta = consultaSistemaEscuro();
    if (estado.escolhido || !consulta) return;
    const aoMudarSistema = (evento: MediaQueryListEvent) => {
      setEstado({ tema: evento.matches ? 'dark' : 'light', escolhido: false });
    };
    consulta.addEventListener('change', aoMudarSistema);
    return () => consulta.removeEventListener('change', aoMudarSistema);
  }, [estado.escolhido]);

  // Updater funcional: alternâncias seguidas partem sempre do estado mais recente.
  const alternar = () => {
    setEstado((anterior) => ({ tema: inverso(anterior.tema), escolhido: true }));
  };

  return { tema: estado.tema, alternar };
}
