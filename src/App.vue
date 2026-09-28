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
import { THEME_LABELS, useTokenStore } from './store';

const themeLabel = (theme: string) => THEME_LABELS[theme] ?? theme;
const isColorValue = (value: string | null | undefined): value is string =>
  !!value && /^#[0-9a-fA-F]{6}$/.test(value.trim());

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
const selectedJson = computed(() => selected.value ? JSON.stringify({
  id: selected.value.id,
  name: selected.value.name,
  category: selected.value.category,
  value: selected.value.value,
  ref: selected.value.ref,
  themes: selected.value.themes,
  description: selected.value.description,
  status: selected.value.status
}, null, 2) : '{}');
const categories = computed(() => ['全部', ...new Set(store.tokens.map((token) => token.category))]);
const graphNodes = computed(() => {
  const nodes = store.tokens.filter((token) => token.ref || store.tokens.some((item) => item.ref === token.id));
  const grouped = ['color', 'font', 'spacing', 'radius', 'shadow', 'component'];
  return nodes.map((token, index) => ({
    ...token,
    x: 80 + grouped.indexOf(token.category) * 150,
    y: 70 + (index % 4) * 105
  }));
});
const graphEdges = computed(() => store.dependencyEdges.map((edge) => {
  const from = graphNodes.value.find((node) => node.id === edge.from);
  const to = graphNodes.value.find((node) => node.id === edge.to);
  return from && to ? { ...edge, from, to } : null;
}).filter(Boolean) as { from: Token & {x:number;y:number}; to: Token & {x:number;y:number} }[]);

// 当前选中令牌在每个变体下沿引用链解析出的最终值
const selectedVariants = computed(() => store.selectedVariantRows);
const activeResolved = computed(() =>
  selectedVariants.value.find((row) => row.theme === store.activeTheme)?.resolved ?? null);
const activeFinalValue = computed(() => activeResolved.value?.value ?? null);
const activeSurfaceColor = computed(() =>
  store.resolution.map[store.activeTheme]?.['color.surface.canvas']?.value ?? null);
const activePrimaryColor = computed(() =>
  store.resolution.map[store.activeTheme]?.['component.button.primary.bg']?.value ?? null);
const activeTextColor = computed(() =>
  store.resolution.map[store.activeTheme]?.['color.text.primary']?.value ?? null);
// 依赖图：任意变体下断链/成环/类型错配的节点都高亮
const issueNodeIds = computed(() => new Set([
  ...store.cycleNodes,
  ...store.brokenReferences.flatMap((item) => [item.tokenId, item.refId]),
  ...store.typeMismatches.flatMap((item) => [item.tokenId, item.refId ?? ''])
]));

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

function onThemeChange(value: string) {
  store.setTheme(value);
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
  });
  store.syncRefs();
  store.persist();
  MessagePlugin.success(`已替换 ${count} 处引用`);
}

