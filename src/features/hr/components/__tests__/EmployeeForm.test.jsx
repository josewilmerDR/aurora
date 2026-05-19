import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import EmployeeForm from '../EmployeeForm';
import { EMPTY_USER, EMPTY_FICHA } from '../../lib/employeeProfileShared';

// El toggle "Esta persona también es usuario del sistema" controla la
// visibilidad de los campos email y rol. Estos tests fijan:
//   - Por defecto (EMPTY_USER → tieneAcceso=false) los campos no aparecen.
//   - Encender el toggle dispara dos onUserChange: uno por la bandera y otro
//     que setea rol='trabajador' (default razonable).
//   - Apagar el toggle vuelve a 'ninguno' y oculta los campos.

function baseProps(overrides = {}) {
  return {
    userForm: { ...EMPTY_USER },
    fichaForm: { ...EMPTY_FICHA },
    errors: {},
    isEditing: false,
    selectedUser: null,
    saving: false,
    encargados: [],
    formRef: { current: null },
    laboralCollapsed: true,
    setLaboralCollapsed: () => {},
    horarioCollapsed: true,
    setHorarioCollapsed: () => {},
    contactoCollapsed: true,
    setContactoCollapsed: () => {},
    notasCollapsed: true,
    setNotasCollapsed: () => {},
    horarioDefault: { inicio: '06:00', fin: '14:00' },
    setHorarioDefault: () => {},
    onUserChange: vi.fn(),
    onFichaChange: vi.fn(),
    onHorarioChange: vi.fn(),
    onAplicarHorarioLV: vi.fn(),
    onSubmit: (e) => e.preventDefault(),
    onCancel: vi.fn(),
    ...overrides,
  };
}

// EmployeeForm renderiza <label>X</label><input name="X"> como hermanos sin
// htmlFor/id, así que getByLabelText no asocia ninguno. Los tests consultan
// los inputs por su atributo `name` y verifican texto visible para los labels.
const queryByName = (container, name) => container.querySelector(`[name="${name}"]`);

describe('<EmployeeForm /> — acceso al sistema toggle', () => {
  test('email and rol fields are hidden by default (tieneAcceso=false)', () => {
    const { container } = render(<EmployeeForm {...baseProps()} />);
    expect(queryByName(container, 'email')).toBeNull();
    expect(queryByName(container, 'rol')).toBeNull();
    // El toggle sí está visible (label envuelve al checkbox, así sí asocia).
    expect(screen.getByLabelText(/también es usuario del sistema/i)).toBeInTheDocument();
  });

  test('email and rol fields appear when tieneAcceso=true', () => {
    const props = baseProps({
      userForm: { ...EMPTY_USER, tieneAcceso: true, rol: 'trabajador' },
    });
    const { container } = render(<EmployeeForm {...props} />);
    expect(queryByName(container, 'email')).toBeInTheDocument();
    expect(queryByName(container, 'rol')).toBeInTheDocument();
  });

  test('checking the toggle emits a tieneAcceso=true change + sets rol to trabajador if currently ninguno', () => {
    const onUserChange = vi.fn();
    render(<EmployeeForm {...baseProps({ onUserChange })} />);

    fireEvent.click(screen.getByLabelText(/también es usuario del sistema/i));

    const changes = onUserChange.mock.calls.map(c => ({
      name: c[0].target.name, value: c[0].target.value,
    }));
    expect(changes).toEqual(
      expect.arrayContaining([
        { name: 'tieneAcceso', value: true },
        { name: 'rol', value: 'trabajador' },
      ])
    );
  });

  test('unchecking the toggle emits tieneAcceso=false + rol=ninguno', () => {
    const onUserChange = vi.fn();
    const props = baseProps({
      onUserChange,
      userForm: { ...EMPTY_USER, tieneAcceso: true, rol: 'encargado' },
    });
    render(<EmployeeForm {...props} />);

    fireEvent.click(screen.getByLabelText(/también es usuario del sistema/i));

    const changes = onUserChange.mock.calls.map(c => ({
      name: c[0].target.name, value: c[0].target.value,
    }));
    expect(changes).toEqual(
      expect.arrayContaining([
        { name: 'tieneAcceso', value: false },
        { name: 'rol', value: 'ninguno' },
      ])
    );
  });

  test('the rol select preserves an existing valid rol when tieneAcceso=true', () => {
    const props = baseProps({
      userForm: { ...EMPTY_USER, tieneAcceso: true, rol: 'supervisor', email: 'a@b.com' },
    });
    const { container } = render(<EmployeeForm {...props} />);
    expect(queryByName(container, 'rol').value).toBe('supervisor');
  });
});

describe('<EmployeeForm /> — basic personal fields', () => {
  test('nombre, cédula and teléfono are always visible regardless of access toggle', () => {
    const { container } = render(<EmployeeForm {...baseProps()} />);
    expect(queryByName(container, 'nombre')).toBeInTheDocument();
    expect(queryByName(container, 'cedula')).toBeInTheDocument();
    expect(queryByName(container, 'telefono')).toBeInTheDocument();
  });
});
