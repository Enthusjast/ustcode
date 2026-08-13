import { ipv4Bytes } from "./protocol"

const FLAG_FIN = 0x01
const FLAG_SYN = 0x02
const FLAG_RST = 0x04
const FLAG_ACK = 0x10

export type TcpPacket = {
  source: string
  destination: string
  sourcePort: number
  destinationPort: number
  sequence: number
  acknowledgement: number
  flags: number
  window: number
  options: Buffer
  payload: Buffer
}

export type TcpSegment = {
  sequence: number
  acknowledgement: number
  flags: number
  payload: Buffer
}

export function parseTcpPacket(packet: Uint8Array): TcpPacket | undefined {
  if (packet.length < 40 || packet[0]! >> 4 !== 4 || packet[9] !== 6) return
  const headerLength = (packet[0]! & 0x0f) * 4
  if (headerLength < 20 || packet.length < headerLength + 20) return
  const totalLength = Math.min(
    packet.length,
    new DataView(packet.buffer, packet.byteOffset, packet.byteLength).getUint16(2),
  )
  const tcpOffset = headerLength
  const tcpLength = packet[tcpOffset + 12]! >> 4
  const tcpHeaderLength = tcpLength * 4
  if (tcpHeaderLength < 20 || totalLength < tcpOffset + tcpHeaderLength) return
  return {
    source: Array.from(packet.subarray(12, 16)).join("."),
    destination: Array.from(packet.subarray(16, 20)).join("."),
    sourcePort: readU16(packet, tcpOffset),
    destinationPort: readU16(packet, tcpOffset + 2),
    sequence: readU32(packet, tcpOffset + 4),
    acknowledgement: readU32(packet, tcpOffset + 8),
    flags: packet[tcpOffset + 13]!,
    window: readU16(packet, tcpOffset + 14),
    options: Buffer.from(packet.subarray(tcpOffset + 20, tcpOffset + tcpHeaderLength)),
    payload: Buffer.from(packet.subarray(tcpOffset + tcpHeaderLength, totalLength)),
  }
}

export function buildTcpPacket(input: {
  source: string
  destination: string
  sourcePort: number
  destinationPort: number
  sequence: number
  acknowledgement: number
  flags: number
  window?: number
  payload?: Uint8Array
  options?: Uint8Array
  identification?: number
}) {
  const payload = Buffer.from(input.payload ?? new Uint8Array())
  const options = Buffer.from(input.options ?? new Uint8Array())
  if (options.length > 40 || options.length % 4 !== 0)
    throw new Error("TCP options must be padded to a 4-byte boundary")
  const tcpHeaderLength = 20 + options.length
  const packet = Buffer.alloc(20 + tcpHeaderLength + payload.length)
  packet[0] = 0x45
  packet[1] = 0
  packet.writeUInt16BE(packet.length, 2)
  packet.writeUInt16BE(input.identification ?? Math.floor(Math.random() * 0x10000), 4)
  packet.writeUInt16BE(0x4000, 6)
  packet[8] = 64
  packet[9] = 6
  ipv4Bytes(input.source).copy(packet, 12)
  ipv4Bytes(input.destination).copy(packet, 16)
  packet.writeUInt16BE(input.sourcePort, 20)
  packet.writeUInt16BE(input.destinationPort, 22)
  packet.writeUInt32BE(input.sequence >>> 0, 24)
  packet.writeUInt32BE(input.acknowledgement >>> 0, 28)
  packet[32] = (tcpHeaderLength / 4) << 4
  packet[33] = input.flags
  packet.writeUInt16BE(input.window ?? 65535, 34)
  packet.writeUInt16BE(0, 36)
  packet.writeUInt16BE(0, 38)
  options.copy(packet, 40)
  payload.copy(packet, 20 + tcpHeaderLength)
  packet.writeUInt16BE(checksum(packet.subarray(0, 20)), 10)
  packet.writeUInt16BE(tcpChecksum(packet), 36)
  return packet
}

export type TcpOptions = {
  mss?: number
  windowScale?: number
  sackPermitted: boolean
}

export function parseTcpOptions(options: Uint8Array): TcpOptions {
  let mss: number | undefined
  let windowScale: number | undefined
  let sackPermitted = false
  let offset = 0
  while (offset < options.length) {
    const kind = options[offset]!
    if (kind === 0) break
    if (kind === 1) {
      offset++
      continue
    }
    if (offset + 2 > options.length) break
    const length = options[offset + 1]!
    if (length < 2 || offset + length > options.length) break
    if (kind === 2 && length === 4) mss = readU16(options, offset + 2)
    if (kind === 3 && length === 3) windowScale = Math.min(options[offset + 2]!, 14)
    if (kind === 4 && length === 2) sackPermitted = true
    offset += length
  }
  return { mss, windowScale, sackPermitted }
}

export function sequenceEnd(segment: Pick<TcpSegment, "sequence" | "flags" | "payload">) {
  return (
    (segment.sequence +
      segment.payload.length +
      ((segment.flags & FLAG_SYN) !== 0 ? 1 : 0) +
      ((segment.flags & FLAG_FIN) !== 0 ? 1 : 0)) >>>
    0
  )
}

export const TcpFlags = {
  fin: FLAG_FIN,
  syn: FLAG_SYN,
  rst: FLAG_RST,
  ack: FLAG_ACK,
} as const

function tcpChecksum(packet: Buffer) {
  const pseudo = Buffer.alloc(12)
  packet.subarray(12, 20).copy(pseudo, 0)
  pseudo[9] = 6
  pseudo.writeUInt16BE(packet.length - 20, 10)
  const tcp = Buffer.from(packet.subarray(20))
  tcp.writeUInt16BE(0, 16)
  return checksum(Buffer.concat([pseudo, tcp]))
}

function checksum(data: Uint8Array) {
  let sum = 0
  for (let index = 0; index < data.length - 1; index += 2) sum += (data[index]! << 8) | data[index + 1]!
  if (data.length % 2) sum += data[data.length - 1]! << 8
  while (sum >>> 16) sum = (sum & 0xffff) + (sum >>> 16)
  return ~sum & 0xffff
}

function readU16(data: Uint8Array, offset: number) {
  return (data[offset]! << 8) | data[offset + 1]!
}

function readU32(data: Uint8Array, offset: number) {
  return (data[offset]! * 0x1000000 + (data[offset + 1]! << 16) + (data[offset + 2]! << 8) + data[offset + 3]!) >>> 0
}

export * as IwanTcp from "./tcp"
