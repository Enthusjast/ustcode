import type { ElectronAPI } from "../api-types"

const deepLinkEvent = "ustcode:deep-link"

export function startDeepLinks(api: ElectronAPI) {
  void api.consumeInitialDeepLinks().then(emitDeepLinks)
  api.onDeepLink(emitDeepLinks)
}

function emitDeepLinks(urls: string[]) {
  if (urls.length === 0) return
  window.__USTCODE__ ??= {}
  window.__USTCODE__.deepLinks = [...(window.__USTCODE__.deepLinks ?? []), ...urls]
  window.dispatchEvent(new CustomEvent(deepLinkEvent, { detail: { urls } }))
}
