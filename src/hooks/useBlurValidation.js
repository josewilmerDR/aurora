import { useState } from 'react';

export function useBlurValidation(validateFn) {
  const [fieldErrors, setFieldErrors] = useState({});

  const blurField = (field, form, ...args) => {
    const errs = validateFn(form, ...args);
    setFieldErrors(prev => {
      const next = { ...prev };
      if (errs[field]) next[field] = errs[field];
      else delete next[field];
      return next;
    });
  };

  const clearField = (field) => {
    setFieldErrors(prev => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const validateAll = (form, ...args) => {
    const errs = validateFn(form, ...args);
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const inputClass = (field, base = 'aur-input') => {
    const parts = [];
    if (base) parts.push(base);
    if (fieldErrors[field]) parts.push('aur-input--error');
    return parts.join(' ') || undefined;
  };

  return { fieldErrors, setFieldErrors, blurField, clearField, validateAll, inputClass };
}
