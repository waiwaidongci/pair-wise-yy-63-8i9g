/**
 * 跨主题引用解析规则（纯函数层）
 *
 * 只负责一件事：给定令牌集合、主题变体和起点令牌，顺着 {token.id}
 * 引用链找到最终颜色或尺寸，并如实报告链上的断链、成环与类型不匹配。
 * 不读取 store、不生成发布快照、不关心页面如何展示。
 */

export type TokenCategory = 'color' | 'font' | 'spacing' | 'radius' | 'shadow' | 'component';

export type ResolvableToken = {
  id: string;
  name?: string;
  category: TokenCategory;
  /** 基础（编辑前）原始值 */
  value: string;
  /** 各主题变体的原始值，缺省回落到基础值 */
  themes?: Record<string, string>;
};

export type IssueType = 'broken' | 'cycle' | 'type-mismatch';

export type ResolveIssue = {
  type: IssueType;
  /** 出问题的令牌（环上令牌为环成员之一） */
  token: string;
  theme: string;
  message: string;
  /** 已走过的引用链，含起点 */
  path: string[];
};

export type ResolveResult = {
  /** 解析是否成功（拿到非引用字面量） */
  ok: boolean;
  /** 最终值；失败时为 undefined */
  value?: string;
  /** 完整链路，含起点；断链时包含悬空引用目标，成环时止于首次重复节点 */
  path: string[];
  /** 终点令牌分类（用于判断最终是颜色还是尺寸） */
  finalCategory?: TokenCategory;
  issue?: ResolveIssue;
};

export const THEME_KEYS = ['light', 'dark', 'ops', 'contrast'] as const;
export const THEME_LABELS: Record<string, string> = {
  light: '明亮模式',
  dark: '暗色模式',
  ops: '运营模式',
  contrast: '高对比度'
};

const REFERENCE_RE = /^\{([^{}]+)\}$/;

/** 原始值是否为引用表达式，如 {color.semantic.primary} */
export function parseReference(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const match = raw.trim().match(REFERENCE_RE);
  return match ? match[1].trim() : null;
}

/**
 * 引用链上的分类是否兼容。
 * color/font/spacing/radius/shadow 只能引用同分类；component（组件别名）
 * 可别名到任意分类，但不允许 component 之间互指。
 */
function categoryCompatible(from: TokenCategory, to: TokenCategory): boolean {
  if (from === 'component') return to !== 'component';
  return from === to;
}

/**
 * 在指定主题变体下，从 startId 起顺着引用解析最终值。
 * 每个变体独立成链：主题里引用了谁，就进入该被引令牌的同一主题继续解析。
 */
export function resolveChain(
  tokens: ResolvableToken[],
  theme: string,
  startId: string
): ResolveResult {
  const byId = new Map(tokens.map((token) => [token.id, token]));
  const rawOf = (id: string): string | undefined => {
    const token = byId.get(id);
    if (!token) return undefined;
    return token.themes && theme in token.themes ? token.themes[theme] : token.value;
  };

  const path: string[] = [];
  let currentId = startId;
  let current: ResolvableToken | undefined = byId.get(currentId);

  const fail = (type: IssueType, message: string, extraPath?: string[]): ResolveResult => ({
    ok: false,
    path: extraPath ? [...path, ...extraPath] : [...path],
    issue: { type, token: startId, theme, message, path: extraPath ? [...path, ...extraPath] : [...path] }
  });

  if (!current) {
    return fail('broken', `起始令牌 ${startId} 不存在`);
  }

  // 有界步数防御，正常情况由 seen 终止。
  for (let guard = 0; guard <= tokens.length + 1; guard += 1) {
    if (path.includes(currentId)) {
      const cycleStart = path.indexOf(currentId);
      const cycleMembers = path.slice(cycleStart);
      return {
        ok: false,
        path: [...path, currentId],
        issue: {
          type: 'cycle',
          token: currentId,
          theme,
          message: `${THEME_LABELS[theme] ?? theme}：引用成环（${cycleMembers.join(' → ')} → ${currentId}）`,
          path: [...path, currentId]
        }
      };
    }
    path.push(currentId);

    const raw = rawOf(currentId);
    const refId = parseReference(raw);
    if (refId === null) {
      return { ok: true, value: raw, path: [...path], finalCategory: current.category };
    }

    const next = byId.get(refId);
    if (!next) {
      return fail('broken', `${THEME_LABELS[theme] ?? theme}：${currentId} 引用的 ${refId} 不存在（引用链断开）`, [refId]);
    }
    if (!categoryCompatible(current.category, next.category)) {
      return fail(
        'type-mismatch',
        `${THEME_LABELS[theme] ?? theme}：${currentId}（${current.category}）不能引用 ${refId}（${next.category}），引用链类型不匹配`
      );
    }

    currentId = refId;
    current = next;
  }

  return fail('cycle', `${THEME_LABELS[theme] ?? theme}：引用链超过最大长度`);
}

/** 单个令牌在单个主题下的解析结果，缺令牌时得到断链结果 */
export function resolveToken(tokens: ResolvableToken[], theme: string, id: string): ResolveResult {
  return resolveChain(tokens, theme, id);
}

/** 全部令牌在指定主题下的解析结果 */
export function resolveTheme(
  tokens: ResolvableToken[],
  theme: string
): Record<string, ResolveResult> {
  const results: Record<string, ResolveResult> = {};
  tokens.forEach((token) => {
    results[token.id] = resolveChain(tokens, theme, token.id);
  });
  return results;
}

/** 全部令牌 × 全部变体的解析结果 */
export function resolveAllThemes(
  tokens: ResolvableToken[],
  themes: readonly string[] = THEME_KEYS
): Record<string, Record<string, ResolveResult>> {
  const map: Record<string, Record<string, ResolveResult>> = {};
  themes.forEach((theme) => {
    map[theme] = resolveTheme(tokens, theme);
  });
  return map;
}

/**
 * 汇总指定主题下的失效引用。
 * 断链 / 类型不匹配只报告出问题的令牌本身；成环每个环成员各列一条。
 */
export function collectIssues(results: Record<string, ResolveResult>): ResolveIssue[] {
  const issues: ResolveIssue[] = [];
  Object.entries(results).forEach(([id, result]) => {
    if (!result.issue) return;
    const issue = result.issue;
    if (issue.type === 'cycle') {
      if (!issues.some((item) => item.type === 'cycle' && item.token === id && item.theme === issue.theme)) {
        issues.push(issue);
      }
    } else {
      if (!issues.some((item) => item.type === issue.type && item.token === id && item.theme === issue.theme)) {
        issues.push(issue);
      }
    }
  });
  return issues;
}

/** 跨全部变体汇总失效引用（去重） */
export function collectAllIssues(
  resolved: Record<string, Record<string, ResolveResult>>
): ResolveIssue[] {
  const all: ResolveIssue[] = [];
  Object.values(resolved).forEach((results) => all.push(...collectIssues(results)));
  return all;
}

/** 粗略判断最终值是否可作为 CSS 颜色渲染（十六进制 / rgb / hsl / 命名透明通道） */
export function isColorValue(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return /^#[0-9a-f]{3}([0-9a-f]{3})?([0-9a-f]{2})?$/.test(v)
    || /^rgba?\(/.test(v)
    || /^hsla?\(/.test(v);
}
