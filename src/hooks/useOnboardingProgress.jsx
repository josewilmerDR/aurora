import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  FiSettings, FiUsers, FiUpload, FiMessageCircle, FiMap, FiPackage,
  FiClipboard, FiLayers, FiCheckSquare, FiDroplet, FiTool, FiSun, FiStar,
} from 'react-icons/fi';
import { getVisited, markVisited, isCompletedSticky } from '../features/dashboard/lib/onboardingState';

// Definición declarativa de los pasos del onboarding en orden.
//
// Modelo "soft": un paso se marca como completado con solo visitar la página
// correspondiente (`to`). Reduce la fricción a costa de no garantizar que el
// usuario haya hecho la acción real — apostamos a que llegar a la página ya
// expone la funcionalidad. El paso `chat` no tiene `to` (abre un panel) y se
// marca manualmente desde AuroraChat.
//
// El orden importa: refleja la secuencia que sugerimos al admin nuevo.
// `description` se renderiza como hint debajo del label en el carrusel.
const STEPS_DEF = [
  { key: 'organizacion', visitKey: 'organizacion', label: 'Configurar la organización',           to: '/config/cuenta',                   icon: FiSettings,      description: 'Actualiza la información de la organización para ser usada en formularios y cédulas de aplicaciones.' },
  { key: 'invitar',      visitKey: 'inviteUser',   label: 'Invitar a tu equipo',                  to: '/users',                           icon: FiUsers,         description: 'Invita a personas a formar parte del equipo de trabajo y asígnales un rol de usuario.' },
  { key: 'cargaMasiva',  visitKey: 'bulkUpload',   label: 'Carga masiva de información',          to: '/admin/config-inicial',            icon: FiUpload,        description: 'Crea cientos o miles de registros con un par de clics.' },
  { key: 'chat',         visitKey: 'chat',         label: 'Chatea con Aurora',                    to: null,                               icon: FiMessageCircle, description: 'Pídele a Aurora que haga algo, como crear un lote o un recordatorio.' },
  { key: 'favoritos',    visitKey: 'favoritos',    label: 'Favoritos y últimas funciones realizadas', to: null,                            icon: FiStar,          description: <>Marca como favoritos (<FiStar size={11} style={{ verticalAlign: '-1px' }} />) las funciones que más uses y tenlas siempre a un click.</> },
  { key: 'lote',         visitKey: 'lote',         label: 'Crear un lote',                        to: '/lotes',                           icon: FiMap,           description: 'Los lotes son espacios físicos donde viven tus cultivos.' },
  { key: 'producto',     visitKey: 'producto',     label: 'Crea o actualiza un producto',         to: '/bodega/agroquimicos/existencias', icon: FiDroplet,       description: 'Crea o actualiza un producto para ser utilizado en las aplicaciones a tus cultivos.' },
  { key: 'calibracion',  visitKey: 'calibracion',  label: 'Crea una calibración',                 to: '/admin/calibraciones',             icon: FiTool,          description: 'Crea una calibración para ser empleada en las aplicaciones a tus cultivos. Es útil para calcular la cantidad de agua y agroquímicos exactos que serán aplicados por Ha a tus cultivos.' },
  { key: 'paqueteApp',   visitKey: 'paqueteApp',   label: 'Crea un paquete de aplicaciones',      to: '/packages',                        icon: FiPackage,       description: 'Crea y reúne una o varias aplicaciones que pueden ser hechas a un bloque, grupo de bloques o lotes enteros.' },
  { key: 'paqueteMon',   visitKey: 'paqueteMon',   label: 'Crea un paquete de muestreos',         to: '/monitoreo/paquetes',              icon: FiClipboard,     description: 'Crea y reúne uno o varios muestreos que pueden ser hechos a un bloque, grupo de bloques o lotes enteros.' },
  { key: 'grupo',        visitKey: 'grupo',        label: 'Crea o actualiza un grupo',            to: '/grupos',                          icon: FiLayers,        description: 'Un grupo es un conjunto homogéneo de bloques a los cuales se les aplica el mismo paquete de aplicaciones, muestreos y labores.' },
  { key: 'tarea',        visitKey: 'tarea',        label: 'Crear una tarea',                      to: '/tasks?new=1',                     icon: FiCheckSquare,   description: 'Crea una tarea para un lote o grupo de lotes que será aplicada en la fecha indicada.' },
  { key: 'siembra',      visitKey: 'siembra',      label: 'Hacer un registro de siembra',         to: '/siembra',                         icon: FiSun,           description: 'Crea un registro de siembra haciendo uso del formulario o mediante el uso de la IA de Aurora.' },
];

