/* 求职面板（侧栏）
 *
 * 自包含：岗位与标记存在 chrome.storage.local，AI 打分直接调用你填的 API。
 * 纯前端、零后端：没有服务端组件，也不需要本机其它程序配合。
 */

const state = {
  tab: 'pick', jobs: [], marks: {}, expanded: new Set(), busy: false, settings: null,
  lastDebug: null, filters: { industry: '', scale: '', city: '' },
}

const $ = (id) => document.getElementById(id)

function say(msg) {
  $('toast').textContent = msg || ''
  if (msg) setTimeout(() => { if ($('toast').textContent === msg) $('toast').textContent = '' }, 6000)
}

const escapeHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

const fmtTime = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(String(iso || ''))
  return m ? `${Number(m[2])}月${Number(m[3])}日 ${m[4]}:${m[5]}` : ''
}

/* ---------- 设置 ---------- */

async function openSettings() {
  const s = await getSettings()
  $('apiBase').value = s.apiBase || ''
  $('apiKey').value = s.apiKey || ''
  $('model').value = s.model || ''
  $('profile').value = s.profile || ''
  const saved = await chrome.storage.local.get('jh.models')
  const list = saved['jh.models'] || []
  fillModels(list, s.model)
  $('settings').classList.add('show')
}

function fillModels(list, selected) {
  const sel = $('modelSel')
  sel.innerHTML = ''
  if (!list.length) {
    sel.innerHTML = '<option value="">— 先测试连接 —</option>'
    return
  }
  for (const id of list) {
    const o = document.createElement('option')
    o.value = id
    o.textContent = id
    if (id === selected) o.selected = true
    sel.appendChild(o)
  }
  if (!selected) { $('model').value = list[0] }
}

/** 测试连接：先列模型，再用当前模型发一次最小请求 */
async function testConnectionFlow() {
  const patch = {
    apiBase: $('apiBase').value.trim(),
    apiKey: $('apiKey').value.trim(),
    model: ($('modelSel').value || $('model').value || '').trim() || 'deepseek-chat',
    profile: $('profile').value,
  }
  if (!patch.apiBase || !patch.apiKey) { $('cfgStatus').textContent = '先填地址和 Key'; return }
  $('cfgStatus').textContent = '连接中…'
  try {
    let models = []
    try {
      models = await listModels(patch)
    } catch (e) {
      $('cfgStatus').textContent = `模型列表不可用（${String(e.message || e).slice(0, 30)}），仍尝试调用`
    }
    if (models.length) {
      await chrome.storage.local.set({ 'jh.models': models })
      fillModels(models, patch.model)
      if (!models.includes(patch.model)) {
        patch.model = models[0]
        $('model').value = patch.model
      }
      $('cfgStatus').textContent = `发现 ${models.length} 个模型`
    }
    await setSettings(patch)
    state.settings = await getSettings()
    const t = await testConnection(state.settings)
    $('cfgStatus').textContent = models.length
      ? `连接正常 · ${models.length} 个模型 · 回显「${t}」`
      : `连接正常 · 回显「${t}」`
    updateHint()
  } catch (e) {
    $('cfgStatus').textContent = `失败：${String(e.message || e).slice(0, 60)}`
  }
}

/* ---------- 简历 → 画像 ---------- */

async function readResumeText(file) {
  if (!file) throw new Error('没选文件')
  if (/\.(txt|md)$/i.test(file.name)) return await file.text()
  if (!/\.pdf$/i.test(file.name)) throw new Error('只支持 PDF / TXT')
  const buf = await file.arrayBuffer()
  if (!window.pdfjsLib) throw new Error('PDF 解析库没加载')
  pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('vendor/pdf.worker.min.js')
  const doc = await pdfjsLib.getDocument({ data: buf }).promise
  const parts = []
  for (let i = 1; i <= doc.numPages; i += 1) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    parts.push(content.items.map((it) => it.str).join(' '))
  }
  const text = parts.join('\n').replace(/[ \t]+/g, ' ').trim()
  if (text.length < 50) throw new Error(`只解析出 ${text.length} 个字符，可能是扫描版 PDF`)
  return text
}

