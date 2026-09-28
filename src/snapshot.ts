import type { Token } from './store';
import {
  contrastChecks,
  type ContrastIssue,
  type ResolutionIssue,
  type ResolutionResult
} from './resolver';

/**
 * 发布快照：发布瞬间把每个变体的引用链全部物化成最终字面量，连同校验
 * 结果一并冻结。产品消费方按版本拉取到的是不可再被后续编辑改变的值。
 */

export interface ReleaseSnapshot {
  releaseId: string;
  version: string;
  actor: string;
  createdAt: string;
  themes: string[];
  /** tokenId → theme → 最终字面量（断链/成环时为 null，正常情况下门禁不允许） */
  values: Record<string, Record<string, string | null>>;
  /** 冻结时的原始令牌（含各变体原始值），用于回滚到该版本 */
  tokens: Token[];
  acceptedChanges: string[];
  checks: {
    publishable: boolean;
    issues: ResolutionIssue[];
    contrastIssues: ContrastIssue[];
    pendingChanges: number;
  };
}

export function buildReleaseSnapshot(input: {
  version: string;
  releaseId?: string;
  actor: string;
  tokens: Token[];
  result: ResolutionResult;
  pendingChanges: number;
  acceptedChanges: string[];
}): ReleaseSnapshot {
  const contrastIssues = contrastChecks(input.result);
  const publishable =
    input.result.issues.length === 0 &&
    contrastIssues.length === 0 &&
    input.pendingChanges === 0;

  const values: Record<string, Record<string, string | null>> = {};
  for (const token of input.tokens) {
    values[token.id] = {};
    for (const theme of input.result.themes) {
      values[token.id][theme] = input.result.map[theme][token.id]?.value ?? null;
    }
  }

  return {
    releaseId: input.releaseId ?? `DS-${input.version}-${Date.now().toString().slice(-4)}`,
    version: input.version,
    actor: input.actor,
    createdAt: new Date().toISOString(),
    themes: [...input.result.themes],
    values,
    tokens: input.tokens.map((token) => ({ ...token, themes: { ...token.themes } })),
    acceptedChanges: [...input.acceptedChanges],
    checks: {
      publishable,
      issues: [...input.result.issues],
      contrastIssues,
      pendingChanges: input.pendingChanges
    }
  };
}