// Devuelve el step cuyo `to` coincide con el pathname dado (ignora query y
// permite sub-rutas, p.ej. /lotes/123 cuenta como visitar /lotes).
function findStepForPath(pathname) {
  return STEPS_DEF.find(s => {
    if (!s.to) return false;
    const stepPath = s.to.split('?')[0];
    return pathname === stepPath || pathname.startsWith(stepPath + '/');
  });
}

/**
 * Hook que computa el progreso del onboarding.
 *
 * Devuelve {steps, completedCount, total, percent, completedSticky, loading}.
 * Si `enabled` es false (p.ej. usuario no admin) devuelve steps vacíos.
 * Si el usuario ya alcanzó 100% antes (flag sticky), devuelve completedSticky=true.
 *
 * Auto-marcado: cuando el usuario navega a la `to` de un paso, lo marca como
 * visitado. Esto reemplaza el modelo anterior de "contar registros creados".
 */
export function useOnboardingProgress({ enabled, uid }) {
  const location = useLocation();
  // `tick` fuerza re-render desde listeners externos (custom event, focus,
  // storage cross-tab). El estado real vive en localStorage; este hook solo
  // lo lee de forma sincrónica en el render.
  const [tick, setTick] = useState(0);

  const completedSticky = enabled && uid ? isCompletedSticky(uid) : false;

  // Auto-marca al navegar: si el pathname matchea la `to` de un step, lo
  // registra como visitado. markVisited dispara aurora:onboarding-refresh
  // que provoca el re-render via el listener de abajo.
  useEffect(() => {
    if (!enabled || !uid || completedSticky) return;
    const step = findStepForPath(location.pathname);
    if (step) markVisited(uid, step.visitKey);
  }, [enabled, uid, completedSticky, location.pathname]);

  // Triggers de re-render externos:
  //   - `aurora:onboarding-refresh` → markVisited (mismo tab) o el botón al
  //     abrir el popover.
  //   - focus → al volver a la pestaña.
  //   - storage → cambios cross-tab en los flags del onboarding.
  useEffect(() => {
    if (!enabled) return;
    const bump = () => setTick(t => t + 1);
    const onStorage = (e) => {
      if (e.key && e.key.startsWith('aurora_onboarding_')) bump();
    };
    window.addEventListener('aurora:onboarding-refresh', bump);
    window.addEventListener('focus', bump);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('aurora:onboarding-refresh', bump);
      window.removeEventListener('focus', bump);
      window.removeEventListener('storage', onStorage);
    };
  }, [enabled]);

  if (!enabled) {
    return { steps: [], completedCount: 0, total: 0, percent: 0, completedSticky: false, loading: false };
  }
  if (completedSticky) {
    return { steps: [], completedCount: STEPS_DEF.length, total: STEPS_DEF.length, percent: 100, completedSticky: true, loading: false };
  }

  // Lectura sincrónica. `tick` y `location.pathname` arriba garantizan que
  // este render se vuelva a ejecutar cuando algo relevante cambia.
  void tick;
  const visited = uid ? getVisited(uid) : {};
  const steps = STEPS_DEF.map(def => ({
    ...def,
    completed: Boolean(visited[def.visitKey]),
  }));

  const completedCount = steps.filter(s => s.completed).length;
  const total = steps.length;
  const percent = total === 0 ? 0 : Math.round((completedCount / total) * 100);

  return { steps, completedCount, total, percent, completedSticky: false, loading: false };
}
