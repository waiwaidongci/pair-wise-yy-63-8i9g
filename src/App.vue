<script setup lang="ts">
import { computed, h, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useQuery, useMutation } from '@tanstack/vue-query';
import { MessagePlugin } from 'tdesign-vue-next';
import {
  AddIcon,
  ArrowRightIcon,
  CopyIcon,
  HistoryIcon,
  LockOnIcon,
  RefreshIcon,
  SearchIcon,
  SwapIcon
} from 'tdesign-icons-vue-next';
import TokenEditor from './components/TokenEditor.vue';
import { fetchTokens, submitRelease, type Token } from './api';
import { useTokenStore } from './store';
import { isColorValue, parseReference, type ResolveResult } from './tokens/resolver';

const AddButtonIcon = () => h(AddIcon);
const ArrowRightButtonIcon = () => h(ArrowRightIcon);
const CopyButtonIcon = () => h(CopyIcon);
const HistoryButtonIcon = () => h(HistoryIcon);
const LockButtonIcon = () => h(LockOnIcon);
const RefreshButtonIcon = () => h(RefreshIcon);
const SearchInputIcon = () => h(SearchIcon);
const SwapButtonIcon = () => h(SwapIcon);

const route = useRoute();
const router = useRouter();
const store = useTokenStore();
const { data: remote } = useQuery({ queryKey: ['tokens'], queryFn: fetchTokens });
const selectedVersion = ref(store.releaseVersion);
const batchFrom = ref('');
const batchTo = ref('');
const releaseDialog = ref(false);
const newTokenDialog = ref(false);
const newToken = ref({ id: '', name: '', category: 'color', value: '#2864dc', description: '' });
const releaseResult = ref('');

const nav = [
  { path: '/', label: '令牌工作区', icon: 'token' },
  { path: '/graph', label: '依赖与校验', icon: 'control-platform' },
  { path: '/review', label: '变更评审', icon: 'git-commit' },
  { path: '/publish', label: '主题发布', icon: 'send' }
];

const pageTitle = computed(() => nav.find((item) => item.path === route.path)?.label ?? '令牌工作区');
const selected = computed<Token | undefined>(() => store.selectedToken);

/** 当前变体下选中令牌顺引用解析出的最终值与引用链 */
const selectedResolution = computed<ResolveResult | undefined>(() =>
  selected.value ? store.activeResolved[selected.value.id] : undefined
);
const selectedResolvedValue = computed(() => (selectedResolution.value?.ok ? selectedResolution.value.value : undefined));
const selectedChain = computed(() => selectedResolution.value?.path ?? []);

function resolvedValue(id: string): string | undefined {
  const result = store.activeResolved[id];
  return result?.ok ? result.value : undefined;
}
function resolvedColor(id: string): string | undefined {
  const value = resolvedValue(id);
  return value && isColorValue(value) ? value : undefined;
}
function rawInActiveTheme(token: Token): string {
  return store.activeTheme in token.themes ? token.themes[store.activeTheme] : token.value;
}

/** 组件预览按当前变体解析后的最终颜色/尺寸渲染（别名会跟随基础令牌联动） */
const previewStyle = computed(() => {
  const style: Record<string, string> = {};
  const canvas = resolvedColor('color.surface.canvas');
  const text = resolvedColor('color.text.primary');
  const primary = resolvedColor('color.semantic.primary');
  const radius = resolvedValue('radius.control');
  const bodySize = resolvedValue('font.size.body');
  if (canvas) style.background = canvas;
  if (text) style.color = text;
  if (radius) style['--preview-radius'] = radius;
  if (bodySize) style.fontSize = bodySize;
  return { vars: style, primary: primary ?? '#2864dc' };
});

const selectedJson = computed(() => selected.value ? JSON.stringify({
  id: selected.value.id,
  name: selected.value.name,
  category: selected.value.category,
  value: selected.value.value,
  ref: selected.value.ref,
  activeTheme: store.activeTheme,
  activeRaw: rawInActiveTheme(selected.value),
  resolved: selectedResolvedValue.value ?? null,
  chain: selectedChain.value,
  themes: selected.value.themes,
  description: selected.value.description,
  status: selected.value.status
}, null, 2) : '{}');
const categories = computed(() => ['全部', ...new Set(store.tokens.map((token) => token.category))]);

