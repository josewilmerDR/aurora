import { useEffect, useState } from 'react';
import {
  FiSettings, FiUsers, FiUpload, FiMessageCircle, FiMap, FiPackage,
  FiClipboard, FiLayers, FiCheckSquare, FiTool, FiSun,
} from 'react-icons/fi';
import { useApiFetch } from './useApiFetch';
import { getVisited, isCompletedSticky } from '../features/dashboard/lib/onboardingState';

// Definición declarativa de los 11 pasos en orden.
// Cada paso es una de tres formas:
//   - kind: 'config'  → completado si el doc /api/config tiene nombreEmpresa
//   - kind: 'visit'   → completado si localStorage visited[visitKey] === true
//   - kind: 'count'   → completado si fetch del endpoint devuelve array.length > 0
//
// El orden importa: refleja la secuencia que sugerimos al admin nuevo.
// `description` se muestra como hint solo en el paso activo del carrusel.
const STEPS_DEF = [
  { key: 'organizacion', kind: 'config',                          label: 'Configurar la organización',           to: '/config/cuenta',         icon: FiSettings,     description: 'Nombre, logo e información de contacto. Sirve de encabezado en tus reportes.' },
  { key: 'invitar',      kind: 'visit', visitKey: 'inviteUser',   label: 'Invitar a tu equipo',                  to: '/users',                 icon: FiUsers,        description: 'Asigna roles y permisos a los miembros de tu equipo para que cada uno acceda a lo que realmente le interesa.' },
  { key: 'cargaMasiva',  kind: 'visit', visitKey: 'bulkUpload',   label: 'Carga masiva de información',          to: '/admin/config-inicial',  icon: FiUpload,       description: 'Importa lotes, productos, usuarios o proveedores desde una hoja de cálculo en pocos clics.' },
  { key: 'chat',         kind: 'visit', visitKey: 'chat',         label: 'Consultar a Aurora en el chat',        to: null,                     icon: FiMessageCircle, description: 'Pregúntale a Aurora sobre tu finca: tareas, stock, planilla o registro de horímetro.' },
  { key: 'lote',         kind: 'count', endpoint: '/api/lotes',            label: 'Crear un lote',                  to: '/lotes',                 icon: FiMap,          description: 'Define las parcelas de la finca con su área y paquete de actividades.' },
  { key: 'paqueteApp',   kind: 'count', endpoint: '/api/packages',         label: 'Crear un paquete de aplicaciones', to: '/packages',            icon: FiPackage,      description: 'Plantilla reusable de aplicaciones agronómicas que se asigna a uno o varios lotes.' },
  { key: 'paqueteMon',   kind: 'count', endpoint: '/api/monitoreo/paquetes', label: 'Crear un paquete de muestreo', to: '/monitoreo/paquetes',    icon: FiClipboard,    description: 'Define qué muestrear y con qué frecuencia para detectar plagas y enfermedades a tiempo.' },
  { key: 'grupo',        kind: 'count', endpoint: '/api/grupos',           label: 'Crear o actualizar un grupo',     to: '/grupos',                icon: FiLayers,       description: 'Agrupa lotes que comparten ciclo de cosecha para coordinar tareas y cosechas.' },
  { key: 'tarea',        kind: 'count', endpoint: '/api/tasks',            label: 'Crear una tarea',                 to: '/tasks?new=1',           icon: FiCheckSquare,  description: 'Programa una actividad puntual y asígnala a un responsable con fecha y descripción.' },
  { key: 'calibracion',  kind: 'count', endpoint: '/api/calibraciones',    label: 'Crear una calibración',           to: '/admin/calibraciones',   icon: FiTool,         description: 'Registra la calibración de equipos para mantener la trazabilidad de tus aplicaciones.' },
  { key: 'siembra',      kind: 'count', endpoint: '/api/siembras',         label: 'Hacer un registro de siembra',    to: '/siembra',               icon: FiSun,          description: 'Registra qué se sembró, dónde y cuándo, para el seguimiento del lote.' },
];

const COUNT_ENDPOINTS = [...new Set(STEPS_DEF.filter(s => s.kind === 'count').map(s => s.endpoint))];

function fetchCount(apiFetch, path) {
  return apiFetch(path)
    .then(r => r.ok ? r.json() : [])
    .then(data => Array.isArray(data) ? data.length : 0)
    .catch(() => 0);
}

function fetchConfigHasName(apiFetch) {
  return apiFetch('/api/config')
    .then(r => r.ok ? r.json() : {})
    .then(data => Boolean(data && typeof data.nombreEmpresa === 'string' && data.nombreEmpresa.trim()))
    .catch(() => false);
}

/**
 * Hook que computa el progreso del onboarding del Dashboard.
 *
 * Devuelve {steps, completedCount, total, percent, completedSticky, loading}.
 * Si `enabled` es false (p.ej. usuario no admin) devuelve loading=false con steps vacíos.
 * Si el usuario ya alcanzó 100% antes (flag sticky), devuelve completedSticky=true sin fetchear.
 */
export function useOnboardingProgress({ enabled, uid }) {
  const apiFetch = useApiFetch();
  const [counts, setCounts]   = useState(null); // {endpoint: number}
  const [hasName, setHasName] = useState(null); // bool
  const [loading, setLoading] = useState(Boolean(enabled));

  const completedSticky = enabled && uid ? isCompletedSticky(uid) : false;

  useEffect(() => {
    if (!enabled || completedSticky) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);

    Promise.all([
      fetchConfigHasName(apiFetch),
      ...COUNT_ENDPOINTS.map(ep => fetchCount(apiFetch, ep).then(n => [ep, n])),
    ]).then(([nameOk, ...pairs]) => {
      if (cancelled) return;
      setHasName(nameOk);
      setCounts(Object.fromEntries(pairs));
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [enabled, completedSticky, apiFetch]);

  if (!enabled) {
    return { steps: [], completedCount: 0, total: 0, percent: 0, completedSticky: false, loading: false };
  }
  if (completedSticky) {
    return { steps: [], completedCount: STEPS_DEF.length, total: STEPS_DEF.length, percent: 100, completedSticky: true, loading: false };
  }

  const visited = uid ? getVisited(uid) : {};
  const steps = STEPS_DEF.map(def => {
    let completed = false;
    if (def.kind === 'config') completed = Boolean(hasName);
    else if (def.kind === 'visit') completed = Boolean(visited[def.visitKey]);
    else if (def.kind === 'count') completed = (counts?.[def.endpoint] || 0) > 0;
    return { ...def, completed };
  });

  const completedCount = steps.filter(s => s.completed).length;
  const total = steps.length;
  const percent = total === 0 ? 0 : Math.round((completedCount / total) * 100);

  return { steps, completedCount, total, percent, completedSticky: false, loading };
}
