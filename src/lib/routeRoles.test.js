import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROUTE_MIN_ROLE, resolveRouteMinRole } from './routeRoles';

// Source of App.jsx read as text — we assert against the JSX without rendering
// the router (which would pull in every lazy page + providers). vitest runs
// with cwd at the project root.
const APP_SRC = readFileSync(join(process.cwd(), 'src', 'App.jsx'), 'utf8');

// Every <RoleRoute path="…"> literal declared in App.jsx.
const roleRoutePaths = [...APP_SRC.matchAll(/<RoleRoute\s+path="([^"]+)"/g)].map(m => m[1]);

describe('routeRoles guardrail', () => {
  it('App.jsx actually uses RoleRoute (sanity: regex still matches)', () => {
    expect(roleRoutePaths.length).toBeGreaterThan(20);
  });

  // The footgun this guards: RoleRoute resolves an unmapped path to a
  // fail-closed default ('administrador'). That keeps unmapped routes safe, but
  // it also silently makes a route admin-only when the dev simply forgot to map
  // it. Forcing every RoleRoute path to be explicit here surfaces the omission
  // at CI instead of as a "why can't encargado see this page?" bug report.
  it('every <RoleRoute path> is explicitly mapped in ROUTE_MIN_ROLE', () => {
    const unmapped = [...new Set(roleRoutePaths)].filter(p => !(p in ROUTE_MIN_ROLE));
    expect(unmapped).toEqual([]);
  });
});

describe('resolveRouteMinRole', () => {
  it('returns the mapped role for a known path', () => {
    expect(resolveRouteMinRole('/users')).toBe('administrador');
    expect(resolveRouteMinRole('/admin/labores')).toBe('supervisor');
  });

  it('FAIL-CLOSED: an unmapped path defaults to administrador, not trabajador', () => {
    expect(resolveRouteMinRole('/some/route/that/does/not/exist')).toBe('administrador');
  });
});
