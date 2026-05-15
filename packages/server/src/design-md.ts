import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type DesignToken = {
  name: string;
  value: string;
};

export type TypographyToken = {
  name: string;
  fontFamily?: string;
  fontSize?: string;
  fontWeight?: string | number;
  lineHeight?: string;
  letterSpacing?: string;
};

export type DesignLintIssue = {
  rule: 'broken-ref' | 'missing-primary' | 'orphaned-token' | 'token-summary' | 'missing-typography' | 'missing-name';
  severity: 'error' | 'warning' | 'info';
  message: string;
  token?: string;
};

export type DesignSpec = {
  exists: boolean;
  path?: string;
  name?: string;
  description?: string;
  version?: string;
  colors: DesignToken[];
  typography: TypographyToken[];
  rounded: DesignToken[];
  spacing: DesignToken[];
  components: Array<{ name: string; props: Record<string, string> }>;
  lint: DesignLintIssue[];
  raw?: string;
};

const EMPTY: DesignSpec = {
  exists: false,
  colors: [],
  typography: [],
  rounded: [],
  spacing: [],
  components: [],
  lint: [],
};

export function loadDesignMd(projectRoot: string): DesignSpec {
  const path = join(projectRoot, 'DESIGN.md');
  if (!existsSync(path)) return EMPTY;
  try {
    const raw = readFileSync(path, 'utf-8');
    return parseDesignMd(raw, path);
  } catch (err) {
    return {
      ...EMPTY,
      exists: true,
      path,
      lint: [{
        rule: 'token-summary',
        severity: 'error',
        message: 'DESIGN.md exists but could not be read: ' + (err as Error).message,
      }],
    };
  }
}

export function parseDesignMd(raw: string, path?: string): DesignSpec {
  const spec: DesignSpec = { ...EMPTY, exists: true, path, raw };
  const fmMatch = /^---\s*\n([\s\S]*?)\n---\s*\n?/.exec(raw);
  if (!fmMatch) {
    spec.lint.push({ rule: 'missing-name', severity: 'warning', message: 'No YAML frontmatter found.' });
    return spec;
  }
  const yaml = fmMatch[1] as string;
  parseYamlInto(yaml, spec);

  if (!spec.name) {
    spec.lint.push({ rule: 'missing-name', severity: 'warning', message: 'No `name` field in frontmatter.' });
  }
  if (!spec.colors.find(c => c.name.toLowerCase() === 'primary')) {
    spec.lint.push({ rule: 'missing-primary', severity: 'warning', message: 'No primary color defined; agents will auto-generate one.' });
  }
  if (spec.colors.length > 0 && spec.typography.length === 0) {
    spec.lint.push({ rule: 'missing-typography', severity: 'warning', message: 'Colors defined but no typography; agents will use default fonts.' });
  }

  // Check for broken token references: {colors.foo} etc.
  const tokenRefRe = /\{([a-zA-Z][\w.]*)\}/g;
  const allRefs = new Set<string>();
  let m;
  while ((m = tokenRefRe.exec(raw)) !== null) allRefs.add(m[1] as string);

  const allTokens = new Set<string>();
  for (const c of spec.colors) allTokens.add(`colors.${c.name}`);
  for (const t of spec.typography) allTokens.add(`typography.${t.name}`);
  for (const r of spec.rounded) allTokens.add(`rounded.${r.name}`);
  for (const s of spec.spacing) allTokens.add(`spacing.${s.name}`);

  for (const ref of allRefs) {
    if (!allTokens.has(ref)) {
      spec.lint.push({
        rule: 'broken-ref',
        severity: 'error',
        message: `Token reference "${ref}" does not resolve.`,
        token: ref,
      });
    }
  }

  // Orphaned colors (info only, skip primary)
  for (const c of spec.colors) {
    if (!allRefs.has(`colors.${c.name}`) && c.name.toLowerCase() !== 'primary') {
      spec.lint.push({
        rule: 'orphaned-token',
        severity: 'info',
        message: `Color "${c.name}" is not referenced by any component.`,
        token: c.name,
      });
    }
  }

  spec.lint.push({
    rule: 'token-summary',
    severity: 'info',
    message: `${spec.colors.length} colors · ${spec.typography.length} type · ${spec.rounded.length} radii · ${spec.spacing.length} spacing`,
  });
  return spec;
}

