# pair-wise-yy-63 跨产品设计令牌治理与主题发布平台

维护基础令牌、语义令牌和组件别名，支持品牌主题、明暗模式与平台变体继承覆盖。包含令牌树、Monaco JSON 编辑、依赖图、循环引用与对比度校验、批量替换、变更评审、版本差异和发布锁定。

## 技术栈

Vue 3、TDesign、Pinia、Vue Router、TanStack Query、Axios、Monaco Editor、Vite、TypeScript。

## 运行

```bash
npm install
npm run dev
```

访问 `http://localhost:62063`。草稿、变更评审和当前主题保存在 `localStorage`。

```bash
npm run build
```

## 跨主题引用解析

- `src/tokens/resolver.ts`（解析规则）：纯函数。按每个主题变体独立顺 `{token.id}` 引用链解析最终颜色或尺寸，检测引用链断开、成环与分类类型不匹配，并返回完整链路。
- `src/tokens/snapshot.ts`（发布快照）：在发布锁定时点冻结只读快照，逐变体记录原始值/解析值/链路/失效原因，并生成跨变体解析后差异。
- `src/store.ts` + `src/App.vue`（页面展示）：预览、依赖图、差异、对比度与发布门禁全部基于四个变体的解析结果；基础令牌一改，各变体的预览、差异与检查结果随响应式重算一并更新。失效引用按变体列出具体令牌，存在任一条即禁止发布。

解析逻辑可用 `npx tsx scripts/verify-resolver.ts` 验证（14 项断言）。
