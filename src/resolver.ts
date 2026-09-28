import type { Token, TokenCategory } from './store';

/**
 * 跨主题引用解析规则（与发布快照、页面展示分离）。
 *
 * 每个变体（light / dark / ops / contrast …）独立沿 `{token.id}` 引用链
 * 走到最终字面量（颜色、尺寸等）。每个变体各自成图，因此同一枚令牌在不同
 * 变体下的断链、成环和类型错配都会被单独检出。
 */

export type IssueKind = 'broken' | 'cycle' | 'type-mismatch';

export interface ResolutionIssue {
  kind: IssueKind;
  /** 变体 key，如 light / dark / ops / contrast */
  theme: string;
  /** 问题归属的具体令牌（声明引用的那一枚；成环时为环入口） */
  tokenId: string;
  /** 引用目标令牌 */
  refId?: string;
  /** 从起始令牌走到问题位置经过的完整链 */
  path: string[];
  /** 成环时环上的令牌 */
  cycleNodes?: string[];
  message: string;
}

export interface ResolvedToken {
  id: string;
  category: TokenCategory;
  /** 该变体下的原始值（可能是 `{ref}` 或字面量） */
  raw: string;
  /** 沿引用链解析出的最终字面量；断链/成环时为 null */
  value: string | null;
  /** 从本令牌开始实际经过的令牌 id 链 */
  chain: string[];
  /** 沿链遇到的问题（同一问题在全局只登记一次） */
  issues: ResolutionIssue[];
}

export interface ResolutionResult {
  themes: string[];
  map: Record<string, Record<string, ResolvedToken>>;
  issues: ResolutionIssue[];
  byId: Map<string, Token>;
}

export interface ContrastIssue {
  theme: string;
  ratio?: number;
  detail: string;
}

const REF_PATTERN = /^\{([^{}]+)\}$/;

/** 取一枚令牌在指定变体下的原始值；变体缺省回退到基础值。 */
export function rawThemeValue(token: Token, theme: string): string {
  return token.themes[theme] ?? token.value;
}

/** 识别 `{token.id}` 形式的引用，返回目标 id。 */
export function parseRef(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  const match = raw.trim().match(REF_PATTERN);
  return match ? match[1].trim() : null;
}

const kindLabel: Record<IssueKind, string> = {
  broken: '引用链断开',
  cycle: '引用成环',
  'type-mismatch': '类型不匹配'
};

export function issueKindLabel(kind: IssueKind): string {
  return kindLabel[kind];
}

/**
 * 对所有变体分别解析全部令牌。
 */
export function resolveTokens(tokens: Token[], themes: string[]): ResolutionResult {
  const byId = new Map(tokens.map((token) => [token.id, token]));
  const map: Record<string, Record<string, ResolvedToken>> = {};
  // 同一（变体、问题位置、类型）只登记一条，避免深层问题被链上每个别名重复计数。
  const registered = new Map<string, ResolutionIssue>();

  const register = (issue: ResolutionIssue): ResolutionIssue => {
    const key = issue.kind === 'cycle'
      ? `cycle|${issue.theme}|${[...(issue.cycleNodes ?? [])].sort().join('>')}`
      : `${issue.kind}|${issue.theme}|${issue.tokenId}|${issue.refId ?? ''}`;
    const existing = registered.get(key);
    if (existing) return existing;
    registered.set(key, issue);
    return issue;
  };

  for (const theme of themes) {
    map[theme] = {};
    for (const token of tokens) {
      map[theme][token.id] = walk(byId, theme, token.id, register);
    }
  }

  return { themes, map, issues: [...registered.values()], byId };
}

