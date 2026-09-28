import { defineStore } from 'pinia';
import {
  contrastChecks,
  parseRef,
  rawThemeValue,
  resolveTokens,
  type ContrastIssue,
  type ResolutionIssue,
  type ResolutionResult,
  type ResolvedToken
} from './resolver';
import { buildReleaseSnapshot, type ReleaseSnapshot } from './snapshot';

export type TokenCategory = 'color' | 'font' | 'spacing' | 'radius' | 'shadow' | 'component';
export type Token = {
  id: string;
  name: string;
  category: TokenCategory;
  value: string;
  ref?: string;
  themes: Record<string, string>;
  usage: number;
  status: 'stable' | 'deprecated' | 'proposed';
  description: string;
};

export type ChangeRequest = {
  id: string;
  title: string;
  requester: string;
  scope: string;
  impact: number;
  status: '待评审' | '已接受' | '已退回';
  diff: { token: string; before: string; after: string };
};

export const THEME_ORDER = ['light', 'dark', 'ops', 'contrast'];
export const THEME_LABELS: Record<string, string> = {
  light: '明亮',
  dark: '暗色',
  ops: '运营',
  contrast: '高对比'
};

const initialTokens: Token[] = [
  { id: 'color.base.blue.600', name: '品牌主色 600', category: 'color', value: '#2864dc', themes: { light: '#2864dc', dark: '#6f96ff', ops: '#24786a', contrast: '#0b4dba' }, usage: 184, status: 'stable', description: '主操作、链接和重点状态' },
  { id: 'color.semantic.primary', name: '语义主色', category: 'color', value: '{color.base.blue.600}', ref: 'color.base.blue.600', themes: { light: '{color.base.blue.600}', dark: '{color.base.blue.400}', ops: '{color.base.green.600}', contrast: '{color.base.blue.800}' }, usage: 126, status: 'stable', description: '组件库统一主色别名' },
  { id: 'color.base.blue.400', name: '品牌蓝 400', category: 'color', value: '#6f96ff', themes: { light: '#6f96ff', dark: '#6f96ff', ops: '#58a99a', contrast: '#2878e8' }, usage: 42, status: 'stable', description: '暗色主题主色' },
  { id: 'color.base.blue.800', name: '品牌蓝 800', category: 'color', value: '#0b4dba', themes: { light: '#0b4dba', dark: '#9ab9ff', ops: '#145c51', contrast: '#06358a' }, usage: 31, status: 'stable', description: '高对比主题主色' },
  { id: 'color.base.green.600', name: '运营绿 600', category: 'color', value: '#24786a', themes: { light: '#24786a', dark: '#54b2a0', ops: '#24786a', contrast: '#0d5a4d' }, usage: 67, status: 'proposed', description: '运营产品品牌替换色' },
  { id: 'color.text.primary', name: '正文主色', category: 'color', value: '#17202b', themes: { light: '#17202b', dark: '#f5f7fa', ops: '#152a25', contrast: '#000000' }, usage: 293, status: 'stable', description: '主要正文和标题' },
  { id: 'color.text.secondary', name: '正文次色', category: 'color', value: '#667582', themes: { light: '#667582', dark: '#a8b2bd', ops: '#62766f', contrast: '#303b46' }, usage: 211, status: 'stable', description: '辅助信息和说明' },
  { id: 'color.surface.canvas', name: '页面背景', category: 'color', value: '#f2f5f7', themes: { light: '#f2f5f7', dark: '#121821', ops: '#f1f6f4', contrast: '#ffffff' }, usage: 54, status: 'stable', description: '应用一级背景' },
  { id: 'font.family.sans', name: '无衬线字体', category: 'font', value: '"Noto Sans SC", sans-serif', themes: { light: '"Noto Sans SC", sans-serif', dark: '"Noto Sans SC", sans-serif', ops: '"Noto Sans SC", sans-serif', contrast: 'system-ui, sans-serif' }, usage: 388, status: 'stable', description: '产品界面默认真体' },
  { id: 'font.size.body', name: '正文字号', category: 'font', value: '14px', themes: { light: '14px', dark: '14px', ops: '14px', contrast: '16px' }, usage: 255, status: 'stable', description: '正文与表单文本' },
  { id: 'spacing.base.2', name: '基础间距 2', category: 'spacing', value: '8px', themes: { light: '8px', dark: '8px', ops: '8px', contrast: '8px' }, usage: 312, status: 'stable', description: '紧凑布局基础间距' },
  { id: 'radius.control', name: '控件圆角', category: 'radius', value: '6px', themes: { light: '6px', dark: '6px', ops: '4px', contrast: '4px' }, usage: 167, status: 'stable', description: '按钮、输入框和卡片' },
  { id: 'shadow.raised', name: '浮层阴影', category: 'shadow', value: '0 8px 28px rgba(22,35,48,.14)', themes: { light: '0 8px 28px rgba(22,35,48,.14)', dark: '0 8px 28px rgba(0,0,0,.42)', ops: '0 8px 28px rgba(21,54,45,.14)', contrast: '0 0 0 2px #303b46' }, usage: 36, status: 'stable', description: '菜单、弹窗和浮层' },
  { id: 'component.button.primary.bg', name: '主按钮背景', category: 'component', value: '{color.semantic.primary}', ref: 'color.semantic.primary', themes: { light: '{color.semantic.primary}', dark: '{color.semantic.primary}', ops: '{color.semantic.primary}', contrast: '{color.semantic.primary}' }, usage: 98, status: 'stable', description: '主要操作按钮' },
  { id: 'component.button.primary.text', name: '主按钮文字', category: 'component', value: '#ffffff', themes: { light: '#ffffff', dark: '#ffffff', ops: '#ffffff', contrast: '#ffffff' }, usage: 98, status: 'stable', description: '主要操作按钮文字' }
];

