import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import '../styles/payroll-hub.css';

// Hub compartido por las dos páginas de planilla (fija / por unidad). Renderiza
// un tab strip con el patrón WAI-ARIA completo (roving tabindex + flechas +
// tabpanel) y mantiene el panel Editor montado siempre para preservar su estado
// al ir y volver del historial. El panel Historial se monta perezosamente la
// primera vez que se abre y luego permanece montado: así evitamos su fetch
// inicial (y el doble fetch de /api/hr/planilla-fijo) cuando el usuario solo
// usa el Editor. El tab activo se deriva de ?tab= (fuente única) para que los
// deep-links y el "Volver" desde el reporte aterricen en el mismo tab.
//
// Props:
//   ariaLabel    string  · etiqueta del tablist
//   heading      string  · título de página (sr-only, da contexto al lector)
//   idBase       string  · prefijo único para los ids tab/panel
//   historyLabel string  · etiqueta visible del segundo tab (default "Historial")
//   editor       node    · contenido del tab Editor
//   history      node    · contenido del tab Historial
export default function PayrollHub({ ariaLabel, heading, idBase, historyLabel = 'Historial', editor, history }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') === 'historial' ? 'historial' : 'editor';

  // El Editor está siempre montado; el Historial se monta al abrirlo por
  // primera vez y se mantiene montado para no perder su estado/scroll.
  const [historyMounted, setHistoryMounted] = useState(tab === 'historial');
  useEffect(() => { if (tab === 'historial') setHistoryMounted(true); }, [tab]);

  const tabsRef = useRef([]);

  const TABS = [
    { key: 'editor', label: 'Editor' },
    { key: 'historial', label: historyLabel },
  ];

  const selectTab = (next) => {
    setSearchParams(prev => {
      const params = new URLSearchParams(prev);
      params.set('tab', next);
      return params;
    }, { replace: true });
  };

  // Navegación con flechas / Home / End dentro del tablist (WAI-ARIA tabs).
  const onTabKeyDown = (e, idx) => {
    let nextIdx = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') nextIdx = (idx + 1) % TABS.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') nextIdx = (idx - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') nextIdx = 0;
    else if (e.key === 'End') nextIdx = TABS.length - 1;
    if (nextIdx === null) return;
    e.preventDefault();
    selectTab(TABS[nextIdx].key);
    tabsRef.current[nextIdx]?.focus();
  };

  return (
    <div className="payroll-hub">
      {heading && <h1 className="aur-sr-only">{heading}</h1>}
      <nav className="payroll-hub-tabs" role="tablist" aria-label={ariaLabel}>
        {TABS.map((t, idx) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              ref={el => { tabsRef.current[idx] = el; }}
              type="button"
              role="tab"
              id={`${idBase}-tab-${t.key}`}
              aria-selected={active}
              aria-controls={`${idBase}-panel-${t.key}`}
              tabIndex={active ? 0 : -1}
              className={`payroll-hub-tab${active ? ' is-active' : ''}`}
              onClick={() => selectTab(t.key)}
              onKeyDown={e => onTabKeyDown(e, idx)}
            >
              {t.label}
            </button>
          );
        })}
      </nav>
      <div className="payroll-hub-body">
        <div
          id={`${idBase}-panel-editor`}
          role="tabpanel"
          aria-labelledby={`${idBase}-tab-editor`}
          tabIndex={0}
          className={`payroll-hub-pane${tab === 'editor' ? '' : ' is-hidden'}`}
        >
          {editor}
        </div>
        <div
          id={`${idBase}-panel-historial`}
          role="tabpanel"
          aria-labelledby={`${idBase}-tab-historial`}
          tabIndex={0}
          className={`payroll-hub-pane${tab === 'historial' ? '' : ' is-hidden'}`}
        >
          {historyMounted && history}
        </div>
      </div>
    </div>
  );
}
