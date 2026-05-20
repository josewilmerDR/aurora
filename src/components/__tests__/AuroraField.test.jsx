import { describe, test, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import AuroraField, { TextInput, Textarea, Select, DateInput, NumberInput } from '../AuroraField';

describe('<AuroraField />', () => {
  test('renderiza label asociado al control via htmlFor + id', () => {
    const { container } = render(
      <AuroraField label="Nombre" htmlFor="nombre">
        <TextInput value="" onChange={() => {}} />
      </AuroraField>
    );
    const label = container.querySelector('label');
    const input = container.querySelector('input');
    expect(label.getAttribute('for')).toBe('nombre');
    expect(input.id).toBe('nombre');
  });

  test('autogenera id cuando no se pasa htmlFor', () => {
    const { container } = render(
      <AuroraField label="x">
        <TextInput value="" onChange={() => {}} />
      </AuroraField>
    );
    const label = container.querySelector('label');
    const input = container.querySelector('input');
    expect(label.getAttribute('for')).toBeTruthy();
    expect(input.id).toBe(label.getAttribute('for'));
  });

  test('required muestra " *" tras el label', () => {
    const { container } = render(
      <AuroraField label="Nombre" required>
        <TextInput />
      </AuroraField>
    );
    expect(container.querySelector('label').textContent).toContain('*');
  });

  test('error renderiza mensaje, aplica aur-input--error y conecta aria', () => {
    const { container } = render(
      <AuroraField label="Nombre" htmlFor="x" error="Campo obligatorio">
        <TextInput value="" onChange={() => {}} />
      </AuroraField>
    );
    const input = container.querySelector('input');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.className).toContain('aur-input--error');
    expect(input.getAttribute('aria-describedby')).toBe('x-err');
    const err = container.querySelector('.aur-field-error');
    expect(err.id).toBe('x-err');
    expect(err.textContent).toBe('Campo obligatorio');
  });

  test('hint renderiza texto y conecta aria-describedby cuando no hay error', () => {
    const { container } = render(
      <AuroraField label="x" htmlFor="x" hint="Ej. Postforza">
        <TextInput />
      </AuroraField>
    );
    const input = container.querySelector('input');
    expect(input.getAttribute('aria-describedby')).toBe('x-hint');
    expect(container.querySelector('.aur-field-hint').textContent).toBe('Ej. Postforza');
  });

  test('cuando hay error, hint se oculta para no duplicar mensajes', () => {
    const { container } = render(
      <AuroraField label="x" hint="Ej. Postforza" error="Falta">
        <TextInput />
      </AuroraField>
    );
    expect(container.querySelector('.aur-field-hint')).toBeNull();
    expect(container.querySelector('.aur-field-error')).toBeInTheDocument();
  });

  test('counter muestra "value/max" y aplica color por umbral', () => {
    const { container, rerender } = render(
      <AuroraField label="x" counter={{ value: 10, max: 100 }}>
        <TextInput />
      </AuroraField>
    );
    let counter = container.querySelector('.aur-field-counter');
    expect(counter.textContent).toBe('10/100');
    expect(counter.className).not.toContain('aur-field-counter--warn');
    expect(counter.className).not.toContain('aur-field-counter--danger');

    rerender(
      <AuroraField label="x" counter={{ value: 90, max: 100 }}>
        <TextInput />
      </AuroraField>
    );
    counter = container.querySelector('.aur-field-counter');
    expect(counter.className).toContain('aur-field-counter--warn');

    rerender(
      <AuroraField label="x" counter={{ value: 100, max: 100 }}>
        <TextInput />
      </AuroraField>
    );
    counter = container.querySelector('.aur-field-counter');
    expect(counter.className).toContain('aur-field-counter--danger');
  });

  test('layout="row" usa aur-row + aur-row-label', () => {
    const { container } = render(
      <AuroraField label="Nombre" layout="row">
        <TextInput />
      </AuroraField>
    );
    expect(container.querySelector('.aur-row')).toBeInTheDocument();
    expect(container.querySelector('.aur-row-label')).toBeInTheDocument();
    expect(container.querySelector('.aur-field')).toBeNull();
  });

  test('layout="stack" (default) usa aur-field + aur-field-label', () => {
    const { container } = render(
      <AuroraField label="Nombre">
        <TextInput />
      </AuroraField>
    );
    expect(container.querySelector('.aur-field')).toBeInTheDocument();
    expect(container.querySelector('.aur-field-label')).toBeInTheDocument();
  });

  test('preserva onChange y value del child sin pisarlos', () => {
    const onChange = vi.fn();
    const { container } = render(
      <AuroraField label="x">
        <TextInput value="hola" onChange={onChange} />
      </AuroraField>
    );
    const input = container.querySelector('input');
    expect(input.value).toBe('hola');
    fireEvent.change(input, { target: { value: 'mundo' } });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  test('Textarea wrapper aplica aur-textarea', () => {
    const { container } = render(
      <AuroraField label="x"><Textarea /></AuroraField>
    );
    const ta = container.querySelector('textarea');
    expect(ta.className).toContain('aur-textarea');
  });

  test('Select wrapper aplica aur-select y renderiza options', () => {
    const { container } = render(
      <AuroraField label="x">
        <Select value="a" onChange={() => {}}>
          <option value="a">A</option>
          <option value="b">B</option>
        </Select>
      </AuroraField>
    );
    const sel = container.querySelector('select');
    expect(sel.className).toContain('aur-select');
    expect(sel.querySelectorAll('option')).toHaveLength(2);
  });

  test('DateInput es input type=date con clase aur-input', () => {
    const { container } = render(
      <AuroraField label="x"><DateInput /></AuroraField>
    );
    const input = container.querySelector('input[type="date"]');
    expect(input).toBeInTheDocument();
    expect(input.className).toContain('aur-input');
  });

  test('NumberInput es input type=number con aur-input--num', () => {
    const { container } = render(
      <AuroraField label="x"><NumberInput /></AuroraField>
    );
    const input = container.querySelector('input[type="number"]');
    expect(input).toBeInTheDocument();
    expect(input.className).toContain('aur-input--num');
  });

  test('TextInput variant="num" aplica aur-input--num', () => {
    const { container } = render(
      <TextInput variant="num" value="" onChange={() => {}} />
    );
    expect(container.querySelector('input').className).toContain('aur-input--num');
  });

  test('preserva className del child y suma aur-input--error al haber error', () => {
    const { container } = render(
      <AuroraField label="x" error="oops">
        <TextInput className="mi-clase" />
      </AuroraField>
    );
    const cls = container.querySelector('input').className;
    expect(cls).toContain('aur-input');
    expect(cls).toContain('mi-clase');
    expect(cls).toContain('aur-input--error');
  });
});