// Minimal YAML subset parser — handles the DESIGN.md schema only.
// Supports: top-level scalars, indented blocks (2-space), 4-space nested props,
// quoted strings, and inline object values for typography entries.
function parseYamlInto(yaml: string, spec: DesignSpec): void {
  const lines = yaml.split('\n');
  let section: 'colors' | 'typography' | 'rounded' | 'spacing' | 'components' | null = null;
  let currentTypo: TypographyToken | null = null;
  let currentComp: { name: string; props: Record<string, string> } | null = null;

  function trimQ(s: string): string {
    s = s.trim();
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
      return s.slice(1, -1);
    }
    return s;
  }

  for (const rawLine of lines) {
    if (!rawLine.trim() || rawLine.trim().startsWith('#')) continue;
    const indent = rawLine.length - rawLine.trimStart().length;
    const line = rawLine.trim();

    if (indent === 0) {
      section = null;
      currentTypo = null;
      currentComp = null;
      const keyMatch = /^([a-zA-Z][\w-]*)\s*:\s*(.*)$/.exec(line);
      if (!keyMatch) continue;
      const key = keyMatch[1] as string;
      const val = trimQ(keyMatch[2] as string);
      if (key === 'name')             spec.name = val;
      else if (key === 'description') spec.description = val;
      else if (key === 'version')     spec.version = val;
      else if (key === 'colors')      section = 'colors';
      else if (key === 'typography')  section = 'typography';
      else if (key === 'rounded')     section = 'rounded';
      else if (key === 'spacing')     section = 'spacing';
      else if (key === 'components')  section = 'components';
      continue;
    }

    if (indent === 2 && section) {
      currentTypo = null;
      currentComp = null;
      const keyMatch = /^([a-zA-Z][\w-]*)\s*:\s*(.*)$/.exec(line);
      if (!keyMatch) continue;
      const key = keyMatch[1] as string;
      const val = trimQ(keyMatch[2] as string);
      if (section === 'colors') {
        spec.colors.push({ name: key, value: val });
      } else if (section === 'rounded') {
        spec.rounded.push({ name: key, value: val });
      } else if (section === 'spacing') {
        spec.spacing.push({ name: key, value: val });
      } else if (section === 'typography') {
        const typo: TypographyToken = { name: key };
        if (val) {
          // Inline object: { fontFamily: X, fontSize: Y }
          const inner = val.replace(/^\{|\}$/g, '');
          for (const kv of inner.split(',')) {
            const kvMatch = /^\s*([a-zA-Z][\w-]*)\s*:\s*(.+?)\s*$/.exec(kv);
            if (kvMatch) (typo as Record<string, string>)[kvMatch[1] as string] = trimQ(kvMatch[2] as string);
          }
          spec.typography.push(typo);
        } else {
          currentTypo = typo;
          spec.typography.push(currentTypo);
        }
      } else if (section === 'components') {
        currentComp = { name: key, props: {} };
        spec.components.push(currentComp);
      }
      continue;
    }

    if (indent === 4) {
      const keyMatch = /^([a-zA-Z][\w-]*)\s*:\s*(.*)$/.exec(line);
      if (!keyMatch) continue;
      const key = keyMatch[1] as string;
      const val = trimQ(keyMatch[2] as string);
      if (currentTypo !== null) {
        (currentTypo as Record<string, string>)[key] = val;
      } else if (currentComp !== null) {
        currentComp.props[key] = val;
      }
    }
  }
}

export function designSummary(spec: DesignSpec): string {
  if (!spec.exists) return '';
  const errCount = spec.lint.filter(l => l.severity === 'error').length;
  const parts = [
    `🎨 ${spec.name ?? 'unnamed'}`,
    `${spec.colors.length} colors`,
    `${spec.typography.length} type`,
  ];
  if (errCount > 0) parts.push(`${errCount} err`);
  return parts.join(' · ');
}
