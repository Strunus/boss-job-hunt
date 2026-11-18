/* 本地存储：设置 / 岗位 / 标记
 * 全部放在 chrome.storage.local，扩展自包含，不依赖任何服务端。
 */

const STORE_KEYS = { settings: 'jh.settings', jobs: 'jh.jobs', marks: 'jh.marks' }

const DEFAULT_SETTINGS = {
  apiBase: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-chat',
  profile: '',
}

async function getSettings() {
  const d = await chrome.storage.local.get(STORE_KEYS.settings)
  return { ...DEFAULT_SETTINGS, ...(d[STORE_KEYS.settings] || {}) }
}

async function setSettings(patch) {
  const cur = await getSettings()
  const next = { ...cur, ...patch }
  await chrome.storage.local.set({ [STORE_KEYS.settings]: next })
  return next
}

async function getJobs() {
  const d = await chrome.storage.local.get(STORE_KEYS.jobs)
  return Array.isArray(d[STORE_KEYS.jobs]) ? d[STORE_KEYS.jobs] : []
}

async function setJobs(list) {
  await chrome.storage.local.set({ [STORE_KEYS.jobs]: list })
}

async function upsertJob(job) {
  const list = await getJobs()
  const i = list.findIndex((x) => x.id === job.id)
  if (i >= 0) list[i] = { ...list[i], ...job }
  else list.unshift(job)
  await setJobs(list)
  return list
}

async function getMarks() {
  const d = await chrome.storage.local.get(STORE_KEYS.marks)
  return d[STORE_KEYS.marks] || {}
}

async function setMark(id, status, job) {
  const marks = await getMarks()
  if (!status || status === 'none') delete marks[id]
  else marks[id] = {
    status, at: new Date().toISOString(),
    title: job?.title || marks[id]?.title || '',
    company: job?.company || marks[id]?.company || '',
    salary: job?.salary || marks[id]?.salary || '',
    city: job?.city || marks[id]?.city || '',
    url: job?.url || marks[id]?.url || '',
  }
  await chrome.storage.local.set({ [STORE_KEYS.marks]: marks })
  return marks
}

/** 删除一条收录（连带清掉它的标记） */
async function removeJob(id) {
  const list = await getJobs()
  await setJobs(list.filter((x) => x.id !== id))
  const marks = await getMarks()
  if (marks[id]) {
    delete marks[id]
    await chrome.storage.local.set({ [STORE_KEYS.marks]: marks })
  }
  return { jobs: await getJobs(), marks: await getMarks() }
}
