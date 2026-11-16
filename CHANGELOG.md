# 更新日志 · Changelog

## v1.1.0

修掉一个「调窗口大小壁纸就消失」的崩溃，并把这一类问题挡在构建阶段。

### 修复

- **调整窗口大小后壁纸整幅消失。** 横排诗句的签名行里引用了一个从未声明的
  `seal`，只要布局切到横排（把窗口拖窄、右侧边栏占走横向空间都可能触发），
  `Verse` 就抛 `ReferenceError`。DSH 的插槽错误边界会把出错的条目摘掉，换成
  一个空锚点，于是诗句和朱印先没了；而页面那张样式表当时还挂在同一个条目下面，
  连纸和山水一起被摘掉——表象就是插件"自己关掉了"，得重开插件才回来。
  现在横排分支不再引用那个标识符（朱印本来由独立节点绘制，这行是旧版残留）。

### 改动

- **样式表改由插件持有，不再挂在插槽条目里。** 画在 `html` / `body` 上的
  `background-image` 规则移进 `<head>` 中一个 `id="dsh-ipw-poem-style"` 的
  `<style>` 节点，由 `apply(ctx)` 的 `ctx.effect` 创建和销毁。条目被卸载、被
  重渲染、或者出错被摘掉，都不再影响背景本身——纸和画会跟着插件活，而不是
  跟着某个 React 子树活。
- **加了一层渲染守卫。** 自定义错误边界 `InkWashGuard` 接住组件内部抛出的错误，
  记下 `message` / `stack` / `componentStack`，然后延时重试渲染（最多 8 次，
  间隔 600ms）。单个子组件出错只损失那一个重试窗口内的诗句，不用重开插件。
- **窗口尺寸改成四路测量。** 原来只监听 `window` 的 `resize`。透明 / vibrancy
  窗口在某些情况下不会把 `resize` 转发给页面，那时背景跟着窗口走（CSS 每帧重算），
  而诗句仍停在旧坐标上，就落到了窗口外面。现在同时用 `resize`、
  `visualViewport` 的 `resize`、`document.documentElement` 上的 `ResizeObserver`，
  再加一路 120ms 定时兜底；`setViewport` / `setBand` 也改成了幂等（值没变就返回
  原对象），顺带消掉了原来每次 MutationObserver 都触发一轮重渲染的问题。
- **诊断信息写到 localStorage。** 新增 `dsh-ipw-poem:last-error`（最近一次渲染
  错误）和 `dsh-ipw-poem:trace`（挂载 / 卸载 / 渲染错误 / 版面几何的环形缓冲，
  400ms 防抖落盘）。出问题不用再靠截图猜，读这两个键就能知道是"条目被摘掉"还是
  "诗句被算到了窗口外面"。

### 工具

- **`src/check_client.py` 现在两种排版都会渲染。** 原来只渲染一次，而自动模式下
  桌面宽度几乎总是走竖排分支，所以横排分支从来没被执行过——上面那个 bug 正是这样
  漏出去的。现在补了完整的 React 替身（`Component`、`useLayoutEffect`）和一层
  足够真实的 DOM（按选择器返回不同的 rect，让两种排版都可达），并在两种
  `vertical` 取向下各渲染一遍，两种 writing-mode 都必须出现，否则判定失败。
  回归验证：把 `seal,` 那行临时加回去，守卫立刻报
  `render failed in 'ink-poem-wallpaper' (horizontal): seal is not defined`。

## v1.0.0

首个版本：每日随机诗句题在水墨山水上，支持竖排 / 横排、四款毛笔字体、可拖动的
诗句与朱印、九项设置。
