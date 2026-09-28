import { resolveChain, resolveAllThemes, collectAllIssues } from '../src/tokens/resolver';
import { buildResolvedDiff, buildReleaseSnapshot } from '../src/tokens/snapshot';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra = '') {
  if (cond) { pass += 1; console.log(`PASS ${name}`); }
  else { fail += 1; console.error(`FAIL ${name} ${extra}`); }
}

type T = { id: string; name: string; category: any; value: string; themes: Record<string, string> };
const tokens: T[] = [
  { id: 'base.blue', name: '蓝', category: 'color', value: '#0000ff', themes: { light: '#0000ff', dark: '#88aaff' } },
  { id: 'sem.primary', name: '主色', category: 'color', value: '{base.blue}', themes: { light: '{base.blue}', dark: '{base.blue}' } },
  { id: 'comp.btn', name: '按钮', category: 'component', value: '{sem.primary}', themes: { light: '{sem.primary}', dark: '{sem.primary}' } },
  { id: 'broken.alias', name: '断链', category: 'component', value: '{missing.x}', themes: { light: '{missing.x}', dark: '{missing.x}' } },
  { id: 'size.radius', name: '圆角', category: 'radius', value: '6px', themes: { light: '6px', dark: '6px' } },
  { id: 'mismatch.alias', name: '错型', category: 'color', value: '{size.radius}', themes: { light: '{size.radius}', dark: '{size.radius}' } },
  { id: 'cyc.a', name: '环A', category: 'color', value: '{cyc.b}', themes: { light: '{cyc.b}', dark: '{cyc.b}' } },
  { id: 'cyc.b', name: '环B', category: 'color', value: '{cyc.a}', themes: { light: '{cyc.a}', dark: '{cyc.a}' } }
];

// 1. 跨主题顺链解析：别名在 dark 下应取 base.blue 的 dark 值，而非基础值
const light = resolveChain(tokens, 'light', 'comp.btn');
const dark = resolveChain(tokens, 'dark', 'comp.btn');
check('light 别名解析到基础 light 值', light.ok && light.value === '#0000ff', JSON.stringify(light));
check('dark 别名解析到基础 dark 值（不是编辑前基础值）', dark.ok && dark.value === '#88aaff', JSON.stringify(dark));
check('引用链完整', light.path.join('>') === 'comp.btn>sem.primary>base.blue', light.path.join('>'));

// 2. 断链
const broken = resolveChain(tokens, 'dark', 'broken.alias');
check('断链标记为 broken', !broken.ok && broken.issue?.type === 'broken', JSON.stringify(broken.issue));
check('断链路径包含悬空目标', broken.path[broken.path.length - 1] === 'missing.x', broken.path.join('>'));

// 3. 成环
const cyc = resolveChain(tokens, 'light', 'cyc.a');
check('成环标记为 cycle', !cyc.ok && cyc.issue?.type === 'cycle', JSON.stringify(cyc.issue));
check('环消息含具体令牌', cyc.issue!.message.includes('cyc.a') && cyc.issue!.message.includes('cyc.b'), cyc.issue!.message);

// 4. 类型不匹配
const mis = resolveChain(tokens, 'light', 'mismatch.alias');
check('类型不匹配标记为 type-mismatch', !mis.ok && mis.issue?.type === 'type-mismatch', JSON.stringify(mis.issue));

// 5. 跨全部变体汇总问题数量（2 变体）
const all = resolveAllThemes(tokens, ['light', 'dark']);
const issues = collectAllIssues(all);
// broken: 2, mismatch: 2, cycle: cyc.a*2 + cyc.b*2 = 4 → 8
check('失效按变体汇总共 8 条', issues.length === 8, `got ${issues.length}`);

// 6. 基础令牌改动后各变体差异联动
const changed = tokens.map((t) => t.id === 'base.blue' ? { ...t, themes: { ...t.themes, dark: '#7799ee' } } : t);
const diff = buildResolvedDiff(changed, tokens, ['light', 'dark']);
const darkRows = diff.filter((r) => r.theme === 'dark').map((r) => r.id);
check('基础值改动联动 sem.primary 与 comp.btn 的 dark 差异', darkRows.includes('sem.primary') && darkRows.includes('comp.btn'), JSON.stringify(darkRows));
check('light 变体不受 dark 改动影响', !diff.some((r) => r.theme === 'light'), JSON.stringify(diff.map((r) => r.id)));

// 7. 发布快照在发布时点冻结
const snap = buildReleaseSnapshot(tokens, '1.0.0', tokens, ['light', 'dark']);
check('快照含 2 个变体', snap.themes.length === 2);
check('快照统计失效数', snap.summary.failed === 8 && snap.summary.tokens === 8 && snap.summary.resolved === 8, JSON.stringify(snap.summary));
const snapBtn = snap.themes[1].tokens.find((t) => t.id === 'comp.btn');
check('快照冻结 dark 解析值', snapBtn?.resolvedValue === '#88aaff', snapBtn?.resolvedValue);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