async function pickResume() {
  const f = $('resumeFile').files && $('resumeFile').files[0]
  if (!f) return
  if (!state.settings || !state.settings.apiKey) {
    $('cfgStatus').textContent = '先填 API 地址和 Key 并保存'
    return
  }
  $('resumeStatus').textContent = `解析 ${f.name}…`
  try {
    const text = await readResumeText(f)
    $('resumeStatus').textContent = `已提取 ${text.length} 字，画像生成中…`
    const { text: profileText, structured } = await profileFromResume(state.settings, text)
    $('profile').value = profileText
    await setSettings({ profile: profileText, resumeChars: text.length, resumeAt: new Date().toISOString() })
    state.settings = await getSettings()
    $('resumeStatus').textContent = `画像已生成（${structured.directions?.length || 0} 个方向 / ${structured.skills?.length || 0} 项技能）`
    updateHint()
  } catch (e) {
    $('resumeStatus').textContent = `失败：${String(e.message || e).slice(0, 70)}`
  } finally {
    $('resumeFile').value = ''
  }
}

async function saveSettings() {
  state.settings = await setSettings({
    apiBase: $('apiBase').value.trim(),
    apiKey: $('apiKey').value.trim(),
    model: $('model').value.trim() || 'deepseek-chat',
    profile: $('profile').value,
  })
  $('settings').classList.remove('show')
  updateHint()
  say('设置已保存')
}

function updateHint() {
  const s = state.settings || {}
  if (!s.apiKey) $('hint').textContent = '未配置 API，点 ⚙'
  else $('hint').textContent = `${s.model || ''} · 本地存储`
}

/* ---------- 渲染 ---------- */

const scoreClass = (n) => (!Number.isFinite(n) ? '' : n >= 80 ? 'hi' : n >= 60 ? 'mid' : '')

function matchFilters(j) {
  const f = state.filters
  if (f.industry && String(j.industry || '') !== f.industry) return false
  if (f.scale && String(j.scale || '') !== f.scale) return false
  if (f.city && String(j.city || '') !== f.city) return false
  return true
}

