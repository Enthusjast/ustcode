export async function resolveBinary() {
  return process.env.USTCODE_PTY_BIN || "ustcode-pty"
}