function walk(
  byId: Map<string, Token>,
  theme: string,
  startId: string,
  register: (issue: ResolutionIssue) => ResolutionIssue
): ResolvedToken {
  const start = byId.get(startId)!;
  const path: string[] = [];
  const seen = new Set<string>();
  const encountered: ResolutionIssue[] = [];
  let currentId = startId;
  let value: string | null = null;

  for (;;) {
    if (seen.has(currentId)) {
      const cycleNodes = path.slice(path.indexOf(currentId));
      encountered.push(register({
        kind: 'cycle',
        theme,
        tokenId: currentId,
        path: [...path, currentId],
        cycleNodes,
        message: `变体 ${theme} 下 ${cycleNodes.join(' → ')} 引用成环，无法解析出最终值`
      }));
      value = null;
      break;
    }

    seen.add(currentId);
    path.push(currentId);

    const token = byId.get(currentId);
    if (!token) {
      // 链上一环缺失：path 倒数第二个是声明该引用的令牌
      const sourceId = path[path.length - 2] ?? startId;
      encountered.push(register({
        kind: 'broken',
        theme,
        tokenId: sourceId,
        refId: currentId,
        path: [...path],
        message: `变体 ${theme} 下 ${sourceId} 引用的 ${currentId} 不存在，引用链在 ${sourceId} 处断开`
      }));
      value = null;
      break;
    }

    const raw = rawThemeValue(token, theme);
    const refId = parseRef(raw);
    if (!refId) {
      value = raw;
      break;
    }

    const target = byId.get(refId);
    if (!target) {
      encountered.push(register({
        kind: 'broken',
        theme,
        tokenId: token.id,
        refId,
        path: [...path],
        message: `变体 ${theme} 下 ${token.id} 引用的 ${refId} 不存在，引用链在 ${token.id} 处断开`
      }));
      value = null;
      break;
    }

    // 组件别名可以指向任意类型（颜色、尺寸…）；其余令牌只能引用同类型令牌。
    if (
      token.category !== 'component' &&
      target.category !== 'component' &&
      target.category !== token.category
    ) {
      encountered.push(register({
        kind: 'type-mismatch',
        theme,
        tokenId: token.id,
        refId,
        path: [...path],
        message: `变体 ${theme} 下 ${token.id}（${token.category}）引用了 ${refId}（${target.category}），类型不匹配`
      }));
    }

    currentId = refId;
  }

  return {
    id: startId,
    category: start.category,
    raw: rawThemeValue(start, theme),
    value,
    chain: path,
    issues: dedupeIssues(encountered)
  };
}

function dedupeIssues(issues: ResolutionIssue[]): ResolutionIssue[] {
  const seen = new Set<ResolutionIssue>();
  return issues.filter((issue) => {
    if (seen.has(issue)) return false;
    seen.add(issue);
    return true;
  });
}

/**
 * 对每个变体校验正文主色与页面背景的对比度（WCAG AA 4.5:1）。
 * 颜色必须经跨主题解析拿到最终字面量后再计算。
 */
export function contrastChecks(result: ResolutionResult): ContrastIssue[] {
  const issues: ContrastIssue[] = [];
  for (const theme of result.themes) {
    const text = result.map[theme]['color.text.primary'];
    const surface = result.map[theme]['color.surface.canvas'];
    if (!text?.value || !surface?.value) {
      const missing = !text?.value ? 'color.text.primary' : 'color.surface.canvas';
      issues.push({
        theme,
        detail: `变体 ${theme} 下 ${missing} 引用链未解析到颜色字面量，无法校验对比度`
      });
      continue;
    }
    const a = parseColor(text.value);
    const b = parseColor(surface.value);
    if (!a || !b) {
      issues.push({
        theme,
        detail: `变体 ${theme} 下颜色值不是十六进制字面量（${!a ? text.value : surface.value}），无法校验对比度`
      });
      continue;
    }
    const ratio = contrastRatio(a, b);
    if (ratio < 4.5) {
      issues.push({ theme, ratio, detail: `变体 ${theme} 正文与页面背景对比度 ${ratio.toFixed(2)}:1，低于 AA 要求的 4.5:1` });
    }
  }
  return issues;
}

type Rgb = [number, number, number];

function parseColor(raw: string): Rgb | null {
  const clean = raw.trim().replace('#', '');
  if (clean.length !== 6 || /[^0-9a-fA-F]/.test(clean)) return null;
  return [0, 2, 4].map((index) => parseInt(clean.slice(index, index + 2), 16)) as Rgb;
}

function contrastRatio(a: Rgb, b: Rgb): number {
  const luminance = (rgb: Rgb) => {
    const channels = rgb.map((channel) => {
      const value = channel / 255;
      return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
