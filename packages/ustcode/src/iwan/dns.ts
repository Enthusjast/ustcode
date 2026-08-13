import { randomBytes } from "node:crypto"

const DNS_HOST = "114.114.114.114"
const DNS_PORT = 53
const DNS_TIMEOUT = 3000

export async function resolveIpv4(domain: string) {
  const normalized = domain.trim().replace(/\.$/, "")
  if (!normalized || normalized.length > 253) throw new Error("invalid DNS name")

  const id = randomBytes(2).readUInt16BE(0)
  const query = buildQuery(id, normalized)
  let timer: ReturnType<typeof setTimeout> | undefined
  let resolveResponse: ((data: Buffer) => void) | undefined
  let rejectResponse: ((error: Error) => void) | undefined
  const socket = await Bun.udpSocket({
    connect: { hostname: DNS_HOST, port: DNS_PORT },
    socket: {
      data(_socket, data) {
        resolveResponse?.(Buffer.from(data))
      },
      error(_socket, error) {
        rejectResponse?.(error)
      },
    },
  })
  try {
    const response = await new Promise<Buffer>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`DNS lookup timed out for ${domain}`)), DNS_TIMEOUT)
      rejectResponse = reject
      resolveResponse = resolve
      socket.send(query)
    })
    return parseResponse(id, response)
  } finally {
    if (timer) clearTimeout(timer)
    rejectResponse = undefined
    resolveResponse = undefined
    socket.close()
  }
}

function buildQuery(id: number, domain: string) {
  const labels = domain.split(".")
  if (labels.some((label) => label.length === 0 || label.length > 63)) throw new Error("invalid DNS label")
  const encodedLabels = labels.map((label) => Buffer.from(label))
  const query = Buffer.alloc(12 + encodedLabels.reduce((total, label) => total + label.length + 1, 1) + 4)
  query.writeUInt16BE(id, 0)
  query.writeUInt16BE(0x0100, 2)
  query.writeUInt16BE(1, 4)
  let offset = 12
  for (const label of encodedLabels) {
    query[offset++] = label.length
    label.copy(query, offset)
    offset += label.length
  }
  query[offset++] = 0
  query.writeUInt16BE(1, offset)
  query.writeUInt16BE(1, offset + 2)
  return query.subarray(0, offset + 4)
}

function parseResponse(id: number, packet: Buffer) {
  if (packet.length < 12 || packet.readUInt16BE(0) !== id) throw new Error("invalid DNS response")
  const flags = packet.readUInt16BE(2)
  if ((flags & 0x8000) === 0 || (flags & 0x000f) !== 0) throw new Error("DNS lookup failed")
  const questions = packet.readUInt16BE(4)
  const answers = packet.readUInt16BE(6)
  let offset = 12
  for (let index = 0; index < questions; index++) {
    offset = skipName(packet, offset) + 4
    if (offset > packet.length) throw new Error("truncated DNS question")
  }
  for (let index = 0; index < answers; index++) {
    offset = skipName(packet, offset)
    if (offset + 10 > packet.length) throw new Error("truncated DNS answer")
    const type = packet.readUInt16BE(offset)
    const klass = packet.readUInt16BE(offset + 2)
    const length = packet.readUInt16BE(offset + 8)
    offset += 10
    if (offset + length > packet.length) throw new Error("truncated DNS record")
    if (type === 1 && klass === 1 && length === 4) return Array.from(packet.subarray(offset, offset + 4)).join(".")
    offset += length
  }
  throw new Error("DNS name has no IPv4 address")
}

function skipName(packet: Buffer, start: number) {
  let offset = start
  while (true) {
    if (offset >= packet.length) throw new Error("truncated DNS name")
    const length = packet[offset]!
    if ((length & 0xc0) === 0xc0) {
      if (offset + 2 > packet.length) throw new Error("truncated DNS pointer")
      return offset + 2
    }
    if ((length & 0xc0) !== 0) throw new Error("invalid DNS label")
    offset++
    if (length === 0) return offset
    offset += length
  }
}

export * as IwanDns from "./dns"