const changes: ChangeRequest[] = [
  { id: 'CR-412', title: '运营产品切换语义主色', requester: '运营设计组', scope: '4 个产品 · 238 处引用', impact: 86, status: '待评审', diff: { token: 'color.semantic.primary', before: '{color.base.blue.600}', after: '{color.base.green.600}' } },
  { id: 'CR-418', title: '高对比度正文尺寸调整', requester: '无障碍专项组', scope: '2 个产品 · 74 处引用', impact: 42, status: '待评审', diff: { token: 'font.size.body', before: '14px', after: '16px' } },
  { id: 'CR-423', title: '统一浮层圆角', requester: '组件维护组', scope: '12 个组件 · 36 处引用', impact: 28, status: '待评审', diff: { token: 'radius.control', before: '8px', after: '6px' } }
];

const cloneTokens = (tokens: Token[]): Token[] =>
  tokens.map((token) => ({ ...token, themes: { ...token.themes } }));

const storageKey = 'yy63-token-governance';
const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(storageKey) : null;
const saved = raw ? JSON.parse(raw) : null;

export type DiffRow = {
  id: string;
  name: string;
  category: TokenCategory;
  before: Record<string, string>;
  after: Record<string, string>;
  /** 真正发生变化的变体 */
  changedThemes: string[];
};

