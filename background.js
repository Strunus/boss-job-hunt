// 点工具栏图标 → 打开侧栏
chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {})

chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.sidePanel.open({ windowId: tab.windowId })
  } catch (e) {
    // 老版本没有 sidePanel.open，点击图标时 Chorme 已按行为打开
  }
})