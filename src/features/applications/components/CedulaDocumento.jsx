import { forwardRef, useMemo } from 'react';
import { tsToDate, formatDateLong, calcFechaCosecha, deriveCambiosLineas } from '../lib/cedulas-helpers';

// Iniciales del nombre de la finca como fallback cuando no hay logoUrl.
// Antes el placeholder estático "AU" sugería "Aurora" en cédulas de fincas
// que tenían su propio nombreEmpresa configurado — quedaba como branding
// confuso. Punto #23 audit. Devuelve max 2 chars en mayúsculas.
const fincaInitials = (nombreEmpresa) => {
  const txt = (nombreEmpresa || '').trim();
  if (!txt) return 'AU';
  const words = txt.split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
};

// Validamos el scheme del logoUrl antes de renderizarlo como <img>. config.js
// solo genera URLs http(s) desde Firebase Storage, pero una escritura directa
// vía Admin SDK (chat tool, autopilot, consola Firestore manual) podría
// colgar un data:, javascript: o file: que el browser cargaría sin chequeo.
// Default-deny todo lo que no sea http/https — el fallback es el placeholder
// de iniciales. L8 audit.
const isSafeImgUrl = (url) => typeof url === 'string' && /^https?:\/\//i.test(url);

// ── CedulaDocumento ──────────────────────────────────────────────────────────
// El papel blanco con el documento auditable de la cédula que se renderiza
// dentro del preview modal y que html2canvas captura para exportar a PDF.
//
// Extraído de CedulasAplicacion.jsx (Fase 3 del refactor del punto #7 del
// audit UX/UI). El bloque tenía ~430 LOC dentro del orquestador con 14
// dependencias inline — moverlo a su propio componente convierte la página
// en un thin wrapper de modal-toolbar + documento + listing.
//
// Forwarded ref: el ref apunta al `<div className="ca-document">` interno
// para que el handleShare/handlePrint del padre pueda capturar el papel sin
// el fondo gris del wrapper.
//
// Dedup con CedulaViewer.jsx (punto #2 audit UX/UI): el viewer ya no tiene
// su propio papel duplicado — adapta su `cedula` con campos `snap_*` a la
// misma shape que el preview pasa, y al renderizar este componente
// proporciona `snapOverrides` para forzar los valores históricos exactos
// (fechaCosecha, totalPlantas, totalBoones, periodoCarenciaMax,
// periodoReingresoMax) en lugar de re-derivarlos desde el catálogo actual.
// El preview no pasa overrides y mantiene su path de cálculo on-the-fly.
const CedulaDocumento = forwardRef(function CedulaDocumento({
  config,
  previewTask,
  activeCedula,
  previewSource,
  previewPkg,                 // eslint-disable-line no-unused-vars
  previewPackageName,
  previewTecnicoResponsable,
  previewProductos,
  previewBloques,
  pvTotalHa,
  previewCal,
  previewCalAplicador,
  previewCalTractor,
  getProductoCatalog,
  // Valores snap del backend (set al lock-in de la cédula). Se usan en el
  // viewer del historial para que el papel refleje EXACTO lo que se aplicó,
  // aunque el catálogo o config hayan cambiado desde entonces. Cualquier
  // campo undefined cae al cálculo on-the-fly.
  snapOverrides = null,
}, ref) {
  // Periodo de carencia (días, max sobre todos los productos planificados) y
  // periodo de reingreso (horas, idem). Antes eran dos IIFE inline que
  // reducían previewProductos y llamaban getProductoCatalog por producto en
  // cada render del documento. La tabla de productos abajo hace un tercer
  // reduce. Con previewProductos estable y getProductoCatalog memoizado en
  // el orquestador (useCallback sobre productosById), los memos son
  // virtualmente gratis a partir de la 2da render. Punto #23 audit.
  const periodoCarencia = useMemo(() => {
    if (snapOverrides?.periodoCarenciaMax != null) {
      const n = Number(snapOverrides.periodoCarenciaMax);
      return n > 0 ? `${n} días` : '—';
    }
    const max = previewProductos.reduce((m, p) => {
      const dias = Number(getProductoCatalog(p.productoId)?.periodoACosecha) || 0;
      return Math.max(m, dias);
    }, 0);
    return max > 0 ? `${max} días` : '—';
  }, [previewProductos, getProductoCatalog, snapOverrides?.periodoCarenciaMax]);

  const periodoReingreso = useMemo(() => {
    if (snapOverrides?.periodoReingresoMax != null) {
      const n = Number(snapOverrides.periodoReingresoMax);
      return n > 0 ? `${n} h` : '—';
    }
    const max = previewProductos.reduce((m, p) => {
      const horas = Number(getProductoCatalog(p.productoId)?.periodoReingreso) || 0;
      return Math.max(m, horas);
    }, 0);
    return max > 0 ? `${max} h` : '—';
  }, [previewProductos, getProductoCatalog, snapOverrides?.periodoReingresoMax]);

  return (
    <div className="ca-doc-wrap">
      <div className="ca-document" ref={ref}>

        {/* ── Encabezado ── */}
        <div className="ca-doc-header">
          <div className="ca-doc-brand">
            {isSafeImgUrl(config.logoUrl)
              // crossOrigin="anonymous" pareado con html2canvas useCORS:true.
              // Sin esto, un logo hosteado en CDN externo taintaba el canvas
              // y toDataURL() lanzaba SecurityError → el botón "Compartir"
              // caía silencioso. Punto #13 audit.
              ? <img src={config.logoUrl} alt="Logo" className="ca-doc-logo-img" crossOrigin="anonymous" />
              : <div className="ca-doc-logo">{fincaInitials(config.nombreEmpresa)}</div>
            }
            <div className="ca-doc-brand-info">
              <div className="ca-doc-brand-name">{config.nombreEmpresa || 'Finca Aurora'}</div>
              {config.identificacion && <div className="ca-doc-brand-sub">Cédula: {config.identificacion}</div>}
              {config.whatsapp      && <div className="ca-doc-brand-sub">Tel: {config.whatsapp}</div>}
              {config.correo        && <div className="ca-doc-brand-sub">{config.correo}</div>}
              {config.direccion     && <div className="ca-doc-brand-sub">{config.direccion}</div>}
            </div>
          </div>
          <div className="ca-doc-title-block">
            <div className="ca-doc-title">CÉDULA DE APLICACIÓN DE AGROQUÍMICOS</div>
            <div className="ca-doc-subtitle">Aplicación: {previewTask.activityName}</div>
            {previewTask.isDraft
              ? <div className="ca-doc-consecutivo ca-doc-consecutivo--draft">BORRADOR</div>
              : activeCedula && (
                <div className="ca-doc-consecutivo">{activeCedula.consecutivo}</div>
              )
            }
          </div>
        </div>

        <hr className="ca-doc-divider" />

        {/* ── Datos generales ── */}
        <div className="ca-section-title ca-section-title--split">
          <span>Datos Generales</span>
          {previewCal && (
            <span className="ca-section-cal-name">Calibración: {previewCal.nombre}</span>
          )}
        </div>
        <div className="ca-datos-grid">
          <div className="ca-dato ca-dato-col">
            <div className="ca-dato">
              <span className="ca-dato-label">F. Prog. Aplicación:</span>
              <span className="ca-dato-value">{formatDateLong(previewTask.dueDate)}</span>
            </div>
            <div className="ca-dato">
              <span className="ca-dato-label">F. Prog. Cosecha:</span>
              <span className="ca-dato-value">
                {formatDateLong(snapOverrides?.fechaCosecha ?? calcFechaCosecha(previewSource, config))}
              </span>
            </div>
            <div className="ca-dato">
              <span className="ca-dato-label">F. Creación de Grupo:</span>
              <span className="ca-dato-value">{formatDateLong(tsToDate(previewSource?.fechaCreacion))}</span>
            </div>
            <div className="ca-dato">
              <span className="ca-dato-label">Periodo de Carencia:</span>
              <span className="ca-dato-value">{periodoCarencia}</span>
            </div>
            <div className="ca-dato">
              <span className="ca-dato-label">Periodo de Reingreso:</span>
              <span className="ca-dato-value">{periodoReingreso}</span>
            </div>
            <div className="ca-dato">
              <span className="ca-dato-label">Método de Apl.:</span>
              <span className="ca-dato-value">
                {activeCedula?.metodoAplicacion || previewCal?.metodo || '—'}
              </span>
            </div>
            {previewPackageName && (
              <div className="ca-dato">
                <span className="ca-dato-label">Paq. Téc.:</span>
                <span className="ca-dato-value">{previewPackageName}</span>
              </div>
            )}
          </div>
          <div className="ca-dato ca-dato-col">
            <div className="ca-dato">
              <span className="ca-dato-label">Grupo:</span>
              <span className="ca-dato-value">{activeCedula?.snap_sourceName || previewTask.loteName || '—'}</span>
            </div>
            {(previewSource?.cosecha || previewSource?.etapa) && (
              <div className="ca-dato">
                <span className="ca-dato-label">Etapa:</span>
                <span className="ca-dato-value">
                  {[previewSource.cosecha, previewSource.etapa].filter(Boolean).join(' / ')}
                </span>
              </div>
            )}
            <div className="ca-dato">
              <span className="ca-dato-label">Área (ha):</span>
              <span className="ca-dato-value">{pvTotalHa > 0 ? pvTotalHa.toFixed(2) : (previewTask.loteHectareas ?? '—')}</span>
            </div>
            <div className="ca-dato">
              <span className="ca-dato-label">Total Plantas:</span>
              <span className="ca-dato-value">
                {(() => {
                  const override = snapOverrides?.totalPlantas;
                  const total = override != null
                    ? Number(override) || 0
                    : previewBloques.reduce((s, b) => s + (Number(b.plantas) || 0), 0);
                  return total > 0 ? total.toLocaleString('es-ES') : '—';
                })()}
              </span>
            </div>
            <div className="ca-dato">
              <span className="ca-dato-label">Volumen (Lt/Ha):</span>
              <span className="ca-dato-value">{previewCal?.volumen ?? '—'}</span>
            </div>
            <div className="ca-dato">
              <span className="ca-dato-label">Litros aplicador:</span>
              <span className="ca-dato-value">
                {previewCalAplicador?.capacidad ?? '—'}
              </span>
            </div>
            <div className="ca-dato">
              <span
                className="ca-dato-label"
                title="Cantidad estimada de tanques (boom) necesarios para cubrir el área programada: (volumen · área) / capacidad del aplicador."
              >
                Total tanques (boom):
              </span>
              <span className="ca-dato-value">
                {(() => {
                  if (snapOverrides?.totalBoones != null) {
                    return Number(snapOverrides.totalBoones).toFixed(2);
                  }
                  const volumen = parseFloat(previewCal?.volumen);
                  const litros  = parseFloat(previewCalAplicador?.capacidad);
                  const area    = pvTotalHa > 0 ? pvTotalHa : parseFloat(previewTask.loteHectareas ?? 0);
                  if (!volumen || !litros || !area) return '—';
                  return ((volumen * area) / litros).toFixed(2);
                })()}
              </span>
            </div>
          </div>

          {/* Columna 3: Calibración */}
          <div className="ca-dato ca-dato-col">
            <div className="ca-dato">
              <span className="ca-dato-label">Tractor:</span>
              <span className="ca-dato-value">{previewCalTractor?.codigo || previewCal?.tractorNombre || '—'}</span>
            </div>
            <div className="ca-dato">
              <span className="ca-dato-label">Aplicador:</span>
              <span className="ca-dato-value">{previewCalAplicador?.codigo || previewCal?.aplicadorNombre || '—'}</span>
            </div>
            <div className="ca-dato">
              <span className="ca-dato-label">RPM Recomendada:</span>
              <span className="ca-dato-value">{previewCal?.rpmRecomendado || '—'}</span>
            </div>
            <div className="ca-dato">
              <span className="ca-dato-label">Marcha Rec.:</span>
              <span className="ca-dato-value">{previewCal?.marchaRecomendada || '—'}</span>
            </div>
            <div className="ca-dato">
              <span className="ca-dato-label">Tipo Boq.:</span>
              <span className="ca-dato-value">{previewCal?.tipoBoquilla || '—'}</span>
            </div>
            <div className="ca-dato">
              <span className="ca-dato-label">Presión Recomendada:</span>
              <span className="ca-dato-value">{previewCal?.presionRecomendada || '—'}</span>
            </div>
            <div className="ca-dato">
              <span className="ca-dato-label">Km/H Recomendados:</span>
              <span className="ca-dato-value">{previewCal?.velocidadKmH || '—'}</span>
            </div>
          </div>
        </div>

        {/* ── Tabla de bloques (sólo para grupos) ── */}
        {previewBloques.length > 0 && (
          <div className="ca-bloques-summary">
            {Object.entries(
              previewBloques.reduce((acc, b) => {
                const lote = b.loteNombre || '—';
                if (!acc[lote]) acc[lote] = [];
                acc[lote].push(b.bloque || '—');
                return acc;
              }, {})
            ).map(([lote, bloques]) => (
              <div key={lote} className="ca-bloques-summary-row">
                <span className="ca-bloques-label">Lote:</span>
                <span className="ca-bloques-value">{lote}</span>
                <span className="ca-bloques-label">Bloques:</span>
                <span className="ca-bloques-value">{[...bloques].sort((a, b) => a.localeCompare(b, 'es', { numeric: true })).join(', ')}</span>
              </div>
            ))}
          </div>
        )}

        {/* ── Tabla de productos ── */}
        {previewProductos.length === 0 ? (
          <p className="ca-empty-products">Sin productos registrados.</p>
        ) : (
          <table className="ca-doc-table">
            <thead>
              <tr>
                <th>Id</th>
                <th>Nombre Comercial — Ing. Activo</th>
                <th className="ca-col-num">Per. Carencia</th>
                <th className="ca-col-num">Per. Reing.</th>
                <th className="ca-col-num">Cant./Ha</th>
                <th className="ca-col-num">Boom</th>
                <th className="ca-col-num">Fracción</th>
                <th>Unidad</th>
                <th className="ca-col-num">Total</th>
              </tr>
            </thead>
            <tbody>
              {previewProductos.map((prod, i) => {
                const info        = getProductoCatalog(prod.productoId);
                const cantPorHa   = prod.cantidadPorHa ?? prod.cantidad;
                const hectareas   = pvTotalHa > 0 ? pvTotalHa : parseFloat(previewTask.loteHectareas || 1);
                const total       = cantPorHa != null
                  ? (parseFloat(cantPorHa) * hectareas).toFixed(3)
                  : '—';
                const nombreFull  = info
                  ? `${info.nombreComercial}${info.ingredienteActivo ? ' — ' + info.ingredienteActivo : ''}`
                  : (prod.nombreComercial || '—');
                const volumen     = parseFloat(previewCal?.volumen);
                const litros      = parseFloat(previewCalAplicador?.capacidad);
                const totalBoones = (volumen && litros && hectareas)
                  ? (volumen * hectareas) / litros
                  : null;
                const fracDecimal = totalBoones != null ? totalBoones % 1 : null;
                const cantBoom    = (cantPorHa != null && volumen && litros && totalBoones > 1)
                  ? ((parseFloat(cantPorHa) * litros) / volumen).toFixed(3)
                  : '—';
                const cantFraccion = (cantPorHa != null && volumen && litros && fracDecimal != null && fracDecimal > 0)
                  ? ((parseFloat(cantPorHa) * litros / volumen) * fracDecimal).toFixed(3)
                  : '—';
                return (
                  <tr key={prod.productoId || i}>
                    <td>{info?.idProducto || '—'}</td>
                    <td>{nombreFull}</td>
                    <td className="ca-col-num">{info?.periodoACosecha ?? '—'}</td>
                    <td className="ca-col-num">{info?.periodoReingreso ?? '—'}</td>
                    <td className="ca-col-num">{cantPorHa ?? '—'}</td>
                    <td className="ca-col-num">{cantBoom}</td>
                    <td className="ca-col-num">{cantFraccion}</td>
                    <td>{info?.unidad || prod.unidad || '—'}</td>
                    <td className="ca-col-num"><strong>{total}</strong></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {/* ── Bloque de observaciones / ajustes (solo si hay datos) ── */}
        {(() => {
          const ced = activeCedula;
          if (!ced) return null;
          const hay = ced.huboCambios || ced.observacionesMezcla || ced.observacionesAplicacion;
          if (!hay) return null;
          const cambiosLineas = ced.huboCambios
            ? deriveCambiosLineas({
                originales: ced.productosOriginales,
                aplicados:  ced.productosAplicados,
              })
            : [];
          return (
            <div className="ca-doc-observaciones">
              {ced.huboCambios && cambiosLineas.length > 0 && (
                <div>
                  <strong>Ajustes respecto al programa original:</strong>
                  <ul>
                    {cambiosLineas.map((ln, i) => <li key={i}>{ln}</li>)}
                  </ul>
                </div>
              )}
              {ced.observacionesMezcla && (
                <p><strong>Observaciones de mezcla:</strong> {ced.observacionesMezcla}</p>
              )}
              {ced.observacionesAplicacion && (
                <p><strong>Observaciones de aplicación:</strong> {ced.observacionesAplicacion}</p>
              )}
            </div>
          );
        })()}

        {/* ── Nota de seguridad ── */}
        <div className="ca-doc-safety-note">
          No olvide usar el Equipo de Protección Personal durante la aplicación y de asegurarse del buen estado del mismo. No fume ni ingiera alimentos durante la aplicación. Recuerde no contaminar fuentes de agua con productos o envases vacíos.
        </div>

        {/* ── Sobrante + Condiciones del tiempo ── */}
        <div className="ca-campo-data-row">
          <div className="ca-campo-item">
            <span className="ca-campo-label">Sobrante:</span>
            <span className="ca-campo-value">
              {activeCedula?.sobrante === true ? 'Sí' : activeCedula?.sobrante === false ? 'No' : '___'}
            </span>
          </div>
          {activeCedula?.sobrante && (
            <div className="ca-campo-item">
              <span className="ca-campo-label">Depositado en:</span>
              <span className="ca-campo-value">{activeCedula?.sobranteLoteNombre || '___________'}</span>
            </div>
          )}
        </div>
        <div className="ca-campo-data-row">
          <div className="ca-campo-item">
            <span className="ca-campo-label">Condiciones del tiempo:</span>
            <span className="ca-campo-value">{activeCedula?.condicionesTiempo || '___________'}</span>
          </div>
          <div className="ca-campo-item">
            <span className="ca-campo-label">Temperatura:</span>
            <span className="ca-campo-value">
              {activeCedula?.temperatura != null ? `${activeCedula.temperatura}°C` : '___'}
            </span>
          </div>
          <div className="ca-campo-item">
            <span className="ca-campo-label">% Humedad Relativa:</span>
            <span className="ca-campo-value">
              {activeCedula?.humedadRelativa != null ? `${activeCedula.humedadRelativa}%` : '___'}
            </span>
          </div>
        </div>

        {/* ── Firma operarios ── */}
        <div className="ca-doc-sig-row">
          <div className="ca-sig-block">
            <div className="ca-sig-line ca-sig-line--prefilled">
              {(() => {
                if (!activeCedula?.aplicadaAt) return null;
                const d = activeCedula.aplicadaAt?.seconds
                  ? new Date(activeCedula.aplicadaAt.seconds * 1000)
                  : new Date(activeCedula.aplicadaAt);
                return d.toLocaleDateString('es-ES', { day:'2-digit', month:'2-digit', year:'numeric', timeZone:'UTC' });
              })()}
            </div>
            <div className="ca-sig-label">Fecha de Aplicación</div>
          </div>
          <div className="ca-sig-block">
            <div className="ca-sig-line ca-sig-line--prefilled">
              {(activeCedula?.horaInicio || activeCedula?.horaFinal)
                ? [activeCedula.horaInicio || '___', activeCedula.horaFinal || '___'].join(' / ')
                : null}
            </div>
            <div className="ca-sig-label">Hora Inicial / Hora Final</div>
          </div>
          <div className="ca-sig-block">
            <div className="ca-sig-line ca-sig-line--prefilled">
              {activeCedula?.operario || null}
            </div>
            <div className="ca-sig-label">Operario</div>
          </div>
        </div>

        {/* ── Firmas finales ──
            Encargado de Finca / Bodega: priorizar el dato persistido en la
            cédula (capturado en AplicadaModal / MezclaListaModal). Antes
            mostraba siempre config.administrador / mezclaListaNombre, lo
            que perdía el audit trail si en una cédula aplicada el encargado
            firmante era distinto al admin actual de finca. */}
        <div className="ca-doc-sig-row ca-doc-sig-final">
          <div className="ca-sig-block">
            <div className="ca-sig-line ca-sig-line--prefilled">
              {activeCedula?.encargadoFinca || config.administrador || null}
            </div>
            <div className="ca-sig-label">Encargado de Finca</div>
          </div>
          <div className="ca-sig-block">
            <div className="ca-sig-line ca-sig-line--prefilled">
              {activeCedula?.encargadoBodega || activeCedula?.mezclaListaNombre || null}
            </div>
            <div className="ca-sig-label">Encargado de Bodega</div>
          </div>
          <div className="ca-sig-block">
            <div className="ca-sig-line ca-sig-line--prefilled">
              {activeCedula?.supAplicaciones || previewTecnicoResponsable}
            </div>
            <div className="ca-sig-label">Sup. Aplicaciones / Regente</div>
          </div>
        </div>

        {/* Footer: distinguir "generado" de "impreso". Antes mostraba
            {today} sin label, sugiriendo falsamente que la cédula es nueva
            cuando se imprime un histórico de meses atrás (problema
            regulatorio en auditorías). Punto #19 audit. */}
        <div className="ca-doc-footer">
          Documento emitido por Sistema Aurora · Impreso: {new Date().toLocaleDateString('es-ES')}
        </div>
      </div>
    </div>
  );
});

export default CedulaDocumento;
