import { useState, useEffect, useCallback, useRef, forwardRef, useImperativeHandle } from 'react';
import { FiPlus, FiTrash2, FiSave, FiRefreshCw, FiCheck } from 'react-icons/fi';
import { useUser } from '../contexts/UserContext';
import { useApiFetch } from '../hooks/useApiFetch';
import Toast from '../components/Toast';
import './HR.css';
import './HrPlanillaPorUnidad.css';

const UNIDADES = ['Ha', 'Jornal', 'Caja', 'Kg', 'Racimo', 'Bolsa', 'Unidad', 'Hora', 'Metro'];

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function fmtMoney(n) {
  if (!n && n !== 0) return '—';
  return '₡' + Number(n).toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function newSegId() {
  return `s${Date.now()}${Math.random().toString(36).slice(2, 5)}`;
}

function newSegmento() {
  return { id: newSegId(), loteId: '', loteNombre: '', labor: '', grupo: '', avanceHa: '', unidad: 'Ha', costoUnitario: '' };
}

const LaborCombobox = forwardRef(function LaborCombobox({ value, onChange, labores, onAfterSelect }, ref) {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const containerRef = useRef(null);
  const listRef = useRef(null);
  const inputRef = useRef(null);
  useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus() }));

  const filtered = labores.filter(l => {
    const q = (value || '').toLowerCase();
    return !q || String(l.codigo).includes(q) || (l.descripcion || '').toLowerCase().includes(q);
  });

  const selectOption = (labor) => {
    onChange(`${labor.codigo} - ${labor.descripcion}`);
    setOpen(false);
    setHighlighted(0);
    onAfterSelect?.();
  };

  const handleKeyDown = (e) => {
    if (!open) {
      if (e.key === 'ArrowDown') { setOpen(true); setHighlighted(0); e.preventDefault(); }
      return;
    }
    if (e.key === 'ArrowDown') {
      setHighlighted(h => {
        const next = Math.min(h + 1, filtered.length - 1);
        listRef.current?.children[next]?.scrollIntoView({ block: 'nearest' });
        return next;
      });
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      setHighlighted(h => {
        const next = Math.max(h - 1, 0);
        listRef.current?.children[next]?.scrollIntoView({ block: 'nearest' });
        return next;
      });
      e.preventDefault();
    } else if (e.key === 'Enter') {
      if (filtered[highlighted]) { selectOption(filtered[highlighted]); e.preventDefault(); }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  useEffect(() => {
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <input
        ref={inputRef}
        className="ut-ctrl"
        value={value}
        autoComplete="off"
        placeholder="Ej: Deshierva"
        onChange={e => { onChange(e.target.value); setOpen(true); setHighlighted(0); }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
      />
      {open && filtered.length > 0 && (
        <ul ref={listRef} className="labor-dropdown">
          {filtered.map((l, i) => (
            <li
              key={l.id}
              className={`labor-dropdown-item${i === highlighted ? ' labor-dropdown-item--active' : ''}`}
              onMouseDown={() => selectOption(l)}
              onMouseEnter={() => setHighlighted(i)}
            >
              <span className="labor-dropdown-code">{l.codigo}</span>
              <span className="labor-dropdown-desc">{l.descripcion}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});

function HrPlanillaPorHora() {
  const { currentUser } = useUser();
  const apiFetch = useApiFetch();
  const [toast, setToast] = useState(null);
  const showToast = (msg, type = 'success') => setToast({ message: msg, type });

  const [fecha, setFecha] = useState(todayStr());
  const [observaciones, setObservaciones] = useState('');
  const [segmentos, setSegmentos] = useState([newSegmento()]);
  const [trabajadores, setTrabajadores] = useState([]);
  const [cantidades, setCantidades] = useState({});
  const [fillAll, setFillAll] = useState({});
  const [lotes, setLotes] = useState([]);
  const [gruposCat, setGruposCat] = useState([]);
  const [laboresCat, setLaboresCat] = useState([]);
  const loteRefs = useRef({});
  const grupoRefs = useRef({});
  const laborRefs = useRef({});
  const avanceRefs = useRef({});
  const unidadRefs = useRef({});
  const costoRefs = useRef({});
  const cantidadRefs = useRef({});
  const nuevoSegmentoRef = useRef(null);
  const pendingFocusSegId = useRef(null);
  const [guardando, setGuardando] = useState(false);
  const [planillaId, setPlanillaId] = useState(null);
  const [consecutivo, setConsecutivo] = useState(null);
  const [historial, setHistorial] = useState([]);

  const fetchHistorial = useCallback(() => {
    apiFetch('/api/hr/planilla-unidad')
      .then(r => r.json())
      .then(data => setHistorial(data.slice(0, 12)))
      .catch(console.error);
  }, []);

  useEffect(() => {
    apiFetch('/api/lotes').then(r => r.json()).then(setLotes).catch(console.error);
    apiFetch('/api/grupos').then(r => r.json()).then(setGruposCat).catch(console.error);
    apiFetch('/api/labores').then(r => r.json()).then(setLaboresCat).catch(console.error);
    fetchHistorial();
  }, []);

  useEffect(() => {
    if (!currentUser?.userId) return;
    apiFetch(`/api/hr/subordinados?encargadoId=${currentUser.userId}`)
      .then(r => r.json())
      .then(data => {
        setTrabajadores(data);
        setCantidades(prev => {
          const next = { ...prev };
          data.forEach(t => { if (!next[t.id]) next[t.id] = {}; });
          return next;
        });
      })
      .catch(console.error);
  }, [currentUser?.userId]);

  const addSegmento = (focusNew = false) => {
    const seg = newSegmento();
    if (focusNew) pendingFocusSegId.current = seg.id;
    setSegmentos(prev => [...prev, seg]);
    setCantidades(prev => {
      const next = { ...prev };
      trabajadores.forEach(t => { next[t.id] = { ...(next[t.id] || {}), [seg.id]: '' }; });
      return next;
    });
  };

  useEffect(() => {
    if (pendingFocusSegId.current && loteRefs.current[pendingFocusSegId.current]) {
      loteRefs.current[pendingFocusSegId.current].focus();
      pendingFocusSegId.current = null;
    }
  }, [segmentos]);

  const removeSegmento = (segId) => {
    setSegmentos(prev => prev.filter(s => s.id !== segId));
    setCantidades(prev => {
      const next = {};
      Object.keys(prev).forEach(tId => {
        const { [segId]: _, ...rest } = prev[tId] || {};
        next[tId] = rest;
      });
      return next;
    });
  };

  const updSeg = (segId, field, value) => {
    setSegmentos(prev => prev.map(s => {
      if (s.id !== segId) return s;
      const u = { ...s, [field]: value };
      if (field === 'loteId') { u.loteNombre = lotes.find(l => l.id === value)?.nombreLote || ''; u.grupo = ''; }
      return u;
    }));
  };

  const setCantidad = (tId, segId, raw) => {
    setCantidades(prev => ({ ...prev, [tId]: { ...(prev[tId] || {}), [segId]: raw } }));
  };

  const applyFillAll = (segId) => {
    const val = fillAll[segId];
    if (val === '' || val === undefined) return;
    setCantidades(prev => {
      const next = { ...prev };
      trabajadores.forEach(t => {
        next[t.id] = { ...(next[t.id] || {}), [segId]: val };
      });
      return next;
    });
  };

  const getCant = (tId, segId) => {
    const v = cantidades[tId]?.[segId];
    return v === '' || v === undefined ? 0 : Number(v);
  };

  const workerTotal = (tId) =>
    segmentos.reduce((sum, seg) => sum + getCant(tId, seg.id) * (Number(seg.costoUnitario) || 0), 0);

  const segCantTotal = (segId) =>
    trabajadores.reduce((sum, t) => sum + getCant(t.id, segId), 0);

  const totalGeneral = () => trabajadores.reduce((sum, t) => sum + workerTotal(t.id), 0);

  const handleGuardar = async (estado) => {
    if (!currentUser?.userId) {
      showToast('Tu cuenta no está vinculada a un perfil de empleado en el sistema.', 'error');
      return;
    }
    setGuardando(true);
    const body = {
      fecha,
      encargadoId: currentUser.userId,
      encargadoNombre: currentUser.nombre || '',
      segmentos,
      trabajadores: trabajadores.map(t => ({
        trabajadorId: t.id, trabajadorNombre: t.nombre,
        cantidades: cantidades[t.id] || {}, total: workerTotal(t.id),
      })),
      totalGeneral: totalGeneral(),
      estado, observaciones,
    };
    try {
      let res;
      if (planillaId) {
        res = await apiFetch(`/api/hr/planilla-unidad/${planillaId}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
      } else {
        res = await apiFetch('/api/hr/planilla-unidad', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        if (res.ok) {
          const data = await res.json();
          setPlanillaId(data.id);
          setConsecutivo(data.consecutivo);
        }
      }
      if (!res.ok) throw new Error();
      showToast(estado === 'borrador' ? 'Borrador guardado.' : 'Planilla guardada correctamente.');
      fetchHistorial();
    } catch {
      showToast('Error al guardar la planilla.', 'error');
    } finally {
      setGuardando(false);
    }
  };

  const CONFIG_ROWS = 6; // lote, labor, grupo, avance, unidad, costo

  const ESTADO_LABEL = { borrador: 'Borrador', pendiente_pago: 'Pendiente', pagado: 'Pagado' };
  const ESTADO_CLASS = { borrador: 'pendiente', pendiente_pago: 'warning', pagado: 'active' };

  return (
    <div className="pu-page-layout">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* ── Columna principal (3/4) ── */}
      <div className="pu-main-col lote-management-layout">

      {/* ── Tabla unificada ── */}
      <div className="form-card pu-table-card">
        <div className="pu-table-toolbar">
          <h2 style={{ margin: 0, fontSize: '1.1rem' }}>
            Planilla por Unidad / Hora
            {consecutivo && <span className="status-badge status-badge--pendiente" style={{ marginLeft: 10 }}>{consecutivo}</span>}
          </h2>
          <button ref={nuevoSegmentoRef} className="btn btn-secondary btn-sm" onClick={() => addSegmento(true)}>
            <FiPlus size={14} /> Agregar segmento
          </button>
        </div>

        {currentUser && !currentUser.userId && (
          <div className="pu-warning">
            Tu cuenta no está vinculada a un perfil de empleado. Pide a un administrador que registre tu usuario con el mismo correo.
          </div>
        )}

        <div className="unidad-table-wrap">
          <table className="unidad-table">
            <colgroup>
              <col style={{ width: 170 }} />
              {segmentos.map(s => <col key={s.id} style={{ minWidth: 150 }} />)}
              <col style={{ width: 130 }} />
            </colgroup>
            <tbody>

              {/* ── FECHA ── */}
              <tr className="ut-row-config ut-row-header-field">
                <td className="ut-label-cell">FECHA</td>
                <td className="ut-config-cell" colSpan={segmentos.length + 1}>
                  <input
                    className="ut-ctrl ut-ctrl--date"
                    type="date"
                    value={fecha}
                    onChange={e => setFecha(e.target.value)}
                  />
                </td>
              </tr>

              {/* ── ENCARGADO ── */}
              <tr className="ut-row-config ut-row-header-field ut-row-header-field--last">
                <td className="ut-label-cell">ENCARGADO</td>
                <td className="ut-config-cell" colSpan={segmentos.length + 1}>
                  <input className="ut-ctrl input-readonly" value={currentUser?.nombre || '—'} readOnly />
                </td>
              </tr>

              {/* ── Fila de encabezados de segmento ── */}
              <tr className="ut-row-seg-title">
                <td className="ut-label-cell" />
                {segmentos.map((seg, idx) => (
                  <td key={seg.id} className="ut-seg-title-cell">
                    <span className="ut-seg-num">#{idx + 1}</span>
                    {segmentos.length > 1 && (
                      <button className="icon-btn delete ut-del-btn" onClick={() => removeSegmento(seg.id)} title="Eliminar segmento">
                        <FiTrash2 size={13} />
                      </button>
                    )}
                  </td>
                ))}
                <td className="ut-filler-cell" />
              </tr>

              {/* ── LOTE ── */}
              <tr className="ut-row-config">
                <td className="ut-label-cell">LOTE</td>
                {segmentos.map(seg => (
                  <td key={seg.id} className="ut-config-cell">
                    <select
                      ref={el => { loteRefs.current[seg.id] = el; }}
                      className="ut-ctrl" value={seg.loteId} onChange={e => {
                      updSeg(seg.id, 'loteId', e.target.value);
                      grupoRefs.current[seg.id]?.focus();
                    }}>
                      <option value="">— Seleccionar —</option>
                      {lotes.map(l => <option key={l.id} value={l.id}>{l.nombreLote}</option>)}
                    </select>
                  </td>
                ))}
                <td className="ut-filler-cell" />
              </tr>

              {/* ── GRUPO ── */}
              <tr className="ut-row-config">
                <td className="ut-label-cell">GRUPO</td>
                {segmentos.map(seg => {
                  const paqueteId = lotes.find(l => l.id === seg.loteId)?.paqueteId;
                  const gruposFiltrados = paqueteId
                    ? gruposCat.filter(g => g.paqueteId === paqueteId)
                    : gruposCat;
                  return (
                    <td key={seg.id} className="ut-config-cell">
                      <select
                        ref={el => { grupoRefs.current[seg.id] = el; }}
                        className="ut-ctrl"
                        value={seg.grupo}
                        onChange={e => {
                          updSeg(seg.id, 'grupo', e.target.value);
                          laborRefs.current[seg.id]?.focus();
                        }}
                      >
                        <option value="">— Seleccionar —</option>
                        {gruposFiltrados.map(g => (
                          <option key={g.id} value={g.nombreGrupo}>{g.nombreGrupo}</option>
                        ))}
                      </select>
                    </td>
                  );
                })}
                <td className="ut-filler-cell" />
              </tr>

              {/* ── LABOR ── */}
              <tr className="ut-row-config">
                <td className="ut-label-cell">LABOR</td>
                {segmentos.map(seg => (
                  <td key={seg.id} className="ut-config-cell">
                    <LaborCombobox
                      ref={el => { laborRefs.current[seg.id] = el; }}
                      value={seg.labor}
                      labores={laboresCat}
                      onChange={v => updSeg(seg.id, 'labor', v)}
                      onAfterSelect={() => avanceRefs.current[seg.id]?.focus()}
                    />
                  </td>
                ))}
                <td className="ut-filler-cell" />
              </tr>

              {/* ── AVANCE ── */}
              <tr className="ut-row-config">
                <td className="ut-label-cell">AVANCE (Ha)</td>
                {segmentos.map(seg => (
                  <td key={seg.id} className="ut-config-cell">
                    <input
                      ref={el => { avanceRefs.current[seg.id] = el; }}
                      className="ut-ctrl" type="number" min="0" step="0.01"
                      value={seg.avanceHa} onChange={e => updSeg(seg.id, 'avanceHa', e.target.value)}
                      placeholder="0.00"
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); unidadRefs.current[seg.id]?.focus(); } }}
                    />
                  </td>
                ))}
                <td className="ut-filler-cell" />
              </tr>

              {/* ── UNIDAD ── */}
              <tr className="ut-row-config">
                <td className="ut-label-cell">UNIDAD</td>
                {segmentos.map(seg => (
                  <td key={seg.id} className="ut-config-cell">
                    <select
                      ref={el => { unidadRefs.current[seg.id] = el; }}
                      className="ut-ctrl" value={seg.unidad}
                      onChange={e => { updSeg(seg.id, 'unidad', e.target.value); costoRefs.current[seg.id]?.focus(); }}
                    >
                      {UNIDADES.map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </td>
                ))}
                <td className="ut-filler-cell" />
              </tr>

              {/* ── COSTO UNITARIO ── */}
              <tr className="ut-row-config ut-row-config--last">
                <td className="ut-label-cell">COSTO UNITARIO</td>
                {segmentos.map(seg => (
                  <td key={seg.id} className="ut-config-cell">
                    <input
                      ref={el => { costoRefs.current[seg.id] = el; }}
                      className="ut-ctrl" type="number" min="0" step="any"
                      value={seg.costoUnitario} onChange={e => updSeg(seg.id, 'costoUnitario', e.target.value)}
                      placeholder="0"
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const firstT = trabajadores[0];
                          if (firstT) cantidadRefs.current[seg.id]?.[firstT.id]?.focus();
                        }
                      }}
                    />
                  </td>
                ))}
                <td className="ut-filler-cell" />
              </tr>

              {/* ── Encabezado de sección trabajadores ── */}
              <tr className="ut-row-workers-header">
                <td className="ut-label-cell">NOMBRE</td>
                {segmentos.map(seg => (
                  <td key={seg.id} className="ut-workers-col-header">
                    <div className="ut-col-header-label">Cantidad</div>
                    <div className="ut-fill-all">
                      <input
                        type="number"
                        step="any"
                        min="0"
                        placeholder="= todos"
                        className="ut-fill-input"
                        value={fillAll[seg.id] ?? ''}
                        onChange={e => setFillAll(prev => ({ ...prev, [seg.id]: e.target.value }))}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            applyFillAll(seg.id);
                            cantidadRefs.current[seg.id]?.[trabajadores[0]?.id]?.focus();
                          }
                        }}
                      />
                      <button
                        className="ut-fill-btn"
                        title="Aplicar a todos"
                        onClick={() => applyFillAll(seg.id)}
                      >
                        <FiCheck size={11} />
                      </button>
                    </div>
                  </td>
                ))}
                <td className="ut-workers-col-header ut-total-col-header">TOTAL GENERAL</td>
              </tr>

              {/* ── Trabajadores ── */}
              {trabajadores.length === 0 ? (
                <tr>
                  <td colSpan={segmentos.length + 2} className="ut-empty-row">
                    No hay trabajadores asignados. Ve a <strong>Gestión de Usuarios</strong> y selecciona este encargado en la ficha de cada trabajador.
                  </td>
                </tr>
              ) : (
                trabajadores.map(t => (
                  <tr key={t.id} className="ut-row-worker">
                    <td className="ut-worker-name">{t.nombre}</td>
                    {segmentos.map(seg => (
                      <td key={seg.id} className="ut-cant-cell">
                        <input
                          ref={el => {
                            if (!cantidadRefs.current[seg.id]) cantidadRefs.current[seg.id] = {};
                            cantidadRefs.current[seg.id][t.id] = el;
                          }}
                          type="number" min="0" step="0.01"
                          value={cantidades[t.id]?.[seg.id] ?? ''}
                          onChange={e => setCantidad(t.id, seg.id, e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              const idx = trabajadores.findIndex(w => w.id === t.id);
                              const nextWorker = trabajadores[idx + 1];
                              if (nextWorker) {
                                cantidadRefs.current[seg.id]?.[nextWorker.id]?.focus();
                              } else {
                                const segIdx = segmentos.findIndex(s => s.id === seg.id);
                                const nextSeg = segmentos[segIdx + 1];
                                if (nextSeg) {
                                  loteRefs.current[nextSeg.id]?.focus();
                                } else {
                                  nuevoSegmentoRef.current?.focus();
                                }
                              }
                            }
                          }}
                          className="ut-cant-input"
                          placeholder="0"
                        />
                      </td>
                    ))}
                    <td className="ut-worker-total">{fmtMoney(workerTotal(t.id))}</td>
                  </tr>
                ))
              )}

              {/* ── Fila de totales ── */}
              {trabajadores.length > 0 && (
                <tr className="ut-row-totals">
                  <td className="ut-label-cell">TOTALES</td>
                  {segmentos.map(seg => (
                    <td key={seg.id} className="ut-cant-cell ut-total-cant">
                      {segCantTotal(seg.id) > 0
                        ? segCantTotal(seg.id).toLocaleString('es-CR', { maximumFractionDigits: 2 })
                        : '—'}
                    </td>
                  ))}
                  <td className="ut-worker-total ut-grand-total">{fmtMoney(totalGeneral())}</td>
                </tr>
              )}

            </tbody>
          </table>
        </div>

        <div className="form-control" style={{ marginTop: 16 }}>
          <label>Observaciones</label>
          <textarea value={observaciones} onChange={e => setObservaciones(e.target.value)} placeholder="Notas adicionales..." rows={3} />
        </div>
        <div className="form-actions" style={{ marginTop: 14 }}>
          <button className="btn btn-secondary" onClick={() => handleGuardar('borrador')} disabled={guardando}>
            Guardar borrador
          </button>
          <button className="btn btn-primary" onClick={() => handleGuardar('pendiente_pago')} disabled={guardando || trabajadores.length === 0}>
            <FiSave size={15} />
            {guardando ? 'Guardando…' : 'Guardar planilla'}
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => {
              setSegmentos([newSegmento()]);
              setCantidades({});
              setFecha(todayStr());
              setObservaciones('');
              setPlanillaId(null);
              setConsecutivo(null);
            }}
            disabled={guardando}
          >
            Limpiar
          </button>
        </div>
      </div>
      </div>{/* /pu-main-col */}

      {/* ── Historial (1/4) ── */}
      <div className="pu-history-col">
        <div className="form-card pu-history-card">
          <div className="pu-history-header">
            <h3 style={{ margin: 0, fontSize: '0.95rem' }}>Últimas planillas</h3>
            <button className="icon-btn" onClick={fetchHistorial} title="Actualizar">
              <FiRefreshCw size={14} />
            </button>
          </div>

          {historial.length === 0 ? (
            <p className="empty-state" style={{ margin: '12px 0 0', fontSize: '0.82rem' }}>
              No hay planillas guardadas.
            </p>
          ) : (
            <ul className="pu-history-list">
              {historial.map(p => (
                <li key={p.id} className="pu-history-item">
                  <div className="pu-history-top">
                    <span className="pu-history-consec">{p.consecutivo || '—'}</span>
                    <span className={`status-badge status-badge--${ESTADO_CLASS[p.estado] || 'pendiente'}`}>
                      {ESTADO_LABEL[p.estado] || p.estado}
                    </span>
                  </div>
                  <div className="pu-history-encargado">{p.encargadoNombre || '—'}</div>
                  <div className="pu-history-meta">
                    {p.fecha ? new Date(p.fecha).toLocaleDateString('es-CR') : '—'}
                    {' · '}
                    {p.segmentos?.length || 0} segmento{p.segmentos?.length !== 1 ? 's' : ''}
                    {' · '}
                    {p.trabajadores?.length || 0} trab.
                  </div>
                  <div className="pu-history-total">
                    ₡{Number(p.totalGeneral || 0).toLocaleString('es-CR')}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

    </div>
  );
}

export default HrPlanillaPorHora;
