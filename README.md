# 求职面板 · Chrome 侧栏扩展

把 BOSS 直聘上的岗位「收」进侧栏，用你自己的 AI 接口打分，再标记已投递 / 不合适。

纯前端、零后端：**没有服务器，没有账号体系，没有埋点**。岗位数据、API Key、候选人画像
全部保存在本机 `chrome.storage.local`；收录岗位时读取的是你当前标签页的 DOM，
**不向 BOSS 直聘发送任何请求**。

> 作者 [@Strunus](https://github.com/Strunus) ｜ Chrome 114+ ｜ Manifest V3 ｜ MIT

---

## 为什么做这个

招聘网站的岗位列表能翻，但「哪个值得投」要靠人一个个点开读 JD。
这个扩展把这一步变成：**粘一个页面 → 得到分数和理由 → 决定投不投**，判断标准由你自己写。

用你自己的 API Key 和模型，不订阅任何服务，也不上传简历原文件。

## 功能

| 功能 | 说明 |
|---|---|
| **收录当前页** | 读你正在看的岗位详情页 DOM，提取岗位名 / 公司 / 行业 / 规模 / 薪资 / 城市 / JD / 福利标签 |
| **AI 打分** | 按你的画像给出 0–100 匹配分、匹配理由（≤60 字）、风险提醒（≤50 字） |
| **标记** | 已投递 / 不合适，可从「收录」移走、随时取消 |
| **筛选** | 按行业 / 公司规模 / 地区三向筛选，选项来自已有数据 |
| **单条重排** | 改了画像后只重算某一条，或一次全部重算 |
| **画像生成** | 上传 PDF 简历 → 本地抽文字 → AI 提炼成结构化画像（原文件不上传） |
| **模型发现** | 点一次「测试连接」自动拉取接口支持的模型列表 |

## 安装

1. 下载本仓库，或 `git clone https://github.com/Strunus/job-hunt-extension`
2. 打开 `chrome://extensions`
3. 右上角开启「开发者模式」
4. 「加载已解压的扩展程序」→ 选择仓库根目录
5. 点工具栏图标 → 侧栏打开

## 首次配置

点侧栏右上角 **⚙**：

**① 接口**

| 字段 | 示例 |
|---|---|
| API 地址 | `https://api.deepseek.com/v1` |
| API Key | `sk-...` |

点「测试连接并获取模型」：会请求 `GET {apiBase}/models` 拉取模型列表并自动选中第一个，
然后发一次最小请求验证连通。

兼容任何 OpenAI 格式的 `/chat/completions`：DeepSeek、通义、智谱、Kimi、本地 Ollama 都可以。
如果服务不提供 `/models`，手动填模型名即可。

**② 画像**

点「上传简历生成画像」，选 PDF / TXT / MD：

1. 本地用 pdf.js 抽取文字（**原文件不离开本机**）
2. 把文字发给你配置的 AI，提炼结构化画像
3. 结果填入文本框，可继续手动修改

画像建议包含：目标方向、工作年限、意向城市、核心技能、可量化成绩、要避开的岗位类型。

## 使用

1. 正常浏览 BOSS，点开一个岗位
2. 侧栏点「**收录当前页**」
3. 看分数与「AI建议」，决定投不投
4. 投了 → 「标记已投递」；不合适 → 「标记不合适」
5. 顶部下拉按 行业 / 规模 / 地区 筛选

## 数据与隐私

| 数据 | 存放位置 | 是否外传 |
|---|---|---|
| API Key / 模型 / 画像 | `chrome.storage.local` | 否（仅随请求发给**你配置的**接口） |
| 岗位列表、JD、标记 | `chrome.storage.local` | 否 |
| 简历原文件 | 不保存 | 否；只把抽取出的文字发给你的 AI |
| 页面内容 | 不保存 | 否 |

- **没有服务端**，作者无法接触任何用户数据
- **没有统计、没有遥测、没有第三方脚本**（`vendor/` 里是本地 pdf.js）
- API Key 是**明文**存储在本机的，共用电脑请谨慎

详见 [PRIVACY.md](PRIVACY.md)。

## 权限说明

| 权限 | 为什么需要 |
|---|---|
| `sidePanel` | 面板显示在浏览器侧栏 |
| `storage` | 保存岗位、标记、设置 |
| `tabs` / `activeTab` | 读取当前标签页地址，判断是否为岗位详情页 |
| `scripting` | 在岗位页执行 DOM 提取（**只在你点「收录当前页」时**） |
| `https://*/*` | API 地址由用户填写，域名不固定 |
| `http://127.0.0.1/*`、`http://localhost/*` | 支持本地模型（Ollama 等） |

扩展只在 `zhipin.com/job_detail/*` 页面执行提取；不会读取其它网站的页面内容。

## 文件结构

```
manifest.json      MV3 声明
background.js      点击图标打开侧栏
panel.html/js      侧栏 UI、页面提取、打分编排
store.js           本地存储（设置 / 岗位 / 标记）
llm.js             接口调用、模型列表、复排提示词、简历→画像
vendor/            本地 pdf.js（MV3 不允许运行时加载远程代码）
icons/             扩展图标
```

无构建步骤：改完文件在 `chrome://extensions` 点「重新加载」即可。

## 已知限制

- 只支持 `zhipin.com/job_detail/*` 的收录
- 扫描版 PDF 抽不出文字，需要自己填写画像
- 未登录浏览时 BOSS 会隐藏薪资并截断 JD，扩展会提示「⚠ JD 可能不完整」
- 打分质量取决于模型与画像质量；分数仅供参考，不构成求职建议

## 免责声明

本项目与 BOSS 直聘无任何关联，未获其授权或背书。

使用前请自行确认符合目标网站的服务条款与当地法律。扩展的收录行为只读取你自己浏览器
已经渲染的页面内容，不绕过登录、不破解接口、不自动投递。

## License

[MIT](LICENSE) © 2026 [Strunus](https://github.com/Strunus)

---

## English

A Chrome side-panel extension that captures a job posting from the page you are viewing,
scores it with **your own** OpenAI-compatible API, and lets you mark it as applied or rejected.

- **No backend, no telemetry.** Jobs, API keys and your profile live in `chrome.storage.local`.
- **No requests to the job site.** Job data is read from the DOM of the tab you already opened.
- Bring your own model: DeepSeek, Qwen, GLM, Kimi, Ollama, or any `/chat/completions` endpoint.

```bash
git clone <this repo>
# chrome://extensions → Developer mode → Load unpacked → select the repo root
```

Then open the side panel, click ⚙, fill in the API base URL and key, and upload a resume to
generate your profile. See [PRIVACY.md](PRIVACY.md) for the data-handling details.