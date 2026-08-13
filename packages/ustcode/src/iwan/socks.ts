import net from "node:net"
import { randomBytes } from "node:crypto"
import { resolveIpv4 } from "./dns"
import { controlPacket, dataPacket, PacketType, packetHeader, sessionKey, xor } from "./protocol"
import { buildTcpPacket, parseTcpOptions, parseTcpPacket, TcpFlags } from "./tcp"
import type { AuthResult } from "./protocol"
import type { TcpPacket } from "./tcp"
import type { UdpChannel } from "./udp"

const MAX_PACKET_PAYLOAD = 1200
const TCP_WINDOW = 1024 * 1024
const TCP_ADVERTISED_WINDOW = 0xffff
const TCP_WINDOW_SCALE = 4
const RETRANSMIT_AFTER = 1000
const MAX_RETRIES = 5
const KEEPALIVE_AFTER = 10_000
const CONNECT_TIMEOUT = 30_000
const LOCAL_PORT_START = 49152

type PendingSegment = {
  packet: Buffer
  sequence: number
  end: number
  flags: number
  sentAt: number
  retries: number
}

type FlowState = "greeting" | "request" | "resolving" | "connecting" | "established" | "closing"

type Flow = {
  socket: net.Socket
  state: FlowState
  input: Buffer
  output: Buffer
  localPort: number
  remoteIp?: string
  remoteHost?: string
  remotePort?: number
  sendSequence: number
  receiveSequence: number
  remoteWindow: number
  remoteWindowScale: number
  pending: PendingSegment[]
  lastActivity: number
  localFin: boolean
  remoteFin: boolean
  resolving: boolean
}

export type SocksStatus = {
  address: string
  port: number
  flows: number
}

export class Socks {
  readonly #udp: UdpChannel
  readonly #auth: AuthResult
  readonly #xorKey: Buffer
  readonly #encryption: number
  readonly #server: net.Server
  readonly #flows = new Set<Flow>()
  readonly #byPort = new Map<number, Flow>()
  readonly #timer: ReturnType<typeof setInterval>
  #nextPort = LOCAL_PORT_START
  #lastKeepalive = 0
  #stopped = false
  #onError: (error: Error) => void