/** 三个下拉的选项来自当前收录里出现过的值 */
function renderFilters() {
  const uniq = (key) => [...new Set(state.jobs.map((j) => String(j[key] || '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'zh'))
  const fill = (sel, values, allLabel, cur) => {
    sel.innerHTML = `<option value="">${allLabel}</option>`
      + values.map((v) => `<option value="${escapeHtml(v)}"${v === cur ? ' selected' : ''}>${escapeHtml(v)}</option>`).join('')
  }
  fill($('fIndustry'), uniq('industry'), `全部行业`, state.filters.industry)
  fill($('fScale'), uniq('scale'), `全部规模`, state.filters.scale)
  fill($('fCity'), uniq('city'), `全部地区`, state.filters.city)
  $('filters').style.display = state.jobs.length ? 'flex' : 'none'
}

function rows() {
  if (state.tab === 'pick') {
    return state.jobs
      .filter((j) => !state.marks[j.id])
      .filter(matchFilters)
      .map((j) => ({ ...j, status: '', stamp: j.capturedAt || '' }))
  }
  const byId = new Map(state.jobs.map((j) => [j.id, j]))
  return Object.entries(state.marks)
    .filter(([, m]) => m && m.status === state.tab)
    .filter(([id]) => matchFilters(byId.get(id) || {}))
    .sort((a, b) => String(b[1].at || '').localeCompare(String(a[1].at || '')))
    .map(([id, m]) => ({
      id, title: m.title, company: m.company, salary: m.salary, city: m.city,
      scale: (byId.get(id) && byId.get(id).scale) || '',
      industry: (byId.get(id) && byId.get(id).industry) || '',
      url: m.url, matchScore: null, reason: '', caution: '', status: m.status,
      // 优先用收录时间；这条被删过再标记的，退回用标记时间
      stamp: (byId.get(id) && byId.get(id).capturedAt) || m.at || '',
    }))
}

function cleanMeta(r) {
  const title = String(r.title || '').trim()
  let company = String(r.company || '').trim()
  let salary = String(r.salary || '').trim()
  // 公司名里混进了岗位名 / 薪资 / 福利（BOSS 的 banner 结构偶发），这里清理掉
  if (company && title && company.includes(title)) company = company.split(title).join(' ').trim()
  if (company && salary && company.includes(salary)) company = company.split(salary).join(' ').trim()
  company = company.replace(/\s{2,}/g, ' ').replace(/^[·,，、\s-]+|[·,，、\s-]+$/g, '').trim()
  if (company === title) company = ''
  // 去掉岗位名/薪资后只剩福利词，说明公司名其实没抓到，别硬凑
  if (/五险|一金|双休|包吃|包住|年终|补贴|节日|团建|带薪|奖金|福利/.test(company)) company = ''
  if (company.length <= 1) company = ''
  // 薪资重复出现时只留一份
  if (salary) {
    const m = salary.match(/\d+\s*[-~]\s*\d+\s*K(·\d+薪)?/i)
    if (m) salary = m[0]
  }
  return { title, company, salary, scale: String(r.scale || '').trim(),
    industry: String(r.industry || '').trim(),
    companyType: String(r.companyType || '').trim() }
}

function render() {
  const list = rows()
  renderFilters()
  $('n-pick').textContent = state.jobs.filter((j) => !state.marks[j.id]).length
  $('n-applied').textContent = Object.values(state.marks).filter((m) => m && m.status === 'applied').length
  $('n-rejected').textContent = Object.values(state.marks).filter((m) => m && m.status === 'rejected').length

  if (!list.length) {
    $('list').innerHTML = `<div class="empty">${
      state.tab === 'pick' ? '打开 BOSS 岗位页，点底部「收录当前页」' : '还没有标记过的岗位'}</div>`
    return
  }

  $('list').innerHTML = list.map((r) => {
    const open = state.expanded.has(r.id)
    const hasReason = !!(r.reason || r.caution)
    const stamp = r.stamp ? `<div class="stamp">收录于 ${fmtTime(r.stamp)}</div>` : ''
    const clean = cleanMeta(r)
    // 行业 → 公司 → 类型 → 规模 → 薪资 → 城市
    const metaBits = [clean.industry, clean.company, clean.companyType, clean.scale, clean.salary, r.city].filter(Boolean)
    return `
      <div class="row">
        <div class="row-top">
          <span class="score ${scoreClass(r.matchScore)}">${Number.isFinite(r.matchScore) ? r.matchScore : '—'}</span>
          <a class="title" href="${escapeHtml(r.url || '#')}" target="_blank" rel="noreferrer">${escapeHtml(clean.title || '（无标题）')}</a>
        </div>
        <div class="meta">${metaBits.map(escapeHtml).join(' · ') || '—'}</div>
        ${stamp}
        <div class="acts">
          ${hasReason ? `<button class="chip c-reason" data-act="reason" data-id="${escapeHtml(r.id)}">${open ? '收起' : 'AI建议'}</button>` : ''}
          <button class="chip c-apply ${r.status === 'applied' ? 'applied' : ''}" data-act="applied" data-id="${escapeHtml(r.id)}">${r.status === 'applied' ? '✓ 已投递' : '标记已投递'}</button>
          <button class="chip c-reject ${r.status === 'rejected' ? 'rejected' : ''}" data-act="rejected" data-id="${escapeHtml(r.id)}">${r.status === 'rejected' ? '✗ 不合适' : '标记不合适'}</button>
          ${r.status ? `<button class="chip c-undo" data-act="none" data-id="${escapeHtml(r.id)}">取消标记</button>` : ''}
          <button class="chip c-reason" data-act="rescore" data-id="${escapeHtml(r.id)}" title="只重新打分这一条">重排</button>
          <button class="chip c-del" data-act="delete" data-id="${escapeHtml(r.id)}" title="从收录里删除">删除</button>
        </div>
        ${open && hasReason ? `<div class="reason">${[
          r.reason ? `<span class="k">匹配：</span>${escapeHtml(r.reason)}` : '',
          r.caution ? `<span class="k">注意：</span>${escapeHtml(r.caution)}` : '',
        ].filter(Boolean).join('\n')}</div>` : ''}
      </div>`
  }).join('')
}

/* ---------- 页面提取（读 DOM，不向 BOSS 发请求） ---------- */

function extractJob() {
  const txt = (e) => (e ? (e.innerText || '').trim() : '')
  const pick = (arr) => { for (const s of arr) { const v = txt(document.querySelector(s)); if (v) return v } return '' }
  let jd = pick(['.job-sec-text', '.job-detail-section .text', '.job-sec .text',
                 '[class*="job-sec-text"]', '.detail-content .text'])
  if (!jd) {
    const body = document.body.innerText || ''
    const m = body.match(/(岗位职责|工作职责|职位描述|工作内容)([\s\S]{80,4000})/)
    if (m) jd = (m[1] + m[2]).trim()
  }
  const titleRaw = pick(['.job-banner .name h1', '.info-primary .name', '.job-name', 'h1'])
  let title = titleRaw.replace(/\s*招聘\s*$/, '')
  let company = pick(['.job-banner .company-info a', '.info-company .name', '.company-info .name',
                      '.sider-company .company-info a', '[class*="company-name"]'])
  const mt = (document.title || '').match(/^「(.+?)招聘」[_-](.+?)招聘/)
  if (mt) { if (!title) title = mt[1]; if (!company) company = mt[2] }
  if (company === title) company = (mt && mt[2]) || ''
  const banner = txt(document.querySelector('.job-banner, .info-primary'))
  const salary = (banner.match(/\d+\s*[-~]\s*\d+\s*K(·\d+薪)?/i) || [''])[0]
    || ((document.body.innerText || '').match(/\d+\s*[-~]\s*\d+\s*K(·\d+薪)?/i) || [''])[0]
  const tags = Array.from(document.querySelectorAll('.job-keyword-list li, .tag-all .tag-item, .job-tags span'))
    .map((e) => e.innerText.trim()).filter(Boolean).slice(0, 15)

  /* ---- 公司块：真正的信息在 .sider-company（右侧栏）
   ⚠️ 别用 .company-info —— 那里面是岗位名；.info-company 是"相似职位"区块 */
  const siderText = txt(document.querySelector('.sider-company'))
  const bannerText = txt(document.querySelector('.job-banner, .info-primary, .job-detail-header, .detail-header'))

  // 城市：banner 里常见「郑州 3-5年 本科」或「郑州 · 3-5年」
  const CITY_RE = /^(北京|上海|天津|重庆|郑州|杭州|南京|苏州|无锡|常州|宁波|温州|合肥|福州|厦门|济南|青岛|烟台|潍坊|武汉|长沙|南昌|广州|深圳|东莞|佛山|珠海|中山|惠州|成都|昆明|贵阳|南宁|西安|太原|石家庄|哈尔滨|长春|沈阳|大连|兰州|乌鲁木齐|呼和浩特|银川|西宁|拉萨|海口|三亚|徐州|洛阳|开封|新乡|南阳|许昌|昆山|嘉兴|绍兴|金华|台州)$/
  let city = ''
  for (const seg of (bannerText || '').split(/[·|,，\n\s]+/)) {
    const s = seg.trim().replace(/市$/, '')
    if (CITY_RE.test(s)) { city = s; break }
  }

  // 右侧栏：公司基本信息 \n 公司名 \n 规模 \n 行业 \n 查看全部职位
  const siderLines = siderText.split(/[\n·|,，]+/).map((s) => s.trim()).filter(Boolean)
  const scaleRe = /^(\d+\s*-\s*\d+\s*人|少于\s*\d+\s*人|\d+\s*人以上|\d+人以上|10000人以上)$/
  const fundingRe = /融资|上市|天使|A轮|B轮|C轮|D轮|不需要融资|已上市|未融资/
  const typeRe = /^(民营|国企|央企|外资|合资|事业单位|创业公司|上市公司|非营利组织)$/
  const labelRe = /公司基本信息|查看全部职位|公司介绍|工商信息/

  const scale = (siderText.match(/\d+\s*-\s*\d+\s*人|少于\s*\d+\s*人|\d+\s*人以上|10000人以上/) || [''])[0].replace(/\s+/g, '')
    || ((document.body.innerText || '').match(/(\d+-\d+人|少于\d+人|\d+人以上|10000人以上)/) || [''])[0]
  const companyType = siderLines.find((s) => typeRe.test(s)) || ''
  // 公司名 = 右侧栏里第一个既不是标签、不是规模、不是行业的短行
  const siderName = siderLines.find((s) => !labelRe.test(s) && !scaleRe.test(s)
    && !fundingRe.test(s) && !typeRe.test(s) && s.length >= 2 && s.length <= 20 && s !== title) || ''
  if (siderName) company = siderName
  const industry = siderLines.find((s) => !labelRe.test(s) && !scaleRe.test(s) && !fundingRe.test(s)
    && !typeRe.test(s) && s !== siderName && s.length >= 2 && s.length <= 12) || ''

  const m = /job_detail\/([A-Za-z0-9_-]+)\.html/.exec(location.href)
  return {
    id: (m && m[1]) || `cap-${Date.now()}`,
    url: location.href, title, company, salary, jd, tags, scale, industry, companyType, city,
    truncated: /登录查看完整内容|登录后查看/.test(document.body.innerText || ''),
    debug: {
      banner: bannerText.slice(0, 300),
      sider: siderText.slice(0, 300),
      siderLines,
      bodyHead: (document.body.innerText || '').slice(0, 400),
    },
  }
}

async function captureCurrent() {
  if (state.busy) return
  state.busy = true
  say('读取中…')
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab || !/zhipin\.com\/job_detail/.test(tab.url || '')) {
      say('请先打开一个 BOSS 岗位详情页')
      return
    }
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractJob })
    const info = res && res.result
    if (!info || !info.jd) { say('这个页面没读到 JD'); return }

    const job = {
      id: info.id, title: info.title, company: info.company, salary: info.salary,
      city: info.city || '', scale: info.scale || '', industry: info.industry || '',
      companyType: info.companyType || '',
      url: info.url, jd: info.jd, tags: info.tags,
      truncated: info.truncated, capturedAt: new Date().toISOString(),
    }
    state.lastDebug = { at: new Date().toISOString(), url: info.url, ...info.debug,
      parsed: { title: info.title, company: info.company, salary: info.salary, city: info.city,
        scale: info.scale, industry: info.industry, companyType: info.companyType,
        jdLen: (info.jd || '').length } }
    await upsertJob(job)

    if (!state.settings || !state.settings.apiKey) {
      say('已收录（未配置 API，暂不打分）')
      await reload()
      return
    }
    say('已收录，AI 打分中…')
    try {
      const r = await rankJobs(state.settings, [job])
      const one = r[job.id]
      if (one) await upsertJob({ ...job, ...one })
      say(one ? `已收录并打分：${one.matchScore} 分` : '已收录（模型没返回有效评分）')
    } catch (e) {
      say(`已收录，打分失败：${String(e.message || e).slice(0, 60)}`)
    }
    await reload()
  } catch (e) {
    say(`收录失败：${String(e.message || e)}`)
  } finally {
    state.busy = false
  }
}

