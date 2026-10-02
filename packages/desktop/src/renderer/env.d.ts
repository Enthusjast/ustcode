import type { ElectronNative } from "../preload/types"

declare global {
  interface ImportMetaEnv {
    readonly USTCODE_TEST_ONBOARDING: boolean
  }

  interface Window {
    electron: ElectronNative
    __USTCODE__?: {
      deepLinks?: string[]
    }
  }
}
