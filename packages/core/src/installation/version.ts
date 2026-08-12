declare global {
  const USTCODE_VERSION: string
  const USTCODE_CHANNEL: string
}

export const InstallationVersion = typeof USTCODE_VERSION === "string" ? USTCODE_VERSION : "local"
export const InstallationChannel = typeof USTCODE_CHANNEL === "string" ? USTCODE_CHANNEL : "local"
export const InstallationLocal = InstallationChannel === "local"