/** 只重排一条 */
async function rescoreOne(id) {
  if (!state.settings || !state.settings.apiKey) { say('先在 ⚙ 里填 API'); return }
  const job = state.jobs.find((j) => j.id === id)
  if (!job || !String(job.jd || '').trim()) { say('这条没有 JD，没法打分'); return }
  say('重排中…')
  try {
    const r = await rankJobs(state.settings, [job])
    if (!r[id]) { say('模型没返回有效评分'); return }
    const list = await getJobs()
    const t = list.find((j) => j.id === id)
    if (t) Object.assign(t, r[id])
    await setJobs(list)
    state.jobs = await getJobs()
    say(`已重排：${r[id].matchScore} 分`)
    render()
  } catch (e) {
    say(`重排失败：${String(e.message || e).slice(0, 70)}`)
  }
}

async function rescoreAll() {
  if (state.busy) return
  if (!state.settings || !state.settings.apiKey) { say('先在 ⚙ 里填 API'); return }
  const todo = state.jobs.filter((j) => String(j.jd || '').trim())
  if (!todo.length) { say('没有可打分的岗位'); return }
  state.busy = true
  try {
    say(`重新打分中（${todo.length} 条）…`)
    const r = await rankJobs(state.settings, todo)
    const list = await getJobs()
    for (const j of list) {
      if (r[j.id]) Object.assign(j, r[j.id])
    }
    await setJobs(list)
    say('打分完成')
    await reload()
  } catch (e) {
    say(`打分失败：${String(e.message || e).slice(0, 80)}`)
  } finally {
    state.busy = false
  }
}

