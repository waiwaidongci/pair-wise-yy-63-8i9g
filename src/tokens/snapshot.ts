/**
 * 发布快照层
 *
 * 在发布时点把草稿令牌冻结成只读快照：每个主题变体一份，包含每个令牌
 * 的原始值、顺引用解析出的最终值、引用链与失效原因；同时汇总跨变体差异。
 * 只依赖 resolver 的纯函数结果，不触碰 Pinia 状态与页面。
 */

import {
  resolveAllThemes,
  resolveChain,
  collectAllIssues,
  THEME_KEYS,
  THEME_LABELS,
  type ResolvableToken,
  type ResolveIssue,
  type ResolveResult,
  type IssueType
} from './resolver';

export type BaselineEntry = { id: string; value: string; themes?: Record<string, string> };

export type SnapshotToken = {
  id: string;
  name: string;
  category: ResolvableToken['category'];
  /** 该变体下的原始值（可能是引用表达式） */
  raw: string;
  /** 解析后的最终颜色或尺寸；链失效时为空 */
  resolvedValue?: string;
  /** 引用链（含起点） */
  path: string[];
  issue?: ResolveIssue;
};

export type ThemeSnapshot = {
  key: string;
  label: string;
  tokens: SnapshotToken[];
  issues: ResolveIssue[];
  /** 成功解析出最终值的令牌数 */
  resolvedCount: number;
};

export type DiffRow = {
  id: string;
  name: string;
  /** 差异所在变体；缺省表示基础值差异 */
  theme?: string;
  themeLabel?: string;
  before: string;
  after: string;
};

export type ReleaseSnapshot = {
  version: string;
  createdAt: string;
  themes: ThemeSnapshot[];
  /** 跨全部变体的失效引用（去重） */
  issues: ResolveIssue[];
  diff: DiffRow[];
  summary: { tokens: number; themes: number; resolved: number; failed: number };
};

function rawOf(token: ResolvableToken, theme: string): string {
  return token.themes && theme in token.themes ? token.themes[theme] : token.value;
}

/**
 * 相对基线计算原始值差异：基础值差异 + 每个变体各自的差异。
 * 基线中不存在的令牌按“新增”处理。
 */
export function buildDiff(tokens: ResolvableToken[], baseline: BaselineEntry[], themes: readonly string[]): DiffRow[] {
  const rows: DiffRow[] = [];
  const baseById = new Map(baseline.map((item) => [item.id, item]));

  tokens.forEach((token) => {
    const base = baseById.get(token.id);
    if (!base) {
      rows.push({ id: token.id, name: token.name ?? token.id, before: '新增', after: token.value });
      return;
    }
    if (base.value !== token.value) {
      rows.push({ id: token.id, name: token.name ?? token.id, before: base.value, after: token.value });
    }
    themes.forEach((theme) => {
      const before = base.themes && theme in base.themes ? base.themes[theme] : base.value;
      const after = rawOf(token, theme);
      if (before !== after) {
        rows.push({
          id: token.id,
          name: token.name ?? token.id,
          theme,
          themeLabel: THEME_LABELS[theme] ?? theme,
          before,
          after
        });
      }
    });
  });

  return rows;
}

export type ResolvedDiffRow = {
  key: string;
  id: string;
  name: string;
  theme: string;
  themeLabel: string;
  /** 基线解析结果 */
  before: ResolveResult;
  /** 当前草稿解析结果 */
  after: ResolveResult;
};

export function issueTypeLabel(type: IssueType): string {
  if (type === 'broken') return '引用断开';
  if (type === 'cycle') return '引用成环';
  return '类型不匹配';
}

/**
 * 跨变体差异：对每个变体分别解析基线与当前草稿，比较“最终值 + 失效状态”。
 * 基础令牌改动后，别名在该变体下解析出的最终值若随之变化，会作为差异列出；
 * 原本可解析、现在断链/成环/类型不匹配（或反过来修复）也算差异。
 */
export function buildResolvedDiff(
  tokens: ResolvableToken[],
  baselineTokens: ResolvableToken[],
  themes: readonly string[] = THEME_KEYS
): ResolvedDiffRow[] {
  const rows: ResolvedDiffRow[] = [];
  const baselineById = new Map(baselineTokens.map((token) => [token.id, token]));

  tokens.forEach((token) => {
    themes.forEach((theme) => {
      const after = resolveChain(tokens, theme, token.id);
      const baseToken = baselineById.get(token.id);
      const before = baseToken
        ? resolveChain(baselineTokens, theme, baseToken.id)
        : undefined;

      const sameOutcome = before
        ? before.ok === after.ok
          && before.value === after.value
          && (before.issue?.type ?? null) === (after.issue?.type ?? null)
        : false;

      if (!sameOutcome) {
        rows.push({
          key: `${token.id}@${theme}`,
          id: token.id,
          name: token.name ?? token.id,
          theme,
          themeLabel: THEME_LABELS[theme] ?? theme,
          before: before ?? { ok: false, path: [], issue: { type: 'broken', token: token.id, theme, message: '基线中不存在该令牌', path: [] } },
          after
        });
      }
    });
  });

  return rows;
}

/** 在发布时点生成只读快照 */
export function buildReleaseSnapshot(
  tokens: ResolvableToken[],
  version: string,
  baseline: BaselineEntry[],
  themes: readonly string[] = THEME_KEYS
): ReleaseSnapshot {
  const resolved = resolveAllThemes(tokens, themes);
  const themeSnapshots: ThemeSnapshot[] = themes.map((theme) => {
    const themeResults = resolved[theme];
    const snapshotTokens: SnapshotToken[] = tokens.map((token) => {
      const result: ResolveResult = themeResults[token.id];
      return {
        id: token.id,
        name: token.name ?? token.id,
        category: token.category,
        raw: rawOf(token, theme),
        resolvedValue: result.ok ? result.value : undefined,
        path: result.path,
        issue: result.issue
      };
    });
    const issues = snapshotTokens.filter((item) => item.issue).map((item) => item.issue!);
    return {
      key: theme,
      label: THEME_LABELS[theme] ?? theme,
      tokens: snapshotTokens,
      issues,
      resolvedCount: snapshotTokens.filter((item) => !item.issue).length
    };
  });

  const issues = collectAllIssues(resolved);
  const diff = buildDiff(tokens, baseline, themes);

  return {
    version,
    createdAt: new Date().toISOString(),
    themes: themeSnapshots,
    issues,
    diff,
    summary: {
      tokens: tokens.length,
      themes: themes.length,
      resolved: themeSnapshots.reduce((sum, item) => sum + item.resolvedCount, 0),
      failed: issues.length
    }
  };
}
