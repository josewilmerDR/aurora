// Bloque de marca compartido de los documentos imprimibles + aviso de
// identidad incompleta. Reemplaza nueve headers duplicados (cédulas, grupos,
// lotes, planillas, siembras, órdenes de compra) que traían el nombre de la
// finca de pruebas hardcodeado como fallback (guard: check-tenant-literal).
//
// `classPrefix` emite las clases existentes de cada documento (ca-doc,
// gp-doc, pr-doc, pu-pdoc, po-doc) para no tocar el CSS de cada página.
// `empresa` viene resuelta por useEmpresaIdentity/useEmpresaConfig (cascada
// + logo saneado) — este componente no aplica fallbacks propios.

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { empresaInitials } from '../../lib/empresa';
import './DocBrand.css';

export function DocBrand({
  classPrefix,
  empresa,
  boxedLogo = false,        // pr/pu: logo (img o iniciales) dentro de un box fijo
  subSuffix = 'brand-sub',  // pu usa 'brand-detail'
  uppercaseName = false,    // planillas/siembras muestran el nombre en mayúsculas
  logoImgStyle,             // pu dimensiona el img inline (no tiene clase CSS)
}) {
  const [logoBroken, setLogoBroken] = useState(false);
  const p = classPrefix;
  const nombre = uppercaseName ? String(empresa.nombre || '').toUpperCase() : (empresa.nombre || '');
  const showImg = !!empresa.logoUrl && !logoBroken;
  const img = (
    <img
      src={empresa.logoUrl}
      alt="Logo"
      className={`${p}-logo-img`}
      style={logoImgStyle}
      // crossOrigin pareado con html2canvas useCORS — sin él, un logo externo
      // tainta el canvas y la exportación a PDF muere con SecurityError.
      crossOrigin="anonymous"
      referrerPolicy="no-referrer"
      onError={() => setLogoBroken(true)}
    />
  );
  const initials = empresaInitials(empresa.nombre);
  return (
    <div className={`${p}-brand`}>
      {boxedLogo
        ? <div className={`${p}-logo`}>{showImg ? img : initials}</div>
        : (showImg ? img : <div className={`${p}-logo`}>{initials}</div>)}
      <div className={`${p}-brand-info`}>
        <div className={`${p}-brand-name`}>{nombre}</div>
        {empresa.identificacion && <div className={`${p}-${subSuffix}`}>Cédula: {empresa.identificacion}</div>}
        {empresa.whatsapp && <div className={`${p}-${subSuffix}`}>Tel: {empresa.whatsapp}</div>}
        {empresa.correo && <div className={`${p}-${subSuffix}`}>{empresa.correo}</div>}
        {empresa.direccion && <div className={`${p}-${subSuffix}`}>{empresa.direccion}</div>}
      </div>
    </div>
  );
}

// Aviso NO imprimible cuando el documento cae al nombre de la organización
// porque «Nombre de la Empresa» no está configurado. Doble protección:
// display:none en @media print y data-html2canvas-ignore para los exports
// que capturan pantalla (cédulas, OCs).
export function IdentityNotice({ show }) {
  if (!show) return null;
  return (
    <div className="doc-identity-notice" role="note" data-html2canvas-ignore="true">
      Este documento usa el nombre de la organización porque «Nombre de la Empresa»
      no está configurado. <Link to="/config/cuenta">Configurarlo en Cuenta</Link>.
    </div>
  );
}