async function reload() {
  state.jobs = await getJobs()
  state.marks = await getMarks()
  render()
}

/* ---------- 事件 ---------- */

$('list').addEventListener('click', async (ev) => {
  const btn = ev.target.closest('button[data-act]')
  if (!btn) return
  const id = btn.dataset.id
  const act = btn.dataset.act
  if (act === 'reason') {
    state.expanded.has(id) ? state.expanded.delete(id) : state.expanded.add(id)
    render()
    return
  }
  const row = rows().find((r) => r.id === id) || { id }
  if (act === 'rescore') { await rescoreOne(id); return }
  if (act === 'delete') {
    const name = row.title ? `「${row.title}」` : '这条收录'
    if (!window.confirm(`确定删除 ${name}？删除后不再出现在列表里。`)) return
    const after = await removeJob(id)
    state.jobs = after.jobs
    state.marks = after.marks
    say('已删除')
    render()
    return
  }
  await setMark(id, act === 'none' ? 'none' : act, row)
  state.marks = await getMarks()
  say(act === 'none' ? '已取消标记' : act === 'applied' ? '已标记为已投递' : '已标记为不合适')
  render()
})

document.querySelectorAll('.tab').forEach((el) => {
  el.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'))
    el.classList.add('active')
    state.tab = el.dataset.tab
    render()
  })
})

