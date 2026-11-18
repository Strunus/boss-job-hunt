/* 直接调用 AI 接口（OpenAI 兼容 /chat/completions）
 *
 * 扩展自带 API Key，请求直接发给你配置的服务，不经过任何中间服务器。
 * 注意：Key 存在 chrome.storage.local，是本机明文，任何能开这个扩展的人都能读到。
 */

const RANK_SYSTEM = [
  '你是求职匹配专家。根据候选人画像，判断每个岗位是否值得投，并给出分数与理由。',
  '只输出一个 JSON 数组，不要任何解释、不要代码块标记。',
  '每项格式：{"id":"岗位id","matchScore":0到100的整数,"reason":"为什么匹配，具体到 JD 的哪一点对应候选人哪段经历","caution":"要注意什么（作息/销售性质/行业跨度/薪资虚高/稳定性）"}',
  'reason 不超过 60 字，caution 不超过 50 字。',
  '只依据给定 JD 内容判断，不许编造 JD 里没有的信息。销售伪装岗、纯执行岗、跨度太大的要给低分。',
].join('\n')

function buildRankPrompt(profile, jobs) {
  const body = jobs.map((j) => [
    `--- id: ${j.id}`,
    `岗位：${j.title || '?'}`,
    `公司：${j.company || '?'}`,
    `薪资：${j.salary || '?'}  城市：${j.city || '?'}`,
    `JD：${String(j.jd || '').replace(/\s+/g, ' ').slice(0, 2000)}`,
  ].join('\n')).join('\n\n')
  return `【候选人画像】\n${String(profile || '').trim() || '（未填写）'}\n\n【待评岗位】\n${body}\n\n请给出 JSON 数组，覆盖以上全部 ${jobs.length} 个岗位。`
}

async function callChat(settings, system, user, maxTokens = 1200) {
  const base = String(settings.apiBase || '').replace(/\/+$/, '')
  if (!base) throw new Error('没填 API 地址')
  if (!settings.apiKey) throw new Error('没填 API Key')
  const url = /\/chat\/completions$/.test(base) ? base : base + '/chat/completions'
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model || 'deepseek-chat',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.2,
      max_tokens: maxTokens,
    }),
  })
  const text = await r.text()
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${text.slice(0, 160)}`)
  let data = null
  try { data = JSON.parse(text) } catch { throw new Error('返回不是 JSON：' + text.slice(0, 120)) }
  const content = data?.choices?.[0]?.message?.content
  if (!content) throw new Error('返回里没有 content')
  return content
}

/** 拉取模型列表：GET {apiBase}/models（OpenAI 兼容） */
async function listModels(settings) {
  const base = String(settings.apiBase || '').replace(/\/+$/, '')
  if (!base) throw new Error('没填 API 地址')
  if (!settings.apiKey) throw new Error('没填 API Key')
  const r = await fetch(base + '/models', {
    headers: { authorization: `Bearer ${settings.apiKey}` },
  })
  const text = await r.text()
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${text.slice(0, 120)}`)
  let data = null
  try { data = JSON.parse(text) } catch { throw new Error('返回不是 JSON') }
  const arr = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : [])
  return arr.map((m) => (typeof m === 'string' ? m : m && (m.id || m.name))).filter(Boolean)
}

function parseRank(text) {
  let t = String(text || '').trim()
  t = t.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  const a = t.indexOf('[')
  const b = t.lastIndexOf(']')
  if (a >= 0 && b > a) t = t.slice(a, b + 1)
  try {
    const arr = JSON.parse(t)
    return Array.isArray(arr) ? arr : []
  } catch { return [] }
}

/** 给一批岗位打分，返回 { id → {matchScore, reason, caution} } */
async function rankJobs(settings, jobs) {
  if (!jobs.length) return {}
  const out = {}
  const SIZE = 4
  for (let i = 0; i < jobs.length; i += SIZE) {
    const batch = jobs.slice(i, i + SIZE)
    const text = await callChat(settings, RANK_SYSTEM, buildRankPrompt(settings.profile, batch))
    const arr = parseRank(text)
    for (const r of arr) {
      if (!r || !r.id) continue
      const score = Number(r.matchScore)
      if (!Number.isFinite(score)) continue
      out[r.id] = {
        matchScore: Math.max(0, Math.min(100, Math.round(score))),
        reason: String(r.reason || '').slice(0, 120),
        caution: String(r.caution || '').slice(0, 100),
      }
    }
  }
  return out
}

async function testConnection(settings) {
  const text = await callChat(settings, '只回一个字：好', '测试', 12)
  return String(text).trim().slice(0, 20)
}

/* ---------- 简历 → 画像 ---------- */

const PROFILE_SYSTEM = [
  '你是资深招聘顾问。请从候选人简历里提炼求职画像，用于给岗位做匹配打分。',
  '只输出一个 JSON 对象，不要解释、不要代码块标记。',
  '字段：',
  '{"directions":["目标岗位方向，2-5 个，越具体越好"],',
  ' "years": 工作年限整数,',
  ' "cities":["意向城市"],',
  ' "skills":["核心技能/工具/方法论，10-20 个"],',
  ' "summary":"一句话定位，不超过 50 字",',
  ' "strengths":["3-5 条可量化的亮点，带数字"],',
  ' "avoid":["应该避开的岗位类型，例如纯销售、纯执行、跨度太大"]}',
  '只依据简历内容，不许编造简历里没有的经历或数字。',
].join('\n')

function parseJsonObject(text) {
  let t = String(text || '').trim()
  t = t.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  const a = t.indexOf('{')
  const b = t.lastIndexOf('}')
  if (a >= 0 && b > a) t = t.slice(a, b + 1)
  try { return JSON.parse(t) } catch { return null }
}

/** 把结构化画像排成可读文本（也是存进 settings.profile 的内容） */
function formatProfile(p) {
  if (!p) return ''
  const lines = []
  if (p.summary) lines.push(`定位：${p.summary}`)
  if (Array.isArray(p.directions) && p.directions.length) lines.push(`目标方向：${p.directions.join('、')}`)
  if (p.years) lines.push(`工作年限：${p.years} 年`)
  if (Array.isArray(p.cities) && p.cities.length) lines.push(`意向城市：${p.cities.join('、')}`)
  if (Array.isArray(p.skills) && p.skills.length) lines.push(`核心技能：${p.skills.join('、')}`)
  if (Array.isArray(p.strengths) && p.strengths.length) {
    lines.push('亮点：')
    for (const s of p.strengths) lines.push(`- ${s}`)
  }
  if (Array.isArray(p.avoid) && p.avoid.length) lines.push(`要避开：${p.avoid.join('、')}`)
  return lines.join('\n')
}

/** 简历文本 → 画像文本（失败抛错） */
async function profileFromResume(settings, resumeText) {
  const text = String(resumeText || '').trim()
  if (text.length < 50) throw new Error('简历文字太少，可能是扫描件')
  const clipped = text.slice(0, 12000)
  const out = await callChat(settings, PROFILE_SYSTEM, `【简历全文】\n${clipped}`, 900)
  const obj = parseJsonObject(out)
  if (!obj) throw new Error('模型没返回合法 JSON')
  return { structured: obj, text: formatProfile(obj) }
}