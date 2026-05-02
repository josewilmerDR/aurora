import { useState, useEffect, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { FiEdit, FiTrash2 } from 'react-icons/fi';
import Toast from '../../../components/Toast';
import AuroraConfirmModal from '../../../components/AuroraConfirmModal';
import AuroraDataTable from '../../../components/AuroraDataTable';
import { useApiFetch } from '../../../hooks/useApiFetch';
import '../styles/machinery.css';

const COLUMNS = [
  { key: 'fecha',             label: 'Fecha',             type: 'date'   },
  { key: 'tractorNombre',     label: 'Tractor',           type: 'text'   },
  { key: 'implemento',        label: 'Implemento',        type: 'text'   },
  { key: 'horimetroInicial',  label: 'Horímetro inicial', type: 'number', align: 'right' },
  { key: 'horimetroFinal',    label: 'Horímetro final',   type: 'number', align: 'right' },
  { key: 'horas',             label: 'Horas',             sortable: false, align: 'right' },
  { key: 'montoDepTractor',   label: 'Monto dep. tractor',    type: 'number', align: 'right' },
  { key: 'montoDepImplemento', label: 'Monto dep. implemento', type: 'number', align: 'right' },
  { key: 'combTasaLH',        label: 'Tasa (L/H)',        sortable: false, align: 'right' },
  { key: 'combPrecio',        label: 'Precio comb.',      sortable: false, align: 'right' },
  { key: 'combLitros',        label: 'Litros est.',       sortable: false, align: 'right' },
  { key: 'combCosto',         label: 'Costo est.',        sortable: false, align: 'right' },
  { key: 'loteNombre',        label: 'Lote',              type: 'text'   },
  { key: 'grupo',             label: 'Grupo',             type: 'text'   },
  { key: 'bloque',            label: 'Bloque',            sortable: false },
  { key: 'labor',             label: 'Labor',             type: 'text'   },
  { key: 'horaInicio',        label: 'Hora inicial',      type: 'text'   },
  { key: 'horaFinal',         label: 'Hora final',        type: 'text'   },
  { key: 'operarioNombre',    label: 'Operario',          type: 'text'   },
];

function horasUsadas(rec) {
  const ini = parseFloat(rec.horimetroInicial);
  const fin = parseFloat(rec.horimetroFinal);
  if (!isNaN(ini) && !isNaN(fin) && fin >= ini) return parseFloat((fin - ini).toFixed(1));
  return null;
}

function costoDepHoraNum(asset) {
  if (!asset) return null;
  const a = parseFloat(asset.valorAdquisicion);
  const r = parseFloat(asset.valorResidual);
  const h = parseFloat(asset.vidaUtilHoras);
  if (!isNaN(a) && !isNaN(r) && !isNaN(h) && h > 0) return (a - r) / h;
  return null;
}

function getColVal(r, key) {
  switch (key) {
    case 'fecha':              return r.fecha?.slice(0, 10) || '';
    case 'tractorNombre':      return (r.tractorNombre || '').toLowerCase();
    case 'implemento':         return (r.implemento || '').toLowerCase();
    case 'horimetroInicial':   return Number(r.horimetroInicial) || 0;
    case 'horimetroFinal':     return Number(r.horimetroFinal) || 0;
    case 'montoDepTractor':    return Number(r.montoDepTractor) || 0;
    case 'montoDepImplemento': return Number(r.montoDepImplemento) || 0;
    case 'loteNombre':         return (r.loteNombre || '').toLowerCase();
    case 'grupo':              return (r.grupo || '').toLowerCase();
    case 'labor':              return (r.labor || '').toLowerCase();
    case 'horaInicio':         return r.horaInicio || '';
    case 'horaFinal':          return r.horaFinal || '';
    case 'operarioNombre':     return (r.operarioNombre || '').toLowerCase();
    default:                   return '';
  }
}

export default function HistorialHorimetros() {
  const apiFetch = useApiFetch();
  const navigate = useNavigate();

  const [records,    setRecords]    = useState([]);
  const [maquinaria, setMaquinaria] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null); // { id, fecha, tractor }
  const [deleting, setDeleting] = useState(false);

  const showToast = (message, type = 'success') => setToast({ message, type });

  const fetchRecords = () =>
    Promise.all([
      apiFetch('/api/horimetro').then(r => r.json()),
      apiFetch('/api/maquinaria').then(r => r.json()),
    ])
      .then(([horimetros, maq]) => {
        setRecords(Array.isArray(horimetros) ? horimetros : []);
        setMaquinaria(Array.isArray(maq) ? maq : []);
      })
      .catch(() => showToast('Error al cargar los registros.', 'error'))
      .finally(() => setLoading(false));

  useEffect(() => { fetchRecords(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleEdit = (rec) => {
    navigate('/operaciones/horimetro/registro', { state: { editRecord: rec } });
  };

  const doDelete = async () => {
    if (!confirmDelete) return;
    const { id } = confirmDelete;
    setDeleting(true);
    try {
      const res = await apiFetch(`/api/horimetro/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      setConfirmDelete(null);
      showToast('Registro eliminado.');
      fetchRecords();
    } catch {
      showToast('Error al eliminar.', 'error');
    } finally {
      setDeleting(false);
    }
  };

  // ── Enrich records with computed depreciation ─────────────────────────────
  const enrichedRecords = useMemo(() => {
    const maqById = Object.fromEntries(maquinaria.map(m => [m.id, m]));
    return records.map(rec => {
      const hrsNum = horasUsadas(rec);

      const costoTractor    = costoDepHoraNum(maqById[rec.tractorId]);
      const montoDepTractor = hrsNum != null && costoTractor != null
        ? parseFloat((hrsNum * costoTractor).toFixed(2)) : null;

      const costoImplemento    = costoDepHoraNum(maqById[rec.implementoId]);
      const montoDepImplemento = hrsNum != null && costoImplemento != null
        ? parseFloat((hrsNum * costoImplemento).toFixed(2)) : null;

      const comb       = rec.combustible;
      const combTasaLH = comb?.tasaLH         ?? null;
      const combPrecio = comb?.precioUnitario ?? null;
      const combLitros = comb?.litrosEstimados ?? null;
      const combCosto  = comb?.costoEstimado   ?? null;

      const bloque = rec.bloques?.length ? rec.bloques.join(', ') : (rec.bloque || '');
      return {
        ...rec,
        horas: hrsNum,
        bloque,
        montoDepTractor,
        montoDepImplemento,
        combTasaLH,
        combPrecio,
        combLitros,
        combCosto,
      };
    });
  }, [records, maquinaria]);

  // ── Render row ────────────────────────────────────────────────────────────
  const renderRow = (rec, visibleCols) => {
    const empty = <span className="machinery-td-empty">—</span>;
    const fmtCurrency = (n) =>
      n != null ? n.toLocaleString('es-CR', { minimumFractionDigits: 2 }) : null;
    return (
      <>
        {visibleCols.fecha             && <td>{rec.fecha || empty}</td>}
        {visibleCols.tractorNombre     && <td>{rec.tractorNombre || empty}</td>}
        {visibleCols.implemento        && <td>{rec.implemento    || empty}</td>}
        {visibleCols.horimetroInicial  && <td className="machinery-td-num">{rec.horimetroInicial !== '' && rec.horimetroInicial != null ? rec.horimetroInicial : empty}</td>}
        {visibleCols.horimetroFinal    && <td className="machinery-td-num">{rec.horimetroFinal   !== '' && rec.horimetroFinal   != null ? rec.horimetroFinal   : empty}</td>}
        {visibleCols.horas             && <td className="machinery-td-num">{rec.horas != null ? <strong style={{ color: 'var(--aur-accent)' }}>{rec.horas.toFixed(1)}</strong> : empty}</td>}
        {visibleCols.montoDepTractor   && <td className="machinery-td-num">{fmtCurrency(rec.montoDepTractor) ?? empty}</td>}
        {visibleCols.montoDepImplemento && <td className="machinery-td-num">{fmtCurrency(rec.montoDepImplemento) ?? empty}</td>}
        {visibleCols.combTasaLH && <td className="machinery-td-num">{rec.combTasaLH != null ? rec.combTasaLH.toFixed(2) : empty}</td>}
        {visibleCols.combPrecio && <td className="machinery-td-num">{fmtCurrency(rec.combPrecio) ?? empty}</td>}
        {visibleCols.combLitros && <td className="machinery-td-num">{rec.combLitros != null ? rec.combLitros.toFixed(2) : empty}</td>}
        {visibleCols.combCosto  && <td className="machinery-td-num">{fmtCurrency(rec.combCosto)  ?? empty}</td>}
        {visibleCols.loteNombre     && <td>{rec.loteNombre || empty}</td>}
        {visibleCols.grupo          && <td>{rec.grupo      || empty}</td>}
        {visibleCols.bloque         && <td>{rec.bloque     || empty}</td>}
        {visibleCols.labor          && <td>{rec.labor      || empty}</td>}
        {visibleCols.horaInicio     && <td>{rec.horaInicio || empty}</td>}
        {visibleCols.horaFinal      && <td>{rec.horaFinal  || empty}</td>}
        {visibleCols.operarioNombre && <td>{rec.operarioNombre || empty}</td>}
      </>
    );
  };

  const trailingCell = (rec) => (
    <td className="machinery-td-actions">
      <button type="button" className="aur-icon-btn aur-icon-btn--sm" onClick={() => handleEdit(rec)} title="Editar">
        <FiEdit size={13} />
      </button>
      <button
        type="button"
        className="aur-icon-btn aur-icon-btn--sm aur-icon-btn--danger"
        onClick={() => setConfirmDelete({ id: rec.id, fecha: rec.fecha, tractor: rec.tractorNombre })}
        title="Eliminar"
      >
        <FiTrash2 size={13} />
      </button>
    </td>
  );

  return (
    <div className="machinery-page">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {confirmDelete && (
        <AuroraConfirmModal
          danger
          title="Eliminar registro de horímetro"
          body={`¿Eliminar el registro del ${confirmDelete.fecha || 'sin fecha'} ${confirmDelete.tractor ? `(${confirmDelete.tractor})` : ''}? Esta acción no se puede deshacer.`}
          confirmLabel="Eliminar"
          onConfirm={doDelete}
          onCancel={() => setConfirmDelete(null)}
          loading={deleting}
        />
      )}

      <div className="aur-sheet">
        <header className="aur-sheet-header">
          <div className="aur-sheet-header-text">
            <h1 className="aur-sheet-title">Historial de horímetros</h1>
            <p className="aur-sheet-subtitle">
              Consulta y analiza el historial de horímetros en busca de patrones o anomalías. <Link to="/operaciones/horimetro/registro">Ir a registro de horímetro</Link>.
            </p>
          </div>
        </header>

        {loading ? (
          <div className="aur-page-loading" />
        ) : (
          <AuroraDataTable
            columns={COLUMNS}
            data={enrichedRecords}
            getColVal={getColVal}
            initialSort={{ field: 'fecha', dir: 'desc' }}
            firstClickDir="desc"
            renderRow={renderRow}
            trailingCell={trailingCell}
            emptyText={
              records.length === 0
                ? <>No hay registros de horímetros creados aún. Crea el primero en <Link to="/operaciones/horimetro/registro">Registro de Horímetro</Link>.</>
                : 'No hay registros con los filtros aplicados.'
            }
          />
        )}
      </div>
    </div>
  );
}