$('gear').addEventListener('click', () => {
  if ($('settings').classList.contains('show')) $('settings').classList.remove('show')
  else openSettings()
})
$('saveCfg').addEventListener('click', saveSettings)
$('closeCfg').addEventListener('click', () => $('settings').classList.remove('show'))
$('testCfg').addEventListener('click', testConnectionFlow)
$('modelSel').addEventListener('change', () => { $('model').value = $('modelSel').value })
$('pickResume').addEventListener('click', () => $('resumeFile').click())
$('resumeFile').addEventListener('change', pickResume)

$('capture').addEventListener('click', captureCurrent)
$('more').addEventListener('click', (ev) => {
  ev.stopPropagation()
  $('menu').classList.toggle('show')
})
document.addEventListener('click', (e) => {
  if (!$('menu').contains(e.target) && e.target.id !== 'more') $('menu').classList.remove('show')
})
$('rescoreAll').addEventListener('click', () => { $('menu').classList.remove('show'); rescoreAll() })
$('diagnose').addEventListener('click', () => {
  $('menu').classList.remove('show')
  if (!state.lastDebug) { say('先点一次「收录当前页」，再来看诊断'); return }
  window.prompt('诊断信息（全选复制发给我）', JSON.stringify(state.lastDebug, null, 1))
})

/* 筛选 */
$('fIndustry').addEventListener('change', () => { state.filters.industry = $('fIndustry').value; render() })
$('fScale').addEventListener('change', () => { state.filters.scale = $('fScale').value; render() })
$('fCity').addEventListener('change', () => { state.filters.city = $('fCity').value; render() })
$('clearFilters').addEventListener('click', () => {
  state.filters = { industry: '', scale: '', city: '' }
  render()
})
$('rescore').addEventListener('click', rescoreAll)
$('openList').addEventListener('click', () => chrome.tabs.create({ url: 'https://www.zhipin.com/web/geek/jobs' }))

;(async () => {
  state.settings = await getSettings()
  updateHint()
  await reload()
  if (!state.settings.apiKey) openSettings()
})()