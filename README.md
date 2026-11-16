# 水墨诗词壁纸 · Ink Poem Wallpaper

一个 [DeepSeek Harness](https://github.com/deepseek-ai) 壁纸插件：每天一句中国古典诗词，题在一幅随句意生成的水墨山水上，作为 Harness 的背景。

> A DSH wallpaper plugin. Every day a Chinese classical couplet is set into a
> generated ink-wash landscape that serves as the background of DeepSeek Harness.

![预览](docs/preview.png)

更多细节见 [docs/GUIDE.md](docs/GUIDE.md)。

## 它做了什么

- **背景是一幅画，不是一张图。** 画面纯 SVG 现场生成，随诗句的意象变化：写月的句子长出月色与远山；写山的句子叠出远、中、近三重山影，并沿山脊带皴笔；写水的句子给出水面、涟漪、倒影和一只孤舟；写鸟的句子添几只两笔掠过的飞鸟；写雨雪的句子落墨点。每次还会从几种构图里挑一种（开阔湖面 / 一侧高峰留白 / 层叠雾障 / 低岸平水），所以连着几天看不会像同一张明信片换了颜色。同一句永远长出同一幅画。
- **诗句不在中间。** 插件实测输入框位置，算出对话区占用的横向范围，再把诗句放进旁边真正空着的那条边栏；右侧边栏展开时自动改到左边。
- **可以竖排，也可以横排。** 默认竖排（右起，传统题画的方式）；设置里可改横排，边栏不够宽时自动回到竖排。
- **四款毛笔字体，每个字都保证能画出来。** 行楷（系统字体）、草书（刘建毛草）、行草（志莽行书）、行书（龙藏）。后三款随插件安装，并按全部诗句**逐字裁切**，完整覆盖 1291 个用字，不会出现缺字方块。
- **位置和字号可以自己定。** 把诗句拖到想放的地方，位置按窗口比例记住，之后每天换句都停在原处。
- **朱印是一枚固定的秦式鸟虫篆古印。** 方印 / 圆印两张各自生成的印面，边框按石印磨损重新刻过（外缘起伏、内缘更毛、四角崩裂、飞白、朱砂颗粒）。可单独拖动、滚轮缩放。
- **每天随机换一句。** 当天日期作为种子把全部诗句打乱一次，每天随机、同一天刷新不变、一轮内不重复。也可手动切换，第二天自动恢复。

## 安装

```bash
dsh plugin add /path/to/this/repo
```

或在 profile 的 `package.json` 里加依赖并写入 `dsh.profile.bundles`：

```json
{
  "dependencies": { "dsh-ink-poem-wallpaper": "link:/path/to/this/repo" },
  "dsh": { "profile": { "bundles": ["dsh-ink-poem-wallpaper"] } }
}
```

装好后刷新页面即可。设置入口在诗句下方的 `⚙`（鼠标移过去才显示）。

## 设置项

| 项 | 可选值 |
| --- | --- |
| 启用壁纸 | 开 / 关 |
| 显示出处 | 开 / 关（出处为 `朝代 · 作者《篇名》`） |
| 字体 | 行楷 / 草书 / 行草 / 行书 |
| 字号 | 小 / 标准 / 大 / 特大 |
| 纸色 | 跟随主题 / 宣纸 / 夜山 |
| 墨色浓淡 | 淡 / 适 / 浓 |
| 排布 | 自动 / 竖排 / 横排 |
| 贴边 | 自动 / 左侧 / 右侧 |
| 朱印形状 | 方印 / 圆印 |
| 朱印样式 | 白文 / 朱文 |
| 朱印大小 | 小 / 标准 / 大 / 特大（也可滚轮缩放） |

所有设置存在本机 `localStorage`，不上传。

## 诗句从哪来

全部来自 [chinese-poetry](https://github.com/chinese-poetry/chinese-poetry)（MIT）：

- `水墨唐诗` —— 项目精选的 176 首唐诗，优先取用
- `全唐诗` —— 李白、杜甫、王维、孟浩然、柳宗元等一级诗人，及一批常见诗人
- `宋词` —— 苏轼、李清照、辛弃疾、柳永、欧阳修、姜夔等

筛选时只保留五言或七言的成对句、简体、无生僻缺字、至少命中两个意象标签（月、山、水、雨、雪、风、鸟、花、幽、夕、春、秋、行旅）的句子。成句只取**同一段落内**的上下两句——跨段落拼接会让读者看到错的诗。含任一随附字体画不出的字的句子也会被剔除。最终收 **371 句**，同一作者最多 6 句。

上游数据本身的个别异体字/错字也做了校正（例如「一权寒梅」→「一树寒梅」、「平明送客楚江孤」→「楚山孤」、「韩竑」→「韩翃」、「鞭蓉山」→「芙蓉山」）。

## 安全与隐私

- **不发任何网络请求。** 画面、诗句、字形全部在本机生成；字体与印面由 Host 半端从插件目录本地提供。
- **不读页面内容。** 只读取输入框与右侧栏的**几何位置**（`getBoundingClientRect`），不读取任何文字。
- **不写除 `localStorage` 以外的任何地方**，不上传，不含统计与埋点。
- Host 半端只注册一条只读静态路由，仅提供 `fonts/` 下白名单扩展名的文件；路径做了解析与 `realpath` 双重校验，拒绝 `..`、编码穿越、符号链接逃逸与非白名单类型。

## 目录

```
index.js              Host 半端：本地静态资源路由
client.js             构建产物（不要手改）
src/client.src.js     Client 半端源码
src/build_client.py   把诗句表注入源码，生成 client.js
src/check_client.py   静态守卫：未定义标识符 / 渲染崩溃
src/make_seal.py      生成两张朱印印面
src/seal-field.png    印面原图（已去水印）
src/quotes.compact.json  371 句诗句数据
fonts/                四款字体子集 + 两张印面 + OFL
locale/               中英文案
docs/GUIDE.md         详细说明（构建、设计取舍）
docs/DETAIL.md        插件详情页（单图，DSH 用）
docs/DETAIL.zh.md     插件详情页（中文）
docs/preview.png      README 与详情页用的预览图
CHANGELOG.md          更新日志
LICENSE               本项目代码的 MIT 许可
NOTICE.md             第三方素材许可（字体 OFL、诗句 MIT）
```

重新构建：

```bash
python3 src/build_client.py    # 生成 client.js
python3 src/check_client.py    # 静态守卫
python3 src/make_seal.py square
python3 src/make_seal.py round
```

`make_seal.py` 需要 `numpy` 与 `Pillow`。

## 注意

- 行楷用系统字体（macOS 自带 Xingkai SC）。Windows / Linux 上会先找「华文行楷」等同类字体，都没有才退回楷体，此时设置面板会提示。其余三款随插件附带，跨平台一致。
- 背景画在页面画布上，会话、卡片、输入框保持原有不透明度。若你另外装了会改页面配色的皮肤插件，两者会争抢同一层背景，建议只开一个。

## 许可

代码 MIT，见 [LICENSE](LICENSE)。随附字体为 SIL OFL 1.1（见 `fonts/OFL.txt`），诗句数据来自 chinese-poetry（MIT），逐项说明见 [NOTICE.md](NOTICE.md)。