function publish() {
  // 发布门禁覆盖全部变体：断链、成环、类型错配或对比度问题会列出具体令牌
  if (!store.canPublish) {
    MessagePlugin.error('发布检查未通过，请先处理各变体下列出的失效引用');
    return;
  }
  const accepted = store.changes.filter((item) => item.status === '已接受').map((item) => item.id);
  const snapshot = store.lockRelease(undefined, '设计系统维护员');
  if (!snapshot) {
    MessagePlugin.error('发布检查未通过，请先处理各变体下列出的失效引用');
    return;
  }
  releaseMutation.mutate({ version: selectedVersion.value, accepted, actor: '设计系统维护员' });
  releaseResult.value = `发布标识 ${snapshot.releaseId} · ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
  releaseDialog.value = true;
}

function restore(releaseId: string) {
  store.restoreSnapshot(releaseId);
  MessagePlugin.success('已按发布快照恢复令牌，预览、差异与检查已刷新');
}
</script>

<template>
  <t-layout class="app-shell">
    <t-header class="app-header">
      <div class="brand"><span class="brand-mark">DS</span><div><strong>设计令牌治理台</strong><small>Cross-product Token Governance</small></div></div>
      <div class="release-chip"><span>当前候选</span><strong>DS {{ store.releaseVersion }}</strong></div>
      <div class="header-spacer" />
      <t-tag :theme="store.releaseReadiness === 100 ? 'success' : 'danger'" variant="light-outline">校验通过 {{ store.releaseReadiness }}%</t-tag>
      <div class="operator"><span>设计系统维护员</span><strong>顾清 · Core DS</strong></div>
    </t-header>
    <t-layout class="body-layout">
      <t-aside class="side-nav">
        <div class="workspace-card"><t-icon name="layers" /><div><span>当前工作区</span><strong>通用组件库 · 品牌主题</strong><small>{{ store.tokens.length }} 个令牌 · {{ store.themes.length }} 个主题变体</small></div></div>
        <nav><button v-for="item in nav" :key="item.path" :class="{ active: route.path === item.path }" @click="go(item.path)"><t-icon :name="item.icon" /><span>{{ item.label }}</span><t-badge v-if="item.path === '/review'" :count="store.changes.filter(c => c.status === '待评审').length" /></button></nav>
        <div class="save-state"><t-icon name="cloud-done" /><div><span>草稿已保存</span><small>{{ new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) }}</small></div></div>
      </t-aside>
      <t-content class="main-content">
        <header class="page-heading">
          <div><small>{{ store.locked ? 'RELEASE LOCKED' : 'GOVERNANCE WORKBENCH' }} / {{ pageTitle }}</small><h1>{{ pageTitle }}</h1><p>基础令牌到语义令牌的引用、差异、校验与跨主题发布。</p></div>
          <div class="heading-actions"><t-select :model-value="store.activeTheme" style="width: 150px" :options="[{label:'明亮模式',value:'light'},{label:'暗色模式',value:'dark'},{label:'运营模式',value:'ops'},{label:'高对比度',value:'contrast'}]" @change="onThemeChange" /><t-button variant="outline" :icon="AddButtonIcon" @click="newTokenDialog = true">新建令牌</t-button><t-button theme="primary" :icon="LockButtonIcon" :disabled="store.locked || !store.canPublish" @click="publish">发布主题</t-button></div>
        </header>

        <section v-if="route.path === '/'" class="token-workspace">
          <aside class="token-tree panel">
            <div class="panel-head"><div><strong>令牌树</strong><span>{{ store.filteredTokens.length }} 个匹配项</span></div><t-button size="small" variant="text" :icon="RefreshButtonIcon" @click="store.rollback">回滚</t-button></div>
            <t-input v-model="store.search" clearable placeholder="搜索令牌 ID 或名称" :prefix-icon="SearchInputIcon" />
            <div class="category-tabs"><button v-for="category in categories" :key="category" :class="{ active: store.category === category }" @click="store.setCategory(category)">{{ category }}</button></div>
            <div class="tree-list">
              <button v-for="token in store.filteredTokens" :key="token.id" :class="{ active: store.selectedTokenId === token.id }" @click="store.selectToken(token.id)">
                <i :class="token.category" />
                <div><strong>{{ token.name }}</strong><span>{{ token.id }}</span></div>
                <t-tag size="small" :theme="token.status === 'stable' ? 'success' : token.status === 'proposed' ? 'warning' : 'default'" variant="light">{{ token.status === 'stable' ? '稳定' : token.status === 'proposed' ? '候选' : '弃用' }}</t-tag>
              </button>
            </div>
          </aside>
          <section class="editor-column">
            <div class="panel editor-panel">
              <div class="panel-head"><div><strong>Monaco 令牌编辑</strong><span>{{ selected?.id }} · {{ store.activeTheme }}</span></div><div class="editor-actions"><t-tag v-if="selected?.ref" variant="light">引用 {{ selected.ref }}</t-tag><t-button size="small" variant="outline" :icon="CopyButtonIcon">复制 JSON</t-button></div></div>
              <div class="editor-host"><TokenEditor :model-value="selectedJson" language="json" @update:model-value="updateEditor" /></div>
              <div class="editor-status"><span><i class="status-dot" />JSON 结构有效</span><span>引用关系 {{ store.dependencyEdges.length }} 条</span><span>{{ selected?.usage }} 处产品引用</span></div>
            </div>
            <div class="panel batch-panel"><div class="panel-head"><div><strong>批量替换</strong><span>跨主题替换相同原始值</span></div><SwapIcon /></div><div class="batch-form"><t-input v-model="batchFrom" placeholder="原始值，如 #2864dc" /><ArrowRightIcon /><t-input v-model="batchTo" placeholder="新值" /><t-button theme="primary" :disabled="!batchFrom || !batchTo" @click="batchReplace">执行替换</t-button></div></div>
          </section>
          <aside class="preview-column">
            <div class="panel preview-panel">
              <div class="panel-head"><div><strong>组件预览</strong><span>按引用链解析 · {{ themeLabel(store.activeTheme) }}变体</span></div><t-tag :theme="activeFinalValue ? 'success' : 'danger'" variant="light">{{ activeFinalValue ? '可渲染' : '无法解析' }}</t-tag></div>
              <div class="component-preview" :style="{ background: isColorValue(activeSurfaceColor) ? activeSurfaceColor : undefined }">
                <div class="mock-app" :style="{ color: isColorValue(activeTextColor) ? activeTextColor : undefined }">
                  <div class="mock-sidebar"><i /><i /><i /></div>
                  <div class="mock-content">
                    <div class="mock-title" />
                    <div class="mock-card"><span /><span /><span /></div>
                    <div class="mock-buttons"><button>取消</button><button :style="isColorValue(activePrimaryColor) ? { background: activePrimaryColor, borderColor: activePrimaryColor } : undefined">确认提交</button></div>
                  </div>
                </div>
              </div>
              <div class="variant-values">
                <div v-for="row in selectedVariants" :key="row.theme" class="variant-row" :class="{ bad: !row.resolved.value, active: row.theme === store.activeTheme }" @click="store.setTheme(row.theme)">
                  <span class="dot" :style="{ background: isColorValue(row.resolved.value) ? row.resolved.value : '#c6d0d8' }" />
                  <strong>{{ themeLabel(row.theme) }}</strong>
                  <code v-if="row.resolved.value" :title="row.resolved.chain.join(' → ')">{{ row.resolved.value }}</code>
                  <code v-else class="unresolved">{{ row.resolved.issues[0] ? (row.resolved.issues[0].kind === 'cycle' ? '引用成环' : '引用链断开') : '无值' }}</code>
                </div>
              </div>
              <div class="token-detail"><div><span>最终值</span><strong>{{ activeFinalValue ?? '无法解析出最终值' }}</strong></div><div><span>引用链</span><strong>{{ activeResolved?.chain.join(' → ') ?? '—' }}</strong></div><div><span>使用量</span><strong>{{ selected?.usage }} 处</strong></div><div><span>状态</span><strong>{{ selected?.status }}</strong></div><div><span>说明</span><strong>{{ selected?.description }}</strong></div></div>
            </div>
            <div class="panel validation-summary"><div class="panel-head"><div><strong>快速校验</strong><span>全变体发布门禁摘要 · {{ store.themes.length }} 个变体</span></div><strong class="score">{{ store.releaseReadiness }}%</strong></div><div class="summary-row" :class="{ bad: store.cycleNodes.length }"><span>循环依赖（全变体）</span><strong>{{ store.cycleNodes.length ? `${store.cycleNodes.length} 个令牌` : '未发现' }}</strong></div><div class="summary-row" :class="{ bad: store.brokenReferences.length }"><span>引用断裂（全变体）</span><strong>{{ store.brokenReferences.length ? `${store.brokenReferences.length} 处` : '未发现' }}</strong></div><div class="summary-row" :class="{ bad: store.typeMismatches.length }"><span>类型不匹配（全变体）</span><strong>{{ store.typeMismatches.length ? `${store.typeMismatches.length} 处` : '未发现' }}</strong></div><div class="summary-row" :class="{ bad: store.contrastIssues.length }"><span>对比度（全变体）</span><strong>{{ store.contrastIssues.length ? `${store.contrastIssues.length} 个变体不达标` : '全部符合 AA' }}</strong></div></div>
          </aside>
        </section>

        <section v-else-if="route.path === '/graph'" class="graph-page panel">
          <div class="panel-head"><div><strong>令牌依赖图</strong><span>基础令牌 → 语义令牌 → 组件别名 · 红色节点在至少一个变体下解析失败</span></div><div class="graph-legend"><span><i class="color" />颜色</span><span><i class="component" />组件</span><span><i class="error" />错误</span></div></div>
          <div class="graph-canvas">
            <svg viewBox="0 0 820 520" preserveAspectRatio="xMidYMid meet">
              <defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="8" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8" fill="#7c8c98" /></marker></defs>
              <path v-for="edge in graphEdges" :key="`${edge.from.id}-${edge.to.id}`" :d="`M ${edge.from.x} ${edge.from.y} C ${edge.from.x + 70} ${edge.from.y}, ${edge.to.x - 70} ${edge.to.y}, ${edge.to.x} ${edge.to.y}`" fill="none" stroke="#8b9aa5" stroke-width="1.5" marker-end="url(#arrow)" />
              <g v-for="node in graphNodes" :key="node.id" :transform="`translate(${node.x},${node.y})`" class="graph-node" :class="{ cycle: issueNodeIds.has(node.id), selected: node.id === store.selectedTokenId }" @click="store.selectToken(node.id)">
                <rect x="-60" y="-24" width="120" height="48" rx="5" />
                <text x="0" y="-3" text-anchor="middle">{{ node.name }}</text>
                <text x="0" y="13" text-anchor="middle">{{ node.category }}</text>
              </g>
            </svg>
          </div>
          <div class="validation-strip">
            <div class="validation-card"><t-icon :name="store.cycleNodes.length ? 'error-circle' : 'check-circle'" :theme="store.cycleNodes.length ? 'danger' : 'success'" /><div><strong>循环依赖（全变体）</strong><span>{{ store.cycleNodes.length ? store.resolutionIssues.filter(i => i.kind === 'cycle').map(i => `[${themeLabel(i.theme)}] ${i.cycleNodes?.join(' → ')}`).join('；') : '未发现循环引用路径' }}</span></div></div>
            <div class="validation-card"><t-icon :name="store.brokenReferences.length ? 'error-circle' : 'check-circle'" :theme="store.brokenReferences.length ? 'danger' : 'success'" /><div><strong>引用完整性（全变体）</strong><span>{{ store.brokenReferences.length ? store.brokenReferences.map(i => `[${themeLabel(i.theme)}] ${i.tokenId} → ${i.refId}`).join('；') : '所有变体的引用均指向存在的令牌' }}</span></div></div>
            <div class="validation-card"><t-icon :name="store.typeMismatches.length ? 'error-circle' : 'check-circle'" :theme="store.typeMismatches.length ? 'danger' : 'success'" /><div><strong>类型一致（全变体）</strong><span>{{ store.typeMismatches.length ? store.typeMismatches.map(i => `[${themeLabel(i.theme)}] ${i.tokenId} → ${i.refId}`).join('；') : '各变体引用链类型一致' }}</span></div></div>
          </div>
          <div class="validation-strip contrast-strip">
            <div class="validation-card" v-for="item in store.contrastIssues" :key="item.theme"><t-icon name="error-circle" theme="danger" /><div><strong>对比度 · {{ themeLabel(item.theme) }}</strong><span>{{ item.detail }}</span></div></div>
            <div class="validation-card" v-if="!store.contrastIssues.length"><t-icon name="check-circle" theme="success" /><div><strong>对比度检查（全变体）</strong><span>明亮、暗色、运营、高对比四个变体的正文与背景对比度均符合 WCAG AA（≥ 4.5:1）。</span></div></div>
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
          <div class="panel publish-main">
            <div class="panel-head"><div><strong>发布准备</strong><span>生成只读版本，支持回滚到历史基线</span></div><t-tag :theme="store.locked ? 'success' : 'warning'">{{ store.locked ? '已锁定' : '候选版本' }}</t-tag></div>
            <div class="publish-form">
              <label><span>版本号</span><t-input v-model="selectedVersion" /></label>
              <label><span>目标产品</span><t-select multiple value="['组件库','运营后台','移动端组件']" :options="[{label:'组件库',value:'组件库'},{label:'运营后台',value:'运营后台'},{label:'移动端组件',value:'移动端组件'},{label:'数据平台',value:'数据平台'}]" /></label>
              <label><span>发布说明</span><t-textarea value="更新语义主色、统一控件圆角，并修复暗色主题正文对比度。" :autosize="{ minRows: 3 }" /></label>
            </div>
            <div class="release-checks">
              <label><t-checkbox :checked="store.cycleNodes.length === 0" :disabled="store.cycleNodes.length > 0" /> 全变体循环依赖检查（{{ store.cycleNodes.length === 0 ? '通过' : `${store.cycleNodes.length} 个令牌成环` }}）</label>
              <label><t-checkbox :checked="store.brokenReferences.length === 0" :disabled="store.brokenReferences.length > 0" /> 全变体引用完整性（{{ store.brokenReferences.length === 0 ? '通过' : `${store.brokenReferences.length} 处断裂` }}）</label>
              <label><t-checkbox :checked="store.typeMismatches.length === 0" :disabled="store.typeMismatches.length > 0" /> 全变体引用类型一致（{{ store.typeMismatches.length === 0 ? '通过' : `${store.typeMismatches.length} 处不匹配` }}）</label>
              <label><t-checkbox :checked="store.contrastIssues.length === 0" :disabled="store.contrastIssues.length > 0" /> 全变体颜色对比度符合 WCAG AA（{{ store.contrastIssues.length === 0 ? '通过' : `${store.contrastIssues.length} 个变体不达标` }}）</label>
              <label><t-checkbox :checked="store.pendingChangeCount === 0" :disabled="store.pendingChangeCount > 0" /> 所有变更请求已处理（{{ store.pendingChangeCount === 0 ? '通过' : `${store.pendingChangeCount} 项待评审` }}）</label>
            </div>
            <div v-if="store.publishBlockers.length" class="blocker-list">
              <strong>发布前必须处理以下具体令牌：</strong>
              <div v-for="group in store.publishBlockers" :key="group.theme" class="blocker-group">
                <t-tag size="small" theme="danger" variant="light">{{ themeLabel(group.theme) }}</t-tag>
                <ul><li v-for="(text, index) in group.items" :key="index">{{ text }}</li></ul>
              </div>
            </div>
            <div class="publish-actions"><t-button variant="outline" @click="store.rollback">回滚全部未发布编辑</t-button><t-button theme="primary" icon="lock-on" :disabled="store.locked || !store.canPublish" @click="publish">校验并锁定发布</t-button></div>
          </div>
          <aside class="publish-side">
            <div class="panel diff-panel"><div class="panel-head"><div><strong>版本差异</strong><span>解析后最终值 · 相对 {{ store.lastPublished }}</span></div><t-tag>{{ store.diffRows.length }} 项</t-tag></div><div v-for="row in store.diffRows" :key="row.id" class="diff-row"><strong>{{ row.name }}</strong><span>{{ row.id }}</span><div v-for="theme in row.changedThemes" :key="theme" class="theme-diff"><em>{{ themeLabel(theme) }}</em><del>{{ row.before[theme] }}</del><ins>{{ row.after[theme] }}</ins></div></div><p v-if="!store.diffRows.length" class="empty">暂无未发布差异。</p></div>
            <div class="panel history-panel"><div class="panel-head"><div><strong>发布历史</strong><span>快照可追溯、可恢复</span></div><HistoryIcon /></div>
              <div v-for="snapshot in store.snapshots" :key="snapshot.releaseId" class="history-row"><t-tag theme="success" variant="light">快照</t-tag><div><strong>DS {{ snapshot.version }}</strong><span>{{ snapshot.actor }} · {{ new Date(snapshot.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) }} · {{ snapshot.themes.map(themeLabel).join(' / ') }}</span></div><t-button size="small" variant="text" @click="restore(snapshot.releaseId)">恢复</t-button></div>
              <div class="history-row"><t-tag theme="success" variant="light">当前</t-tag><div><strong>DS {{ store.lastPublished }}</strong><span>顾清 · 09-24 17:20</span></div><t-button size="small" variant="text">查看</t-button></div><div class="history-row"><t-tag>历史</t-tag><div><strong>DS 4.5.1</strong><span>周序 · 09-12 11:04</span></div><t-button size="small" variant="text">回滚</t-button></div><div class="history-row"><t-tag>历史</t-tag><div><strong>DS 4.5.0</strong><span>顾清 · 08-28 15:42</span></div><t-button size="small" variant="text">回滚</t-button></div></div>
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