/** 当前变体下的失效令牌 ID（树标红用） */
const activeIssueTokenIds = computed(() => new Set(
  store.allIssues.filter((view) => view.theme === store.activeTheme).map((view) => view.tokenId)
));

function graphPosition(category: string, index: number) {
  const grouped = ['color', 'font', 'spacing', 'radius', 'shadow', 'component'];
  return { x: 90 + grouped.indexOf(category) * 148, y: 64 + (index % 4) * 118 };
}

/** 依赖图节点：真实节点 + 断链悬空引用的虚拟节点 */
const graphNodes = computed(() => {
  const realIds = new Set(store.tokens.map((token) => token.id));
  const nodeTokens = store.tokens.filter(
    (token) => parseReference(rawInActiveTheme(token)) || store.activeEdges.some((edge) => edge.from === token.id)
  );
  const positioned = nodeTokens.map((token, index) => ({
    id: token.id,
    name: token.name,
    category: token.category,
    dangling: false,
    ...graphPosition(token.category, index)
  }));
  const dangling = new Set<string>();
  store.activeEdges.forEach((edge) => {
    if (!realIds.has(edge.from)) dangling.add(edge.from);
  });
  const danglingNodes = [...dangling].map((id, index) => ({
    id,
    name: id.split('.').pop() ?? id,
    category: 'missing' as const,
    dangling: true,
    x: 110 + index * 170,
    y: 478
  }));
  return [...positioned, ...danglingNodes];
});

const graphEdges = computed(() => store.activeEdges.map((edge) => {
  const from = graphNodes.value.find((node) => node.id === edge.from);
  const to = graphNodes.value.find((node) => node.id === edge.to);
  if (!from || !to) return null;
  const targetResult = store.activeResolved[edge.to];
  return {
    ...edge,
    from,
    to,
    broken: !!targetResult?.issue && targetResult.issue.type === 'broken',
    mismatch: !!targetResult?.issue && targetResult.issue.type === 'type-mismatch'
  };
}).filter(Boolean) as { from: { id: string; x: number; y: number }; to: { id: string; x: number; y: number }; broken: boolean; mismatch: boolean }[]);

/** 发布前失效引用按变体分组列出具体令牌 */
const issuesByTheme = computed(() => store.themes.map((theme) => ({
  theme,
  label: store.themeLabels[theme] ?? theme,
  items: store.issueList.filter((item) => item.theme === theme)
})));

const pendingChanges = computed(() => store.changes.filter((item) => item.status === '待评审').length);
const publishBlocked = computed(() => store.allIssues.length > 0 || store.contrastIssues.length > 0 || pendingChanges.value > 0);

function formatResolve(result: ResolveResult | undefined): string {
  if (!result) return '—';
  if (result.ok) return result.value ?? '—';
  return result.issue ? `${result.issue.type === 'broken' ? '断开' : result.issue.type === 'cycle' ? '成环' : '类型不匹配'}` : '失效';
}