  private constructor(input: {
    udp: UdpChannel
    auth: AuthResult
    username: string
    password: string
    encryption: number
    onError?: (error: Error) => void
  }) {
    this.#udp = input.udp
    this.#auth = input.auth
    this.#xorKey = sessionKey(input.username, input.password).subarray(0, 8)
    this.#encryption = input.encryption
    this.#onError = input.onError ?? (() => {})
    this.#server = net.createServer({ allowHalfOpen: true }, (socket) => this.#accept(socket))
    this.#udp.setHandler({
      data: (data) => this.#receiveVpn(data),
      error: (error) => this.#fail(error),
    })
    this.#timer = setInterval(() => this.#tick(), 50)
  }

  static async open(input: {
    udp: UdpChannel
    auth: AuthResult
    username: string
    password: string
    encryption: number
    onError?: (error: Error) => void
  }) {
    const instance = new Socks(input)
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => {
          input.udp.socket.close()
          reject(error)
        }
        instance.#server.once("error", onError)
        instance.#server.listen({ host: "127.0.0.1", port: 0 }, () => {
          instance.#server.off("error", onError)
          resolve()
        })
      })
      return instance
    } catch (error) {
      instance.stop()
      throw error
    }
  }

  status(): SocksStatus {
    const address = this.#server.address()
    if (!address || typeof address === "string") throw new Error("iWAN SOCKS listener is not ready")
    return { address: "127.0.0.1", port: address.port, flows: this.#flows.size }
  }

  stop() {
    if (this.#stopped) return
    this.#stopped = true
    clearInterval(this.#timer)
    if (this.#server.listening) this.#server.close()
    this.#udp.socket.close()
    for (const flow of this.#flows) flow.socket.destroy()
    this.#flows.clear()
    this.#byPort.clear()
  }

  #accept(socket: net.Socket) {
    if (this.#stopped) return socket.destroy()
    socket.setNoDelay(true)
    const flow: Flow = {
      socket,
      state: "greeting",
      input: Buffer.alloc(0),
      output: Buffer.alloc(0),
      localPort: 0,
      sendSequence: 0,
      receiveSequence: 0,
      remoteWindow: 65535,
      remoteWindowScale: 0,
      pending: [],
      lastActivity: Date.now(),
      localFin: false,
      remoteFin: false,
      resolving: false,
    }
    this.#flows.add(flow)
    socket.on("data", (data: Buffer) => {
      flow.input = Buffer.concat([flow.input, data])
      flow.lastActivity = Date.now()
      this.#processLocal(flow)
    })
    socket.on("end", () => {
      flow.localFin = true
      this.#flushRemote(flow)
    })
    socket.on("drain", () => this.#flushLocal(flow))
    socket.on("error", () => this.#closeFlow(flow))
    socket.on("close", () => this.#closeFlow(flow))
  }

  #processLocal(flow: Flow) {
    if (flow.state === "greeting") {
      if (flow.input.length < 2) return
      const methodsLength = flow.input[1]!
      if (flow.input.length < methodsLength + 2) return
      const version = flow.input[0]
      const methods = flow.input.subarray(2, methodsLength + 2)
      flow.input = flow.input.subarray(methodsLength + 2)
      if (version === 5 && methods.includes(0)) {
        this.#writeLocal(flow, Buffer.from([5, 0]))
        flow.state = "request"
      } else {
        this.#writeLocal(flow, Buffer.from([5, 0xff]))
        flow.state = "closing"
        flow.socket.end()
      }
    }

    if (flow.state !== "request") return
    if (flow.input.length < 4) return
    if (flow.input[0] !== 5 || flow.input[1] !== 1 || flow.input[2] !== 0) return this.#socksError(flow, 7)

    const addressType = flow.input[3]!
    if (addressType === 1) {
      if (flow.input.length < 10) return
      flow.remoteIp = Array.from(flow.input.subarray(4, 8)).join(".")
      flow.remoteHost = flow.remoteIp
      flow.remotePort = flow.input.readUInt16BE(8)
      flow.input = flow.input.subarray(10)
      return this.#openRemote(flow)
    }
    if (addressType !== 3) return this.#socksError(flow, 8)
    if (flow.input.length < 5) return
    const domainLength = flow.input[4]!
    const requestLength = 5 + domainLength + 2
    if (domainLength === 0 || flow.input.length < requestLength) return
    const domain = flow.input.subarray(5, 5 + domainLength).toString("utf8")
    flow.remoteHost = domain
    flow.remotePort = flow.input.readUInt16BE(5 + domainLength)
    flow.input = flow.input.subarray(requestLength)
    flow.state = "resolving"
    flow.resolving = true
    void resolveIpv4(domain).then(
      (ip) => {
        if (flow.state !== "resolving") return
        flow.resolving = false
        flow.remoteIp = ip
        this.#openRemote(flow)
      },
      () => {
        flow.resolving = false
        this.#socksError(flow, 4)
      },
    )
  }

  #openRemote(flow: Flow) {
    if (!flow.remoteIp || !flow.remotePort) return this.#socksError(flow, 1)
    const localPort = this.#allocatePort()
    if (!localPort) return this.#socksError(flow, 1)
    flow.localPort = localPort
    this.#byPort.set(localPort, flow)
    flow.state = "connecting"
    flow.sendSequence = randomBytes(4).readUInt32BE(0)
    flow.receiveSequence = 0
    flow.remoteWindow = 65535
    flow.remoteWindowScale = 0
    this.#sendSegment(flow, TcpFlags.syn, Buffer.alloc(0))
  }

  #receiveVpn(packet: Buffer) {
    if (packet.length < 8) return
    const type = packet[0]!
    if (packet.readUInt16BE(2) !== this.#auth.sid || packet.readUInt32BE(4) !== this.#auth.token) return
    if (type === PacketType.EchoRequest) {
      this.#sendControl(PacketType.EchoResponse)
      return
    }
    if (type === PacketType.Close) return this.#fail(new Error("iWAN server closed the tunnel"))
    if (type !== PacketType.Data && type !== PacketType.DataEncrypted) return
    let inner = packet.subarray(8)
    if (type === PacketType.DataEncrypted) inner = xor(inner, this.#xorKey)
    const tcp = parseTcpPacket(inner)
    if (!tcp || tcp.destination !== this.#auth.tunnelIp) return
    const flow = this.#byPort.get(tcp.destinationPort)
    if (!flow || flow.remoteIp !== tcp.source || flow.remotePort !== tcp.sourcePort) return
    this.#receiveTcp(flow, tcp)
  }

  #receiveTcp(flow: Flow, packet: TcpPacket) {
    flow.lastActivity = Date.now()
    if (packet.flags & TcpFlags.rst) return this.#closeFlow(flow)

    if (packet.flags & TcpFlags.ack) this.#acknowledge(flow, packet.acknowledgement)

    if (flow.state === "connecting" && packet.flags & TcpFlags.syn && packet.flags & TcpFlags.ack) {
      if (packet.acknowledgement !== flow.sendSequence) return
      const options = parseTcpOptions(packet.options)
      flow.remoteWindowScale = options.windowScale ?? 0
      flow.receiveSequence = (packet.sequence + 1) >>> 0
      flow.remoteWindow = scaledWindow(packet.window, flow.remoteWindowScale)
      flow.state = "established"
      this.#sendSegment(flow, TcpFlags.ack, Buffer.alloc(0), false)
      this.#writeLocal(
        flow,
        Buffer.from([
          5,
          0,
          0,
          1,
          ...this.#auth.tunnelIp.split(".").map(Number),
          flow.localPort >> 8,
          flow.localPort & 0xff,
        ]),
      )
      this.#processLocal(flow)
      this.#flushRemote(flow)
      return
    }

    if (flow.state !== "established" && flow.state !== "closing") return
    flow.remoteWindow = scaledWindow(packet.window, flow.remoteWindowScale)
    let acceptedPayload = false
    if (packet.payload.length > 0) {
      if (packet.sequence === flow.receiveSequence) {
        flow.receiveSequence = (flow.receiveSequence + packet.payload.length) >>> 0
        this.#writeLocal(flow, packet.payload)
        acceptedPayload = true
      }
      this.#sendSegment(flow, TcpFlags.ack, Buffer.alloc(0), false)
    }
    if (packet.flags & TcpFlags.fin) {
      const inOrder = packet.payload.length === 0 ? packet.sequence === flow.receiveSequence : acceptedPayload
      if (inOrder) {
        flow.receiveSequence = (flow.receiveSequence + 1) >>> 0
        flow.remoteFin = true
        this.#sendSegment(flow, TcpFlags.ack, Buffer.alloc(0), false)
        flow.socket.end()
        flow.state = "closing"
      }
    }
    this.#flushRemote(flow)
  }

  #acknowledge(flow: Flow, acknowledgement: number) {
    flow.pending = flow.pending.filter((segment) => !isSequenceAtOrBefore(segment.end, acknowledgement))
    this.#flushRemote(flow)
  }

  #flushRemote(flow: Flow) {
    if (flow.state !== "established" && flow.state !== "closing") return
    while (flow.input.length > 0 && this.#availableWindow(flow) > 0) {
      const length = Math.min(flow.input.length, MAX_PACKET_PAYLOAD, this.#availableWindow(flow))
      const payload = flow.input.subarray(0, length)
      flow.input = flow.input.subarray(length)
      this.#sendSegment(flow, TcpFlags.ack, payload)
    }
    if (flow.localFin && !flow.input.length && !flow.pending.some((segment) => segment.flags & TcpFlags.fin)) {
      this.#sendSegment(flow, TcpFlags.fin | TcpFlags.ack, Buffer.alloc(0))
    }
  }

  #availableWindow(flow: Flow) {
    const inFlight = flow.pending.reduce((total, segment) => total + sequenceDistance(segment.sequence, segment.end), 0)
    return Math.max(0, Math.min(flow.remoteWindow, TCP_WINDOW) - inFlight)
  }

  #sendSegment(flow: Flow, flags: number, payload: Buffer, track = true) {
    if (!flow.remoteIp || !flow.remotePort) return
    const packet = buildTcpPacket({
      source: this.#auth.tunnelIp,
      destination: flow.remoteIp,
      sourcePort: flow.localPort,
      destinationPort: flow.remotePort,
      sequence: flow.sendSequence,
      acknowledgement: flow.receiveSequence,
      flags,
      window: TCP_ADVERTISED_WINDOW,
      options: flags & TcpFlags.syn ? synOptions(this.#auth.mtu) : undefined,
      payload,
    })
    const start = flow.sendSequence
    flow.sendSequence =
      (flow.sendSequence + payload.length + (flags & TcpFlags.syn ? 1 : 0) + (flags & TcpFlags.fin ? 1 : 0)) >>> 0
    this.#sendInner(packet)
    if (track && (payload.length > 0 || flags & (TcpFlags.syn | TcpFlags.fin))) {
      flow.pending.push({
        packet,
        sequence: start,
        end: flow.sendSequence,
        flags,
        sentAt: Date.now(),
        retries: 0,
      })
    }
  }

  #sendInner(inner: Buffer) {
    const payload = this.#encryption === 0 ? inner : xor(inner, this.#xorKey)
    const type = this.#encryption === 0 ? PacketType.Data : PacketType.DataEncrypted
    this.#udp.socket.send(dataPacket(packetHeader(type, this.#encryption, this.#auth.sid, this.#auth.token), payload))
  }

  #sendControl(type: number) {
    const header = packetHeader(type, this.#encryption, this.#auth.sid, this.#auth.token)
    this.#udp.socket.send(controlPacket(header))
  }

  #tick() {
    if (this.#stopped) return
    const now = Date.now()
    if (now - this.#lastKeepalive >= KEEPALIVE_AFTER) {
      this.#sendControl(PacketType.EchoRequest)
      this.#lastKeepalive = now
    }
    for (const flow of [...this.#flows]) {
      const first = flow.pending[0]
      if (first && now - first.sentAt >= RETRANSMIT_AFTER) {
        if (first.retries >= MAX_RETRIES) {
          this.#socksError(flow, 4)
          continue
        }
        first.retries++
        first.sentAt = now
        this.#sendInner(first.packet)
      }
      if (flow.state === "connecting" && now - flow.lastActivity > CONNECT_TIMEOUT) this.#socksError(flow, 4)
      if (flow.state === "established" && now - flow.lastActivity > CONNECT_TIMEOUT * 4) this.#closeFlow(flow)
      this.#flushRemote(flow)
    }
  }

  #writeLocal(flow: Flow, data: Buffer) {
    if (flow.socket.destroyed) return
    flow.output = Buffer.concat([flow.output, data])
    this.#flushLocal(flow)
  }

  #flushLocal(flow: Flow) {
    if (flow.socket.destroyed) return
    while (flow.output.length > 0) {
      const output = flow.output
      flow.output = Buffer.alloc(0)
      if (!flow.socket.write(output) || !flow.socket.writable) return
    }
  }

  #socksError(flow: Flow, code: number) {
    if (flow.state === "closing") return
    flow.state = "closing"
    this.#writeLocal(flow, Buffer.from([5, code, 0, 1, 0, 0, 0, 0, 0, 0]))
    flow.socket.end()
  }

  #closeFlow(flow: Flow) {
    if (!this.#flows.delete(flow)) return
    this.#byPort.delete(flow.localPort)
    flow.socket.destroy()
  }

  #fail(error: Error) {
    if (this.#stopped) return
    this.#onError(error)
    this.stop()
  }

  #allocatePort() {
    for (let index = 0; index < 16384; index++) {
      const port = this.#nextPort
      this.#nextPort = this.#nextPort >= 65535 ? LOCAL_PORT_START : this.#nextPort + 1
      if (!this.#byPort.has(port)) return port
    }
    return undefined
  }
}

function synOptions(mtu: number) {
  const mss = Math.max(536, Math.min(1460, mtu - 40))
  return Buffer.from([2, 4, mss >> 8, mss & 0xff, 3, 3, TCP_WINDOW_SCALE, 4, 2, 0, 0, 0])
}

function scaledWindow(window: number, scale: number) {
  return Math.min(0x7fff_ffff, window * 2 ** scale)
}

function sequenceDistance(start: number, end: number) {
  return (end - start + 0x1_0000_0000) % 0x1_0000_0000
}

function isSequenceAtOrBefore(value: number, target: number) {
  return sequenceDistance(value, target) < 0x8000_0000
}

export * as IwanSocks from "./socks"