export const useTokenStore = defineStore('tokens', {
  state: () => ({
    tokens: (saved?.tokens as Token[]) ?? cloneTokens(initialTokens),
    changes: (saved?.changes as ChangeRequest[]) ?? changes,
    activeTheme: (saved?.activeTheme as string) ?? 'light',
    selectedTokenId: (saved?.selectedTokenId as string) ?? 'color.semantic.primary',
    search: (saved?.search as string) ?? '',
    category: (saved?.category as string) ?? '全部',
    releaseVersion: '4.6.0-rc.2',
    locked: (saved?.locked as boolean) ?? false,
    lastPublished: (saved?.lastPublished as string) ?? 'DS 4.5.2',
    /** 发布基线：用于版本差异与回滚，保存每个变体的原始值 */
    baselineTokens: cloneTokens(initialTokens) as Token[],
    /** 历次发布冻结的快照 */
    snapshots: (saved?.snapshots as ReleaseSnapshot[]) ?? []
  }),
  getters: {
    selectedToken(state): Token | undefined {
      return state.tokens.find((token) => token.id === state.selectedTokenId);
    },
    themes(state): string[] {
      const set = new Set<string>(THEME_ORDER);
      state.tokens.forEach((token) => Object.keys(token.themes).forEach((theme) => set.add(theme)));
      return [...set];
    },
    filteredTokens(state): Token[] {
      const query = state.search.toLowerCase();
      return state.tokens.filter((token) => {
        const matchesSearch = !query || token.id.toLowerCase().includes(query) || token.name.includes(state.search);
        const matchesCategory = state.category === '全部' || token.category === state.category;
        return matchesSearch && matchesCategory;
      });
    },
    /** 跨主题解析结果：令牌或变体变化时自动重算，预览/差异/检查共用同一份。 */
    resolution(state): ResolutionResult {
      return resolveTokens(state.tokens, this.themes);
    },
    /** 基础值（明亮模式）的引用边，用于依赖图 */
    dependencyEdges(state) {
      return state.tokens.filter((token) => token.ref).map((token) => ({ from: token.ref!, to: token.id }));
    },
    /** 跨所有变体汇总：在任意变体下成环的令牌 */
    cycleNodes(state): string[] {
      const ids = new Set<string>();
      (this.resolution as ResolutionResult).issues
        .filter((issue) => issue.kind === 'cycle')
        .forEach((issue) => issue.cycleNodes?.forEach((id) => ids.add(id)));
      return [...ids];
    },
    /** 跨所有变体汇总：在任意变体下引用断裂的具体令牌 */
    brokenReferences(): { tokenId: string; refId: string; theme: string }[] {
      return (this.resolution as ResolutionResult).issues
        .filter((issue) => issue.kind === 'broken')
        .map((issue) => ({ tokenId: issue.tokenId, refId: issue.refId!, theme: issue.theme }));
    },
    /** 跨所有变体汇总：类型不匹配的具体令牌 */
    typeMismatches(): ResolutionIssue[] {
      return (this.resolution as ResolutionResult).issues.filter((issue) => issue.kind === 'type-mismatch');
    },
    /** 兼容页面：仍以令牌为单位的失效引用列表 */
    invalidReferences(): Token[] {
      const ids = new Set(this.brokenReferences.map((item) => item.tokenId));
      return this.tokens.filter((token) => ids.has(token.id));
    },
    /** 兼容页面：跨变体成环 + 断链 + 类型错配 */
    resolutionIssues(): ResolutionIssue[] {
      return (this.resolution as ResolutionResult).issues;
    },
    /** 每个变体各自的对比度问题（按解析后的最终颜色计算） */
    contrastIssues(): ContrastIssue[] {
      return contrastChecks(this.resolution as ResolutionResult);
    },
    /** 所有阻塞发布的问题（含具体令牌），按变体分组 */
    publishBlockers(): { theme: string; items: string[] }[] {
      const groups = new Map<string, string[]>();
      const push = (theme: string, text: string) => {
        const list = groups.get(theme) ?? [];
        list.push(text);
        groups.set(theme, list);
      };
      for (const issue of (this.resolution as ResolutionResult).issues) push(issue.theme, issue.message);
      for (const issue of this.contrastIssues) push(issue.theme, issue.detail);
      return [...groups.entries()].map(([theme, items]) => ({ theme, items }));
    },
    pendingChangeCount(state): number {
      return state.changes.filter((item) => item.status === '待评审').length;
    },
    releaseReadiness(): number {
      const issues = (this.resolution as ResolutionResult).issues;
      const penalty =
        issues.filter((issue) => issue.kind === 'cycle').length * 25 +
        issues.filter((issue) => issue.kind === 'broken').length * 20 +
        issues.filter((issue) => issue.kind === 'type-mismatch').length * 15 +
        (this.contrastIssues as ContrastIssue[]).length * 15;
      return Math.max(0, 100 - penalty);
    },
    canPublish(): boolean {
      return (this.resolution as ResolutionResult).issues.length === 0
        && (this.contrastIssues as ContrastIssue[]).length === 0
        && this.pendingChangeCount === 0;
    },
    /** 各变体相对发布基线的差异（比较解析后的最终值，基础令牌改动会传导到别名） */
    diffRows(state): DiffRow[] {
      const baseline = resolveTokens(state.baselineTokens, this.themes);
      return state.tokens.map((token) => {
        const before: Record<string, string> = {};
        const after: Record<string, string> = {};
        const changedThemes: string[] = [];
        for (const theme of this.themes) {
          const oldValue = baseline.map[theme][token.id]?.value ?? '新增';
          const newValue = (this.resolution as ResolutionResult).map[theme][token.id]?.value ?? '（无法解析）';
          before[theme] = oldValue;
          after[theme] = newValue;
          if (oldValue !== newValue) changedThemes.push(theme);
        }
        return { id: token.id, name: token.name, category: token.category, before, after, changedThemes };
      }).filter((row) => row.changedThemes.length > 0);
    },
    /** 当前选中令牌在每个变体下的解析结果，供预览与详情使用 */
    selectedVariantRows(state): { theme: string; resolved: ResolvedToken }[] {
      const id = state.selectedTokenId;
      const result = this.resolution as ResolutionResult;
      return result.themes.map((theme) => ({ theme, resolved: result.map[theme][id] })).filter((row) => row.resolved);
    }
  },
  actions: {
    selectToken(id: string) {
      this.selectedTokenId = id;
      this.persist();
    },
    updateTokenValue(id: string, value: string) {
      const token = this.tokens.find((item) => item.id === id);
      if (!token) return;
      token.themes[this.activeTheme] = value;
      // 基础值即明亮变体；编辑其他变体时不改写基础值，避免污染明亮解析
      if (this.activeTheme === 'light') token.value = value;
      token.ref = parseRef(rawThemeValue(token, 'light')) ?? undefined;
      this.persist();
    },
    addToken(token: Token) {
      if (!this.tokens.some((item) => item.id === token.id)) this.tokens.push(token);
      this.persist();
    },
    setTheme(theme: string) {
      this.activeTheme = theme;
      this.persist();
    },
    setSearch(value: string) { this.search = value; this.persist(); },
    setCategory(value: string) { this.category = value; this.persist(); },
    /** 编辑/批量替换后，按基础值同步组件别名的 ref 元数据（各变体引用以 themes 为准即时解析） */
    syncRefs() {
      this.tokens.forEach((token) => {
        const ref = parseRef(rawThemeValue(token, 'light')) ?? parseRef(token.value);
        if (ref) token.ref = ref;
        else delete token.ref;
      });
    },
    acceptChange(id: string) {
      const change = this.changes.find((item) => item.id === id);
      if (!change) return;
      const token = this.tokens.find((item) => item.id === change.diff.token);
      if (token) this.updateTokenValue(token.id, change.diff.after);
      change.status = '已接受';
      this.persist();
    },
    rejectChange(id: string) {
      const change = this.changes.find((item) => item.id === id);
      if (change) change.status = '已退回';
      this.persist();
    },
    /** 回滚到发布基线：恢复每个变体的原始值与引用元数据，预览/差异/检查随之刷新 */
    rollback() {
      this.tokens = cloneTokens(this.baselineTokens);
      this.syncRefs();
      this.persist();
    },
    /** 门禁通过才允许锁定：先物化发布快照，再锁定版本 */
    lockRelease(releaseId?: string, actor = '设计系统维护员'): ReleaseSnapshot | null {
      if (!this.canPublish) return null;
      const accepted = this.changes.filter((item) => item.status === '已接受').map((item) => item.id);
      const snapshot = buildReleaseSnapshot({
        version: this.releaseVersion,
        releaseId,
        actor,
        tokens: this.tokens,
        result: this.resolution,
        pendingChanges: 0,
        acceptedChanges: accepted
      });
      this.snapshots.unshift(snapshot);
      this.locked = true;
      this.lastPublished = `DS ${this.releaseVersion}`;
      this.persist();
      return snapshot;
    },
    restoreSnapshot(releaseId: string) {
      const snapshot = this.snapshots.find((item) => item.releaseId === releaseId);
      if (!snapshot) return;
      this.tokens = cloneTokens(snapshot.tokens);
      this.syncRefs();
      this.persist();
    },
    persist() {
      if (typeof localStorage !== 'undefined') localStorage.setItem(storageKey, JSON.stringify({ tokens: this.tokens, changes: this.changes, activeTheme: this.activeTheme, selectedTokenId: this.selectedTokenId, search: this.search, category: this.category, locked: this.locked, lastPublished: this.lastPublished, snapshots: this.snapshots }));
    }
  }
});