const releaseMutation = useMutation({
  mutationFn: (payload: { version: string; accepted: string[]; actor: string }) => submitRelease(payload),
  onSuccess: (data) => {
    releaseResult.value = `发布标识 ${data.releaseId} · ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
    MessagePlugin.success('主题版本已锁定并生成发布记录');
  }
});

watch(remote, (value) => {
  if (value && !store.tokens.length) value.tokens.forEach((token) => store.addToken(token));
});

function go(path: string) {
  router.push(path);
}

function updateEditor(value: string) {
  try {
    const parsed = JSON.parse(value) as Partial<Token>;
    if (parsed.value !== undefined) store.updateTokenValue(store.selectedTokenId, parsed.value);
  } catch {
    // Keep invalid JSON editable; validation is shown in the dependency panel.
  }
}

function addToken() {
  if (!newToken.value.id || !store.tokens.every((token) => token.id !== newToken.value.id)) {
    MessagePlugin.error('令牌 ID 不能为空且不能重复');
    return;
  }
  store.addToken({
    id: newToken.value.id,
    name: newToken.value.name || newToken.value.id,
    category: newToken.value.category as Token['category'],
    value: newToken.value.value,
    themes: { light: newToken.value.value, dark: newToken.value.value, ops: newToken.value.value, contrast: newToken.value.value },
    usage: 0,
    status: 'proposed',
    description: newToken.value.description
  });
  store.selectToken(newToken.value.id);
  newTokenDialog.value = false;
  newToken.value = { id: '', name: '', category: 'color', value: '#2864dc', description: '' };
  MessagePlugin.success('已创建候选令牌');
}

function batchReplace() {
  if (!batchFrom.value || !batchTo.value) return;
  let count = 0;
  store.tokens.forEach((token) => {
    Object.keys(token.themes).forEach((theme) => {
      if (token.themes[theme] === batchFrom.value) {
        token.themes[theme] = batchTo.value;
        count += 1;
      }
    });
    if (token.value === batchFrom.value) {
      token.value = batchTo.value;
      count += 1;
    }
    const refId = parseReference(token.themes[store.activeTheme]);
    if (refId) token.ref = refId;
    else delete token.ref;
  });
  store.persist();
  MessagePlugin.success(`已替换 ${count} 处值，引用链将跨主题重新解析`);
}

function publish() {
  if (publishBlocked.value) {
    MessagePlugin.warning('仍有失效引用、对比度问题或待评审变更，无法发布');
    router.push('/publish');
    return;
  }
  const accepted = store.changes.filter((item) => item.status === '已接受').map((item) => item.id);
  releaseMutation.mutate({ version: selectedVersion.value, accepted, actor: '设计系统维护员' });
  store.lockRelease();
  releaseDialog.value = true;
}
</script>

<template>
  <t-layout class="app-shell">
    <t-header class="app-header">
      <div class="brand"><span class="brand-mark">DS</span><div><strong>设计令牌治理台</strong><small>Cross-product Token Governance</small></div></div>
      <div class="release-chip"><span>当前候选</span><strong>DS {{ store.releaseVersion }}</strong></div>
      <div class="header-spacer" />
      <t-tag theme="success" variant="light-outline">校验通过 {{ store.releaseReadiness }}%</t-tag>
      <div class="operator"><span>设计系统维护员</span><strong>顾清 · Core DS</strong></div>
    </t-header>
    <t-layout class="body-layout">
      <t-aside class="side-nav">
        <div class="workspace-card"><t-icon name="layers" /><div><span>当前工作区</span><strong>通用组件库 · 品牌主题</strong><small>15 个令牌 · 4 个主题变体</small></div></div>
        <nav><button v-for="item in nav" :key="item.path" :class="{ active: route.path === item.path }" @click="go(item.path)"><t-icon :name="item.icon" /><span>{{ item.label }}</span><t-badge v-if="item.path === '/review'" :count="store.changes.filter(c => c.status === '待评审').length" /></button></nav>
        <div class="save-state"><t-icon name="cloud-done" /><div><span>草稿已保存</span><small>{{ new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) }}</small></div></div>
      </t-aside>
      <t-content class="main-content">
        <header class="page-heading">
          <div><small>{{ store.locked ? 'RELEASE LOCKED' : 'GOVERNANCE WORKBENCH' }} / {{ pageTitle }}</small><h1>{{ pageTitle }}</h1><p>基础令牌到语义令牌的引用、差异、校验与跨主题发布。</p></div>
          <div class="heading-actions"><t-select :model-value="store.activeTheme" style="width: 150px" :options="[{label:'明亮模式',value:'light'},{label:'暗色模式',value:'dark'},{label:'运营模式',value:'ops'},{label:'高对比度',value:'contrast'}]" @update:model-value="store.setTheme" /><t-button variant="outline" :icon="AddButtonIcon" @click="newTokenDialog = true">新建令牌</t-button><t-button theme="primary" :icon="LockButtonIcon" :disabled="store.locked || publishBlocked" @click="publish">发布主题</t-button></div>
        </header>

        <section v-if="route.path === '/'" class="token-workspace">
          <aside class="token-tree panel">
            <div class="panel-head"><div><strong>令牌树</strong><span>{{ store.filteredTokens.length }} 个匹配项</span></div><t-button size="small" variant="text" :icon="RefreshButtonIcon" @click="store.rollback">回滚</t-button></div>
            <t-input v-model="store.search" clearable placeholder="搜索令牌 ID 或名称" :prefix-icon="SearchInputIcon" />
            <div class="category-tabs"><button v-for="category in categories" :key="category" :class="{ active: store.category === category }" @click="store.setCategory(category)">{{ category }}</button></div>
            <div class="tree-list">
              <button v-for="token in store.filteredTokens" :key="token.id" :class="{ active: store.selectedTokenId === token.id, issue: activeIssueTokenIds.has(token.id) }" @click="store.selectToken(token.id)">
                <i :class="token.category" />
                <div><strong>{{ token.name }}</strong><span>{{ token.id }}</span></div>
                <t-tag v-if="activeIssueTokenIds.has(token.id)" size="small" theme="danger" variant="light">失效</t-tag>
                <t-tag v-else size="small" :theme="token.status === 'stable' ? 'success' : token.status === 'proposed' ? 'warning' : 'default'" variant="light">{{ token.status === 'stable' ? '稳定' : token.status === 'proposed' ? '候选' : '弃用' }}</t-tag>
              </button>
            </div>
          </aside>
          <section class="editor-column">
            <div class="panel editor-panel">
              <div class="panel-head"><div><strong>Monaco 令牌编辑</strong><span>{{ selected?.id }} · {{ store.themeLabels[store.activeTheme] }}</span></div><div class="editor-actions"><t-tag v-if="selectedResolution?.ok && selectedChain.length > 1" variant="light">解析链 {{ selectedChain.join(' → ') }}</t-tag><t-tag v-else-if="selectedResolution?.issue" theme="danger" variant="light">{{ selectedResolution.issue.type === 'broken' ? '引用断开' : selectedResolution.issue.type === 'cycle' ? '引用成环' : '类型不匹配' }}</t-tag><t-button size="small" variant="outline" :icon="CopyButtonIcon">复制 JSON</t-button></div></div>
              <div class="editor-host"><TokenEditor :model-value="selectedJson" language="json" @update:model-value="updateEditor" /></div>
              <div class="editor-status"><span><i class="status-dot" :class="{ bad: selectedResolution?.issue }" />{{ selectedResolution?.issue ? '当前变体解析失败' : 'JSON 结构有效' }}</span><span>当前变体引用 {{ store.activeEdges.length }} 条</span><span>{{ selected?.usage }} 处产品引用</span></div>
            </div>
            <div class="panel batch-panel"><div class="panel-head"><div><strong>批量替换</strong><span>跨主题替换相同原始值</span></div><SwapIcon /></div><div class="batch-form"><t-input v-model="batchFrom" placeholder="原始值，如 #2864dc" /><ArrowRightIcon /><t-input v-model="batchTo" placeholder="新值" /><t-button theme="primary" :disabled="!batchFrom || !batchTo" @click="batchReplace">执行替换</t-button></div></div>
          </section>
          <aside class="preview-column">
            <div class="panel preview-panel">
              <div class="panel-head"><div><strong>组件预览</strong><span>{{ store.themeLabels[store.activeTheme] }} · 别名按引用链解析</span></div><t-tag :theme="selectedResolution?.issue ? 'danger' : 'success'" variant="light">{{ selectedResolution?.issue ? '解析失败' : '可渲染' }}</t-tag></div>
              <div class="component-preview" :style="previewStyle.vars">
                <div class="mock-app"><div class="mock-sidebar"><i /><i /><i /></div><div class="mock-content"><div class="mock-title" /><div class="mock-card"><span /><span /><span /></div><div class="mock-buttons"><button>取消</button><button :style="{ background: previewStyle.primary, borderColor: previewStyle.primary }">确认提交</button></div></div></div>
              </div>
              <div class="token-detail">
                <div><span>原始值</span><strong>{{ selected ? rawInActiveTheme(selected) : '—' }}</strong></div>
                <div><span>解析值</span><strong :class="{ bad: selectedResolution?.issue }">{{ selectedResolvedValue ?? (selectedResolution?.issue ? '未解析：' + selectedResolution.issue.message : '—') }}</strong></div>
                <div><span>引用链</span><strong class="chain">{{ selectedChain.length ? selectedChain.join(' → ') : '字面量' }}</strong></div>
                <div><span>使用量</span><strong>{{ selected?.usage }} 处</strong></div>
                <div><span>说明</span><strong>{{ selected?.description }}</strong></div>
              </div>
            </div>
            <div class="panel validation-summary"><div class="panel-head"><div><strong>跨变体快速校验</strong><span>4 个变体发布门禁摘要</span></div><strong class="score" :class="{ bad: store.releaseReadiness < 100 }">{{ store.releaseReadiness }}%</strong></div><div class="summary-row" :class="{ bad: store.cycleIssues.length }"><span>引用成环</span><strong>{{ store.cycleIssues.length ? `${store.cycleIssues.length} 条` : '未发现' }}</strong></div><div class="summary-row" :class="{ bad: store.brokenIssues.length }"><span>引用断开</span><strong>{{ store.brokenIssues.length ? `${store.brokenIssues.length} 条` : '未发现' }}</strong></div><div class="summary-row" :class="{ bad: store.typeMismatchIssues.length }"><span>类型不匹配</span><strong>{{ store.typeMismatchIssues.length ? `${store.typeMismatchIssues.length} 条` : '未发现' }}</strong></div><div class="summary-row" :class="{ bad: store.contrastIssues.length }"><span>对比度（全变体）</span><strong>{{ store.contrastIssues.length ? `${store.contrastIssues.length} 个变体需调整` : '均符合 AA' }}</strong></div></div>
          </aside>
        </section>

        <section v-else-if="route.path === '/graph'" class="graph-page panel">
          <div class="panel-head"><div><strong>令牌依赖图</strong><span>{{ store.themeLabels[store.activeTheme] }}：基础令牌 → 语义令牌 → 组件别名（按该变体原始值解析）</span></div><div class="graph-legend"><span><i class="color" />颜色</span><span><i class="component" />组件</span><span><i class="cycle" />成环</span><span><i class="error" />断链/类型</span></div></div>
          <div class="graph-canvas">
            <svg viewBox="0 0 820 520" preserveAspectRatio="xMidYMid meet">
              <defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="8" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8" fill="#7c8c98" /></marker><marker id="arrow-bad" markerWidth="8" markerHeight="8" refX="8" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8" fill="#b94343" /></marker></defs>
              <path v-for="edge in graphEdges" :key="`${edge.from.id}-${edge.to.id}`" :d="`M ${edge.from.x} ${edge.from.y} C ${edge.from.x + 70} ${edge.from.y}, ${edge.to.x - 70} ${edge.to.y}, ${edge.to.x} ${edge.to.y}`" fill="none" :stroke="edge.broken || edge.mismatch ? '#b94343' : '#8b9aa5'" :stroke-dasharray="edge.broken ? '4 3' : '0'" stroke-width="1.5" :marker-end="edge.broken || edge.mismatch ? 'url(#arrow-bad)' : 'url(#arrow)'" />
              <g v-for="node in graphNodes" :key="node.id" :transform="`translate(${node.x},${node.y})`" class="graph-node" :class="{ cycle: store.cycleNodes.includes(node.id), dangling: node.dangling, selected: node.id === store.selectedTokenId }" @click="!node.dangling && store.selectToken(node.id)">
                <rect x="-60" y="-24" width="120" height="48" rx="5" />
                <text x="0" y="-3" text-anchor="middle">{{ node.name }}</text>
                <text x="0" y="13" text-anchor="middle">{{ node.dangling ? '悬空引用' : node.category }}</text>
              </g>
            </svg>
          </div>
          <div class="cross-theme-issues">
            <div class="cross-theme-head"><strong>跨变体引用解析结果</strong><span>每个变体独立沿引用链解析，断链、成环或类型不匹配在此列出具体令牌</span></div>
            <div v-for="group in issuesByTheme" :key="group.theme" class="theme-issue-group" :class="{ bad: group.items.length }">
              <div class="theme-issue-title"><t-icon :name="group.items.length ? 'error-circle' : 'check-circle'" :theme="group.items.length ? 'danger' : 'success'" /><strong>{{ group.label }}</strong><t-tag size="small" :theme="group.items.length ? 'danger' : 'success'" variant="light">{{ group.items.length ? `${group.items.length} 个令牌失效` : '全部解析成功' }}</t-tag></div>
              <ul v-if="group.items.length">
                <li v-for="item in group.items" :key="item.key">
                  <t-tag size="small" :theme="item.type === 'cycle' ? 'warning' : 'danger'" variant="light">{{ item.typeLabel }}</t-tag>
                  <code>{{ item.tokenId }}</code>
                  <span>{{ item.message }}</span>
                </li>
              </ul>
            </div>
          </div>
          <div class="validation-strip">
            <div class="validation-card"><t-icon :name="store.cycleIssues.length ? 'error-circle' : 'check-circle'" :theme="store.cycleIssues.length ? 'danger' : 'success'" /><div><strong>引用成环</strong><span>{{ store.cycleIssues.length ? store.cycleIssues.map(i => `${i.themeLabel} · ${i.tokenId}`).join('；') : '4 个变体均未发现成环' }}</span></div></div>
            <div class="validation-card"><t-icon :name="store.brokenIssues.length ? 'error-circle' : 'check-circle'" :theme="store.brokenIssues.length ? 'danger' : 'success'" /><div><strong>引用断开</strong><span>{{ store.brokenIssues.length ? store.brokenIssues.map(i => `${i.themeLabel} · ${i.tokenId}`).join('；') : '所有引用均指向已存在令牌' }}</span></div></div>
            <div class="validation-card"><t-icon :name="store.typeMismatchIssues.length || store.contrastIssues.length ? 'error-circle' : 'check-circle'" :theme="store.typeMismatchIssues.length || store.contrastIssues.length ? 'danger' : 'success'" /><div><strong>类型与对比度</strong><span>{{ store.typeMismatchIssues.length ? `类型不匹配 ${store.typeMismatchIssues.length} 条；` : '' }}{{ store.contrastIssues.length ? store.contrastIssues.map(i => i.detail).join('；') : '类型一致，对比度符合 AA' }}</span></div></div>
          </div>
        </section>

        <section v-else-if="route.path === '/review'" class="review-page">
          <div class="review-summary panel"><div><span>待评审变更</span><strong>{{ store.changes.filter(c => c.status === '待评审').length }}</strong></div><div><span>已接受</span><strong>{{ store.changes.filter(c => c.status === '已接受').length }}</strong></div><div><span>已退回</span><strong>{{ store.changes.filter(c => c.status === '已退回').length }}</strong></div><div><span>受影响组件</span><strong>48</strong></div></div>
          <div class="review-grid">
            <div v-for="change in store.changes" :key="change.id" class="panel change-card">
              <div class="change-head"><div><t-tag size="small">{{ change.id }}</t-tag><strong>{{ change.title }}</strong><span>{{ change.requester }} · {{ change.scope }}</span></div><t-tag :theme="change.status === '已接受' ? 'success' : change.status === '已退回' ? 'danger' : 'warning'" variant="light">{{ change.status }}</t-tag></div>
              <div class="diff-box"><div><span>修改前</span><code>{{ change.diff.before }}</code></div><t-icon name="arrow-right" /><div><span>修改后</span><code>{{ change.diff.after }}</code></div></div>
              <div class="impact"><span>影响评分</span><t-progress :percentage="change.impact" :theme="change.impact > 70 ? 'danger' : 'warning'" /></div>
              <div class="change-actions"><t-button variant="outline" :disabled="change.status !== '待评审'" @click="store.rejectChange(change.id)">退回并说明</t-button><t-button theme="primary" :disabled="change.status !== '待评审'" @click="store.acceptChange(change.id)">接受变更</t-button></div>
            </div>
          </div>
        </section>

        <section v-else class="publish-page">
          <div class="publish-main-col">
            <div class="panel publish-main">
              <div class="panel-head"><div><strong>发布准备</strong><span>生成只读版本快照（含每变体解析结果），支持回滚到历史基线</span></div><t-tag :theme="store.locked ? 'success' : 'warning'">{{ store.locked ? '已锁定' : '候选版本' }}</t-tag></div>
              <div class="publish-form">
                <label><span>版本号</span><t-input v-model="selectedVersion" /></label>
                <label><span>目标产品</span><t-select multiple value="['组件库','运营后台','移动端组件']" :options="[{label:'组件库',value:'组件库'},{label:'运营后台',value:'运营后台'},{label:'移动端组件',value:'移动端组件'},{label:'数据平台',value:'数据平台'}]" /></label>
                <label><span>发布说明</span><t-textarea value="更新语义主色、统一控件圆角，并修复暗色主题正文对比度。" :autosize="{ minRows: 3 }" /></label>
              </div>
              <div class="release-checks">
                <label><t-checkbox :checked="store.cycleIssues.length === 0" :disabled="store.cycleIssues.length > 0" /> 引用成环检查（{{ store.cycleIssues.length }}）</label>
                <label><t-checkbox :checked="store.brokenIssues.length === 0" :disabled="store.brokenIssues.length > 0" /> 引用断开检查（{{ store.brokenIssues.length }}）</label>
                <label><t-checkbox :checked="store.typeMismatchIssues.length === 0" :disabled="store.typeMismatchIssues.length > 0" /> 引用类型匹配（{{ store.typeMismatchIssues.length }}）</label>
                <label><t-checkbox :checked="store.contrastIssues.length === 0" :disabled="store.contrastIssues.length > 0" /> 4 个变体对比度均符合 WCAG AA（{{ store.contrastIssues.length }}）</label>
                <label><t-checkbox :checked="pendingChanges === 0" :disabled="pendingChanges > 0" /> 所有变更请求已处理（{{ pendingChanges }}）</label>
              </div>
              <div class="publish-actions"><t-button variant="outline" @click="store.rollback">回滚全部未发布编辑</t-button><t-button theme="primary" icon="lock-on" :disabled="store.locked || publishBlocked" @click="publish">校验并锁定发布</t-button></div>
            </div>

            <div class="panel issue-panel">
              <div class="panel-head"><div><strong>发布前失效引用清单</strong><span>按变体列出具体令牌；有任一条目即禁止发布</span></div><t-tag :theme="store.allIssues.length ? 'danger' : 'success'" variant="light">{{ store.allIssues.length }} 条</t-tag></div>
              <div v-for="group in issuesByTheme" :key="group.theme" class="issue-group">
                <div class="issue-group-title"><strong>{{ group.label }}</strong><span>{{ group.items.length ? `${group.items.length} 个令牌` : '解析全部通过' }}</span></div>
                <div v-for="item in group.items" :key="item.key" class="issue-row">
                  <t-tag size="small" :theme="item.type === 'cycle' ? 'warning' : 'danger'" variant="light">{{ item.typeLabel }}</t-tag>
                  <div><code>{{ item.tokenId }}</code><span>{{ item.message }}</span><small>链：{{ item.path.join(' → ') }}</small></div>
                </div>
                <p v-if="!group.items.length" class="empty">该变体所有别名均可解析到最终颜色或尺寸。</p>
              </div>
            </div>
          </div>
          <aside class="publish-side">
            <div class="panel diff-panel"><div class="panel-head"><div><strong>跨变体差异</strong><span>相对 {{ store.lastPublished }}，按解析后最终值对比</span></div><t-tag>{{ store.diffRows.length }} 项</t-tag></div>
              <div v-for="row in store.diffRows" :key="row.key" class="diff-row">
                <div class="diff-row-head"><strong>{{ row.name }}</strong><t-tag size="small" variant="light" :theme="row.after.issue ? 'danger' : 'default'">{{ row.themeLabel }}</t-tag></div>
                <span>{{ row.id }}</span>
                <div><del>{{ formatResolve(row.before) }}</del><ins :class="{ bad: row.after.issue }">{{ formatResolve(row.after) }}</ins></div>
              </div>
              <p v-if="!store.diffRows.length" class="empty">暂无未发布差异。</p>
            </div>
            <div v-if="store.releaseSnapshot" class="panel snapshot-panel">
              <div class="panel-head"><div><strong>发布快照</strong><span>DS {{ store.releaseSnapshot.version }} · 只读冻结</span></div><t-tag theme="success" variant="light">已生成</t-tag></div>
              <div class="snapshot-meta"><div><span>令牌 × 变体</span><strong>{{ store.releaseSnapshot.summary.tokens }} × {{ store.releaseSnapshot.summary.themes }}</strong></div><div><span>解析成功</span><strong class="ok">{{ store.releaseSnapshot.summary.resolved }}</strong></div><div><span>失效条目</span><strong :class="{ bad: store.releaseSnapshot.summary.failed }">{{ store.releaseSnapshot.summary.failed }}</strong></div></div>
              <div v-for="theme in store.releaseSnapshot.themes" :key="theme.key" class="snapshot-theme"><span>{{ theme.label }}</span><strong :class="{ bad: theme.issues.length }">{{ theme.resolvedCount }}/{{ theme.tokens.length }}</strong></div>
            </div>
            <div class="panel history-panel"><div class="panel-head"><div><strong>发布历史</strong><span>可追溯版本</span></div><HistoryIcon /></div><div class="history-row"><t-tag theme="success" variant="light">当前</t-tag><div><strong>DS {{ store.lastPublished }}</strong><span>顾清 · 09-24 17:20</span></div><t-button size="small" variant="text">查看</t-button></div><div class="history-row"><t-tag>历史</t-tag><div><strong>DS 4.5.1</strong><span>周序 · 09-12 11:04</span></div><t-button size="small" variant="text">回滚</t-button></div><div class="history-row"><t-tag>历史</t-tag><div><strong>DS 4.5.0</strong><span>顾清 · 08-28 15:42</span></div><t-button size="small" variant="text">回滚</t-button></div></div>
          </aside>
        </section>
      </t-content>
    </t-layout>
  </t-layout>

  <t-dialog v-model:visible="newTokenDialog" header="创建候选令牌" :confirm-btn="{ content: '创建', onClick: addToken }">
    <div class="dialog-form"><t-input v-model="newToken.id" label="令牌 ID" placeholder="product.component.property" /><t-input v-model="newToken.name" label="显示名称" /><t-select v-model="newToken.category" label="分类" :options="[{label:'颜色',value:'color'},{label:'字体',value:'font'},{label:'间距',value:'spacing'},{label:'圆角',value:'radius'},{label:'阴影',value:'shadow'},{label:'组件',value:'component'}]" /><t-input v-model="newToken.value" label="默认值" /><t-textarea v-model="newToken.description" label="用途说明" /></div>
  </t-dialog>
  <t-dialog v-model:visible="releaseDialog" header="主题发布完成" :footer="false"><div class="release-success"><t-icon name="check-circle" size="46px" theme="success" /><h3>DS {{ store.releaseVersion }} 已锁定</h3><p>{{ releaseResult }}</p><p>版本快照已生成，产品使用方可以按固定版本拉取令牌。</p></div></t-dialog>
</template>
