type MouseTerminal = {
  cols: number
  rows: number
  wasmTerm?: {
    getMode(mode: number, isAnsi?: boolean): boolean
    hasMouseTracking(): boolean
  }
  input(data: string, wasUserInput?: boolean): void
}

export function bindMouseTracking(container: HTMLElement, terminal: MouseTerminal) {
  const canvas = container.querySelector("canvas")
  if (!canvas) return () => {}

  let buttons = 0

  const mode = (id: number) => terminal.wasmTerm?.getMode(id) ?? false
  const tracked = () => terminal.wasmTerm?.hasMouseTracking() ?? false
  const position = (event: MouseEvent | WheelEvent) => {
    const rect = canvas.getBoundingClientRect()
    const width = rect.width || canvas.width || terminal.cols
    const height = rect.height || canvas.height || terminal.rows
    return {
      col: Math.max(1, Math.min(terminal.cols, Math.floor((event.clientX - rect.left) / (width / terminal.cols)) + 1)),
      row: Math.max(1, Math.min(terminal.rows, Math.floor((event.clientY - rect.top) / (height / terminal.rows)) + 1)),
    }
  }
  const send = (button: number, event: MouseEvent | WheelEvent, release = false) => {
    const location = position(event)
    const modifiers = (event.shiftKey ? 4 : 0) + (event.altKey ? 8 : 0) + (event.ctrlKey ? 16 : 0)
    if (mode(1006)) {
      terminal.input(`\u001b[<${button + modifiers};${location.col};${location.row}${release ? "m" : "M"}`, true)
      return
    }
    if (mode(1015)) {
      terminal.input(`\u001b[${button + modifiers + 32};${location.col};${location.row}M`, true)
      return
    }
    const code = (release ? 3 : button) + modifiers + 32
    terminal.input(
      `\u001b[M${String.fromCharCode(Math.min(code, 255))}${String.fromCharCode(Math.min(location.col + 32, 255))}${String.fromCharCode(Math.min(location.row + 32, 255))}`,
      true,
    )
  }
  const stop = (event: Event) => {
    event.preventDefault()
    event.stopImmediatePropagation()
  }
  const onMouseDown = (event: MouseEvent) => {
    if (event.target !== canvas || event.shiftKey || !tracked() || event.button > 2) return
    buttons |= 1 << event.button
    send(event.button, event)
    stop(event)
  }
  const onMouseUp = (event: MouseEvent) => {
    if (!buttons) return
    const button = event.button <= 2 && buttons & (1 << event.button) ? event.button : Math.log2(buttons & -buttons)
    buttons &= ~(1 << button)
    send(button, event, true)
    stop(event)
  }
  const onMouseMove = (event: MouseEvent) => {
    if (event.shiftKey || !tracked()) return
    if (event.target !== canvas) {
      if (!container.contains(event.target instanceof Node ? event.target : null) && buttons && (mode(1002) || mode(1003))) {
        send(Math.log2(buttons & -buttons), event)
        stop(event)
      }
      return
    }
    if (!mode(1002) && !mode(1003)) return
    if (mode(1002) && !mode(1003) && !buttons) return
    const button = buttons ? Math.log2(buttons & -buttons) : 35
    send(button, event)
    stop(event)
  }
  const onWheel = (event: WheelEvent) => {
    if (event.target !== canvas || event.shiftKey || !tracked() || (event.deltaX === 0 && event.deltaY === 0)) return
    const button = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? (event.deltaX < 0 ? 66 : 67) : event.deltaY < 0 ? 64 : 65
    send(button, event)
    stop(event)
  }

  document.addEventListener("mousedown", onMouseDown, true)
  document.addEventListener("mousemove", onMouseMove, true)
  document.addEventListener("wheel", onWheel, true)
  document.addEventListener("mouseup", onMouseUp, true)

  return () => {
    document.removeEventListener("mousedown", onMouseDown, true)
    document.removeEventListener("mousemove", onMouseMove, true)
    document.removeEventListener("wheel", onWheel, true)
    document.removeEventListener("mouseup", onMouseUp, true)
    buttons = 0
  }
}
