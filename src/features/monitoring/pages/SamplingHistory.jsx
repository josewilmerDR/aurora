import { useState, useEffect, useMemo } from 'react';
import { FiTrash2, FiImage, FiDownload } from 'react-icons/fi';
import Toast from '../../../components/Toast';
import AuroraConfirmModal from '../../../components/AuroraConfirmModal';
import ImageLightbox from '../../../components/ImageLightbox';
import { useApiFetch } from '../../../hooks/useApiFetch';
import '../styles/monitoring.css';

function SamplingHistory() {
  const apiFetch = useApiFetch();
  const [allRegistros, setAllRegistros] = useState([]);
  const [lotes, setLotes]               = useState([]);
  const [tipos, setTipos]               = useState([]);
  const [filtros, setFiltros]           = useState({ loteId: '', tipoId: '', desde: '', hasta: '' });
  const [loading, setLoading]           = useState(false);
  const [toast, setToast]               = useState(null);
  const [tipoCampos, setTipoCampos]     = useState([]);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [lightbox, setLightbox] = useState(null); // { src, caption }
  const showToast = (message, type = 'success') => setToast({ message, type });

  useEffect(() => {
    apiFetch('/api/lotes').then(r => r.json()).then(setLotes).catch(console.error);
    apiFetch('/api/monitoreo/tipos').then(r => r.json()).then(setTipos).catch(console.error);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const fetchData = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (filtros.loteId) params.set('loteId', filtros.loteId);
        if (filtros.tipoId) params.set('tipoId', filtros.tipoId);
        if (filtros.desde)  params.set('desde',  filtros.desde);
        if (filtros.hasta)  params.set('hasta',  filtros.hasta);
        const data = await apiFetch(`/api/monitoreo?${params}`).then(r => r.json());
        if (!cancelled) setAllRegistros(Array.isArray(data) ? data : []);
      } catch {
        if (!cancelled) showToast('Error al cargar registros.', 'error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchData();
    return () => { cancelled = true; };
  }, [filtros.loteId, filtros.tipoId, filtros.desde, filtros.hasta]);

  useEffect(() => {
    if (!filtros.tipoId) { setTipoCampos([]); return; }
    let cancelled = false;
    apiFetch(`/api/monitoreo/tipos/${filtros.tipoId}`)
      .then(r => r.json())
      .then(t => { if (!cancelled) setTipoCampos(Array.isArray(t.campos) ? t.campos : []); })
      .catch(() => { if (!cancelled) setTipoCampos([]); });
    return () => { cancelled = true; };
  }, [filtros.tipoId]);

  const registros = allRegistros;

  // When a tipo filter is active, expand each monitoreo into one row per registro.
  // Common columns (dates, names) only shown on the first sub-row.
  const displayRows = useMemo(() => {
    if (!tipoCampos.length) {
      return registros.map(r => ({ mon: r, reg: null, isFirst: true }));
    }
    const rows = [];
    for (const r of registros) {
      const regs = r.formularioData?.registros;
      if (Array.isArray(regs) && regs.length > 0) {
        regs.forEach((reg, i) => rows.push({ mon: r, reg, isFirst: i === 0, regIdx: i, regTotal: regs.length }));
      } else {
        const reg = r.formularioData?.datos || null;
        rows.push({ mon: r, reg, isFirst: true, regIdx: null, regTotal: 1 });
      }
    }
    return rows;
  }, [registros, tipoCampos]);

  const handleFiltro = (e) => setFiltros(prev => ({ ...prev, [e.target.name]: e.target.value }));

  const doDeleteRegistro = async (monId, regIdx, regTotal) => {
    const esTodo = regTotal <= 1 || regIdx === null;
    try {
      if (esTodo) {
        const res = await apiFetch(`/api/monitoreo/${monId}`, { method: 'DELETE' });
        if (!res.ok) throw new Error();
        setAllRegistros(prev => prev.filter(r => r.id !== monId));
      } else {
        const res = await apiFetch(`/api/monitoreo/${monId}/registros/${regIdx}`, { method: 'DELETE' });
        if (!res.ok) throw new Error();
        const data = await res.json();
        if (data.deleted === 'monitoreo') {
          setAllRegistros(prev => prev.filter(r => r.id !== monId));
        } else {
          setAllRegistros(prev => prev.map(r =>
            r.id === monId
              ? { ...r, formularioData: { ...r.formularioData, registros: data.registros } }
              : r
          ));
        }
      }
      showToast('Eliminado correctamente.');
    } catch {
      showToast('Error al eliminar.', 'error');
    }
  };

  const fmt = (iso) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('es-CR', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  const getDynCell = (reg, campoNombre) => {
    if (!reg) return '—';
    const val = reg[campoNombre];
    return (val !== undefined && val !== '') ? val : '—';
  };

  const csvCell = (v) => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const handleExportCSV = () => {
    const headers = [
      'F. Programada', 'F. Carga', 'Muestreador', 'Supervisor',
      'Lote', 'Grupo', 'Notas',
      ...tipoCampos.map(c => c.nombre),
    ];
    const rows = displayRows.map(({ mon: r, reg }) => [
      fmt(r.fecha),
      fmt(r.createdAt),
      r.responsableNombre || '',
      r.supervisorNombre || '',
      r.loteNombre || '',
      r.bloque || '',
      r.observaciones || '',
      ...tipoCampos.map(c => reg?.[c.nombre] ?? ''),
    ]);
    const csv = [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n');
    // BOM (U+FEFF) para que Excel lea acentos correctamente
    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const today = new Date().toISOString().split('T')[0];
    const a = document.createElement('a');
    a.href = url;
    a.download = `muestreos-${today}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mh-page">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <header className="mh-page-header">
        <h2 className="mh-page-title">Historial de muestreos</h2>
        <p className="mh-page-subtitle">
          Consulta los muestreos realizados, filtra por lote, tipo y fechas, y exporta los resultados a CSV.
        </p>
      </header>

      {/* Filtros */}
      <section className="aur-section mh-filtros-section">
        <div className="aur-section-header">
          <h3>Filtros</h3>
        </div>
        <div className="monitoreo-filtros">
          <div className="aur-field">
            <label className="aur-field-label" htmlFor="filt-lote">Lote</label>
            <select id="filt-lote" className="aur-select" name="loteId" value={filtros.loteId} onChange={handleFiltro}>
              <option value="">Todos</option>
              {lotes.map(l => <option key={l.id} value={l.id}>{l.nombreLote}</option>)}
            </select>
          </div>
          <div className="aur-field">
            <label className="aur-field-label" htmlFor="filt-tipo">Tipo</label>
            <select id="filt-tipo" className="aur-select" name="tipoId" value={filtros.tipoId} onChange={handleFiltro}>
              <option value="">Todos</option>
              {tipos.map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}
            </select>
          </div>
          <div className="aur-field">
            <label className="aur-field-label" htmlFor="filt-desde">Desde</label>
            <input id="filt-desde" className="aur-input" type="date" name="desde" value={filtros.desde} onChange={handleFiltro} />
          </div>
          <div className="aur-field">
            <label className="aur-field-label" htmlFor="filt-hasta">Hasta</label>
            <input id="filt-hasta" className="aur-input" type="date" name="hasta" value={filtros.hasta} onChange={handleFiltro} />
          </div>
        </div>
      </section>

      {/* Tabla */}
      <section className="aur-section">
        <div className="aur-section-header">
          <h3>Registros</h3>
          <span className="aur-section-count">{displayRows.length}</span>
          <button
            type="button"
            className="aur-btn-pill aur-btn-pill--sm"
            style={{ marginLeft: 'auto' }}
            onClick={handleExportCSV}
            disabled={displayRows.length === 0}
            title="Descargar los registros filtrados como CSV"
          >
            <FiDownload size={14} /> Exportar CSV
          </button>
        </div>

        {loading ? (
          <div className="mon-loading" />
        ) : displayRows.length === 0 ? (
          <div className="mh-state mh-state--empty">
            No hay muestreos registrados para los filtros seleccionados.
          </div>
        ) : (
          <div className="aur-table-wrap">
            <table className="aur-table mh-historial-table">
              <thead>
                <tr>
                  <th>F. Programada</th>
                  <th>F. Carga</th>
                  <th>Muestreador</th>
                  <th>Supervisor</th>
                  <th>Lote</th>
                  <th>Grupo</th>
                  <th>Notas</th>
                  {tipoCampos.map(c => (
                    <th key={c.nombre} className="mh-th-dyn">
                      {c.nombre}
                    </th>
                  ))}
                  <th className="mh-th-actions" aria-hidden="true" />
                </tr>
              </thead>
              <tbody>
                {displayRows.map((row, rowIdx) => {
                  const { mon: r, reg, isFirst, regIdx, regTotal } = row;
                  const isMultiRow = regTotal > 1;
                  const isSub = !isFirst;
                  const rowClass = [
                    'mh-data-row',
                    isSub && 'mh-data-row--sub',
                    isMultiRow && 'mh-data-row--group',
                    isFirst && isMultiRow && 'mh-data-row--group-start',
                  ].filter(Boolean).join(' ');
                  return (
                    <tr key={`${r.id}-${rowIdx}`} className={rowClass}>
                      <td className="mh-td-fecha">
                        {isSub ? (
                          <span className="mh-sub-marker">↳ {regIdx + 1}/{regTotal}</span>
                        ) : (
                          <>
                            {fmt(r.fecha)}
                            {isMultiRow && (
                              <span className="mh-multi-badge">1/{regTotal}</span>
                            )}
                          </>
                        )}
                      </td>
                      <td>{isSub ? '' : fmt(r.createdAt)}</td>
                      <td>{isSub ? '' : (r.responsableNombre || '—')}</td>
                      <td>{isSub ? '' : (r.supervisorNombre || '—')}</td>
                      <td>{isSub ? '' : (r.loteNombre || '—')}</td>
                      <td>{isSub ? '' : (r.bloque || '—')}</td>
                      <td className="mh-td-notas" title={isSub ? undefined : (r.observaciones || undefined)}>
                        {isSub ? '' : (r.observaciones || '')}
                      </td>
                      {tipoCampos.map(c => (
                        <td key={c.nombre} className="mh-td-dyn">{getDynCell(reg, c.nombre)}</td>
                      ))}
                      <td className="mh-td-actions">
                        {isFirst && r.scanImageUrl && (
                          <button
                            type="button"
                            className="mh-img-btn"
                            onClick={() => setLightbox({
                              src: r.scanImageUrl,
                              caption: `${r.loteNombre || 'Registro'} · ${fmt(r.fecha)}`,
                            })}
                            title="Ver imagen de escaneo"
                          >
                            <FiImage size={13} />
                          </button>
                        )}
                        <button
                          type="button"
                          className="aur-icon-btn aur-icon-btn--sm aur-icon-btn--danger"
                          onClick={() => setConfirmDelete({ monId: r.id, regIdx, regTotal })}
                          title={regTotal > 1 && regIdx !== null ? 'Eliminar esta línea' : 'Eliminar registro'}
                        >
                          <FiTrash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {lightbox && (
        <ImageLightbox
          src={lightbox.src}
          caption={lightbox.caption}
          openUrl={lightbox.src}
          onClose={() => setLightbox(null)}
        />
      )}

      {confirmDelete && (
        <AuroraConfirmModal
          danger
          title={confirmDelete.regTotal > 1 && confirmDelete.regIdx !== null
            ? 'Eliminar línea'
            : 'Eliminar registro'}
          body={confirmDelete.regTotal > 1 && confirmDelete.regIdx !== null
            ? '¿Eliminar esta línea del registro de muestreo?'
            : '¿Eliminar este registro completo? No se puede deshacer.'}
          confirmLabel="Eliminar"
          onConfirm={() => {
            doDeleteRegistro(confirmDelete.monId, confirmDelete.regIdx, confirmDelete.regTotal);
            setConfirmDelete(null);
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

export default SamplingHistory;
